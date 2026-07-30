import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { mergeExploreTrailChildIntoParent } from '../../components/explore/curatedExplorePlaces';
import type { ExplorePlaceProfile } from '../api';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const guideSource = readFileSync(join(mobileRoot, 'app/(tabs)/guide.tsx'), 'utf8');

function profile(input: {
  id: string;
  title: string;
  category: string;
  region?: string;
  trails?: Array<Record<string, unknown>>;
}): ExplorePlaceProfile {
  return {
    id: input.id,
    category: input.category,
    subcategories: [input.category.toLowerCase()],
    card: { title: input.title, region: input.region || '' },
    summary: {
      id: input.id,
      title: input.title,
      category: input.category,
      region: input.region || '',
      lat: 37.75,
      lng: -119.58,
      tags: [],
      badges: [],
    },
    profile: {},
    audio_script: '',
    wiki_extract: '',
    facts: {},
    attribution: '',
    trails: input.trails as any,
  } as unknown as ExplorePlaceProfile;
}

test('a trail wrapper carries its known trail list into the destination hub', () => {
  const parent = profile({
    id: 'place:nps:yose',
    title: 'Yosemite National Park',
    category: 'Parks',
  });
  const child = profile({
    id: 'explore:trails:yosemite-trails',
    title: 'Yosemite Trails',
    category: 'Trails',
    region: 'Yosemite National Park',
    trails: [{ id: 'mist-trail', title: 'Mist Trail', distance_mi: 3.2 }],
  });

  const merged = mergeExploreTrailChildIntoParent(parent, child);
  assert.equal(merged.id, parent.id);
  assert.equal(merged.summary.title, 'Yosemite National Park');
  assert.deepEqual((merged.trails || []).map(trail => trail.title), ['Mist Trail']);
});

test('a child without real trail records cannot fabricate a trail list', () => {
  const parent = profile({ id: 'place:nps:yose', title: 'Yosemite National Park', category: 'Parks' });
  const child = profile({ id: 'legacy:trails:yose', title: 'Yosemite Trails', category: 'Trails' });
  assert.equal(mergeExploreTrailChildIntoParent(parent, child), parent);
});

test('Explore resolves trail wrappers with data and forces a real lookup only when needed', () => {
  assert.match(guideSource, /parentTab === 'trails'[\s\S]*?mergeExploreTrailChildIntoParent\(parentHub, place\)/);
  assert.match(guideSource, /mergeExploreTrailChildIntoParent\(resolvedParentHub, place\)/);
  assert.match(guideSource, /const retainedTrailArea = hasExploreTrailCards\(local\)/);
  assert.match(guideSource, /initialTab === 'trails' && !hasExploreTrailCards\(retainedTrailArea\)/);
  assert.match(guideSource, /hydrateExploreTrailArea\(retainedTrailArea, true\)/);
});

test('Trail Discovery map handoffs retain the mounted workspace and focus-gate its modal', () => {
  const start = guideSource.indexOf('function openTrailDiscoveryMap');
  const end = guideSource.indexOf('async function requestTrailDiscoveryLocation', start);
  assert.ok(start >= 0 && end > start);
  const handoff = guideSource.slice(start, end);
  assert.doesNotMatch(handoff, /setExploreTrailDiscoveryOpen\(false\)/);
  assert.match(guideSource, /visible=\{exploreTrailDiscoveryOpen && screenActivity\.isActive\}/);
});
