
# FMB TimeTracker - Final Production Validation Script
# Comprehensive validation before on-premises production deployment

param(
    [switch]$Fix = $false,
    [switch]$Verbose = $false
)

Write-Host "🏢 FMB TimeTracker - Final Production Validation" -ForegroundColor Green
Write-Host "===============================================" -ForegroundColor Green

$ErrorCount = 0
$WarningCount = 0

# 1. TypeScript Compilation Check
Write-Host "`n🔧 Checking TypeScript compilation..." -ForegroundColor Yellow
try {
    $tsOutput = npx tsc --noEmit 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   ✅ TypeScript compilation successful" -ForegroundColor Green
    } else {
        Write-Host "   ❌ TypeScript compilation failed:" -ForegroundColor Red
        Write-Host $tsOutput -ForegroundColor Red
        $ErrorCount++
        
        if ($Fix) {
            Write-Host "   🔧 Attempting to fix compilation issues..." -ForegroundColor Yellow
            # Add ES2022.Error to tsconfig.json lib array
            $tsconfig = Get-Content "tsconfig.json" | ConvertFrom-Json
            if (-not $tsconfig.compilerOptions.lib.Contains("ES2022.Error")) {
                $tsconfig.compilerOptions.lib += "ES2022.Error"
                $tsconfig | ConvertTo-Json -Depth 10 | Set-Content "tsconfig.json"
                Write-Host "   ✅ Updated tsconfig.json with ES2022.Error support" -ForegroundColor Green
            }
        }
    }
} catch {
    Write-Host "   ❌ Failed to check TypeScript compilation: $($_.Exception.Message)" -ForegroundColor Red
    $ErrorCount++
}

# 2. Environment Variables Validation
Write-Host "`n🔍 Validating FMB environment variables..." -ForegroundColor Yellow

