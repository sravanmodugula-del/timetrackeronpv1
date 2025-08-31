
#!/usr/bin/env node

/**
 * FMB On-Premises Production Readiness Check
 * Validates all environment variables and configurations for FMB production deployment
 */

import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Required environment variables for FMB on-premises production
const REQUIRED_FMB_ENV_VARS = [
  'NODE_ENV',
  'FMB_DEPLOYMENT',
  'FMB_SESSION_SECRET',
  'FMB_DB_SERVER',
  'FMB_DB_NAME',
  'FMB_DB_USER',
  'FMB_DB_PASSWORD',
  'FMB_SAML_ENTITY_ID',
  'FMB_SAML_SSO_URL',
  'FMB_SAML_ACS_URL'
];

const OPTIONAL_FMB_ENV_VARS = [
  'FMB_PORT',
  'FMB_HOST',
  'FMB_DB_PORT',
  'FMB_DB_ENCRYPT',
  'FMB_DB_TRUST_CERT'
];

function checkFmbEnvironmentVariables() {
  console.log('🏢 Checking FMB on-premises environment variables...\n');
  
  let errors = 0;
  let warnings = 0;

  // Check required FMB variables
  console.log('Required FMB environment variables:');
  REQUIRED_FMB_ENV_VARS.forEach(varName => {
    const value = process.env[varName];
    if (value) {
      const displayValue = varName.includes('SECRET') || varName.includes('PASSWORD') ? '***HIDDEN***' : value;
      console.log(`✅ ${varName} = ${displayValue}`);
      
      // Additional FMB-specific validation
      if (varName === 'NODE_ENV' && value !== 'production') {
        console.log(`   ❌ ERROR: NODE_ENV must be "production" for FMB deployment, got "${value}"`);
        errors++;
      }
      
      if (varName === 'FMB_DEPLOYMENT' && value !== 'onprem') {
        console.log(`   ❌ ERROR: FMB_DEPLOYMENT must be "onprem", got "${value}"`);
        errors++;
      }
      
      if (varName === 'FMB_SESSION_SECRET' && value.length < 32) {
        console.log(`   ❌ ERROR: FMB_SESSION_SECRET must be at least 32 characters for enterprise security`);
        errors++;
      }
      
      if (varName === 'FMB_DB_SERVER' && !value.includes('HUB-SQL1TST-LIS')) {
        console.log(`   ⚠️  Warning: FMB_DB_SERVER should point to HUB-SQL1TST-LIS for production`);
        warnings++;
      }
      
    } else {
      console.log(`❌ ${varName} - MISSING`);
      errors++;
    }
  });

  // Check optional FMB variables
  console.log('\nOptional FMB environment variables:');
  OPTIONAL_FMB_ENV_VARS.forEach(varName => {
    const value = process.env[varName];
    if (value) {
      console.log(`✅ ${varName} = ${value}`);
    } else {
      console.log(`➖ ${varName} - Using default`);
    }
  });

  return { errors, warnings };
}

function checkFmbSecurityConfiguration() {
  console.log('\n🔒 Checking FMB security configuration...\n');
  
  let errors = 0;
  let warnings = 0;
  
  // Critical security checks for FMB
  if (process.env.NODE_ENV !== 'production') {
    console.log('❌ CRITICAL: NODE_ENV must be "production" for FMB deployment');
    errors++;
  } else {
    console.log('✅ NODE_ENV correctly set to production');
  }

  if (process.env.FMB_DEPLOYMENT !== 'onprem') {
    console.log('❌ CRITICAL: FMB_DEPLOYMENT must be "onprem"');
    errors++;
  } else {
    console.log('✅ FMB_DEPLOYMENT correctly set to onprem');
  }

  // Check SAML configuration
  if (process.env.FMB_SAML_ENTITY_ID && process.env.FMB_SAML_SSO_URL && process.env.FMB_SAML_ACS_URL) {
    console.log('✅ SAML configuration variables are set');
    
    if (!process.env.FMB_SAML_ACS_URL.includes('https://timetracker.fmb.com')) {
      console.log('⚠️  Warning: SAML ACS URL should use production domain');
      warnings++;
    }
  } else {
    console.log('❌ SAML configuration incomplete');
    errors++;
  }

  // Check database configuration
  if (process.env.FMB_DB_ENCRYPT !== 'true') {
    console.log('⚠️  Warning: Database encryption should be enabled for production');
    warnings++;
  }

  return { errors, warnings };
}

