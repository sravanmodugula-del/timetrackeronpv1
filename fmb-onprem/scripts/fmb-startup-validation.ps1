
# FMB TimeTracker - Startup Validation Script
# Validates all components before starting the application

param(
    [switch]$SkipSessionTest = $false,
    [switch]$Verbose = $false
)

Write-Host "=== FMB TimeTracker Startup Validation ===" -ForegroundColor Cyan

# 1. Environment Check
Write-Host "1. Checking environment variables..." -ForegroundColor Yellow
if (-not $env:FMB_DEPLOYMENT) {
    Write-Host "   ❌ FMB_DEPLOYMENT not set" -ForegroundColor Red
    exit 1
}
Write-Host "   ✅ FMB_DEPLOYMENT: $env:FMB_DEPLOYMENT" -ForegroundColor Green

# 2. Database Connectivity
Write-Host "2. Testing database connectivity..." -ForegroundColor Yellow
try {
    $testQuery = "SELECT GETDATE() AS current_time"
    $result = Invoke-Sqlcmd -ServerInstance "HUB-SQL1TST-LIS" -Database "timetracker" -Query $testQuery -ErrorAction Stop
    Write-Host "   ✅ Database connectivity: OK" -ForegroundColor Green
    if ($Verbose) {
        Write-Host "   📋 Database time: $($result.current_time)" -ForegroundColor Gray
    }
} catch {
    Write-Host "   ❌ Database connectivity failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# 3. Session Table Validation
if (-not $SkipSessionTest) {
    Write-Host "3. Validating session store..." -ForegroundColor Yellow
    try {
        $sessionCheck = "SELECT COUNT(*) as session_count FROM sessions"
        $sessionResult = Invoke-Sqlcmd -ServerInstance "HUB-SQL1TST-LIS" -Database "timetracker" -Query $sessionCheck -ErrorAction Stop
        Write-Host "   ✅ Session store: OK ($($sessionResult.session_count) active sessions)" -ForegroundColor Green
    } catch {
        Write-Host "   ❌ Session store validation failed: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

# 4. PM2 Process Check
Write-Host "4. Checking PM2 processes..." -ForegroundColor Yellow
$pm2Status = pm2 jlist | ConvertFrom-Json
$fmbProcess = $pm2Status | Where-Object { $_.name -eq "fmb-timetracker" }

if ($fmbProcess) {
    Write-Host "   ⚠️  FMB TimeTracker process already running (PID: $($fmbProcess.pid))" -ForegroundColor Yellow
    Write-Host "   💡 Use 'pm2 restart fmb-timetracker' to restart" -ForegroundColor Cyan
} else {
    Write-Host "   ✅ No existing FMB TimeTracker processes" -ForegroundColor Green
}

# 5. Port Availability
Write-Host "5. Checking port availability..." -ForegroundColor Yellow
$portCheck = netstat -an | Select-String ":3000"
if ($portCheck) {
    Write-Host "   ⚠️  Port 3000 may be in use" -ForegroundColor Yellow
    if ($Verbose) {
        Write-Host "   📋 Port details: $portCheck" -ForegroundColor Gray
    }
} else {
    Write-Host "   ✅ Port 3000 available" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Validation Summary ===" -ForegroundColor Cyan
Write-Host "✅ Environment: Ready" -ForegroundColor Green
Write-Host "✅ Database: Connected" -ForegroundColor Green
if (-not $SkipSessionTest) {
    Write-Host "✅ Session Store: Validated" -ForegroundColor Green
}
Write-Host "✅ System: Ready for deployment" -ForegroundColor Green
Write-Host ""
Write-Host "💡 Next steps:" -ForegroundColor Cyan
Write-Host "   - Run: pm2 start ecosystem.config.cjs --env production" -ForegroundColor White
Write-Host "   - Monitor: pm2 logs fmb-timetracker" -ForegroundColor White
Write-Host "   - Health: https://timetracker.fmb.com/api/health" -ForegroundColor White
