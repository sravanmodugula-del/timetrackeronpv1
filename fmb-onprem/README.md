
# FMB TimeTracker - On-Premises Deployment

This is the FMB TimeTracker application configured exclusively for on-premises deployment at First Midwest Bank.

## Features

- **SAML Authentication**: Integrated with RSA Identity Provider
- **MS SQL Database**: Enterprise-grade database storage
- **Session Management**: Database-backed session persistence
- **Role-Based Access Control**: Admin, Manager, Project Manager, Employee, Viewer roles
- **Time Tracking**: Comprehensive time entry and project management
- **Enterprise Security**: Production-ready security configurations

## Architecture

### Authentication Flow
1. User accesses application at `https://timetracker.fmb.com`
2. Application redirects to RSA Identity Provider for SAML authentication
3. After successful authentication, user is redirected back with SAML assertion
4. Application validates assertion and creates session in MS SQL database
5. User gains access to application based on their role

### Database Schema
- **Sessions**: Express session storage in MS SQL
- **Users**: User profiles from SAML authentication
- **Organizations**: FMB organizational structure
- **Departments**: Department management
- **Projects**: Project tracking and management
- **Tasks**: Task assignment and tracking
- **Time Entries**: Time logging and tracking
- **Employees**: Employee profiles and assignments

## Configuration

### Required Environment Variables

```bash
# Database Configuration
FMB_DATABASE_SERVER=HUB-SQL1TST-LIS
FMB_DATABASE_NAME=timetracker
FMB_DATABASE_USER=timetracker
FMB_DATABASE_PASSWORD=your_secure_password

# SAML Configuration
FMB_SAML_ISSUER=https://timetracker.fmb.com
FMB_SAML_CERT=your_saml_certificate
FMB_SAML_ENTRY_POINT=https://your-rsa-idp.fmb.com/sso/saml
FMB_SAML_CALLBACK_URL=https://timetracker.fmb.com/saml/acs

# Session Security
FMB_SESSION_SECRET=your_32_character_minimum_secret

# Server Configuration
FMB_PORT=5000
FMB_HOST=0.0.0.0
```

## Deployment

### Prerequisites
- Windows Server 2022
- IIS 10.0+
- MS SQL Server 2019+
- Node.js 20+
- PM2 for process management

### Installation Steps

1. **Database Setup**
   ```powershell
   sqlcmd -S HUB-SQL1TST-LIS -d timetracker -i fmb-onprem/scripts/fmb-complete-setup.sql
   ```

2. **Application Deployment**
   ```powershell
   .\fmb-onprem\scripts\fmb-install.ps1
   ```

3. **IIS Configuration**
   ```powershell
   .\fmb-onprem\scripts\fmb-iis-config.ps1
   ```

4. **Start Application**
   ```powershell
   .\fmb-onprem\scripts\fmb-deploy.ps1
   ```

## Security Features

- **HttpOnly Cookies**: Session cookies are not accessible via JavaScript
- **SAML Integration**: Enterprise SSO with RSA Identity Provider
- **Role-Based Access**: Granular permissions based on user roles
- **Database Session Store**: Sessions persisted in MS SQL for clustering
- **SQL Injection Protection**: Parameterized queries throughout
- **CSRF Protection**: Built-in CSRF protection mechanisms

## Monitoring

- **Session Health Monitoring**: Automatic monitoring of session store health
- **Database Health Checks**: Regular database connectivity validation
- **Application Logs**: Comprehensive logging for troubleshooting
- **Performance Metrics**: Session and database performance tracking

## Support

For technical support and configuration assistance, contact the FMB IT Department.

## Version Information

- **Version**: 1.0.0-fmb
- **Environment**: On-Premises Production
- **Authentication**: SAML 2.0
- **Database**: MS SQL Server
- **Session Store**: Custom MS SQL Session Store

# FMB TimeTracker On-Premises Setup

This directory contains all the necessary files and configurations for deploying TimeTracker on FMB's on-premises infrastructure.

## Architecture Overview

- **Application Server**: HUB-DEVAPP01-C3 (Windows Server with IIS reverse proxy)
- **Database**: HUB-SQL1TST-LIS (MS SQL Server)
- **Authentication**: RSA SAML Identity Provider
- **Domain**: https://timetracker.fmb.com
- **Port**: 3000 (proxied through IIS to 443)

## Installation Steps

### 1. Prerequisites
- Windows Server 2022
- Node.js 20.x or higher
- MS SQL Server access
- IIS with URL Rewrite Module
- PowerShell 5.1 or higher

### 2. Database Setup
```powershell
# Run the complete database setup script on HUB-SQL1TST-LIS
sqlcmd -S HUB-SQL1TST-LIS -d timetracker -U timetracker -P "iTT!\$Lo7gm\"i\'JAg~5Y\\" -i scripts\fmb-complete-setup.sql
```

### 3. Application Installation
```powershell
# Run the installation script as Administrator
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
.\scripts\fmb-install.ps1
```

### 4. Configuration
Edit `C:\fmb-timetracker\.env` with your environment-specific values:
- Update database connection details
- Configure SAML certificate and endpoints
- Set session secrets and security settings

### 5. IIS Reverse Proxy Configuration
```powershell
# Configure IIS reverse proxy as Administrator
.\scripts\fmb-iis-config.ps1
```

### 6. Start the Application
```powershell
# Navigate to application directory
cd C:\fmb-timetracker

# Start with PM2
npx pm2 start ecosystem.config.cjs

# Or start Windows service (if installed)
net start FMBTimeTracker
```

## Maintenance

### Viewing Logs
```powershell
# PM2 logs
npx pm2 logs

# Log files location
Get-Content C:\fmb-timetracker\logs\combined.log -Tail 50 -Wait
```

### Deployment Updates
```powershell
# Run as Administrator
.\scripts\fmb-deploy.ps1
```

### Service Management
```powershell
# PM2 Status
npx pm2 status

# Restart application
npx pm2 restart ecosystem.config.cjs

# Windows Service (if using service mode)
net start FMBTimeTracker
net stop FMBTimeTracker
net restart FMBTimeTracker

# IIS Management
iisreset /restart
```

## Synchronization Strategy

The application is designed to maintain feature parity between Replit and on-premises versions:

1. **Core Business Logic**: Shared in `/shared` and `/server` directories
2. **Environment Detection**: Automatic detection via `FMB_DEPLOYMENT=onprem`
3. **Database Abstraction**: Same schema, different drivers (PostgreSQL vs MS SQL)
4. **Authentication Abstraction**: Pluggable auth strategies (Replit OAuth vs SAML)

## Troubleshooting

### Common Issues

1. **Database Connection Failures**
   - Verify MS SQL Server is accessible
   - Check firewall settings
   - Validate credentials

2. **SAML Authentication Issues**
   - Verify certificate format
   - Check IDP metadata configuration
   - Validate ACS URL accessibility

3. **IIS Proxy Issues**
   - Ensure URL rewrite module is installed
   - Verify proxy rules configuration
   - Check application pool settings

### Health Checks

The application provides health check endpoints:
- `/api/health` - General application health
- `/api/health/database` - Database connectivity
- `/api/health/saml` - SAML configuration validation

## Security Considerations

1. **TLS/SSL**: Ensure all traffic is encrypted
2. **Session Management**: Use secure session storage
3. **SAML Security**: Validate all SAML assertions
4. **Database Security**: Use encrypted connections
5. **Logging**: Ensure sensitive data is not logged

## Contact

For support with the on-premises deployment, contact the FMB IT team.