[CmdletBinding()]
param(
    [string]$ControlPlaneUrl = "http://127.0.0.1:8080",
    [string]$NodesFile = (Join-Path $PSScriptRoot "..\..\examples\windows-multi-laptop-nodes.sample.json"),
    [string]$ProjectName = "multi-laptop-test",
    [string]$BillingEmail = "ops@example.test",
    [ValidateSet("archive", "active")]
    [string]$Tier = "active",
    [ValidateSet("balanced", "durability", "latency", "cost")]
    [string]$Objective = "latency",
    [int]$ReplicaCount = 2,
    [switch]$AutoReplica,
    [int]$MaxHeartbeatAgeMin = 30,
    [int]$ObjectSizeMb = 8,
    [string]$DegradeNodeId = "",
    [double]$DegradeLatencyMs = 2200,
    [double]$DegradeUptimePct = 91,
    [double]$DegradeProofSuccessPct = 84,
    [double]$DegradeAvailableGb = 5,
    [double]$UsageStorageGbHours = 7200,
    [double]$UsageEgressGb = 400,
    [double]$UsageApiOps = 1200000,
    [string]$OutDir = (Join-Path (Get-Location) "artifacts\multi-laptop-test")
)

$ErrorActionPreference = "Stop"

function Invoke-ApiJson {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("GET", "POST")]
        [string]$Method,
        [Parameter(Mandatory = $true)]
        [string]$Path,
        $Body
    )

    $base = $script:ControlPlaneUrl.TrimEnd("/")
    $uri = "$base$Path"
    $request = @{
        Uri = $uri
        Method = $Method
    }
    if ($null -ne $Body) {
        $request["ContentType"] = "application/json"
        $request["Body"] = ($Body | ConvertTo-Json -Depth 20 -Compress)
    }

    try {
        return Invoke-RestMethod @request
    } catch {
        $details = $_.Exception.Message
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            $details = "$details`n$($_.ErrorDetails.Message)"
        }
        throw "API call failed: $Method $uri`n$details"
    }
}

function Save-Json {
    param(
        [Parameter(Mandatory = $true)]
        $Data,
        [Parameter(Mandatory = $true)]
        [string]$Path
    )
    $Data | ConvertTo-Json -Depth 30 | Set-Content -Path $Path -Encoding UTF8
}

function To-SafeFileName {
    param([Parameter(Mandatory = $true)][string]$Text)
    $safe = $Text
    foreach ($char in [System.IO.Path]::GetInvalidFileNameChars()) {
        $safe = $safe.Replace([string]$char, "_")
    }
    return $safe.Replace(":", "_").Replace("/", "_")
}

function Resolve-Number {
    param($Value, [double]$DefaultValue)
    if ($null -eq $Value) {
        return $DefaultValue
    }
    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text)) {
        return $DefaultValue
    }
    return [double]$Value
}

function Resolve-String {
    param($Value, [string]$DefaultValue)
    if ($null -eq $Value) {
        return $DefaultValue
    }
    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text)) {
        return $DefaultValue
    }
    return $text.Trim()
}

if (-not (Test-Path -Path $NodesFile -PathType Leaf)) {
    throw "Nodes file not found: $NodesFile"
}

$nodesRaw = Get-Content -Path $NodesFile -Raw
$nodes = @($nodesRaw | ConvertFrom-Json)
if ($nodes.Count -lt 3) {
    throw "Nodes file must contain at least 3 nodes for failover testing."
}

foreach ($node in $nodes) {
    if ([string]::IsNullOrWhiteSpace([string]$node.node_id)) {
        throw "Each node row must include node_id."
    }
    if ([string]::IsNullOrWhiteSpace([string]$node.wallet)) {
        throw "Each node row must include wallet."
    }
}

$runDir = Join-Path $OutDir (Get-Date -Format "yyyyMMdd-HHmmss")
New-Item -Path $runDir -ItemType Directory -Force | Out-Null

