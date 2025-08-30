
import dotenv from 'dotenv';
import path from 'path';

// Load FMB on-premises configuration
export function loadFmbOnPremConfig() {
  // Load the FMB-specific environment file
  const fmbEnvPath = path.join(process.cwd(), 'fmb-onprem', '.env.fmb-onprem');
  dotenv.config({ path: fmbEnvPath });
  
  // Load the main .env file as well for any shared configs
  dotenv.config();
  
  console.log('🏢 FMB On-Premises configuration loaded');
}

// Always return true for FMB on-premises only version
export function isFmbOnPremEnvironment(): boolean {
  return true;
}

// Validate FMB environment variables
export function validateFmbEnvironment(): boolean {
  const requiredVars = [
    'FMB_DATABASE_SERVER',
    'FMB_DATABASE_NAME',
    'FMB_DATABASE_USER',
    'FMB_DATABASE_PASSWORD',
    'FMB_SESSION_SECRET',
    'FMB_SAML_ISSUER',
    'FMB_SAML_CERT',
    'FMB_SAML_ENTRY_POINT'
  ];

  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required FMB environment variables:', missing);
    return false;
  }

  console.log('✅ All required FMB environment variables are set');
  return true;
}

// Get FMB-specific configuration
export function getFmbConfig() {
  return {
    database: {
      server: process.env.FMB_DATABASE_SERVER!,
      database: process.env.FMB_DATABASE_NAME!,
      user: process.env.FMB_DATABASE_USER!,
      password: process.env.FMB_DATABASE_PASSWORD!,
      port: parseInt(process.env.FMB_DATABASE_PORT || '1433'),
      options: {
        encrypt: process.env.FMB_DATABASE_ENCRYPT === 'true',
        trustServerCertificate: process.env.FMB_DATABASE_TRUST_CERT === 'true'
      }
    },
    saml: {
      issuer: process.env.FMB_SAML_ISSUER!,
      cert: process.env.FMB_SAML_CERT!,
      entryPoint: process.env.FMB_SAML_ENTRY_POINT!,
      callbackUrl: process.env.FMB_SAML_CALLBACK_URL || 'https://timetracker.fmb.com/saml/acs'
    },
    session: {
      secret: process.env.FMB_SESSION_SECRET!,
      name: 'fmb.timetracker.sid'
    },
    server: {
      port: parseInt(process.env.FMB_PORT || '5000'),
      host: process.env.FMB_HOST || '0.0.0.0'
    }
  };
}
