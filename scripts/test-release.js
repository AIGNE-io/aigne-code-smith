#!/usr/bin/env node

/**
 * Test script for release functionality - validates without making changes
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function execCommand(command, options = {}) {
  try {
    return execSync(command, { 
      encoding: 'utf8', 
      stdio: options.silent ? 'pipe' : 'inherit',
      ...options 
    });
  } catch (err) {
    if (!options.allowFail) {
      throw err;
    }
    return '';
  }
}

function testValidation() {
  console.log('🧪 Testing release script validation...\n');
  
  // Test 1: Check dependencies
  console.log('1. Checking dependencies:');
  const deps = [
    { cmd: 'node --version', name: 'Node.js' },
    { cmd: 'npm --version', name: 'npm' },
    { cmd: 'git --version', name: 'Git' },
    { cmd: 'gh --version', name: 'GitHub CLI' }
  ];

  let allDepsOk = true;
  for (const dep of deps) {
    try {
      const version = execCommand(dep.cmd, { silent: true }).trim();
      console.log(`   ✅ ${dep.name}: ${version}`);
    } catch {
      console.log(`   ❌ ${dep.name}: Not installed`);
      allDepsOk = false;
    }
  }
  
  // Test 2: Check package.json
  console.log('\n2. Checking package.json:');
  try {
    const packagePath = path.join(__dirname, '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    console.log(`   ✅ Current version: ${packageJson.version}`);
    console.log(`   ✅ Name: ${packageJson.name}`);
    console.log(`   ✅ Repository: ${packageJson.repository?.url || 'Not set'}`);
  } catch (err) {
    console.log(`   ❌ Error reading package.json: ${err.message}`);
  }
  
  // Test 3: Check git status
  console.log('\n3. Checking git status:');
  try {
    const branch = execCommand('git branch --show-current', { silent: true }).trim();
    console.log(`   📍 Current branch: ${branch}`);
    
    const status = execCommand('git status --porcelain', { silent: true }).trim();
    if (status) {
      console.log(`   ⚠️  Working directory has changes:`);
      console.log(`   ${status.split('\n').join('\n   ')}`);
    } else {
      console.log(`   ✅ Working directory is clean`);
    }
  } catch (err) {
    console.log(`   ❌ Error checking git status: ${err.message}`);
  }
  
  // Test 4: Check build process
  console.log('\n4. Testing build commands:');
  const buildCommands = [
    'npm run build',
    'npm run lint', 
    'npm run format-check',
    'npm run package'
  ];
  
  for (const cmd of buildCommands) {
    try {
      console.log(`   Testing: ${cmd}`);
      execCommand(cmd, { silent: true });
      console.log(`   ✅ ${cmd} - OK`);
    } catch (err) {
      console.log(`   ❌ ${cmd} - Failed: ${err.message.split('\n')[0]}`);
    }
  }
  
  // Test 5: Version calculation
  console.log('\n5. Testing version calculations:');
  const currentVersion = '0.1.0';
  const versions = {
    patch: calculateNextVersion(currentVersion, 'patch'),
    minor: calculateNextVersion(currentVersion, 'minor'), 
    major: calculateNextVersion(currentVersion, 'major')
  };
  
  for (const [type, version] of Object.entries(versions)) {
    console.log(`   ${currentVersion} -> ${type} -> ${version}`);
  }
  
  // Test 6: Script permissions
  console.log('\n6. Checking script permissions:');
  const scripts = ['scripts/release.sh', 'scripts/release.js'];
  for (const script of scripts) {
    try {
      const stats = fs.statSync(path.join(__dirname, '..', script));
      const isExecutable = !!(stats.mode & parseInt('111', 8));
      console.log(`   ${isExecutable ? '✅' : '❌'} ${script} - ${isExecutable ? 'Executable' : 'Not executable'}`);
    } catch (err) {
      console.log(`   ❌ ${script} - Not found`);
    }
  }
  
  console.log('\n🎉 Validation complete!');
  console.log('\n💡 To run an actual release:');
  console.log('   npm run release:patch   # 0.1.0 -> 0.1.1');
  console.log('   npm run release:minor   # 0.1.0 -> 0.2.0'); 
  console.log('   npm run release:major   # 0.1.0 -> 1.0.0');
  
  if (!allDepsOk) {
    console.log('\n⚠️  Please install missing dependencies before running a release.');
  }
}

// Helper function from main script
function calculateNextVersion(currentVersion, releaseType) {
  const parts = currentVersion.split('.').map(Number);
  
  switch (releaseType) {
    case 'major':
      return `${parts[0] + 1}.0.0`;
    case 'minor':
      return `${parts[0]}.${parts[1] + 1}.0`;
    case 'patch':
      return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
    default:
      throw new Error(`Invalid release type: ${releaseType}`);
  }
}

// Run the test
if (require.main === module) {
  testValidation();
}