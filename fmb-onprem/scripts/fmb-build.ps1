
# FMB TimeTracker Production Build Script
# Builds the application for on-premises deployment

param(
    [string]$InstallPath = "C:\fmb-timetracker"
)

Write-Host "🔨 FMB TimeTracker Production Build" -ForegroundColor Green
Write-Host "===================================" -ForegroundColor Green

# Set working directory
Set-Location $InstallPath

# Set production environment
$env:NODE_ENV = "production"
$env:FMB_DEPLOYMENT = "onprem"

Write-Host "📦 Installing production dependencies..." -ForegroundColor Yellow
npm ci --only=production

Write-Host "🔨 Building application..." -ForegroundColor Yellow
npm run build

Write-Host "🧹 Cleaning up..." -ForegroundColor Yellow
# Remove development dependencies to reduce size
Remove-Item -Path "node_modules" -Recurse -Force -ErrorAction SilentlyContinue
npm ci --only=production

Write-Host "✅ Production build completed!" -ForegroundColor Green
Write-Host "📁 Build output: $InstallPath\dist" -ForegroundColor Cyan
