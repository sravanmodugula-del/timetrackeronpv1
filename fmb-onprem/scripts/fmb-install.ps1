# FMB TimeTracker On-Premises Installation Script for Windows Server 2022
# This script sets up the complete on-premises environment on Windows

param(
    [string]$InstallPath = "C:\fmb-timetracker",
    [string]$ServiceName = "FMBTimeTracker",
    [string]$ServiceUser = "NetworkService",
    [string]$SourcePath = "" # Added parameter for specifying source path
)

Write-Host "🏢 FMB TimeTracker On-Premises Installation (Windows Server 2022)" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Green

# Check if running as Administrator
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "❌ This script must be run as Administrator" -ForegroundColor Red
    exit 1
}

# Create application directories
Write-Host "📁 Creating application directories..." -ForegroundColor Yellow
if (!(Test-Path $InstallPath)) {
    New-Item -ItemType Directory -Path $InstallPath -Force
    Write-Host "✅ Created directory: $InstallPath" -ForegroundColor Green
}

$LogPath = "$InstallPath\logs"
if (!(Test-Path $LogPath)) {
    New-Item -ItemType Directory -Path $LogPath -Force
    Write-Host "✅ Created log directory: $LogPath" -ForegroundColor Green
}

# Check if Node.js is installed
Write-Host "🔍 Checking Node.js installation..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js is installed: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js is not installed. Please install Node.js 20.x or higher from https://nodejs.org/" -ForegroundColor Red
    exit 1
}

