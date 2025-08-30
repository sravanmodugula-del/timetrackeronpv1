# FMB TimeTracker - Windows Server 2022 On-Premises Installation Guide

This guide covers the complete installation of FMB TimeTracker on Windows Server 2022 with MS SQL Server integration and SAML authentication.

## Prerequisites

- Windows Server 2022
- Node.js 20.x or higher (already installed)
- MS SQL Server access (HUB-SQL1TST-LIS)
- IIS with URL Rewrite Module
- PowerShell 5.1 or higher
- Git for Windows

## Architecture Overview

- **Application Server**: HUB-DEVAPP01-C3 (Windows Server 2022)
- **Database**: MS SQL Server on HUB-SQL1TST-LIS
- **Authentication**: RSA SAML Identity Provider
- **Domain**: https://timetracker.fmb.com (HTTPS-only)
- **Internal Port**: 3000 (proxied through IIS from 80→443 and 443)

## Installation Steps

### 1. System Prerequisites

```powershell
# Install Chocolatey (if not already installed)
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Install Git
choco install git -y

# Install PM2 globally (Node.js is already installed on the server)
npm install -g pm2
npm install -g pm2-windows-service
```

### 2. Database Setup

**Run the complete setup script**:
```sql
-- Run: fmb-onprem/scripts/fmb-complete-setup.sql
```

This single script creates all required database tables, session store, indexes, constraints, triggers, and sample data.
```

### 3. Application Installation

```powershell
# Navigate to your project directory (adjust path as needed)
cd C:\path\to\your\project

# Ensure you're in the correct directory (should contain fmb-onprem folder)
Get-ChildItem

# Run the FMB installation script as Administrator
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
.\fmb-onprem\scripts\fmb-install.ps1

# Optional: Specify custom install path
.\fmb-onprem\scripts\fmb-install.ps1 -InstallPath "C:\fmb-timetracker" -ServiceName "FMBTimeTracker"
```

### 4. Environment Configuration

Create and configure the environment file:

```powershell
# Copy the FMB environment template
copy fmb-onprem\.env.fmb-onprem .env
```

Edit `.env` with FMB-specific values:

```env
# FMB On-Premises Configuration
FMB_DEPLOYMENT=onprem
NODE_ENV=production

# Database Configuration (MS SQL Server)
FMB_DB_SERVER=HUB-SQL1TST-LIS
FMB_DB_NAME=timetracker
FMB_DB_USER=timetracker
FMB_DB_PASSWORD=iTT!$Lo7gm"i'JAg~5Y\
FMB_DB_PORT=1433
FMB_DB_ENCRYPT=true
FMB_DB_TRUST_CERT=true

# SAML Configuration (RSA Identity Provider)
FMB_SAML_ENTITY_ID=https://timetracker.fmb.com
FMB_SAML_SSO_URL=https://rsa.fmb.com/saml/sso
FMB_SAML_ACS_URL=https://timetracker.fmb.com/saml/acs
FMB_SAML_CERTIFICATE=-----BEGIN CERTIFICATE-----\nMIIC...certificate content...\n-----END CERTIFICATE-----

# Application Configuration
PORT=3000
HOST=0.0.0.0
FMB_SESSION_SECRET=your-super-secure-session-secret-here
```

### 5. Build Application

```powershell
# Install dependencies and build
npm install
npm run build
```

### 6. IIS Reverse Proxy Configuration

```powershell
# Run IIS configuration script as Administrator
.\fmb-onprem\scripts\fmb-iis-config.ps1
```

This script will:
- Create IIS site for timetracker.fmb.com
- Configure reverse proxy to port 3000
- Set up SSL certificate binding
- Configure URL rewrite rules

### 7. PM2 Process Management

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'fmb-timetracker',
    script: 'dist/index.js',
    cwd: 'C:\\fmb-timetracker',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      FMB_DEPLOYMENT: 'onprem'
    },
    instances: 1,
    exec_mode: 'cluster',
    watch: false,
    max_memory_restart: '2G',
    log_file: 'logs\\combined.log',
    out_file: 'logs\\out.log',
    error_file: 'logs\\error.log',
    time: true,
    merge_logs: true,
    windows_hide: true
  }]
};
```

