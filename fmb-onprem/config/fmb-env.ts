import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

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
    // Handle relative paths from the project root
    const fullPath = path.isAbsolute(certPath) ? certPath : path.join(process.cwd(), certPath);

    console.log(`🔍 [FMB-CONFIG] Looking for certificate at: ${fullPath}`);

    if (fs.existsSync(fullPath)) {
      let certContent = fs.readFileSync(fullPath, 'utf8').trim();

      // Remove any extra whitespace and ensure proper certificate format
      certContent = certContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      // Ensure the certificate has proper BEGIN/END markers
      if (!certContent.includes('-----BEGIN CERTIFICATE-----')) {
        throw new Error('Invalid certificate format: missing BEGIN marker');
      }
      if (!certContent.includes('-----END CERTIFICATE-----')) {
        throw new Error('Invalid certificate format: missing END marker');
      }

      console.log(`✅ [FMB-CONFIG] Certificate loaded successfully from: ${fullPath}`);
      console.log(`🔍 [FMB-CONFIG] Certificate length: ${certContent.length} characters`);
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
        // Fix: Enable trustServerCertificate for self-signed certificates
        trustServerCertificate: process.env.FMB_DB_TRUST_SERVER_CERTIFICATE === 'true'
      }
    },
    // SAML Configuration
    saml: {
      issuer: process.env.FMB_SAML_ISSUER || 'fmb-timetracker',
      entryPoint: process.env.FMB_SAML_SSO_URL || '',
      callbackUrl: process.env.FMB_SAML_ACS_URL || '',
      certPath: process.env.FMB_SAML_CERT || './saml_cert.pem',
      cert: '',
      nameIdFormat: process.env.FMB_SAML_NAME_ID_FORMAT || 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
      binding: process.env.FMB_SAML_BINDING || 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST'
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