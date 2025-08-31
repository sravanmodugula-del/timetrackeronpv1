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

  // Load and cache the config instead of calling getFmbConfig
  return loadAndExportFmbConfig();
}

// Always return true for FMB on-premises only version
export function isFmbOnPremEnvironment(): boolean {
  return true;
}

// Validate FMB environment variables
export function validateFmbEnvironment(): boolean {
  const requiredVars = [
    'FMB_DB_SERVER',
    'FMB_DB_NAME',
    'FMB_DB_USER',
    'FMB_DB_PASSWORD',
    'FMB_SESSION_SECRET',
    'FMB_SAML_ENTITY_ID',
    'FMB_SAML_SSO_URL',
    'FMB_SAML_ACS_URL'
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
  // Ensure config is loaded
  if (!global.fmbConfig) {
    loadAndExportFmbConfig();
  }
  return global.fmbConfig!;
}

// Helper function to read certificate file content
function readCertificateFile(certPath: string): string {
  try {
    const fs = require('fs');
    const path = require('path');

    // Handle relative paths from the project root
    const fullPath = path.isAbsolute(certPath) ? certPath : path.join(process.cwd(), certPath);

    console.log(`🔍 [FMB-CONFIG] Looking for certificate at: ${fullPath}`);

    if (fs.existsSync(fullPath)) {
      const certContent = fs.readFileSync(fullPath, 'utf8').trim();
      console.log(`✅ [FMB-CONFIG] Certificate loaded successfully from: ${fullPath}`);
      return certContent;
    } else {
      console.error(`🔴 [FMB-CONFIG] Certificate file not found at: ${fullPath}`);
      throw new Error(`SAML certificate file not found: ${fullPath}`);
    }
  } catch (error) {
    console.error(`🔴 [FMB-CONFIG] Error reading certificate file: ${error}`);
    throw error;
  }
}

// Load FMB configuration and export it
export function loadAndExportFmbConfig() {
  const config = {
    database: {
      server: process.env.FMB_DB_SERVER!,
      database: process.env.FMB_DB_NAME!,
      user: process.env.FMB_DB_USER!,
      password: process.env.FMB_DB_PASSWORD!,
      port: parseInt(process.env.FMB_DB_PORT || '1433'),
      options: {
        encrypt: process.env.FMB_DB_ENCRYPT === 'true',
        // Fix: Disable trustServerCertificate for self-signed certificates as per log
        trustServerCertificate: false
      }
    },
    // SAML configuration
    saml: {
      issuer: process.env.FMB_SAML_ISSUER!,
      // Fix: Load SAML certificate content from file
      cert: readCertificateFile(process.env.FMB_SAML_CERT!),
      entryPoint: process.env.FMB_SAML_SSO_URL!,
      callbackUrl: process.env.FMB_SAML_ACS_URL!
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
  // Store config in global scope to be accessible by getFmbConfig
  global.fmbConfig = config;
  return config;
}
