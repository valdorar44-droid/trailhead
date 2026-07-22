#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function source(path) {
  return readFileSync(join(root, path), 'utf8');
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function assertAll(text, markers, label) {
  for (const marker of markers) {
    assert(text.includes(marker), `${label}: ${marker}`);
  }
}

const map = source('app/(tabs)/map.tsx');
const premiumPlace = source('components/PremiumPlaceSheet.tsx');
const adapters = source('lib/placeSheetAdapters.ts');
const ratingEligibility = source('lib/communityRatingEligibility.ts');
const explore = source('app/(tabs)/guide.tsx');
const exploreDetail = source('components/explore/ExploreDetailSheet.tsx');
const mapFilters = source('components/map/MapFilterSheet.tsx');

assertAll(map, [
  'PlaceSheetShell',
  'PlaceSheetHeroChrome',
  'selectedCampSheetModel',
  'placeSheetRequestIsCurrent',
], 'Map campground uses the coordinated shared shell');
assertAll(premiumPlace, [
  '<PlaceSheetShell model={sheetModel}>',
  '<PlaceSheetShellHeader',
  '<PlaceSheetHeroChrome',
], 'Generic places use the shared shell chrome');

assertAll(map, [
  'campPhotoItems(',
  'booking_url: camp.booking_url',
  'derivedCampSiteTypes(',
  'campsites_count',
  "bucket === 'campers' ? 'For campers' : 'For vehicles'",
  'campMobileCoverage(',
  'campWeather',
  'derivedCampActivities(',
  '<CampReviewsSection',
  '<CampCommentsSection',
  '<CampFieldReportsSection',
  "openCampEdit('suggest')",
  'handleReportFull',
  '<CampCoordinatesSection',
  'campSourceUrl(',
], 'Campground release-gate module remains mounted');

assertAll(adapters, [
  "'photos'",
  "'booking'",
  "'site_types'",
  "'site_counts'",
  "'rig_suitability'",
  "'mobile_coverage'",
  "'weather'",
  "'activities'",
  "'comments'",
  "'source_reviews'",
  "'field_reports'",
  "'edits'",
  "'reporting'",
  "'coordinates'",
  "'official_links'",
], 'Campground adapter preserves its parity contract');
assertAll(adapters, [
  'TRAIL_SHEET_PARITY_MODULES',
  "'community_reports'",
  "'preview_3d'",
  "'route_builder'",
  'COMMUNITY_REPORT_SHEET_PARITY_MODULES',
  "'field_review'",
  'EXPLORE_HUB_SHEET_PARITY_MODULES',
  "'visitor_information'",
  "'official_sources'",
  "'guided_tours'",
], 'Trail, report, and Explore adapters preserve their capability contracts');

assertAll(premiumPlace, [
  'relatedVisitorCenters',
  'relatedCampgrounds',
  'relatedTrails',
  '<RelatedRail title="Visitor centers"',
  '<RelatedRail title="Campgrounds nearby"',
  '<RelatedRail title="Trails"',
  'NWS forecast / alerts',
  'data.registration_url || data.booking_url || data.official_url || data.website',
], 'NPS and official place depth remains available');

assertAll(map, [
  '<RouteActivityOfferSheet',
  'tripAlreadyHasRouteActivityStop',
  'mergeRouteActivityBooking(',
  "'route_activity'",
], 'Viator route insertion and booked-tour flow remains available');

assertAll(map, [
  '<FirstPartyRatingSection',
  '<CampCommentsSection',
  '<CampReviewsSection',
], 'First-party ratings stay separate from comments and source reviews');
assertAll(premiumPlace, [
  '<FirstPartyRatingSection',
  'comments.slice(0, 5)',
  'Suggest an edit',
], 'Generic place ratings preserve discussion and edits');
assertAll(ratingEligibility, [
  "kind === 'camp'",
  "kind === 'trail'",
  "kind === 'trailhead'",
  "kind === 'place'",
  'viator|original|originals|trip pack|guided tour',
], 'First-party rating eligibility excludes external product lanes');

assertAll(map, [
  'normalizeTrailheadTrailProfile',
  'trailElevationDisplay',
  'trailWeatherDisplay',
  'downloadSelectedTrail',
  'openTrailPreview',
  '<FieldReportComposer',
  'Recent reports',
  'refreshSelectedTrailSource',
  'seedTrailPinCaptureFromTrail',
  '<PlaceSheetShell model={selectedTrailSheetModel!}',
  'selectedTrailRatingTarget',
], 'Trail and trailhead detail parity remains mounted');

assertAll(map, [
  'communityLiveContext',
  'suggestCommunityUpdate',
  'voteCommunityPin',
  'openDispersedLeadEdit',
  'addDispersedLeadPhoto',
  'reviewDispersedLeadPin',
  'publishDispersedLeadPin',
  'setQuickReport(true)',
  '<PlaceSheetShell model={selectedReportSheetModel!}',
], 'Community report and field-check actions remain mounted');

assertAll(exploreDetail, [
  "key: 'see'",
  "key: 'do'",
  "key: 'stay'",
  "key: 'visitor'",
  "key: 'trails'",
  "key: 'fees'",
  "key: 'alerts'",
  "key: 'calendar'",
  "key: 'weather'",
  "key: 'map'",
  'experiencesSlot',
  'sourceUrl',
], 'Explore and NPS hub depth remains mounted');
assertAll(explore, [
  'BOOKABLE_EXPERIENCES_ENABLED',
  'renderExploreCampgrounds',
  'renderExploreExperiences',
  '<ExploreDetailSheet',
  'getExploreDetailWeather',
  'onTrailMap',
  'onTrailRoute',
  '<PlaceSheetShell model={selectedExploreSheetModel!}',
  'exploreSheetRequestIsCurrent',
], 'Explore hub camps, weather, trails, and guided inventory remain connected');

assertAll(mapFilters, [
  'MapModeGallery',
  "title: 'Base layers'",
  "title: 'Camps'",
  "title: 'Places'",
  "title: 'Water'",
  "title: 'Camps & Stays'",
  "title: 'Services'",
  "title: 'Community notes'",
  "title: 'Weather & trails'",
  'onOpenLegend',
  'onResetAll',
], 'Canonical layers and filters preserve every existing control family');

assertAll(map, [
  '<ThreeNeedleCompass heading={userHeading} bearing={bearing}',
  '<RouteActivityOfferSheet',
  'mergeRouteActivityBooking(',
  "openLayersAndFilters('layers'",
  "openLayersAndFilters('camps'",
], 'Navigation compass and Viator route insertion remain mounted');

assert(!map.includes('onOpenLayers={() => setShowLayerSheet(true)}'), 'Map drawer still opens the legacy layer sheet');
assert(!map.includes('onPress={() => setShowLayerSheet(true)}'), 'Map shortcut still opens the legacy layer sheet');

if (failures.length) {
  console.error('Place-sheet parity audit failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Place-sheet parity audit passed: shared shells, trail/report depth, NPS hubs, filters, compass, Viator, comments, and ratings are intact.');