async function checkFmbBuildArtifacts() {
  console.log('\n🏗️  Checking FMB build artifacts...\n');
  
  let errors = 0;
  
  // Check if dist directory exists
  if (fs.existsSync('dist')) {
    console.log('✅ Build directory (dist/) exists');
    
    // Check for main server file
    if (fs.existsSync('dist/index.js')) {
      console.log('✅ Server build (dist/index.js) found');
    } else {
      console.log('❌ Server build missing');
      errors++;
    }
    
    // Check for FMB config builds
    if (fs.existsSync('dist/fmb-onprem/config')) {
      console.log('✅ FMB configuration builds found');
    } else {
      console.log('❌ FMB configuration builds missing');
      errors++;
    }
    
  } else {
    console.log('❌ Build directory (dist/) does not exist');
    console.log('   💡 Run "npm run build" before FMB production deployment');
    errors++;
  }

  // Check if public build exists for frontend
  if (fs.existsSync('public')) {
    console.log('✅ Frontend build directory (public/) exists');
  } else {
    console.log('❌ Frontend build directory missing');
    errors++;
  }
  
  return { errors, warnings: 0 };
}

async function checkFmbCriticalFiles() {
  console.log('\n📋 Checking FMB critical files...\n');
  
  let errors = 0;
  
  const fmbCriticalFiles = [
    'fmb-onprem/config/fmb-env.ts',
    'fmb-onprem/config/fmb-database.ts',
    'fmb-onprem/storage/fmb-storage.ts',
    'fmb-onprem/auth/fmb-saml-auth.ts',
    'fmb-onprem/scripts/fmb-complete-setup.sql',
    'fmb-onprem/.env.fmb-onprem',
    'ecosystem.config.cjs'
  ];
  
  fmbCriticalFiles.forEach(file => {
    if (fs.existsSync(file)) {
      console.log(`✅ ${file}`);
    } else {
      console.log(`❌ ${file} - MISSING`);
      errors++;
    }
  });
  
  return { errors, warnings: 0 };
}

function checkTypeScriptErrors() {
  console.log('\n🔧 Checking TypeScript compilation...\n');
  
  try {
    const { execSync } = require('child_process');
    execSync('npx tsc --noEmit', { stdio: 'pipe' });
    console.log('✅ TypeScript compilation successful');
    return { errors: 0, warnings: 0 };
  } catch (error) {
    console.log('❌ TypeScript compilation errors found');
    console.log('   💡 Fix TypeScript errors before production deployment');
    return { errors: 1, warnings: 0 };
  }
}

async function main() {
  console.log('🏢 FMB TimeTracker On-Premises Production Readiness Check\n');
  console.log('=' .repeat(60));
  
  // Load environment from FMB config
  if (fs.existsSync('.env')) {
    require('dotenv').config();
  }
  if (fs.existsSync('fmb-onprem/.env.fmb-onprem')) {
    require('dotenv').config({ path: 'fmb-onprem/.env.fmb-onprem' });
  }
  
  let totalErrors = 0;
  let totalWarnings = 0;
  
  // Run all FMB-specific checks
  const envCheck = checkFmbEnvironmentVariables();
  totalErrors += envCheck.errors;
  totalWarnings += envCheck.warnings;
  
  const securityCheck = checkFmbSecurityConfiguration();
  totalErrors += securityCheck.errors;
  totalWarnings += securityCheck.warnings;
  
  const buildCheck = await checkFmbBuildArtifacts();
  totalErrors += buildCheck.errors;
  totalWarnings += buildCheck.warnings;
  
  const filesCheck = await checkFmbCriticalFiles();
  totalErrors += filesCheck.errors;
  totalWarnings += filesCheck.warnings;

  const tsCheck = checkTypeScriptErrors();
  totalErrors += tsCheck.errors;
  totalWarnings += tsCheck.warnings;
  
  // Final summary
  console.log('\n' + '=' .repeat(60));
  console.log('📊 FMB ON-PREMISES PRODUCTION READINESS SUMMARY\n');
  
  if (totalErrors === 0) {
    console.log('✅ READY FOR FMB ON-PREMISES PRODUCTION DEPLOYMENT');
    if (totalWarnings > 0) {
      console.log(`⚠️  ${totalWarnings} warnings found - consider reviewing`);
    }
    console.log('\n🚀 Your FMB TimeTracker application is ready for on-premises deployment!');
    console.log('\n📋 Next steps:');
    console.log('   1. Run: .\\fmb-onprem\\scripts\\fmb-deploy.ps1');
    console.log('   2. Configure IIS reverse proxy');
    console.log('   3. Verify SAML integration');
    console.log('   4. Test database connectivity to HUB-SQL1TST-LIS');
    process.exit(0);
  } else {
    console.log('❌ NOT READY FOR FMB PRODUCTION DEPLOYMENT');
    console.log(`   ${totalErrors} critical errors found`);
    console.log(`   ${totalWarnings} warnings found`);
    console.log('\n💡 Fix all errors before deploying to FMB production environment');
    console.log('\n🔧 FMB-specific fixes needed:');
    console.log('   • Ensure NODE_ENV=production');
    console.log('   • Set FMB_DEPLOYMENT=onprem');
    console.log('   • Configure all FMB_* environment variables');
    console.log('   • Run npm run build');
    console.log('   • Fix TypeScript compilation errors');
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled promise rejection:', reason);
  process.exit(1);
});

// Run the FMB production check
main().catch(error => {
  console.error('❌ FMB production readiness check failed:', error);
  process.exit(1);
});
