#!/usr/bin/env node
/**
 * Patches expo-modules-core's ExpoModulesCorePlugin.gradle to fix
 * "Could not get unknown property 'release'" error on Gradle 8.8+.
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(
  __dirname,
  '../node_modules/expo-modules-core/android/ExpoModulesCorePlugin.gradle'
);

if (!fs.existsSync(filePath)) {
  console.log('expo-modules-core patch: file not found, skipping.');
  process.exit(0);
}

let content = fs.readFileSync(filePath, 'utf8');

if (!content.includes('components.release')) {
  console.log('expo-modules-core patch: already patched, skipping.');
  process.exit(0);
}

// Inject a variable before the publishing block, then use it in 'from'
// Strategy: find the project.afterEvaluate opening line and inject after it
const lines = content.split('\n');
const result = [];
let injected = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // Inject the variable declaration after the project.afterEvaluate { line
  if (!injected && line.includes('project.afterEvaluate') && line.includes('{')) {
    result.push(line);
    // Detect indentation from this line
    const indent = line.match(/^(\s*)/)[1] + '  ';
    result.push(`${indent}def releaseComponent = components.findByName('release')`);
    result.push(`${indent}if (releaseComponent == null) return`);
    injected = true;
    continue;
  }

  // Replace the problematic 'from components.release' with the variable
  if (line.includes('from components.release')) {
    result.push(line.replace('from components.release', 'from releaseComponent'));
    continue;
  }

  result.push(line);
}

fs.writeFileSync(filePath, result.join('\n'));
console.log('expo-modules-core patch: applied Gradle 8.8+ fix.');
