# FMB TimeTracker Simple Deployment Script
param(
    [string]$InstallPath = "C:\fmb-timetracker"
)

Write-Host "🚀 FMB TimeTracker Deployment" -ForegroundColor Green

# Check admin privileges
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "❌ Run as Administrator" -ForegroundColor Red
    exit 1
}

# Create logs directory
if (-not (Test-Path "$InstallPath\logs")) {
    New-Item -ItemType Directory -Path "$InstallPath\logs" -Force | Out-Null
}

# Check .env file
if (-not (Test-Path ".env")) {
    if (Test-Path "fmb-onprem/.env.fmb-onprem") {
        Copy-Item "fmb-onprem/.env.fmb-onprem" ".env"
        Write-Host "✅ Environment file copied" -ForegroundColor Green
    } else {
        Write-Host "❌ No .env file found" -ForegroundColor Red
        exit 1
    }
}

# Stop existing processes
Write-Host "⏹️ Stopping application..." -ForegroundColor Yellow
npx pm2 delete fmb-timetracker 2>$null

# Install dependencies
Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
npm install --legacy-peer-deps

# Build application
Write-Host "🔨 Building..." -ForegroundColor Yellow
npm run build

if (-not (Test-Path "dist/index.js")) {
    Write-Host "❌ Build failed" -ForegroundColor Red
    exit 1
}

# Start application
Write-Host "▶️ Starting application..." -ForegroundColor Yellow
npx pm2 start ecosystem.config.cjs

# Wait and check status
Start-Sleep -Seconds 15
$status = npx pm2 jlist | ConvertFrom-Json
$app = $status | Where-Object { $_.name -eq "fmb-timetracker" }

if ($app -and $app.pm2_env.status -eq "online") {
    Write-Host "✅ Deployment successful!" -ForegroundColor Green
    Write-Host "🌐 Check: http://localhost:3000" -ForegroundColor Green
    
    # Health check
    Start-Sleep -Seconds 5
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3000/health" -UseBasicParsing -TimeoutSec 10
        if ($response.StatusCode -eq 200) {
            Write-Host "✅ Health check passed" -ForegroundColor Green
        }
    } catch {
        Write-Host "⚠️ Health check failed - check logs" -ForegroundColor Yellow
    }
} else {
    Write-Host "❌ Deployment failed" -ForegroundColor Red
    npx pm2 logs fmb-timetracker --lines 10
    exit 1
}

Write-Host "📋 Commands: npx pm2 status | npx pm2 logs" -ForegroundColor Cyan