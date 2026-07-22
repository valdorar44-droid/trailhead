#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(mobileRoot, path), 'utf8');
const autolinkingCli = join(
  mobileRoot,
  'node_modules/expo-modules-autolinking/bin/expo-modules-autolinking.js',
);

function autolinkingJson(args) {
  const result = spawnSync(process.execPath, [autolinkingCli, ...args, '--json'], {
    cwd: mobileRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || `Autolinking failed: ${args.join(' ')}`);
  return JSON.parse(result.stdout);
}

const pkg = JSON.parse(read('package.json'));
const androidExpoGraph = autolinkingJson(['resolve', '--platform', 'android']);
const iosExpoGraph = autolinkingJson(['resolve', '--platform', 'ios']);
const androidReactGraph = autolinkingJson(['react-native-config', '--platform', 'android']);
const iosReactGraph = autolinkingJson(['react-native-config', '--platform', 'ios']);

const androidAdapter = androidExpoGraph.modules.find(
  module => module.packageName === '@config-plugins/react-native-branch',
);
const iosAdapter = iosExpoGraph.modules.find(
  module => module.packageName === '@config-plugins/react-native-branch',
);

assert.equal(pkg.dependencies['@config-plugins/react-native-branch'], '11.0.0');
assert.equal(pkg.dependencies['react-native-branch'], '6.10.0');
assert.ok(
  !pkg.expo?.autolinking?.exclude?.includes('@config-plugins/react-native-branch'),
  'The Branch Expo lifecycle adapter must remain autolinked.',
);
assert.equal(androidAdapter?.projects?.[0]?.name, 'config-plugins-react-native-branch');
assert.equal(iosAdapter?.pods?.[0]?.podName, 'ExpoAdapterBranch');
assert.ok(iosAdapter?.appDelegateSubscribers?.includes('BranchAppDelegate'));
assert.ok(androidReactGraph.dependencies?.['react-native-branch']?.platforms?.android);
assert.ok(iosReactGraph.dependencies?.['react-native-branch']?.platforms?.ios);

const androidApplicationAdapter = read(
  'node_modules/@config-plugins/react-native-branch/android/src/main/java/expo/modules/adapters/branch/BranchApplicationLifecycleListener.kt',
);
const androidActivityAdapter = read(
  'node_modules/@config-plugins/react-native-branch/android/src/main/java/expo/modules/adapters/branch/BranchReactActivityLifecycleListener.kt',
);
const iosAppDelegateAdapter = read(
  'node_modules/@config-plugins/react-native-branch/ios/ExpoAdapterBranch/BranchAppDelegate.swift',
);

assert.match(androidApplicationAdapter, /RNBranchModule\.getAutoInstance\(this\.context\)/);
assert.match(androidActivityAdapter, /RNBranchModule\.initSession\(activity\.getIntent\(\)\.getData\(\), activity\)/);
assert.match(androidActivityAdapter, /override fun onNewIntent\(intent: Intent\?\)[\s\S]*RNBranchModule\.onNewIntent\(intent\)/);
assert.match(iosAppDelegateAdapter, /RNBranch\.initSession\(launchOptions: launchOptions, isReferrable: true\)/);
assert.match(iosAppDelegateAdapter, /RNBranch\.application\(application, open:url, options:options\)/);
assert.match(iosAppDelegateAdapter, /RNBranch\.continue\(userActivity\)/);

const application = read('android/app/src/main/java/com/trailhead/app/MainApplication.kt');
const activity = read('android/app/src/main/java/com/trailhead/app/MainActivity.kt');
const appDelegate = read('ios/Trailhead/AppDelegate.swift');
assert.doesNotMatch(application + activity, /RNBranchModule/, 'Do not duplicate Expo adapter callbacks in Android app classes.');
assert.doesNotMatch(appDelegate, /import RNBranch/, 'Do not duplicate Expo AppDelegateSubscriber callbacks.');

const branchConfig = JSON.parse(read('ios/Trailhead/Branch.json'));
assert.equal(branchConfig.checkPasteboardOnInstall, true, 'Do not silently change the approved NativeLink policy.');

console.log('Branch Expo lifecycle and native autolinking tests passed.');
