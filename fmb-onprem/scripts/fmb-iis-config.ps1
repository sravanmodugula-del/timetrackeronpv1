# FMB TimeTracker IIS Reverse Proxy Configuration
# Configures IIS on Windows Server 2022 to proxy requests to Node.js application

param(
    [string]$SiteName = "timetracker.fmb.com",
    [string]$ApplicationPool = "FMBTimeTrackerPool",
    [int]$NodePort = 3000
)

Write-Host "FMB TimeTracker IIS Configuration" -ForegroundColor Green
Write-Host "====================================" -ForegroundColor Green

# Check if running as Administrator
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "This script must be run as Administrator" -ForegroundColor Red
    exit 1
}

# Import WebAdministration module
Import-Module WebAdministration

# Install required IIS features
Write-Host "Installing required IIS features..." -ForegroundColor Yellow
$features = @(
    "IIS-WebServerRole",
    "IIS-WebServer",
    "IIS-CommonHttpFeatures",
    "IIS-HttpRedirect",
    "IIS-HttpErrors",
    "IIS-StaticContent",
    "IIS-DefaultDocument",
    "IIS-DirectoryBrowsing",
    "IIS-ASPNET45",
    "IIS-NetFxExtensibility45",
    "IIS-ISAPIExtensions",
    "IIS-ISAPIFilter",
    "IIS-ApplicationDevelopment"
)

foreach ($feature in $features) {
    try {
        Enable-WindowsOptionalFeature -Online -FeatureName $feature -All -NoRestart
        Write-Host "Enabled feature: $feature" -ForegroundColor Green
    } catch {
        Write-Host "Could not enable feature: $feature" -ForegroundColor Yellow
    }
}

# Install URL Rewrite Module (required for reverse proxy)
Write-Host "Installing URL Rewrite Module..." -ForegroundColor Yellow
$urlRewriteUrl = "https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi"
$tempPath = "$env:TEMP\urlrewrite.msi"

try {
    Invoke-WebRequest -Uri $urlRewriteUrl -OutFile $tempPath
    Start-Process msiexec.exe -Wait -ArgumentList "/i `"$tempPath`" /quiet"
    Remove-Item $tempPath -Force
    Write-Host "URL Rewrite Module installed successfully" -ForegroundColor Green
} catch {
    Write-Host "URL Rewrite Module installation may have failed - install manually if needed" -ForegroundColor Yellow
}

# Install Application Request Routing (ARR) Module (required for reverse proxy)
Write-Host "Installing Application Request Routing (ARR) Module..." -ForegroundColor Yellow
$arrUrl = "https://download.microsoft.com/download/E/9/8/E9849D6A-020E-47E4-9FD0-A023E99B54EB/requestRouter_amd64.msi"
$arrTempPath = "$env:TEMP\arr.msi"

try {
    Invoke-WebRequest -Uri $arrUrl -OutFile $arrTempPath
    Start-Process msiexec.exe -Wait -ArgumentList "/i `"$arrTempPath`" /quiet"
    Remove-Item $arrTempPath -Force
    Write-Host "ARR Module installed successfully" -ForegroundColor Green
    
    # Enable ARR proxy functionality
    Write-Host "Enabling ARR proxy functionality..." -ForegroundColor Yellow
    Import-Module WebAdministration
    Set-WebConfigurationProperty -PSPath "MACHINE/WEBROOT/APPHOST" -Filter "system.webServer/proxy" -Name "enabled" -Value "True"
    
    # Allow custom server variables for proxy headers
    Write-Host "Configuring allowed server variables..." -ForegroundColor Yellow
    try {
        Add-WebConfigurationProperty -PSPath "MACHINE/WEBROOT/APPHOST" -Filter "system.webServer/rewrite/allowedServerVariables" -Name "." -Value @{name="HTTP_X_FORWARDED_PROTO"}
        Add-WebConfigurationProperty -PSPath "MACHINE/WEBROOT/APPHOST" -Filter "system.webServer/rewrite/allowedServerVariables" -Name "." -Value @{name="HTTP_X_FORWARDED_FOR"}
        Add-WebConfigurationProperty -PSPath "MACHINE/WEBROOT/APPHOST" -Filter "system.webServer/rewrite/allowedServerVariables" -Name "." -Value @{name="HTTP_X_FORWARDED_HOST"}
        Write-Host "Server variables configured successfully" -ForegroundColor Green
    } catch {
        Write-Host "Server variables may already be configured or failed to configure" -ForegroundColor Yellow
    }
    
    Write-Host "ARR proxy enabled successfully" -ForegroundColor Green
} catch {
    Write-Host "ARR Module installation may have failed - install manually if needed" -ForegroundColor Yellow
}

# Create Application Pool
Write-Host "Creating Application Pool: $ApplicationPool..." -ForegroundColor Yellow
if (Get-IISAppPool -Name $ApplicationPool -ErrorAction SilentlyContinue) {
    Remove-WebAppPool -Name $ApplicationPool
    Write-Host "Removed existing Application Pool" -ForegroundColor Yellow
}

