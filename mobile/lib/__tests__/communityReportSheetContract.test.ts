import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const mapSource = readFileSync(join(mobileRoot, 'app/(tabs)/map.tsx'), 'utf8');
const snapSheetSource = readFileSync(join(mobileRoot, 'components/map/TrailheadSnapSheet.tsx'), 'utf8');

test('community reports use one controlled shared half sheet', () => {
  assert.match(mapSource, /const opensAtHalf = activePlaceSheetModel\.identity\.kind === 'community_report'/);
  assert.match(mapSource, /key=\{`community-report-sheet:\$\{selectedReportSheetModel!\.identity\.entityId\}`\}/);
  assert.match(mapSource, /stage=\{placeSheetCoordinator\.current\?\.kind === 'community_report'/);
  assert.match(mapSource, /initialStage="half"/);
  assert.match(mapSource, /halfRatio=\{0\.56\}/);
  assert.match(mapSource, /onStageChange=\{presentation => dispatchPlaceSheet\(\{ type: 'set_presentation', presentation \}\)\}/);
  assert.match(snapSheetSource, /testID=\{testID\}/);
});

test('Android Back cancels an update, then follows Full to Half to dismiss', () => {
  assert.match(mapSource, /communityUpdatePin\?\.id === selectedCommunityPin\.id/);
  assert.match(mapSource, /placeSheetCoordinator\.presentation === 'full'[\s\S]*presentation: 'half'/);
  assert.match(mapSource, /setSelectedCommunityPin\(null\);[\s\S]*setCommunityUpdatePin\(null\);[\s\S]*setCommunityUpdateNote\(''\)/);
});

test('nearby enrichment remains identity-bound and uses a stable reserved loading row', () => {
  assert.match(mapSource, /const sheetRequest = currentPlaceSheetRequest\(selectedReportSheetModel\)/);
  assert.match(mapSource, /cancelled \|\| !placeSheetRequestIsCurrent\(sheetRequest\)/);
  assert.match(mapSource, /style=\{s\.communityNearbyBody\}/);
  assert.match(mapSource, /nearby-loading/);
  assert.match(mapSource, />Loading…</);
});

test('report trust actions and update cancellation preserve the approved capabilities', () => {
  for (const suffix of [
    'navigate',
    'save',
    'helpful',
    'not-accurate',
    'suggest-update',
    'report',
    'suggest-update-cancel',
    'edit',
    'photo',
    'checked',
    'not-found',
    'publish',
  ]) {
    const expected = 'testID={`${selectedReportSheetModel!.testID}-' + suffix + '`}';
    assert.ok(mapSource.includes(expected), `missing ${expected}`);
  }
  assert.match(mapSource, />Helpful</);
  assert.match(mapSource, />Not accurate</);
  assert.match(mapSource, /helpful · \$\{selectedCommunityPin\.downvotes \?\? 0\} marked inaccurate/);
  assert.match(mapSource, /privateLead \? 'Needs field check' : 'Community report'/);
});

test('report sheet copy omits prior filler and raw all-caps actions', () => {
  assert.match(mapSource, /const reportNotes = communityReportNotes\(selectedCommunityPin\)/);
  assert.match(mapSource, /\{!!reportNotes && \(/);
  assert.match(mapSource, /\{reportNotes\}<\/Text>/);
  assert.doesNotMatch(mapSource, /verify before relying on access or legality/);
  assert.doesNotMatch(mapSource, /Checking nearby area/);
  assert.doesNotMatch(mapSource, />SEARCHING</);
  assert.doesNotMatch(mapSource, />GOOD</);
  assert.doesNotMatch(mapSource, />BAD</);
  assert.doesNotMatch(mapSource, /Add access, hours, condition, or verification details/);
});