# Load environment files
if (Test-Path ".env") {
    Get-Content ".env" | ForEach-Object {
        if ($_ -match "^([^#=]+)=(.*)$") {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

if (Test-Path "fmb-onprem/.env.fmb-onprem") {
    Get-Content "fmb-onprem/.env.fmb-onprem" | ForEach-Object {
        if ($_ -match "^([^#=]+)=(.*)$") {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

$requiredVars = @(
    'NODE_ENV', 'FMB_DEPLOYMENT', 'FMB_SESSION_SECRET',
    'FMB_DB_SERVER', 'FMB_DB_NAME', 'FMB_DB_USER', 'FMB_DB_PASSWORD'
)

foreach ($var in $requiredVars) {
    $value = [Environment]::GetEnvironmentVariable($var, "Process")
    if ($value) {
        $displayValue = if ($var -like "*SECRET*" -or $var -like "*PASSWORD*") { "***HIDDEN***" } else { $value }
        Write-Host "   ✅ $var = $displayValue" -ForegroundColor Green
        
        # Specific validations
        if ($var -eq "NODE_ENV" -and $value -ne "production") {
            Write-Host "      ❌ Must be 'production' for FMB deployment" -ForegroundColor Red
            $ErrorCount++
        }
        if ($var -eq "FMB_DEPLOYMENT" -and $value -ne "onprem") {
            Write-Host "      ❌ Must be 'onprem' for FMB deployment" -ForegroundColor Red
            $ErrorCount++
        }
    } else {
        Write-Host "   ❌ $var - MISSING" -ForegroundColor Red
        $ErrorCount++
    }
}

# 3. Build Artifacts Check
Write-Host "`n📦 Checking build artifacts..." -ForegroundColor Yellow
$buildArtifacts = @("dist/index.js", "public/index.html", "dist/fmb-onprem")

foreach ($artifact in $buildArtifacts) {
    if (Test-Path $artifact) {
        Write-Host "   ✅ $artifact" -ForegroundColor Green
    } else {
        Write-Host "   ❌ $artifact - MISSING" -ForegroundColor Red
        $ErrorCount++
        
        if ($Fix -and $artifact -eq "dist/index.js") {
            Write-Host "   🔧 Running build..." -ForegroundColor Yellow
            npm run build
            if (Test-Path "dist/index.js") {
                Write-Host "   ✅ Build completed successfully" -ForegroundColor Green
                $ErrorCount--
            }
        }
    }
}

# 4. Database Schema Validation
Write-Host "`n🗄️  Validating database setup..." -ForegroundColor Yellow
$sqlFile = "fmb-onprem/scripts/fmb-complete-setup.sql"
if (Test-Path $sqlFile) {
    Write-Host "   ✅ Database setup script found" -ForegroundColor Green
    
    # Check for required table creations in SQL file
    $sqlContent = Get-Content $sqlFile -Raw
    $requiredTables = @("sessions", "users", "organizations", "employees", "departments", "projects", "tasks", "project_employees", "time_entries")
    
    foreach ($table in $requiredTables) {
        if ($sqlContent -match "CREATE TABLE $table") {
            Write-Host "   ✅ Table '$table' definition found" -ForegroundColor Green
        } else {
            Write-Host "   ❌ Table '$table' definition missing" -ForegroundColor Red
            $ErrorCount++
        }
    }
} else {
    Write-Host "   ❌ Database setup script missing" -ForegroundColor Red
    $ErrorCount++
}

# 5. PM2 Configuration Check
Write-Host "`n⚙️  Checking PM2 configuration..." -ForegroundColor Yellow
if (Test-Path "ecosystem.config.cjs") {
    Write-Host "   ✅ PM2 ecosystem configuration found" -ForegroundColor Green
    
    $ecosystemContent = Get-Content "ecosystem.config.cjs" -Raw
    if ($ecosystemContent -match "fmb-timetracker") {
        Write-Host "   ✅ FMB application name configured" -ForegroundColor Green
    } else {
        Write-Host "   ⚠️  Warning: Application name should be 'fmb-timetracker'" -ForegroundColor Yellow
        $WarningCount++
    }
} else {
    Write-Host "   ❌ PM2 ecosystem configuration missing" -ForegroundColor Red
    $ErrorCount++
}

# 6. Security Headers and Configuration
Write-Host "`n🛡️  Checking security configuration..." -ForegroundColor Yellow

# Check if helmet is configured in server files
$serverFiles = Get-ChildItem -Path "server" -Filter "*.ts" -Recurse
$helmetFound = $false
foreach ($file in $serverFiles) {
    $content = Get-Content $file.FullName -Raw
    if ($content -match "helmet") {
        $helmetFound = $true
        break
    }
}

if ($helmetFound) {
    Write-Host "   ✅ Security headers (helmet) configured" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Warning: Security headers not found" -ForegroundColor Yellow
    $WarningCount++
}

# Final Summary
Write-Host "`n" + "=" * 60 -ForegroundColor Cyan
Write-Host "📊 FMB ON-PREMISES PRODUCTION READINESS SUMMARY" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Cyan

if ($ErrorCount -eq 0) {
    Write-Host "`n✅ READY FOR FMB ON-PREMISES PRODUCTION DEPLOYMENT" -ForegroundColor Green
    if ($WarningCount -gt 0) {
        Write-Host "⚠️  $WarningCount warnings found - review recommended" -ForegroundColor Yellow
    }
    
    Write-Host "`n🚀 Your FMB TimeTracker is ready for deployment!" -ForegroundColor Green
    Write-Host "`n📋 Deployment checklist:" -ForegroundColor Cyan
    Write-Host "   1. ✅ Environment variables configured" -ForegroundColor White
    Write-Host "   2. ✅ TypeScript compilation successful" -ForegroundColor White
    Write-Host "   3. ✅ Build artifacts present" -ForegroundColor White
    Write-Host "   4. ✅ Database schema ready" -ForegroundColor White
    Write-Host "   5. ✅ PM2 configuration ready" -ForegroundColor White
    
    Write-Host "`n🔄 Next steps:" -ForegroundColor Cyan
    Write-Host "   • Run: .\fmb-onprem\scripts\fmb-deploy.ps1" -ForegroundColor White
    Write-Host "   • Verify: https://timetracker.fmb.com/api/health" -ForegroundColor White
    Write-Host "   • Monitor: pm2 logs fmb-timetracker" -ForegroundColor White
    
    exit 0
} else {
    Write-Host "`n❌ NOT READY FOR FMB PRODUCTION DEPLOYMENT" -ForegroundColor Red
    Write-Host "   $ErrorCount critical errors found" -ForegroundColor Red
    Write-Host "   $WarningCount warnings found" -ForegroundColor Yellow
    
    Write-Host "`n🔧 Required actions:" -ForegroundColor Cyan
    Write-Host "   • Fix all TypeScript compilation errors" -ForegroundColor White
    Write-Host "   • Set NODE_ENV=production" -ForegroundColor White
    Write-Host "   • Set FMB_DEPLOYMENT=onprem" -ForegroundColor White
    Write-Host "   • Configure all FMB_* environment variables" -ForegroundColor White
    Write-Host "   • Run: npm run build" -ForegroundColor White
    
    Write-Host "`n💡 Use -Fix parameter to auto-fix some issues" -ForegroundColor Yellow
    exit 1
}
