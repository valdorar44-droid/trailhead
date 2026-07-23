#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildWindowsMaestroCommand,
  chooseMaestroHost,
  discoverWslDistro,
  isWslEnvironment,
  parseAdbDevices,
  parseMaestroArgs,
  pinnedMaestroVersion,
  quoteWindowsCmdArg,
} from './run-maestro.mjs';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = join(mobileRoot, '.maestro');
const version = readFileSync(join(workspace, 'MAESTRO_VERSION'), 'utf8').trim();
const runnerSource = readFileSync(join(mobileRoot, 'scripts', 'run-maestro.mjs'), 'utf8');
assert.match(version, /^\d+\.\d+\.\d+$/);
assert.equal(pinnedMaestroVersion(`Maestro CLI ${version}`), version);
assert.equal(pinnedMaestroVersion(`Microsoft Windows [Version 10.0.26200]\n${version}`), version);
assert.match(runnerSource, /WSL_DISTRO_NAME/);
assert.match(runnerSource, /Android Studio', 'jbr/);
assert.match(runnerSource, /platform-tools', 'adb\.exe/);
assert.doesNotMatch(runnerSource, /C:\\Users\\[A-Za-z0-9._-]+/);

const config = readFileSync(join(workspace, 'config.yaml'), 'utf8');
assert.match(config, /appId:\s*\$\{APP_ID\}/);
assert.match(config, /flows:\s*\n\s*- flows\/\*\.yaml/);

const flowNames = readdirSync(join(workspace, 'flows')).filter(name => name.endsWith('.yaml')).sort();
assert.deepEqual(flowNames, [
  '01-launch-tabs.yaml',
  '02-search-rapid-typing.yaml',
  '03-map-warm-return.yaml',
  '04-search-race-qa.yaml',
  '05-search-canonical-result.yaml',
  '06-map-search-opens-complete-sheet.yaml',
  '07-map-search-opens-complete-camp-sheet.yaml',
  '08-map-search-opens-complete-trail-sheet.yaml',
  '09-map-search-opens-trailhead-sheet.yaml',
  '10-map-place-related-sheet-drilldown.yaml',
  '11-map-place-related-camp-sheet.yaml',
  '12-map-place-related-see-visitor-sheets.yaml',
]);
for (const name of flowNames) {
  const source = readFileSync(join(workspace, 'flows', name), 'utf8');
  assert.match(source, /^appId:\s*\$\{APP_ID\}/);
  assert.match(source, /clearState:\s*false/);
  assert.doesNotMatch(source, /clearState:\s*true/);
  assert.doesNotMatch(source, /\b(?:buy|purchase|subscribe|book now|delete account|submit report|end tour)\b/i);
  assert.doesNotMatch(source, /\btapOn:\s*\n\s*point:/);
}

const rapidSearchFlow = readFileSync(join(workspace, 'flows', '02-search-rapid-typing.yaml'), 'utf8');
assert.match(rapidSearchFlow, /id:\s*"search-v2\.sheet"/);
assert.match(rapidSearchFlow, /id:\s*"search-v2\.results"/);
assert.match(rapidSearchFlow, /Search all for “Yellowstone”/);

const deterministicSearchFlow = readFileSync(join(workspace, 'flows', '04-search-race-qa.yaml'), 'utf8');
assert.match(deterministicSearchFlow, /trailhead:\/\/\/qa\/telemetry/);
assert.match(deterministicSearchFlow, /id:\s*"qa\.search-race\.run"/);
assert.match(deterministicSearchFlow, /Late result rejected/);
assert.match(deterministicSearchFlow, /No result opened automatically/);
assert.match(deterministicSearchFlow, /Explicit selection confirmed/);

const completeMapSheetFlow = readFileSync(join(workspace, 'flows', '06-map-search-opens-complete-sheet.yaml'), 'utf8');
assert.match(completeMapSheetFlow, /id:\s*"map\.search\.inline\.result\.place:nps:yell"/);
assert.match(completeMapSheetFlow, /id:\s*"place-sheet-place-place-place-nps-yell-content"/);
assert.match(completeMapSheetFlow, /assertVisible:\s*"Navigate"/);
assert.match(completeMapSheetFlow, /assertVisible:\s*"Park"/);

const completeCampSheetFlow = readFileSync(join(workspace, 'flows', '07-map-search-opens-complete-camp-sheet.yaml'), 'utf8');
assert.match(completeCampSheetFlow, /map\.search\.inline\.result\.place:ridb:251841/);
assert.match(completeCampSheetFlow, /place-sheet-camp-camp-place-ridb-251841/);
assert.match(completeCampSheetFlow, /text:\s*"Site types"/);

const completeTrailSheetFlow = readFileSync(join(workspace, 'flows', '08-map-search-opens-complete-trail-sheet.yaml'), 'utf8');
assert.match(completeTrailSheetFlow, /map\.search\.inline\.result\.place:ridb:270422/);
assert.match(completeTrailSheetFlow, /place-sheet-trail-trail-place-ridb-270422/);

const trailheadSheetFlow = readFileSync(join(workspace, 'flows', '09-map-search-opens-trailhead-sheet.yaml'), 'utf8');
assert.match(trailheadSheetFlow, /map\.search\.inline\.result\.place:nps-child:grca:places:bright-angel-trailhead/);
assert.match(trailheadSheetFlow, /place-sheet-trailhead-trailhead-place-nps-child-grca-places-bright-angel-trailhead/);

