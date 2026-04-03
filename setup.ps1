# NeuroStore — One-Command Development Setup (Windows)
# Usage: powershell -ExecutionPolicy Bypass -File setup.ps1

$ErrorActionPreference = "Stop"
$ROOT = $PSScriptRoot
if (-not $ROOT) { $ROOT = (Get-Location).Path }

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║        NeuroStore — Development Environment         ║" -ForegroundColor Cyan
Write-Host "  ║             One-Command Setup Script                ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

function Step {
    param([string]$Name, [scriptblock]$Action)
    Write-Host "  [*] $Name..." -ForegroundColor Yellow -NoNewline
    try {
        & $Action
        Write-Host " OK" -ForegroundColor Green
    } catch {
        Write-Host " FAILED" -ForegroundColor Red
        Write-Host "      Error: $_" -ForegroundColor Red
        return $false
    }
    return $true
}

# ── Step 1: Check Node.js ──
$nodeOk = Step "Checking Node.js" {
    $ver = node --version 2>$null
    if (-not $ver) { throw "Node.js not found. Install from https://nodejs.org" }
    $major = [int]($ver -replace 'v','').Split('.')[0]
    if ($major -lt 20) { throw "Node.js 20+ required (found $ver)" }
    Write-Host " ($ver)" -NoNewline -ForegroundColor DarkGray
}
if (-not $nodeOk) { exit 1 }

# ── Step 2: Check npm ──
$npmOk = Step "Checking npm" {
    $ver = npm --version 2>$null
    if (-not $ver) { throw "npm not found" }
    Write-Host " (v$ver)" -NoNewline -ForegroundColor DarkGray
}
if (-not $npmOk) { exit 1 }

# ── Step 3: Generate .env for control-plane ──
Step "Generating control-plane .env" {
    $cpEnv = Join-Path $ROOT "services\control-plane\.env"
    if (-not (Test-Path $cpEnv) -or -not (Select-String -Path $cpEnv -Pattern "NODE_SHARED_SECRET" -Quiet -ErrorAction SilentlyContinue)) {
        $macaroonSecret = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 48 | ForEach-Object { [char]$_ })
        $nodeSecret = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 48 | ForEach-Object { [char]$_ })
        @"
PORT=8080
ENVIRONMENT=development
DATABASE_URL=postgres://neuro_admin:neuro_dev_password_2026@localhost:5432/neurostore_production
MACAROON_SECRET=$macaroonSecret
NODE_SHARED_SECRET=$nodeSecret
SESSION_TTL_SECS=86400
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
COOKIE_SECURE=false
"@ | Set-Content $cpEnv -Encoding UTF8
    }
}

# ── Step 4: Generate .env for frontend ──
Step "Generating frontend .env" {
    $feEnv = Join-Path $ROOT "frontend\.env"
    if (-not (Test-Path $feEnv)) {
        "VITE_API_URL=http://localhost:8080" | Set-Content $feEnv -Encoding UTF8
    }
}

# ── Step 5: Install control-plane dependencies ──
Step "Installing control-plane dependencies" {
    Push-Location (Join-Path $ROOT "services\control-plane")
    npm install --silent 2>&1 | Out-Null
    Pop-Location
}

# ── Step 6: Install frontend dependencies ──
Step "Installing frontend dependencies" {
    Push-Location (Join-Path $ROOT "frontend")
    npm install --silent 2>&1 | Out-Null
    Pop-Location
}

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║              Setup Complete!                        ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  To start the development servers:" -ForegroundColor Cyan
Write-Host ""
Write-Host "    Backend:  cd services\control-plane && npm start" -ForegroundColor White
Write-Host "    Frontend: cd frontend && npm run dev" -ForegroundColor White
Write-Host ""
Write-Host "  Prerequisites:" -ForegroundColor Yellow
Write-Host "    - PostgreSQL running on localhost:5432" -ForegroundColor DarkGray
Write-Host "    - Database 'neurostore_production' created" -ForegroundColor DarkGray
Write-Host "    - User 'neuro_admin' with password from .env" -ForegroundColor DarkGray
Write-Host ""