Write-Host "[1/9] Checking control-plane readiness"
$ready = Invoke-ApiJson -Method "GET" -Path "/readyz"
Save-Json -Data $ready -Path (Join-Path $runDir "readyz.json")
if (-not $ready.ok) {
    throw "Control plane is not healthy: /readyz returned ok=false"
}

Write-Host "[2/9] Creating project"
$projectResp = Invoke-ApiJson -Method "POST" -Path "/v1/projects" -Body @{
    name = $ProjectName
    billing_email = $BillingEmail
    tier = $Tier
}
Save-Json -Data $projectResp -Path (Join-Path $runDir "project.json")
$projectId = [string]$projectResp.project.project_id
if ([string]::IsNullOrWhiteSpace($projectId)) {
    throw "Project creation failed: missing project_id"
}

Write-Host "[3/9] Registering nodes"
foreach ($node in $nodes) {
    $registerBody = @{
        node_id = [string]$node.node_id
        wallet = [string]$node.wallet
        region = Resolve-String -Value $node.region -DefaultValue "global"
        asn = Resolve-String -Value $node.asn -DefaultValue "unknown"
        capacity_gb = Resolve-Number -Value $node.capacity_gb -DefaultValue 100
        available_gb = Resolve-Number -Value $node.available_gb -DefaultValue 90
        bandwidth_mbps = Resolve-Number -Value $node.bandwidth_mbps -DefaultValue 100
    }
    $reg = Invoke-ApiJson -Method "POST" -Path "/v1/nodes/register" -Body $registerBody
    $safeId = To-SafeFileName -Text ([string]$node.node_id)
    Save-Json -Data $reg -Path (Join-Path $runDir "register-$safeId.json")
}

Write-Host "[4/9] Sending healthy heartbeats"
foreach ($node in $nodes) {
    $heartbeat = $node.heartbeat
    $availableFallback = Resolve-Number -Value $node.available_gb -DefaultValue 90
    $heartbeatBody = @{
        node_id = [string]$node.node_id
        uptime_pct = Resolve-Number -Value $heartbeat.uptime_pct -DefaultValue 99.5
        latency_ms = Resolve-Number -Value $heartbeat.latency_ms -DefaultValue 65
        proof_success_pct = Resolve-Number -Value $heartbeat.proof_success_pct -DefaultValue 99.2
        available_gb = Resolve-Number -Value $heartbeat.available_gb -DefaultValue $availableFallback
        bandwidth_mbps = Resolve-Number -Value $heartbeat.bandwidth_mbps -DefaultValue (Resolve-Number -Value $node.bandwidth_mbps -DefaultValue 100)
    }
    $hb = Invoke-ApiJson -Method "POST" -Path "/v1/nodes/heartbeat" -Body $heartbeatBody
    $safeId = To-SafeFileName -Text ([string]$node.node_id)
    Save-Json -Data $hb -Path (Join-Path $runDir "heartbeat-healthy-$safeId.json")
}

Write-Host "[5/9] Ingesting project usage and capturing baseline AI outputs"
$usageResp = Invoke-ApiJson -Method "POST" -Path "/v1/usage/ingest" -Body @{
    project_id = $projectId
    storage_gb_hours = $UsageStorageGbHours
    egress_gb = $UsageEgressGb
    api_ops = $UsageApiOps
}
Save-Json -Data $usageResp -Path (Join-Path $runDir "usage-ingest.json")

$riskBefore = Invoke-ApiJson -Method "GET" -Path "/v1/ai/nodes/risk?limit=200"
Save-Json -Data $riskBefore -Path (Join-Path $runDir "risk-before.json")

$encodedProjectId = [System.Uri]::EscapeDataString($projectId)
$strategyBefore = Invoke-ApiJson -Method "GET" -Path "/v1/ai/placement/strategy?project_id=$encodedProjectId&objective=$Objective&object_size_mb=$ObjectSizeMb"
Save-Json -Data $strategyBefore -Path (Join-Path $runDir "strategy-before.json")

if ([string]::IsNullOrWhiteSpace($DegradeNodeId)) {
    $DegradeNodeId = [string]$nodes[0].node_id
}

