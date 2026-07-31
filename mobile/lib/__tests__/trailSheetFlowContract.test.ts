import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { TRAIL_SHEET_PARITY_MODULES } from '../placeSheetAdapters';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const mapSource = readFileSync(join(mobileRoot, 'app/(tabs)/map.tsx'), 'utf8');
const presentationSource = readFileSync(join(mobileRoot, 'components/map/TrailPlaceSheet.tsx'), 'utf8');
const actionSource = readFileSync(join(mobileRoot, 'lib/sheetActions.ts'), 'utf8');

test('trail and trailhead selections enter the shared Peek/Full coordinator', () => {
  assert.match(mapSource, /activePlaceSheetModel\.identity\.kind === 'trail'/);
  assert.match(mapSource, /activePlaceSheetModel\.identity\.kind === 'trailhead'/);
  assert.match(mapSource, /<TrailPlaceSheetPeek/);
  assert.match(mapSource, /peekExpandsToFull/);
  assert.match(mapSource, /expandedLoading=\{fullLoading\}/);
  assert.match(mapSource, /trailSheetExpandedIsLoading/);
  assert.match(presentationSource, /testID=\{`\$\{model\.testID\}-peek`\}/);
});

test('trail enrichment is generation-bound and commits as one readiness state', () => {
  assert.match(mapSource, /requestGeneration: placeSheetCoordinator\.requestGeneration/);
  assert.match(mapSource, /placeSheetRequestIsCurrent\(request\)/);
  assert.match(mapSource, /selectedTrailRef\.current\?\.id === trail\.id/);
  assert.match(mapSource, /Promise\.allSettled\(tasks\)/);
  assert.match(mapSource, /timeoutTrailSheetHydration\(value, key, attempt\)/);
  assert.match(mapSource, /completeTrailSheetHydration\(value, key, attempt\)/);
});

test('linked trail and trailhead drilldowns retain the parent sheet and scroll', () => {
  assert.match(mapSource, /function rememberTrailSheetParent\(\)/);
  assert.match(mapSource, /function restoreTrailSheetParent\(\)/);
  assert.match(mapSource, /scrollY: trailSheetScrollYRef\.current/);
  assert.match(mapSource, /trailPresentationRestoreRef\.current = adaptTrailSheet\(parent\.trail\)\.identity\.entityId/);
  assert.match(mapSource, /setTrailSheetScrollRestore\(value => \(\{ key: value\.key \+ 1, y: parent\.scrollY \}\)\)/);
});

test('Back restores the trail discovery sheet, viewport, stage, and scroll while Close exits', () => {
  const campDiscoverySheet = mapSource.slice(
    mapSource.indexOf('{showCampDiscoverySheet && ('),
    mapSource.indexOf('{showDiscoveryPanel && !navMode'),
  );
  const trailDiscoverySheet = mapSource.slice(
    mapSource.indexOf('{showDiscoveryPanel && !navMode'),
    mapSource.indexOf('{/* Route alerts */}'),
  );
  assert.match(mapSource, /trailDiscoveryReturnRef = useRef/);
  assert.match(mapSource, /trailDiscoverySheetStageRef = useRef/);
  assert.match(mapSource, /stage: trailDiscoverySheetStageRef\.current/);
  assert.match(mapSource, /trailDiscoverySheetStageRef\.current = snapshot\.stage/);
  assert.match(trailDiscoverySheet, /stage=\{trailDiscoverySheetStage\}/);
  assert.match(trailDiscoverySheet, /onStageChange=\{handleTrailDiscoverySheetStageChange\}/);
  assert.match(trailDiscoverySheet, /onScrollYChange=\{value => \{ trailDiscoveryScrollYRef\.current = value; \}\}/);
  assert.doesNotMatch(campDiscoverySheet, /trailDiscoverySheetStage|trailDiscoveryScroll/);
  assert.match(mapSource, /scrollY: trailDiscoveryScrollYRef\.current/);
  assert.match(mapSource, /function restoreTrailDiscoveryReturn\(\)/);
  assert.match(mapSource, /setShowDiscoveryPanel\(true\)/);
  assert.match(mapSource, /nativeMapRef\.current\?\.fitCoordinates/);
  assert.match(mapSource, /if \(restoreTrailDiscoveryReturn\(\)\) return true/);
  assert.match(mapSource, /function closeSelectedTrailSheet\(\)[\s\S]*sharedTrailMapReturnMatchesSelection\(sharedTrailMapReturnRef\.current, selectedTrailRef\.current\)[\s\S]*trailDiscoveryReturnRef\.current = null;/);
});

test('trail sheet parity retains planning, offline, community, source, and navigation capabilities', () => {
  assert.deepEqual(TRAIL_SHEET_PARITY_MODULES, [
    'photos', 'route_facts', 'surface_access', 'weather', 'nearby', 'community_reports', 'ratings',
    'downloads', 'preview_3d', 'route_builder', 'edits', 'reporting', 'official_sources',
    'linked_trails', 'coordinates', 'navigation',
  ]);
  assert.match(mapSource, /Download for offline/);
  assert.match(actionSource, /const PREVIEW_3D:[\s\S]*?'Preview in 3D'/);
  assert.match(mapSource, /Build route/);
  assert.match(actionSource, /const REPORT:[\s\S]*?'Report'/);
  assert.match(mapSource, /<FirstPartyRatingSection/);
  assert.match(mapSource, /<TrailSheetSectionTitle>Source<\/TrailSheetSectionTitle>/);
  assert.match(mapSource, /api\.suggestTrailEdit/);
  assert.match(actionSource, /const SUGGEST_EDIT:[\s\S]*?'Suggest edit'/);
});

test('full sheet copy avoids invented confidence and access assurances', () => {
  const implementedTrailSheet = mapSource.slice(
    mapSource.indexOf('{selectedTrail && !trailPreviewOpen && !navMode && !trailPinCaptureMode && !trailCardCollapsed && !trailRouteBuilderOpen'),
    mapSource.indexOf('{selectedTrail && !navMode && !trailPinCaptureMode && trailRouteBuilderOpen'),
  );
  assert.doesNotMatch(implementedTrailSheet, /profile confidence|check local rules|parking nearby|restrooms nearby/i);
  assert.match(implementedTrailSheet, /Some details could not load/);
});