New-WebAppPool -Name $ApplicationPool
Set-ItemProperty -Path "IIS:\AppPools\$ApplicationPool" -Name processModel.identityType -Value ApplicationPoolIdentity
Set-ItemProperty -Path "IIS:\AppPools\$ApplicationPool" -Name recycling.periodicRestart.time -Value "00:00:00"
Write-Host "Application Pool created successfully" -ForegroundColor Green

# Create Website
Write-Host "Creating Website: $SiteName..." -ForegroundColor Yellow
if (Get-Website -Name $SiteName -ErrorAction SilentlyContinue) {
    Remove-Website -Name $SiteName
    Write-Host "Removed existing Website" -ForegroundColor Yellow
}

$wwwPath = "C:\inetpub\wwwroot\$SiteName"
if (!(Test-Path $wwwPath)) {
    New-Item -ItemType Directory -Path $wwwPath -Force
    Write-Host "Created directory: $wwwPath" -ForegroundColor Green
}

# Create a simple index.html for health checks
$indexContent = @"
<!DOCTYPE html>
<html>
<head>
    <title>FMB TimeTracker</title>
    <meta charset="utf-8">
</head>
<body>
    <h1>FMB TimeTracker - Reverse Proxy Active</h1>
    <p>If you see this page, the IIS reverse proxy is configured but the Node.js application may not be running.</p>
    <p>Node.js should be running on port $NodePort</p>
</body>
</html>
"@

Set-Content -Path "$wwwPath\index.html" -Value $indexContent -Encoding UTF8

New-Website -Name $SiteName -Port 80 -PhysicalPath $wwwPath -ApplicationPool $ApplicationPool
Write-Host "Website created successfully" -ForegroundColor Green

# Create web.config with URL Rewrite rules and HTTPS redirect
$webConfigContent = @"
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="Force HTTPS" stopProcessing="true">
          <match url="(.*)" />
          <conditions>
            <add input="{HTTPS}" pattern="off" ignoreCase="true" />
            <add input="{HTTP_HOST}" pattern="localhost" negate="true" />
            <add input="{HTTP_HOST}" pattern="127.0.0.1" negate="true" />
          </conditions>
          <action type="Redirect" url="https://{HTTP_HOST}/{R:1}" redirectType="Permanent" />
        </rule>
        <rule name="Reverse Proxy to Node.js" stopProcessing="true">
          <match url="(.*)" />
          <conditions>
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="http://127.0.0.1:$NodePort/{R:1}" logRewrittenUrl="true" />
          <serverVariables>
            <set name="HTTP_X_FORWARDED_PROTO" value="{HTTPS_ON:https:http}" />
            <set name="HTTP_X_FORWARDED_FOR" value="{REMOTE_ADDR}" />
            <set name="HTTP_X_FORWARDED_HOST" value="{HTTP_HOST}" />
            <set name="HTTP_X_ORIGINAL_URL" value="{REQUEST_URI}" />
          </serverVariables>
        </rule>
      </rules>
    </rewrite>
    <httpErrors errorMode="Detailed" />
    <defaultDocument>
      <files>
        <clear />
        <add value="index.html" />
      </files>
    </defaultDocument>
    <httpProtocol>
      <customHeaders>
        <add name="Strict-Transport-Security" value="max-age=31536000; includeSubDomains" />
        <add name="X-Content-Type-Options" value="nosniff" />
        <add name="X-Frame-Options" value="DENY" />
        <add name="X-XSS-Protection" value="1; mode=block" />
      </customHeaders>
    </httpProtocol>
  </system.webServer>
</configuration>
"@

Set-Content -Path "$wwwPath\web.config" -Value $webConfigContent -Encoding UTF8
Write-Host "URL Rewrite rules configured successfully" -ForegroundColor Green

# Set permissions
Write-Host "Setting permissions..." -ForegroundColor Yellow
$acl = Get-Acl $wwwPath
$accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule("IIS_IUSRS", "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")
$acl.SetAccessRule($accessRule)
Set-Acl $wwwPath $acl
Write-Host "Permissions set successfully" -ForegroundColor Green

# Check for SSL certificate and configure HTTPS binding
$certPath = "C:\fmb-timetracker\certs"
$pfxFile = Join-Path $certPath "timetracker.fmb.com.pfx"
$cerFile = Join-Path $certPath "timetracker.fmb.com.cer"
$keyFile = Join-Path $certPath "timetracker.fmb.com.key"