### 8. Start the Application

```powershell
# Navigate to installation directory
cd C:\fmb-timetracker

# Start with PM2
npx pm2 start ecosystem.config.js

# Save PM2 configuration
npx pm2 save

# Check application status
npx pm2 status

# View logs
npx pm2 logs FMBTimeTracker

# Start the Windows service (if PM2 service was installed)
net start PM2
```

### 9. Configure Windows Firewall

```powershell
# Allow internal port 3000
New-NetFirewallRule -DisplayName "FMB TimeTracker Internal" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow

# Allow HTTPS traffic (should already be configured)
New-NetFirewallRule -DisplayName "FMB TimeTracker HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow

# Allow HTTP for redirect to HTTPS
New-NetFirewallRule -DisplayName "FMB TimeTracker HTTP Redirect" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
```

### 10. Validate HTTPS Configuration

```powershell
# Test HTTP to HTTPS redirect
curl -I http://timetracker.fmb.com
# Should return 301 redirect to https://

# Test HTTPS endpoint
curl -I https://timetracker.fmb.com
# Should return 200 with security headers

# Verify SSL certificate
openssl s_client -connect timetracker.fmb.com:443 -servername timetracker.fmb.com
```

## Deployment and Updates

### Deployment Script

```powershell
# Run deployment script for updates
.\fmb-onprem\scripts\fmb-deploy.ps1
```

### Manual Deployment Steps

```powershell
# Pull latest changes
git pull origin main

# Install new dependencies
npm install

# Build application
npm run build

# Restart PM2 process
npx pm2 restart fmb-timetracker
```

## Health Checks and Monitoring

### Application Health Endpoints

- `/api/health` - General application health
- `/api/health/database` - MS SQL Server connectivity
- `/api/health/saml` - SAML configuration validation

### Monitoring Commands

```powershell
# Check PM2 status
npx pm2 status

# View logs
npx pm2 logs fmb-timetracker

# Monitor real-time logs
npx pm2 logs fmb-timetracker --lines 50 -f

# Check Windows service status
Get-Service FMBTimeTracker
```

## Troubleshooting

### Database Connection Issues

```powershell
# Test MS SQL Server connectivity
sqlcmd -S HUB-SQL1TST-LIS -U timetracker -P "iTT!`$Lo7gm`"i'JAg~5Y\\" -Q "SELECT 1"
```

### SAML Authentication Issues

1. Verify RSA Identity Provider configuration
2. Check certificate validity
3. Validate metadata exchange
4. Review SAML assertion attributes

### Common Issues

1. **Port 3000 conflicts**: Check for other services using port 3000
2. **IIS configuration**: Ensure URL Rewrite module is installed
3. **SSL certificate**: Verify certificate is properly bound to IIS site
4. **Firewall rules**: Ensure required ports are open

## Security Considerations

1. **Database Security**: Use encrypted connections to MS SQL Server
2. **SAML Security**: Validate all SAML assertions and certificates
3. **Session Management**: Use secure session storage with proper secrets
4. **TLS/SSL**: Ensure all external traffic is encrypted
5. **Logging**: Configure secure logging without sensitive data exposure

## Contact and Support

For FMB on-premises deployment support:
- Contact: FMB IT Infrastructure Team
- Database Issues: Contact SQL Server DBA team
- SAML/Authentication: Contact Identity Management team

## File Structure

```
C:\fmb-timetracker\
├── fmb-onprem\          # FMB-specific configurations
├── dist\                # Built application
├── logs\                # Application logs
├── .env                 # Environment configuration
├── ecosystem.config.js  # PM2 configuration
└── node_modules\        # Node.js dependencies