# Install PM2 globally
Write-Host "🔧 Installing PM2..." -ForegroundColor Yellow
try {
    npm install -g pm2
    npm install -g pm2-windows-service
    Write-Host "✅ PM2 installed successfully" -ForegroundColor Green

    # Verify PM2 is accessible via npx
    $pm2Version = npx pm2 --version 2>$null
    if ($pm2Version) {
        Write-Host "✅ PM2 accessible via npx: $pm2Version" -ForegroundColor Green
    } else {
        Write-Host "⚠️ PM2 global installation may have issues, will use npx prefix" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ Failed to install PM2" -ForegroundColor Red
    exit 1
}

# Copy application files
Write-Host "📋 Copying application files..." -ForegroundColor Yellow

# Function to find project root directory
function Find-ProjectRoot {
    param([string]$StartPath)

    $CurrentPath = $StartPath
    $MaxDepth = 10  # Prevent infinite loops
    $Depth = 0

    while ($Depth -lt $MaxDepth) {
        # Check if this directory contains the project markers
        $PackageJsonPath = Join-Path $CurrentPath "package.json"
        $FmbOnpremPath = Join-Path $CurrentPath "fmb-onprem"

        if ((Test-Path $PackageJsonPath) -and (Test-Path $FmbOnpremPath)) {
            Write-Host "✅ Found project root at: $CurrentPath" -ForegroundColor Green
            return $CurrentPath
        }

        # Move up one directory
        $ParentPath = Split-Path -Parent $CurrentPath
        if ($ParentPath -eq $CurrentPath) {
            # Reached root of drive
            break
        }
        $CurrentPath = $ParentPath
        $Depth++
    }

    return $null
}

# Determine source path with robust detection
if ($SourcePath -eq "") {
    Write-Host "🔍 Auto-detecting project directory..." -ForegroundColor Yellow

    # Try multiple methods to find the project root
    $ProjectRoot = $null

    # Method 1: Use script path if available
    if ($MyInvocation.MyCommand.Path) {
        $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
        $ProjectRoot = Find-ProjectRoot $ScriptDir
        if ($ProjectRoot) {
            Write-Host "✅ Found project via script path method" -ForegroundColor Green
        }
    }

    # Method 2: Search from current directory
    if (-not $ProjectRoot) {
        $CurrentDir = Get-Location
        $ProjectRoot = Find-ProjectRoot $CurrentDir.Path
        if ($ProjectRoot) {
            Write-Host "✅ Found project via current directory search" -ForegroundColor Green
        }
    }

    # Method 3: Search from common locations if script name is known
    if (-not $ProjectRoot -and $MyInvocation.MyCommand.Name) {
        $PossiblePaths = @(
            (Join-Path (Get-Location) "fmb-onprem\scripts"),
            (Join-Path (Get-Location) "..\.."),
            "C:\fmb-timetracker-dev",
            "C:\projects\fmb-timetracker",
            "C:\source\fmb-timetracker"
        )

        foreach ($Path in $PossiblePaths) {
            if (Test-Path $Path) {
                $ProjectRoot = Find-ProjectRoot $Path
                if ($ProjectRoot) {
                    Write-Host "✅ Found project via search method at: $Path" -ForegroundColor Green
                    break
                }
            }
        }
    }

    if (-not $ProjectRoot) {
        Write-Host "❌ Could not automatically detect project directory!" -ForegroundColor Red
        Write-Host "💡 The project directory should contain both 'package.json' and 'fmb-onprem' folder" -ForegroundColor Yellow
        Write-Host "💡 Please run this script with -SourcePath parameter:" -ForegroundColor Yellow
        Write-Host "💡   .\fmb-install.ps1 -SourcePath `"C:\path\to\your\project`"" -ForegroundColor Yellow
        Write-Host "" -ForegroundColor Yellow
        Write-Host "💡 Or navigate to the project root directory and run:" -ForegroundColor Yellow
        Write-Host "💡   .\fmb-onprem\scripts\fmb-install.ps1" -ForegroundColor Yellow
        exit 1
    }

    $SourcePath = $ProjectRoot
    $ScriptPath = Join-Path $SourcePath "fmb-onprem\scripts"
} else {
    Write-Host "✅ Using provided source path: $SourcePath" -ForegroundColor Green

    # Validate the provided source path
    if (-not (Find-ProjectRoot $SourcePath)) {
        Write-Host "❌ Provided source path does not appear to be a valid project directory" -ForegroundColor Red
        Write-Host "❌ Expected to find 'package.json' and 'fmb-onprem' folder in: $SourcePath" -ForegroundColor Red
        exit 1
    }
}

# Normalize paths for comparison
$NormalizedSourcePath = (Resolve-Path $SourcePath).Path
$NormalizedInstallPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($InstallPath)

Write-Host "📂 Script path: $ScriptPath" -ForegroundColor Yellow
Write-Host "📂 Source path: $NormalizedSourcePath" -ForegroundColor Yellow
Write-Host "📂 Install path: $NormalizedInstallPath" -ForegroundColor Yellow

# Check if source and destination are the same - skip copy but continue installation
$SkipFileCopy = $false
if ($NormalizedSourcePath -eq $NormalizedInstallPath) {
    Write-Host "📂 Source and destination paths are the same - running in-place installation" -ForegroundColor Yellow
    Write-Host "📂 Source: $NormalizedSourcePath" -ForegroundColor Yellow
    Write-Host "📂 Install: $NormalizedInstallPath" -ForegroundColor Yellow
    Write-Host "⏭️ Skipping file copy operation..." -ForegroundColor Yellow
    $SkipFileCopy = $true
}

# Check if install path is a subdirectory of source path
if (-not $SkipFileCopy -and $NormalizedInstallPath.StartsWith($NormalizedSourcePath + "\")) {
    Write-Host "❌ Installation path cannot be a subdirectory of the source!" -ForegroundColor Red
    Write-Host "❌ Source: $NormalizedSourcePath" -ForegroundColor Red
    Write-Host "❌ Install: $NormalizedInstallPath" -ForegroundColor Red
    Write-Host "💡 Please choose an installation path outside the project directory" -ForegroundColor Yellow
    exit 1
}

# Verify source path exists and contains required files
if (!(Test-Path $SourcePath)) {
    Write-Host "❌ Source path not found: $SourcePath" -ForegroundColor Red
    Write-Host "💡 Make sure to run this script from the fmb-onprem/scripts directory" -ForegroundColor Yellow
    exit 1
}

# Verify critical source files exist
$RequiredSourceFiles = @("package.json", "server", "client", "shared")
foreach ($file in $RequiredSourceFiles) {
    $sourceFile = Join-Path $SourcePath $file
    if (!(Test-Path $sourceFile)) {
        Write-Host "❌ Required source file/directory missing: $sourceFile" -ForegroundColor Red
        exit 1
    }
}

# Create install directory if it doesn't exist
if (!(Test-Path $InstallPath)) {
    New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
}

# Copy application files excluding unnecessary directories
if (-not $SkipFileCopy) {
    $ExcludeItems = @('.git', 'node_modules', 'dist', '.replit', '.vscode', '.idea', 'logs')
    Write-Host "📋 Copying application files..." -ForegroundColor Yellow

    Get-ChildItem -Path $SourcePath -Exclude $ExcludeItems | ForEach-Object {
        $destPath = Join-Path $InstallPath $_.Name

        # Skip if source and destination are the same file/folder
        if ($_.FullName -eq $destPath) {
            Write-Host "  ⏭️ Skipped: $($_.Name) (same location)" -ForegroundColor Yellow
            return
        }

        if ($_.PSIsContainer) {
            Copy-Item -Path $_.FullName -Destination $destPath -Recurse -Force
        } else {
            Copy-Item -Path $_.FullName -Destination $destPath -Force
        }
        Write-Host "  ✅ Copied: $($_.Name)" -ForegroundColor Green
    }
} else {
    Write-Host "📋 Skipping file copy (in-place installation)" -ForegroundColor Yellow
}

# Store original location and set working directory to install path
$OriginalLocation = Get-Location
Set-Location $InstallPath
Write-Host "📍 Working directory set to: $InstallPath" -ForegroundColor Yellow

# Install application dependencies
Write-Host "📦 Installing application dependencies..." -ForegroundColor Cyan
npm install

Write-Host "Installing FMB-specific dependencies..." -ForegroundColor Cyan
npm install connect-mssql-v2


# Set up environment configuration
$EnvTemplatePath = "$InstallPath\fmb-onprem\.env.fmb-onprem"
$EnvPath = "$InstallPath\.env"

Write-Host "🔧 Setting up environment configuration..." -ForegroundColor Yellow

if (Test-Path $EnvTemplatePath) {
    if (!(Test-Path $EnvPath)) {
        Copy-Item -Path $EnvTemplatePath -Destination $EnvPath
        Write-Host "✅ Environment template copied to .env" -ForegroundColor Green
        Write-Host "📝 Please edit $EnvPath with your specific configuration" -ForegroundColor Yellow
    } else {
        Write-Host "📝 Environment file already exists: $EnvPath" -ForegroundColor Green
        Write-Host "📝 You may want to review and update it with new settings from the template" -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠️ Environment template not found at: $EnvTemplatePath" -ForegroundColor Yellow
    Write-Host "⚠️ Creating basic .env file..." -ForegroundColor Yellow

    $BasicEnvContent = @"
# FMB TimeTracker On-Premises Configuration
FMB_DEPLOYMENT=onprem
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Database Configuration (Update these values)
FMB_DB_SERVER=HUB-SQL1TST-LIS
FMB_DB_NAME=timetracker
FMB_DB_USER=timetracker
FMB_DB_PASSWORD=YOUR_PASSWORD_HERE
FMB_DB_PORT=1433
FMB_DB_ENCRYPT=true
FMB_DB_TRUST_CERT=true

# SAML Configuration (Update these values)
FMB_SAML_ENTITY_ID=https://timetracker.fmb.com
FMB_SAML_SSO_URL=https://rsa.fmb.com/saml/sso
FMB_SAML_ACS_URL=https://timetracker.fmb.com/saml/acs
FMB_SAML_CERTIFICATE=YOUR_CERTIFICATE_HERE

# Session Configuration
FMB_SESSION_SECRET=CHANGE_THIS_TO_A_SECURE_SECRET
"@

    Set-Content -Path $EnvPath -Value $BasicEnvContent
    Write-Host "✅ Basic .env file created" -ForegroundColor Green
}

# Verify critical files exist
$CriticalFiles = @("package.json", "fmb-onprem\config\fmb-database.ts", "server\index.ts")
foreach ($file in $CriticalFiles) {
    $filePath = "$InstallPath\$file"
    if (!(Test-Path $filePath)) {
        Write-Host "❌ Critical file missing: $filePath" -ForegroundColor Red
        Write-Host "❌ Installation may be incomplete. Please check source files." -ForegroundColor Red
        exit 1
    }
}
Write-Host "✅ Critical files verified" -ForegroundColor Green

# Build application
Write-Host "🔨 Building application..." -ForegroundColor Yellow
try {
    $buildResult = npm run build 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Build failed with exit code: $LASTEXITCODE" -ForegroundColor Red
        Write-Host "Build output:" -ForegroundColor Yellow
        Write-Host $buildResult -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Application built successfully" -ForegroundColor Green

    # Clean up dev dependencies after build for production
    Write-Host "🧹 Cleaning up development dependencies..." -ForegroundColor Yellow
    npm prune --production
    Write-Host "✅ Development dependencies removed" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to build application" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
    exit 1
}

# Create PM2 ecosystem file with proper Windows path handling
$NormalizedInstallPath = $InstallPath.Replace('\', '/')
$NormalizedLogPath = $LogPath.Replace('\', '/')

$EcosystemContent = @"
module.exports = {
  apps: [{
    name: '$ServiceName',
    script: './dist/server/index.js',
    cwd: '$NormalizedInstallPath',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      HOST: '0.0.0.0',
      FMB_DEPLOYMENT: 'onprem'
    },
    instances: 1,
    exec_mode: 'cluster',
    watch: false,
    max_memory_restart: '1G',
    log_file: '$NormalizedLogPath/combined.log',
    out_file: '$NormalizedLogPath/out.log',
    error_file: '$NormalizedLogPath/error.log',
    time: true,
    merge_logs: true,
    windows_hide: true,
    restart_delay: 5000,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
"@

Set-Content -Path "$InstallPath\ecosystem.config.js" -Value $EcosystemContent
Write-Host "✅ PM2 ecosystem configuration created" -ForegroundColor Green

# Install PM2 as Windows service
Write-Host "🔧 Installing PM2 as Windows service..." -ForegroundColor Yellow
try {
    npx pm2-service-install -n $ServiceName
    Write-Host "✅ PM2 service installed" -ForegroundColor Green
} catch {
    Write-Host "⚠️ PM2 service installation may have issues - check manually" -ForegroundColor Yellow
    Write-Host "💡 Try manually: npx pm2-service-install -n $ServiceName" -ForegroundColor Yellow
}

# Set up Windows Firewall rule for port 3000
Write-Host "🔥 Configuring Windows Firewall..." -ForegroundColor Yellow
try {
    New-NetFirewallRule -DisplayName "FMB TimeTracker" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
    Write-Host "✅ Firewall rule created for port 3000" -ForegroundColor Green
} catch {
    Write-Host "⚠️ Failed to create firewall rule - configure manually if needed" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "✅ FMB TimeTracker installation completed!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Next steps:" -ForegroundColor Cyan
Write-Host "1. Edit $InstallPath\.env with your configuration" -ForegroundColor White
Write-Host "2. Run the database setup script on your MS SQL Server (HUB-SQL1TST-LIS)" -ForegroundColor White
Write-Host "3. Configure IIS reverse proxy on HUB-DEVAPP01-C3" -ForegroundColor White
Write-Host "4. Start the application: npx pm2 start ecosystem.config.js" -ForegroundColor White
Write-Host "5. View logs: npx pm2 logs" -ForegroundColor White
Write-Host "6. Check status: npx pm2 status" -ForegroundColor White
Write-Host ""
Write-Host "🔧 Service Management:" -ForegroundColor Cyan
Write-Host "Start service: net start $ServiceName" -ForegroundColor White
Write-Host "Stop service: net stop $ServiceName" -ForegroundColor White
Write-Host "Restart service: net stop $ServiceName && net start $ServiceName" -ForegroundColor White
Write-Host ""
Write-Host "💡 Note: All PM2 commands should use 'npx pm2' prefix if global installation has PATH issues" -ForegroundColor Yellow

# Restore original working directory
Set-Location $OriginalLocation
Write-Host "📍 Restored original working directory" -ForegroundColor Yellow