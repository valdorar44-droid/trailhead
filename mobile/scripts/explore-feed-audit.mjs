#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(mobileRoot, '..');

function read(path) {
  return readFileSync(path, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

const guide = read(join(mobileRoot, 'app/(tabs)/guide.tsx'));
const api = read(join(mobileRoot, 'lib/api.ts'));
const card = read(join(mobileRoot, 'components/explore/ExplorePlaceCard.tsx'));
const server = read(join(repoRoot, 'dashboard/server.py'));

assert(
  server.includes('class ExplorePlacesBulkRequest') && server.includes('@app.post("/api/explore/places/bulk")'),
  'Explore bulk detail endpoint is missing.',
);
assert(
  server.includes('explore_places_bulk_v1:') && server.includes('ttl_hours'),
  'Explore bulk detail endpoint must use a cache key and expose cache metadata.',
);
assert(
  api.includes('getExplorePlacesBulk') && api.includes('/api/explore/places/bulk'),
  'Mobile API wrapper for bulk Explore detail hydration is missing.',
);
assert(
  guide.includes('exploreVisibleLimit + EXPLORE_VISIBLE_STEP') && guide.includes('getExplorePlacesBulk'),
  'Explorer feed must hydrate the visible page plus the next page with the bulk endpoint.',
);
assert(
  /for \(let index = 0; index < candidates\.length; index \+= 24\)/.test(guide),
  'Explorer bulk hydration should run in bounded chunks.',
);
assert(
  card.includes('seededFallback(place') && card.includes('explore-hero-welcome-mountains') && card.includes('onboarding-hero-overland'),
  'Explore cards need deterministic varied fallback imagery.',
);
assert(
  server.includes('EXPLORE_LOCAL_IMAGE_GENERIC_SLUG_WORDS') && server.includes('_explore_contextual_image_url(place, summary.get(key))'),
  'Explore detail responses must strip mismatched bundled local images before bulk hydration.',
);
assert(
  server.includes('area_fallback_used = False') && server.includes('not has_source_photo and area_image and not area_fallback_used'),
  'Nearby camps should not all inherit the same area fallback image.',
);
assert(
  !/Show\s+48\s+more/.test(guide),
  'Explore load-more text should stay count-aware instead of hard-coded.',
);

console.log('Explore feed audit passed.');