const relatedSheetFlow = readFileSync(join(workspace, 'flows', '10-map-place-related-sheet-drilldown.yaml'), 'utf8');
assert.match(relatedSheetFlow, /place-sheet-place-place-place-nps-yose-related\.things-to-do/);
assert.match(relatedSheetFlow, /item\.explore-place-nps-child-yose-thingstodo-go-skiing-at-badger-pass/);
assert.match(relatedSheetFlow, /place-sheet-place-place-explore-place-nps-child-yose-thingstodo-go-skiing-at-badger-pass-content/);
assert.match(relatedSheetFlow, /pressKey: Back/);

const relatedCampFlow = readFileSync(join(workspace, 'flows', '11-map-place-related-camp-sheet.yaml'), 'utf8');
assert.match(relatedCampFlow, /related\.campgrounds-nearby/);
assert.match(relatedCampFlow, /item\.explore-place-nps-child-yose-campgrounds-bridalveil-creek-campground/);
assert.match(relatedCampFlow, /place-sheet-camp-camp-explore-place-nps-child-yose-campgrounds-bridalveil-creek-campground-summary/);
assert.match(relatedCampFlow, /bridalveil-creek-campground-back/);

const relatedNpsFlow = readFileSync(join(workspace, 'flows', '12-map-place-related-see-visitor-sheets.yaml'), 'utf8');
assert.match(relatedNpsFlow, /related\.things-to-see/);
assert.match(relatedNpsFlow, /anderson-cabin-content/);
assert.match(relatedNpsFlow, /related\.visitor-centers/);
assert.match(relatedNpsFlow, /big-oak-flat-information-station-content/);
assert.match(relatedNpsFlow, /pressKey: Back/);

const parsed = parseMaestroArgs([
  '--device', 'emulator-5554',
  '--app-id', 'com.trailhead.app',
  '--tags', 'smoke,search',
  '--flow', '02-search-rapid-typing.yaml',
  '--dry-run',
]);
assert.equal(parsed.device, 'emulator-5554');
assert.equal(parsed.appId, 'com.trailhead.app');
assert.equal(parsed.flow, '02-search-rapid-typing.yaml');
assert.throws(() => parseMaestroArgs(['--device', '../unsafe']), /Invalid --device/);

const windowsParsed = parseMaestroArgs([
  '--host', 'windows',
  '--windows-maestro', '\\\\wsl.localhost\\Ubuntu\\home\\qa\\.maestro\\bin\\maestro.bat',
  '--windows-java-home', 'C:\\Program Files\\Android\\Android Studio\\jbr',
  '--windows-android-sdk', 'C:\\Users\\qa\\AppData\\Local\\Android\\Sdk',
], {});
assert.equal(windowsParsed.host, 'windows');
assert.match(windowsParsed.windowsMaestro, /maestro\.bat$/);
assert.throws(() => parseMaestroArgs(['--host', 'somewhere']), /auto, native, or windows/);

assert.equal(isWslEnvironment({ platform: 'linux', env: { WSL_DISTRO_NAME: 'Ubuntu' } }), true);
assert.equal(isWslEnvironment({ platform: 'linux', env: {}, procVersion: 'Linux Microsoft-standard-WSL2' }), true);
assert.equal(isWslEnvironment({ platform: 'darwin', env: { WSL_DISTRO_NAME: 'Ubuntu' } }), false);
assert.equal(chooseMaestroHost('auto', true), 'windows');
assert.equal(chooseMaestroHost('auto', false), 'native');
assert.equal(chooseMaestroHost('native', true), 'native');
assert.equal(discoverWslDistro({}, '\\\\wsl.localhost\\Ubuntu-24.04\\'), 'Ubuntu-24.04');
assert.equal(discoverWslDistro({ WSL_DISTRO_NAME: 'Ubuntu' }), 'Ubuntu');

assert.equal(quoteWindowsCmdArg('hello world'), '"hello world"');
assert.throws(() => quoteWindowsCmdArg('unsafe%PATH%'), /unsupported command characters/);
assert.throws(() => quoteWindowsCmdArg('unsafe\nvalue'), /unsupported command characters/);

const windowsCommand = buildWindowsMaestroCommand({
  maestro: '\\\\wsl.localhost\\Ubuntu\\home\\qa\\.maestro\\bin\\maestro.bat',
  javaHome: 'C:\\Program Files\\Android\\Android Studio\\jbr',
  androidSdk: 'C:\\Users\\qa\\AppData\\Local\\Android\\Sdk',
  args: ['--no-ansi', '--device=emulator-5554', 'test', '\\\\wsl.localhost\\Ubuntu\\home\\qa\\trailhead\\mobile\\.maestro'],
});
assert.match(windowsCommand, /^setlocal DisableDelayedExpansion&&/);
assert.match(windowsCommand, /set "JAVA_HOME=C:\\Program Files\\Android\\Android Studio\\jbr"/);
assert.match(windowsCommand, /set "ANDROID_HOME=C:\\Users\\qa\\AppData\\Local\\Android\\Sdk"/);
assert.match(windowsCommand, /call "\\\\wsl\.localhost\\Ubuntu\\home\\qa\\\.maestro\\bin\\maestro\.bat"/);
assert.match(windowsCommand, /"--device=emulator-5554"/);
assert.doesNotMatch(windowsCommand, /C:\\Users\\User/);

assert.deepEqual(parseAdbDevices(`List of devices attached
emulator-5554\tdevice product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64
RFCR408DA9B\toffline transport_id:2
`), [
  { serial: 'emulator-5554', state: 'device' },
  { serial: 'RFCR408DA9B', state: 'offline' },
]);

console.log(`PASS: ${flowNames.length} pinned Maestro flows at CLI ${version}`);
