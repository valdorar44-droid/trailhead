import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const apiSource = readFileSync(join(mobileRoot, 'lib/api.ts'), 'utf8');
const mapSource = readFileSync(join(mobileRoot, 'app/(tabs)/map.tsx'), 'utf8');
const routeBuilderSource = readFileSync(join(mobileRoot, 'app/(tabs)/route-builder.tsx'), 'utf8');
const briefSource = readFileSync(join(mobileRoot, 'components/map/CampgroundBriefSection.tsx'), 'utf8');

test('the researched campground brief uses a source-owned opt-in endpoint', () => {
  assert.match(apiSource, /getCampgroundPlanningBrief: async \(id: string\) =>/);
  assert.match(apiSource, /\/api\/campsites\/\$\{encodeURIComponent\(facilityId\)\}\/planning-brief/);
  assert.match(apiSource, /method: 'POST'/);
  assert.match(apiSource, /response\.status === 'preparing'/);
  assert.match(apiSource, /planning-brief\/jobs\/\$\{encodeURIComponent\(response\.job_id\)\}/);
});

test('Recreation.gov campsite cards resolve their parent campground brief', () => {
  assert.match(apiSource, /raw\.startsWith\('ridb_site:'\) \? raw\.split\(':'\) : \[\]/);
  assert.match(apiSource, /const facilityId = siteParts\[1\] \|\| ridbFacilityIdFromCanonicalCampId\(raw\) \|\| raw/);
});

test('camp selection does not automatically fetch or charge for a brief', () => {
  assert.doesNotMatch(mapSource, /api\.getCampgroundBrief\(detailFetchId\)/);
  assert.doesNotMatch(mapSource, /api\.getCampgroundBrief\(String\(siteCardId\)\)/);
  assert.doesNotMatch(mapSource, /loadCampDetailForCamp\(selectedCamp, \{ loadInsight:/);
  assert.match(mapSource, /onShow=\{\(\) => selectedCamp && openCampgroundPlanningBrief\(selectedCamp, campDetail\)\}/);
});

test('late brief responses are bound to the selected campground identity', () => {
  assert.match(mapSource, /const requestIsCurrent = \(\) => placeSheetRequestIsCurrent\(request\) && selectedCampRef\.current\?\.id === camp\.id/);
  assert.match(mapSource, /if \(!requestIsCurrent\(\)\) return false;\s+setCampgroundBrief\(brief\)/);
  assert.match(mapSource, /campgroundBriefOwnerRef\.current === selectedCamp\?\.id/);
});

test('the compact action has the approved price and no public AI label', () => {
  assert.match(briefSource, /'Show brief'/);
  assert.match(briefSource, />5 credits · Included with Explorer</);
  assert.match(briefSource, /Preparing brief/);
  assert.doesNotMatch(briefSource, />[^<]*(?:AI|artificial intelligence)[^<]*</i);
  assert.doesNotMatch(briefSource, /site types|amenities|booking|phone|weather/i);
});

test('the opened brief renders planning context and cited source links', () => {
  for (const label of [
    'Best time',
    'Access and rig',
    'Service and signal',
    'What to look out for',
    'Before you go',
    'Nearby',
    'Sources',
  ]) {
    assert.ok(briefSource.includes(label), `${label} should be rendered`);
  }
  assert.match(briefSource, /Linking\.openURL\(source\.url\)/);
});

test('the standard campground sheet keeps its existing modules beside the opt-in brief', () => {
  for (const contract of [
    /campDetail\.campsites/,
    /campDetail\.site_types/,
    /campDetail\.amenities/,
    /campMobileCoverage/,
    /CampCommentsSection/,
    /FirstPartyRatingSection/,
    /CampFieldReportsSection/,
    /openCampEdit\('suggest'\)/,
    /campSourceUrl/,
  ]) {
    assert.match(mapSource, contract);
  }
});

test('Route Builder full profiles do not auto-charge and share the same brief action', () => {
  assert.doesNotMatch(routeBuilderSource, /const insight = await api\.getCampsiteInsight/);
  assert.match(routeBuilderSource, /api\.getCampgroundPlanningBrief\(camp\.id\)/);
  assert.match(routeBuilderSource, /<CampgroundBriefSection/);
  assert.match(routeBuilderSource, /onShow=\{showCampPlanningBrief\}/);
});
