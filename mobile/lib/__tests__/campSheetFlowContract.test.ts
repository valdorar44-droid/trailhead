import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const mapSource = readFileSync(join(mobileRoot, 'app/(tabs)/map.tsx'), 'utf8');
const snapSheetSource = readFileSync(join(mobileRoot, 'components/map/TrailheadSnapSheet.tsx'), 'utf8');
const campPeekSource = readFileSync(join(mobileRoot, 'components/map/CampPlaceSheetPeek.tsx'), 'utf8');

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
  assert.match(mapSource, /const parentEntityId = adaptCampgroundSheet\(parent\.camp\)\.identity\.entityId/);
  assert.match(mapSource, /campPresentationRestoreRef\.current = parentEntityId/);
  assert.match(mapSource, /sitesSectionY: campSitesSectionYRef\.current/);
  assert.match(mapSource, /sitesReturnY = parent\.sitesSectionY > 0/);
  assert.match(mapSource, /campSitesReturnTargetRef\.current = parentEntityId/);
  assert.match(mapSource, /campSitesReturnTargetRef\.current === selectedCampSheetModel!\.identity\.entityId/);
  assert.match(mapSource, /const returnY = Math\.max\(0, sectionY - 180\)/);
  assert.match(mapSource, /campSitesReturnTargetRef\.current = null/);
  assert.match(mapSource, /setCampSheetScrollRestore\(current => \(\{ key: current\.key \+ 1, y: sitesReturnY \}\)\)/);
  assert.match(mapSource, /campParentSnapshotRef\.current\s*\? restoreCampgroundParent/);
});

test('campground sheets clean metadata and omit invented summary fallbacks', () => {
  assert.match(campPeekSource, /cleanCampPeekMeta\(meta\)/);
  assert.match(campPeekSource, /replace\(\/\\u00c2\\u00b7\/g, ' · '\)/);
  assert.match(mapSource, /check current access,\\s\*rules/);
  assert.match(mapSource, /if \(useful\) return useful;\s+return '';/);
  assert.match(mapSource, /const summaryText = campSummaryText\(selectedCamp, null\)/);
});

test('campground action parity retains its existing offline area workflow', () => {
  assert.match(mapSource, /offline_download: true/);
  assert.match(mapSource, /sheetActionTestIDV1\(selectedCampSheetModel!\.testID, 'download'\)/);
  assert.match(mapSource, /onPress=\{\(\) => downloadCampPlace\(campDetail \|\| selectedCamp\)\}/);
  assert.match(mapSource, /setOfflineAreaPicker\(true\)/);
});

test('campground Save and Remove saved use the same reversible action', () => {
  assert.match(mapSource, /const removeSavedPlace = useStore\(s => s\.removeSavedPlace\)/);
  assert.match(mapSource, /function toggleCampPlaceSaved\(camp: CampsitePin \| CampsiteDetail\)/);
  assert.match(mapSource, /removeSavedPlace\(`camp:\$\{campKey\(camp\)\}`\)/);
  assert.match(mapSource, /onSave=\{\(\) => toggleCampPlaceSaved\(selectedCamp\)\}/);
  assert.match(mapSource, /function downloadCampPlace\(camp: CampsitePin \| CampsiteDetail\)[\s\S]*?saveCampPlace\(camp\)/);
});

test('campground availability reports are explicit and require confirmation', () => {
  assert.match(mapSource, /availability_report: !privateLeadKeyFromCamp\(selectedCamp, campDetail\)/);
  assert.match(mapSource, /function confirmReportFull\(\)/);
  assert.match(mapSource, /'Report campground full\?'/);
  assert.match(mapSource, /sheetActionTestIDV1\(selectedCampSheetModel!\.testID, 'report_full'\)/);
  assert.match(mapSource, /onPress=\{confirmReportFull\}/);
  assert.match(mapSource, /<Text style=\{s\.reportFullText\}>Report full<\/Text>/);
});
