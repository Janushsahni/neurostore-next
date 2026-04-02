$ErrorActionPreference = "Stop"

$RegisterBody = @{
    email = "jwt-test-user-5@neurostore.network"
    password = "SuperSecretPassword123!"
} | ConvertTo-Json

try {
    Write-Host "Registering test user..."
    $RegisterResponse = Invoke-RestMethod -Uri "https://neurostore-backend-production.up.railway.app/api/register" -Method Post -Headers @{"Content-Type"="application/json"} -Body $RegisterBody
    $jwt = $RegisterResponse.token

    if (-not [string]::IsNullOrWhiteSpace($jwt)) {
        Write-Host "✅ JWT generation is working! Got JWT token."
        Write-Host "Token starts with: $($jwt.Substring(0, 20))..."
        
        Write-Host "`nTesting standard Bearer authentication..."
        $SessionResponse = Invoke-RestMethod -Uri "https://neurostore-backend-production.up.railway.app/api/session" -Method Get -Headers @{
            "Authorization" = "Bearer $jwt"
        }
        
        Write-Host "✅ JWT verification (Bearer) is working! User profile returned:"
        $SessionResponse.user | ConvertTo-Json
    }
} catch {
    Write-Host "❌ Request failed with status $($_.Exception.Response.StatusCode.value__)!"
    
    $stream = $_.Exception.Response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream)
    $responseBody = $reader.ReadToEnd()
    Write-Host "Response body:"
    Write-Host $responseBody
}
