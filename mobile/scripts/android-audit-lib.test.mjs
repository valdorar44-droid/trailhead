#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  actionSafety,
  findNode,
  parseArgs,
  parseDevices,
  parseMeminfo,
  parseUiNodes,
  summarizeUi,
  summarizeLogcat,
  swipePoints,
  tapPoint,
} from './android-audit-lib.mjs';

const devices = parseDevices(`List of devices attached\nRFCR408DA9B device product:a32x model:SM_A326U1 transport_id:7\nemulator-5554 offline\n`);
assert.equal(devices.length, 2);
assert.deepEqual(devices[0].attributes, { product: 'a32x', model: 'SM_A326U1', transport_id: '7' });
assert.equal(devices[1].state, 'offline');

const xml = `<?xml version="1.0"?><hierarchy><node index="0" text="Explore" resource-id="com.trailhead.app:id/tab-explore" content-desc="" clickable="true" enabled="true" bounds="[10,20][110,80]"/><node index="1" text="Delete account" resource-id="com.trailhead.app:id/delete-account" clickable="true" enabled="true" bounds="[0,100][200,160]"/><node index="2" text="north_america" clickable="false" enabled="true" bounds="[0,200][200,240]"/></hierarchy>`;
const nodes = parseUiNodes(xml);
assert.equal(nodes.length, 3);
assert.deepEqual(tapPoint(nodes[0]), { x: 60, y: 50 });
assert.equal(findNode(nodes, { testID: 'tab-explore' }, 'com.trailhead.app')['resource-id'], 'com.trailhead.app:id/tab-explore');
assert.throws(() => findNode(nodes, { text: 'Explore' }, 'com.trailhead.app'), /allow-text-actions/);
assert.equal(findNode(nodes, { text: 'Explore' }, 'com.trailhead.app', true).text, 'Explore');
assert.equal(actionSafety({ type: 'tap' }, nodes[0]).safe, true);
assert.equal(actionSafety({ type: 'tap' }, nodes[1]).safe, false);
assert.equal(actionSafety({ type: 'tap' }, { ...nodes[0], text: 'Download offline map' }).safe, false);
assert.equal(actionSafety({ type: 'wait', ms: 6000 }).safe, false);
assert.deepEqual(swipePoints('up', 1000, 2000), [500, 1500, 500, 500]);
const summary = summarizeUi(nodes);
assert.equal(summary.nodeCount, 3);
assert.ok(summary.suspiciousCopy.some((hit) => hit.code === 'raw_slug' && hit.text === 'north_america'));
assert.equal(summary.likelyTestIds.length, 2);

const releaseIdentityText = '{"schema":"qa_release_identity_v1","updateId":"019f8d29-38a2-7de7-8935-7797f993dd0c"}';
const releaseIdentityNodes = parseUiNodes(
  `<hierarchy><node index="0" text='${releaseIdentityText}' resource-id="qa.telemetry.release-identity" content-desc="" bounds="[20,40][200,120]"/></hierarchy>`,
);
assert.equal(releaseIdentityNodes.length, 1);
assert.equal(releaseIdentityNodes[0].text, releaseIdentityText);
assert.equal(JSON.parse(releaseIdentityNodes[0].text).schema, 'qa_release_identity_v1');

assert.deepEqual(parseMeminfo('TOTAL PSS:   633774  TOTAL RSS:   145128  TOTAL SWAP PSS:   550082\nViews: 427 Activities: 1 WebViews: 0'), {
  totalPssKb: 633774,
  totalRssKb: 145128,
  totalSwapPssKb: 550082,
  viewCount: 427,
  activityCount: 1,
  webViewCount: null,
});

const logSummary = summarizeLogcat(`
07-20 W ProgressiveDecoder: unknown image format, {uri: https://www.youtube.com/watch?v=one, length: 100}
07-20 W app: Long monitor contention with owner OkHttp for 1.5s
07-20 W TextToSpeech: System TTS connection error: timeout
07-20 W WrappingUtils: Don't know how to round that drawable
`);
assert.deepEqual(logSummary.invalidImageUrls, ['https://www.youtube.com/watch?v=one']);
assert.equal(logSummary.severeContentionLines.length, 1);
assert.equal(logSummary.ttsErrorLines.length, 1);
assert.equal(logSummary.imageRoundingWarningCount, 1);

const args = parseArgs(['scenario', '--serial', 'one', '--serial', 'two', '--scenario', 'safe.json', '--execute-safe-actions']);
assert.equal(args.command, 'scenario');
assert.deepEqual(args.serials, ['one', 'two']);
assert.equal(args.executeSafeActions, true);
assert.throws(() => parseArgs(['capture', '--record-seconds', '31']), /0 to 30/);
const evidenceArgs = parseArgs([
  'capture',
  '--runtime', 'native-1.0.10-android.1',
  '--build-id', '06142308-0199-46cc-8a4c-fb9d45bca25e',
  '--update-id', '019f8a0e-c002-75e4-b52b-1f20b9128950',
  '--account-role', 'admin',
  '--feature-stage', 'TRAILHEAD_ORIGINALS_STAGE=internal',
]);
assert.equal(evidenceArgs.accountRole, 'admin');
assert.deepEqual(evidenceArgs.featureStages, ['TRAILHEAD_ORIGINALS_STAGE=internal']);
assert.throws(() => parseArgs(['capture', '--account-role', 'owner']), /guest, account, explorer, or admin/);
assert.throws(() => parseArgs(['capture', '--feature-stage', 'SEARCH_QUERY=Moab weekend']), /SAFE_FLAG=value/);

console.log('PASS: Android audit harness helpers');