if (Test-Path $pfxFile) {
    Write-Host "Found PFX certificate at: $pfxFile" -ForegroundColor Green
    Write-Host "To complete SSL setup, run these commands as Administrator:" -ForegroundColor Yellow
    Write-Host "Import-PfxCertificate -FilePath '$pfxFile' -CertStoreLocation Cert:\LocalMachine\My -Password (Read-Host -AsSecureString)" -ForegroundColor Gray
    Write-Host "Then bind the certificate to the HTTPS binding using IIS Manager or:" -ForegroundColor Gray
    Write-Host "Get-WebBinding -Name '$SiteName' -Protocol https | Remove-WebBinding" -ForegroundColor Gray
    Write-Host "New-WebBinding -Name '$SiteName' -Protocol https -Port 443 -SslFlags 1" -ForegroundColor Gray
} elseif ((Test-Path $cerFile) -and (Test-Path $keyFile)) {
    Write-Host "Found separate certificate files:" -ForegroundColor Green
    Write-Host "  Certificate: $cerFile" -ForegroundColor Gray
    Write-Host "  Private Key: $keyFile" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Option 1: Convert to PFX format (recommended):" -ForegroundColor Yellow
    Write-Host "openssl pkcs12 -export -out '$pfxFile' -inkey '$keyFile' -in '$cerFile'" -ForegroundColor Gray
    Write-Host "Then import the PFX file as shown above." -ForegroundColor Gray
    Write-Host ""
    Write-Host "Option 2: Import certificate and key separately:" -ForegroundColor Yellow
    Write-Host "Import-Certificate -FilePath '$cerFile' -CertStoreLocation Cert:\LocalMachine\My" -ForegroundColor Gray
    Write-Host "# Note: Private key import requires additional steps with certlm.msc" -ForegroundColor Gray
} else {
    Write-Host "SSL certificate files not found in: $certPath" -ForegroundColor Yellow
    Write-Host "Expected files:" -ForegroundColor Yellow
    Write-Host "  - timetracker.fmb.com.pfx (preferred), OR" -ForegroundColor Gray
    Write-Host "  - timetracker.fmb.com.cer AND timetracker.fmb.com.key" -ForegroundColor Gray
}

# Add HTTPS binding (SSL certificate will need to be configured separately)
try {
    New-WebBinding -Name $SiteName -Protocol https -Port 443
    Write-Host "Added HTTPS binding on port 443" -ForegroundColor Green
    Write-Host "Note: SSL certificate needs to be imported and bound manually" -ForegroundColor Yellow
} catch {
    Write-Host "Could not add HTTPS binding - configure manually if needed" -ForegroundColor Yellow
}

# Start the website
Write-Host "Starting website..." -ForegroundColor Yellow
Start-Website -Name $SiteName
Write-Host "Website started successfully" -ForegroundColor Green

Write-Host ""
Write-Host "IIS configuration completed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Configuration Summary:" -ForegroundColor Cyan
Write-Host "Website: $SiteName" -ForegroundColor White
Write-Host "Application Pool: $ApplicationPool" -ForegroundColor White
Write-Host "Physical Path: $wwwPath" -ForegroundColor White
Write-Host "Proxy Target: http://localhost:$NodePort" -ForegroundColor White
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "1. Ensure your Node.js application is running on port $NodePort" -ForegroundColor White
Write-Host "2. Install SSL certificate from C:\fmb-timetracker\certs:" -ForegroundColor White
Write-Host "   For PFX file:" -ForegroundColor Gray
Write-Host "   Import-PfxCertificate -FilePath 'C:\fmb-timetracker\certs\timetracker.fmb.com.pfx' -CertStoreLocation Cert:\LocalMachine\My" -ForegroundColor Gray
Write-Host "   For CER/KEY files, convert first:" -ForegroundColor Gray
Write-Host "   openssl pkcs12 -export -out 'C:\fmb-timetracker\certs\timetracker.fmb.com.pfx' -inkey 'C:\fmb-timetracker\certs\timetracker.fmb.com.key' -in 'C:\fmb-timetracker\certs\timetracker.fmb.com.cer'" -ForegroundColor Gray
Write-Host "   Get-ChildItem -Path Cert:\LocalMachine\My | Where-Object {$_.Subject -like '*timetracker.fmb.com*'}" -ForegroundColor Gray
Write-Host "   New-WebBinding -Name '$SiteName' -Protocol https -Port 443 -SslFlags 1" -ForegroundColor Gray
Write-Host "3. Test HTTP redirect: http://$SiteName (should redirect to HTTPS)" -ForegroundColor White
Write-Host "4. Test HTTPS proxy: https://$SiteName" -ForegroundColor White
Write-Host "5. Update DNS to point $SiteName to this server" -ForegroundColor White
Write-Host ""
Write-Host "Test Commands:" -ForegroundColor Cyan
Write-Host "curl http://localhost" -ForegroundColor Gray
Write-Host "curl http://localhost/api/health" -ForegroundColor Gray
Write-Host ""
Write-Host "Troubleshooting Commands:" -ForegroundColor Cyan
Write-Host "Check allowed server variables:" -ForegroundColor White
Write-Host "Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/rewrite/allowedServerVariables'" -ForegroundColor Gray
Write-Host "Check proxy enabled:" -ForegroundColor White
Write-Host "Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name 'enabled'" -ForegroundColor Gray
Write-Host "View web.config location:" -ForegroundColor White
Write-Host "Get-Content '$wwwPath\web.config'" -ForegroundColor Gray
Write-Host "Check website bindings:" -ForegroundColor White
Write-Host "Get-WebBinding -Name '$SiteName'" -ForegroundColor Gray