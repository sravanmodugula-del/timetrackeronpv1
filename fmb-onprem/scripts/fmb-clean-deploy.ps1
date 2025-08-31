
# FMB TimeTracker Clean Deployment Script
# Cleans previous builds and deploys latest code

param(
    [string]$InstallPath = "C:\fmb-timetracker"
)

Write-Host "🧹 FMB TimeTracker Clean Deployment" -ForegroundColor Green
Write-Host "====================================" -ForegroundColor Green

# Check admin privileges
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "❌ Run as Administrator" -ForegroundColor Red
    exit 1
}

# Set working directory
Set-Location $InstallPath

# Stop existing application
Write-Host "⏹️ Stopping application..." -ForegroundColor Yellow
npx pm2 delete fmb-timetracker 2>$null
Start-Sleep -Seconds 3

# Clean previous builds
Write-Host "🧹 Cleaning previous builds..." -ForegroundColor Yellow
if (Test-Path "dist") {
    Remove-Item -Path "dist" -Recurse -Force
    Write-Host "   ✅ Removed dist folder" -ForegroundColor Green
}

if (Test-Path "node_modules") {
    Remove-Item -Path "node_modules" -Recurse -Force
    Write-Host "   ✅ Removed node_modules folder" -ForegroundColor Green
}

# Clean npm cache
Write-Host "🧹 Cleaning npm cache..." -ForegroundColor Yellow
npm cache clean --force

# Create logs directory if it doesn't exist
if (-not (Test-Path "logs")) {
    New-Item -ItemType Directory -Path "logs" -Force | Out-Null
    Write-Host "   ✅ Created logs directory" -ForegroundColor Green
}

# Check environment file
Write-Host "🔍 Checking environment configuration..." -ForegroundColor Yellow
if (-not (Test-Path ".env")) {
    if (Test-Path "fmb-onprem/.env.fmb-onprem") {
        Copy-Item "fmb-onprem/.env.fmb-onprem" ".env"
        Write-Host "   ✅ Environment file copied" -ForegroundColor Green
    } else {
        Write-Host "   ❌ No .env file found" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "   ✅ Environment file exists" -ForegroundColor Green
}

# Fresh install of dependencies
Write-Host "📦 Installing fresh dependencies..." -ForegroundColor Yellow
npm install --legacy-peer-deps

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Dependency installation failed" -ForegroundColor Red
    exit 1
}

Write-Host "   ✅ Dependencies installed" -ForegroundColor Green

# Set production environment variables
$env:NODE_ENV = "production"
$env:FMB_DEPLOYMENT = "onprem"

# Build application
Write-Host "🔨 Building application..." -ForegroundColor Yellow
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed" -ForegroundColor Red
    exit 1
}

# Verify build output
if (-not (Test-Path "dist/index.js")) {
    Write-Host "❌ Build output missing - dist/index.js not found" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path "dist/public")) {
    Write-Host "❌ Build output missing - dist/public not found" -ForegroundColor Red
    exit 1
}

Write-Host "   ✅ Build completed successfully" -ForegroundColor Green

# Start application with PM2
Write-Host "▶️ Starting application..." -ForegroundColor Yellow
npx pm2 start ecosystem.config.cjs

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to start application with PM2" -ForegroundColor Red
    exit 1
}

# Wait for application to start
Write-Host "⏳ Waiting for application to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 15

# Check PM2 status
$status = npx pm2 jlist | ConvertFrom-Json
$app = $status | Where-Object { $_.name -eq "fmb-timetracker" }

if ($app -and $app.pm2_env.status -eq "online") {
    Write-Host "✅ Application started successfully!" -ForegroundColor Green
    Write-Host "🌐 Application URL: http://localhost:3000" -ForegroundColor Green
    
    # Health check
    Write-Host "🏥 Performing health check..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
    
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3000/api/health" -UseBasicParsing -TimeoutSec 15
        if ($response.StatusCode -eq 200) {
            Write-Host "   ✅ Health check passed" -ForegroundColor Green
            $healthData = $response.Content | ConvertFrom-Json
            Write-Host "   📊 Status: $($healthData.status)" -ForegroundColor Cyan
        }
    } catch {
        Write-Host "   ⚠️ Health check failed - $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "   📋 Check logs: npx pm2 logs fmb-timetracker" -ForegroundColor Cyan
    }
    
    # Save PM2 configuration
    npx pm2 save
    
    Write-Host ""
    Write-Host "🎉 FMB TimeTracker deployment completed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📋 Management Commands:" -ForegroundColor Cyan
    Write-Host "   • Status: npx pm2 status" -ForegroundColor White
    Write-Host "   • Logs: npx pm2 logs fmb-timetracker" -ForegroundColor White
    Write-Host "   • Restart: npx pm2 restart fmb-timetracker" -ForegroundColor White
    Write-Host "   • Stop: npx pm2 stop fmb-timetracker" -ForegroundColor White
    Write-Host ""
    Write-Host "🔗 Access Points:" -ForegroundColor Cyan
    Write-Host "   • Internal: http://localhost:3000" -ForegroundColor White
    Write-Host "   • External: https://timetracker.fmb.com (via IIS)" -ForegroundColor White
    
} else {
    Write-Host "❌ Application failed to start" -ForegroundColor Red
    Write-Host "📋 Checking logs..." -ForegroundColor Yellow
    npx pm2 logs fmb-timetracker --lines 20
    exit 1
}

Write-Host ""
Write-Host "✨ Clean deployment completed!" -ForegroundColor Green
