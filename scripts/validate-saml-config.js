
#!/usr/bin/env node

/**
 * SAML Configuration Validator
 * Validates SAML certificate and configuration
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function validateCertificate(certPath) {
  console.log('🔍 Validating SAML certificate...\n');
  
  try {
    if (!fs.existsSync(certPath)) {
      console.error('❌ Certificate file not found:', certPath);
      return false;
    }
    
    const certContent = fs.readFileSync(certPath, 'utf8');
    console.log('📄 Certificate file found');
    console.log('📏 Certificate length:', certContent.length, 'characters');
    
    // Check format
    const hasBegin = certContent.includes('-----BEGIN CERTIFICATE-----');
    const hasEnd = certContent.includes('-----END CERTIFICATE-----');
    
    console.log('✅ Has BEGIN marker:', hasBegin);
    console.log('✅ Has END marker:', hasEnd);
    
    if (!hasBegin || !hasEnd) {
      console.error('❌ Invalid certificate format');
      return false;
    }
    
    // Extract certificate data
    const certData = certContent
      .replace('-----BEGIN CERTIFICATE-----', '')
      .replace('-----END CERTIFICATE-----', '')
      .replace(/\s/g, '');
    
    console.log('📏 Certificate data length:', certData.length);
    
    // Validate base64
    try {
      const buffer = Buffer.from(certData, 'base64');
      console.log('✅ Valid base64 encoding');
      console.log('📏 Decoded length:', buffer.length, 'bytes');
      
      // Try to parse as X.509
      const cert = crypto.X509Certificate ? new crypto.X509Certificate(certContent) : null;
      if (cert) {
        console.log('✅ Valid X.509 certificate');
        console.log('📅 Valid from:', cert.validFrom);
        console.log('📅 Valid to:', cert.validTo);
        console.log('🏢 Subject:', cert.subject);
        console.log('🏢 Issuer:', cert.issuer);
      }
      
    } catch (parseError) {
      console.error('❌ Certificate parsing failed:', parseError.message);
      return false;
    }
    
    return true;
    
  } catch (error) {
    console.error('❌ Certificate validation failed:', error.message);
    return false;
  }
}

function validateSamlConfig() {
  console.log('🔍 Validating SAML configuration...\n');
  
  require('dotenv').config({ path: './fmb-onprem/.env.fmb-onprem' });
  
  const requiredEnvVars = [
    'FMB_SAML_ENTITY_ID',
    'FMB_SAML_SSO_URL',
    'FMB_SAML_ACS_URL',
    'FMB_SAML_CERT',
    'FMB_SAML_ISSUER'
  ];
  
  let allValid = true;
  
  for (const envVar of requiredEnvVars) {
    const value = process.env[envVar];
    if (value) {
      console.log(`✅ ${envVar}: ${value.substring(0, 50)}...`);
    } else {
      console.error(`❌ ${envVar}: Missing`);
      allValid = false;
    }
  }
  
  return allValid;
}

// Main execution
console.log('🛡️ SAML Configuration Validator\n');

const configValid = validateSamlConfig();
const certValid = validateCertificate('./saml_cert.pem');

console.log('\n📊 Validation Summary:');
console.log('Configuration:', configValid ? '✅ Valid' : '❌ Invalid');
console.log('Certificate:', certValid ? '✅ Valid' : '❌ Invalid');

if (configValid && certValid) {
  console.log('\n🎉 SAML configuration appears to be valid!');
  process.exit(0);
} else {
  console.log('\n🔴 SAML configuration has issues that need to be resolved.');
  process.exit(1);
}
