
#!/usr/bin/env node

const { execSync } = require('child_process');

console.log('🔍 Validating On-Premises Fixes...\n');

// Check if PostgreSQL columns are fixed
try {
  console.log('📊 Checking PostgreSQL column structure...');
  const dbCheck = execSync('npx drizzle-kit introspect', { 
    encoding: 'utf8',
    cwd: process.cwd()
  });
  console.log('✅ Database introspection completed');
} catch (error) {
  console.log('⚠️  Database introspection warning:', error.message);
}

// Check TypeScript compilation
try {
  console.log('\n🔧 Checking TypeScript compilation...');
  execSync('npx tsc --noEmit', { 
    encoding: 'utf8',
    stdio: 'pipe'
  });
  console.log('✅ TypeScript compilation successful');
} catch (error) {
  console.log('❌ TypeScript compilation errors found');
  console.log(error.stdout || error.message);
}

// Check FMB storage class implementation
try {
  console.log('\n📦 Validating FMB Storage implementation...');
  const fs = require('fs');
  const storageContent = fs.readFileSync('fmb-onprem/storage/fmb-storage.ts', 'utf8');
  
  const requiredMethods = [
    'getUser',
    'getUserByEmail', 
    'upsertUser',
    'getProjects',
    'getProject',
    'updateProject',
    'deleteProject',
    'getTimeEntries',
    'getTimeEntry',
    'updateTimeEntry',
    'deleteTimeEntry',
    'getTask'
  ];
  
  const missingMethods = requiredMethods.filter(method => 
    !storageContent.includes(`async ${method}(`)
  );
  
  if (missingMethods.length === 0) {
    console.log('✅ All required methods implemented');
  } else {
    console.log('❌ Missing methods:', missingMethods.join(', '));
  }
} catch (error) {
  console.log('❌ Storage validation failed:', error.message);
}

console.log('\n🎉 Validation complete!');
console.log('\n📋 Next steps:');
console.log('1. Restart the development server');
console.log('2. Test authentication flow');
console.log('3. Verify database operations work correctly');
