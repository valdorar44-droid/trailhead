import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const mapSource = readFileSync(join(mobileRoot, 'app/(tabs)/map.tsx'), 'utf8');
const snapSheetSource = readFileSync(join(mobileRoot, 'components/map/TrailheadSnapSheet.tsx'), 'utf8');

test('campground selection opens an identity-stable peek before the full sheet', () => {
  assert.match(mapSource, /<CampPlaceSheetPeek/);
  assert.match(mapSource, /initialStage="peek"/);
  assert.match(mapSource, /expandedLoading=\{loadingDetail && !campDetail\}/);
  assert.match(mapSource, /CAMP_DETAIL_REVEAL_TIMEOUT_MS = 6000/);
  assert.match(mapSource, /campDetailMatchesSelection\(camp, result\.value\)/);
});

test('the shared snap sheet supports controlled peek-to-full loading without partial children', () => {
  assert.match(snapSheetSource, /stage\?: TrailheadSnapStage/);
  assert.match(snapSheetSource, /expandedLoading \? \(/);
  assert.match(snapSheetSource, /hidePeekHeaderWhenExpanded/);
  assert.match(snapSheetSource, /peekExpandsToFull/);
  assert.match(snapSheetSource, /onContentSizeChange=\{restoreScrollAfterLayout\}/);
  assert.match(snapSheetSource, /pendingScrollRestoreRef\.current = null/);
});

test('campsite Back restores the parent campground and its scroll position', () => {
  assert.match(mapSource, /campParentSnapshotRef\.current = parentSnapshot/);
  assert.match(mapSource, /campPresentationRestoreRef\.current = adaptCampgroundSheet\(sitePin\)\.identity\.entityId/);
  assert.match(mapSource, /function restoreCampgroundParent\(\)/);
  assert.match(mapSource, /campPresentationRestoreRef\.current = adaptCampgroundSheet\(parent\.camp\)\.identity\.entityId/);
  assert.match(mapSource, /setCampSheetScrollRestore\(current => \(\{ key: current\.key \+ 1, y: parent\.scrollY \}\)\)/);
  assert.match(mapSource, /campParentSnapshotRef\.current\s*\? restoreCampgroundParent/);
});