if (-not (@($nodes | Where-Object { [string]$_.node_id -eq $DegradeNodeId }).Count -gt 0)) {
    throw "DegradeNodeId '$DegradeNodeId' was not found in nodes file."
}

Write-Host "[6/9] Injecting bad heartbeat and proof failure for node '$DegradeNodeId'"
$degradeHeartbeat = Invoke-ApiJson -Method "POST" -Path "/v1/nodes/heartbeat" -Body @{
    node_id = $DegradeNodeId
    uptime_pct = $DegradeUptimePct
    latency_ms = $DegradeLatencyMs
    proof_success_pct = $DegradeProofSuccessPct
    available_gb = $DegradeAvailableGb
}
Save-Json -Data $degradeHeartbeat -Path (Join-Path $runDir "heartbeat-degraded.json")

$proofFailure = Invoke-ApiJson -Method "POST" -Path "/v1/proofs/submit" -Body @{
    node_id = $DegradeNodeId
    ok = $false
    proof_latency_ms = [int][Math]::Round($DegradeLatencyMs)
    bytes_proven = 1048576
}
Save-Json -Data $proofFailure -Path (Join-Path $runDir "proof-failure.json")

Write-Host "[7/9] Capturing AI outputs after degradation"
$riskAfter = Invoke-ApiJson -Method "GET" -Path "/v1/ai/nodes/risk?limit=200"
Save-Json -Data $riskAfter -Path (Join-Path $runDir "risk-after.json")

$placementAfter = Invoke-ApiJson -Method "POST" -Path "/v1/placement/suggest" -Body @{
    project_id = $projectId
    objective = $Objective
    object_size_mb = $ObjectSizeMb
    replica_count = $ReplicaCount
    auto_replica = [bool]$AutoReplica
    min_score = 0
    max_heartbeat_age_min = $MaxHeartbeatAgeMin
}
Save-Json -Data $placementAfter -Path (Join-Path $runDir "placement-after.json")

Write-Host "[8/9] Building summary"
$beforeRow = @($riskBefore.risks | Where-Object { $_.node_id -eq $DegradeNodeId } | Select-Object -First 1)
$afterRow = @($riskAfter.risks | Where-Object { $_.node_id -eq $DegradeNodeId } | Select-Object -First 1)
$selectedNodeIds = @($placementAfter.selected | ForEach-Object { $_.node_id })
$degradedSelected = $selectedNodeIds -contains $DegradeNodeId

$summary = [ordered]@{
    generated_at = (Get-Date).ToUniversalTime().ToString("o")
    run_dir = $runDir
    control_plane_url = $ControlPlaneUrl
    project_id = $projectId
    objective = $Objective
    requested_replica_count = $ReplicaCount
    auto_replica = [bool]$AutoReplica
    degraded_node_id = $DegradeNodeId
    degraded_node_risk_before = if ($beforeRow) { $beforeRow.risk.risk_score } else { $null }
    degraded_node_risk_after = if ($afterRow) { $afterRow.risk.risk_score } else { $null }
    degraded_node_selected_after = $degradedSelected
    selected_nodes_after = $selectedNodeIds
    ai_recommended_replica_count = $placementAfter.ai_strategy.recommended_policy.replica_count
    ai_recommended_erasure_profile = $placementAfter.ai_strategy.recommended_policy.erasure_profile
}

Save-Json -Data $summary -Path (Join-Path $runDir "summary.json")

Write-Host "[9/9] Completed"
Write-Host ""
Write-Host "Project ID                     : $($summary.project_id)"
Write-Host "Degraded node                 : $($summary.degraded_node_id)"
Write-Host "Risk before -> after          : $($summary.degraded_node_risk_before) -> $($summary.degraded_node_risk_after)"
Write-Host "Selected after degradation    : $($summary.degraded_node_selected_after)"
Write-Host "AI recommended replica count  : $($summary.ai_recommended_replica_count)"
Write-Host "Run artifacts                 : $runDir"
