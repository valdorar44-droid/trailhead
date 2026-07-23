import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { NPS_HUB_PRESERVATION_FIXTURES } from './fixtures/npsHubPreservationFixtures';
import {
  buildNpsHubModel,
  createNpsHubMainMapHandoff,
  npsHubGroupingDepth,
  resolveNpsHubLevel,
  restoreNpsHubListFromMap,
} from './support/npsHubPreservation';
import { relatedThingToDoCanShow, relatedThingToSeeCanShow } from '../exploreContextFilters';

test('NPS hub evidence covers direct, one-group, and two-group hierarchies', () => {
  assert.deepEqual(
    NPS_HUB_PRESERVATION_FIXTURES.map(fixture => fixture.expectedGroupingDepth),
    [0, 1, 2],
  );
  for (const fixture of NPS_HUB_PRESERVATION_FIXTURES) {
    assert.ok(fixture.evidence.length >= 2, `${fixture.name} must cite list/detail evidence`);
    assert.ok(
      fixture.evidence.every(item => /^\d{2}-[a-z0-9-]+\.(?:xml|png)$/.test(item)),
      `${fixture.name} evidence names must remain deterministic`,
    );
  }
});

test('production source-pack children retain canonical identity in the main-map handoff', () => {
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const guideSource = readFileSync(resolve(testDirectory, '../../app/(tabs)/guide.tsx'), 'utf8');
  const handoff = guideSource.match(
    /function showSourcePackItemOnMap\(item: ExploreSourcePackItem\) \{[\s\S]*?\n  \}\n\n  function routeExplore/,
  )?.[0];

  assert.ok(handoff, 'showSourcePackItemOnMap must remain present in the Explore implementation');
  assert.match(handoff, /const canonicalId = String\(item\.source_id \|\| ''\)\.trim\(\)/);
  assert.match(handoff, /setPendingMapSelection\(\{\s*kind: 'explorePlace'/s);
  assert.match(handoff, /place: \{\s*id: canonicalId,/s);
  assert.match(handoff, /sourceLabel: item\.source_label \|\| item\.source/);
  assert.match(handoff, /imageUrl: image,/);
  assert.match(handoff, /photos: image \? \[\{/);
  assert.match(handoff, /suspendSelectedExploreForMap\(\);/);
  assert.doesNotMatch(handoff, /closeSelectedExplore\(\);/);
  assert.match(
    guideSource,
    /type: place\.summary\.category \|\| place\.category \|\| 'place'/,
    'Explore hands the canonical semantic entity type to the main map',
  );
  assert.match(
    guideSource,
    /displayType: place\.summary\.category \|\| place\.category \|\| mapCategory/,
    'Explore hands the user-facing canonical type to the main map',
  );
  assert.match(
    readFileSync(resolve(testDirectory, '../../app/(tabs)/map.tsx'), 'utf8'),
    /type: explore\.type \|\| 'place',[\s\S]*?display_type: explore\.displayType \|\| explore\.category \|\| undefined/,
    'the main map preserves the Explore semantic type instead of flattening every entity to place',
  );
  assert.match(
    guideSource,
    /visible=\{!!selectedExplore && !selectedExploreSuspendedForMap\}/,
    'the hub remains mounted while the main map is visible',
  );
  assert.match(
    guideSource,
    /useFocusEffect\(useCallback\(\(\) => \{\s*if \(selectedExploreRef\.current\) setSelectedExploreSuspendedForMap\(false\);/s,
    'returning to Explore restores the exact mounted hub instead of opening Explore root',
  );
  assert.match(
    guideSource,
    /navigationState=\{selectedExploreNavigation\}/,
    'NPS module, list, and child navigation must live above the Android Modal',
  );
  assert.match(
    guideSource,
    /onNavigationStateChange=\{setSelectedExploreNavigation\}/,
    'the restored Explore sheet must receive the same controlled navigation state',
  );
});

test('official canonical rail labels survive client filtering without keyword guessing', () => {
  assert.equal(relatedThingToDoCanShow({
    id: 'explore:place:nps-child:yose:thingstodo:junior-ranger',
    name: 'Junior Ranger Day',
    lat: 37.8,
    lng: -119.5,
    type: 'attraction',
    display_type: 'Activity',
    source: 'trailhead_explore',
    summary: 'A ranger-led park activity.',
  }), true);
  assert.equal(relatedThingToSeeCanShow({
    id: 'explore:place:nps-child:yose:places:anderson-cabin',
    name: 'Anderson Cabin',
    lat: 37.8,
    lng: -119.5,
    type: 'attraction',
    display_type: 'Place to see',
    source: 'trailhead_explore',
    summary: 'A documented historic place in Yosemite.',
  }), true);
});

for (const fixture of NPS_HUB_PRESERVATION_FIXTURES) {
  test(`${fixture.name} preserves adaptive depth and exact main-map return context`, () => {
    const unchangedInput = JSON.parse(JSON.stringify(fixture.input));
    const model = buildNpsHubModel(fixture.input);

    assert.deepEqual(fixture.input, unchangedInput, 'normalization must not mutate source data');
    assert.deepEqual(model.modules.map(module => module.key), fixture.expectedModuleKeys);
    assert.equal(model.modules.some(module => module.key === fixture.omittedEmptyModuleKey), false);

    const module = model.modules.find(candidate => candidate.key === fixture.selection.moduleKey);
    assert.ok(module);
    assert.equal(npsHubGroupingDepth(module), fixture.expectedGroupingDepth);

    const level = resolveNpsHubLevel(model, fixture.selection.moduleKey, fixture.selection.path);
    assert.equal(level.items[fixture.selection.listIndex]?.id, fixture.selection.canonicalChildId);

    const handoff = createNpsHubMainMapHandoff(model, fixture.selection);
    assert.equal(handoff.place.id, fixture.selection.canonicalChildId);
    assert.equal(handoff.returnContext.parkId, model.parkId);
    assert.equal(handoff.returnContext.parkTitle, model.parkTitle);
    assert.equal(handoff.returnContext.moduleKey, fixture.selection.moduleKey);
    assert.equal(handoff.returnContext.moduleLabel, level.module.label);
    assert.deepEqual(
      handoff.returnContext.path.map(segment => segment.groupId),
      fixture.selection.path,
    );
    assert.equal(handoff.returnContext.listKey, level.listKey);
    assert.equal(handoff.returnContext.listTitle, level.listTitle);
    assert.equal(handoff.returnContext.selectedIndex, fixture.selection.listIndex);
    assert.equal(handoff.returnContext.listCount, level.items.length);
    assert.equal(handoff.returnContext.canonicalChildId, fixture.selection.canonicalChildId);

    const restored = restoreNpsHubListFromMap(model, handoff.returnContext);
    assert.equal(restored.selected.id, fixture.selection.canonicalChildId);
    assert.equal(restored.selectedIndex, fixture.selection.listIndex);
    assert.equal(restored.listKey, level.listKey);
    assert.deepEqual(restored.path, level.path);
  });
}

test('empty park-specific modules and empty branches are omitted, never fabricated', () => {
  const model = buildNpsHubModel({
    parkId: 'nps:test',
    parkTitle: 'Evidence Park',
    modules: [
      {
        key: 'see',
        label: 'What to See',
        items: [
          {
            id: 'test:empty-area',
            label: 'Empty Area',
            kind: 'group',
            children: [],
          },
          {
            id: 'test:real-place',
            label: 'Verified Place',
            kind: 'place',
            lat: 1,
            lng: 2,
          },
        ],
      },
      { key: 'geothermal', label: 'Geothermal Features', parkSpecific: true, items: [] },
    ],
  });

  assert.deepEqual(model.modules.map(module => module.key), ['see']);
  assert.deepEqual(model.modules[0].items.map(item => item.id), ['test:real-place']);
  assert.equal(model.modules.some(module => module.key === 'geothermal'), false);
});

test('stale child identity, list position, and return context are rejected', () => {
  const fixture = NPS_HUB_PRESERVATION_FIXTURES[1];
  const model = buildNpsHubModel(fixture.input);

  assert.throws(
    () => createNpsHubMainMapHandoff(model, { ...fixture.selection, canonicalChildId: 'yose:not-selected' }),
    /stale|canonical place/,
  );
  assert.throws(
    () => createNpsHubMainMapHandoff(model, { ...fixture.selection, listIndex: 99 }),
    /stale|canonical place/,
  );

  const handoff = createNpsHubMainMapHandoff(model, fixture.selection);
  assert.throws(
    () => restoreNpsHubListFromMap(model, { ...handoff.returnContext, listCount: 99 }),
    /stale/,
  );
  assert.throws(
    () => restoreNpsHubListFromMap(model, { ...handoff.returnContext, parkId: 'nps:other' }),
    /does not belong/,
  );
});

test('invalid canonical hierarchy and map handoff data fail closed', () => {
  assert.throws(
    () => buildNpsHubModel({
      parkId: 'nps:test',
      parkTitle: 'Duplicate Park',
      modules: [{
        key: 'see',
        label: 'What to See',
        items: [
          { id: 'test:same', label: 'One', kind: 'place', lat: 1, lng: 2 },
          { id: 'test:same', label: 'Two', kind: 'place', lat: 3, lng: 4 },
        ],
      }],
    }),
    /Duplicate NPS hub canonical ID/,
  );

  const model = buildNpsHubModel({
    parkId: 'nps:test',
    parkTitle: 'Coordinate Park',
    modules: [{
      key: 'see',
      label: 'What to See',
      items: [{ id: 'test:no-coordinate', label: 'No Coordinate', kind: 'place' }],
    }],
  });
  assert.throws(
    () => createNpsHubMainMapHandoff(model, {
      moduleKey: 'see',
      path: [],
      canonicalChildId: 'test:no-coordinate',
      listIndex: 0,
    }),
    /without coordinates/,
  );
});
