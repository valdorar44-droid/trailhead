import assert from 'node:assert/strict';
import test from 'node:test';
import {
  availableSheetActionsV1,
  inferSheetActionEntityKindV1,
  resolveSheetActionDescriptorsV1,
  sheetActionByIdV1,
  sheetActionTestIDV1,
} from '../sheetActions';

test('campground actions expose capabilities without fabricating unavailable actions', () => {
  const actions = resolveSheetActionDescriptorsV1({
    entityKind: 'campground',
    capabilities: {
      coordinates: true,
      savable: true,
      booking_url: true,
      ratings: true,
      comments: true,
      reporting: true,
      suggest_edit: true,
    },
    returnContext: { surface: 'explore', key: 'camp-search' },
  });
  assert.equal(sheetActionByIdV1(actions, 'navigate')?.destination, 'navigation');
  assert.equal(sheetActionByIdV1(actions, 'navigate')?.returnContext.key, 'camp-search');
  assert.equal(sheetActionByIdV1(actions, 'booking')?.available, true);
  assert.equal(sheetActionByIdV1(actions, 'download')?.available, false);
  assert.equal(sheetActionByIdV1(actions, 'download')?.unavailableReason, 'Requires offline_download');
  assert.deepEqual(
    availableSheetActionsV1({
      entityKind: 'campground',
      capabilities: { coordinates: true, booking_url: true },
    }).map(action => action.id),
    ['navigate', 'booking'],
  );
});

test('saved actions keep a stable identifier while changing the user-facing label', () => {
  const saved = resolveSheetActionDescriptorsV1({
    entityKind: 'place',
    capabilities: { savable: true },
    saved: true,
  });
  assert.equal(sheetActionByIdV1(saved, 'save')?.id, 'save');
  assert.equal(sheetActionByIdV1(saved, 'save')?.label, 'Remove');
  assert.equal(sheetActionByIdV1(saved, 'save')?.classification, 'mutating');
});

test('trail and report actions encode destination and expected return behavior', () => {
  const trail = resolveSheetActionDescriptorsV1({
    entityKind: 'trail',
    capabilities: { route_geometry: true, offline_download: true },
    returnContext: { surface: 'trail_hub', key: 'loop-4' },
  });
  assert.deepEqual(sheetActionByIdV1(trail, 'preview_3d')?.expectedState, {
    sheet: 'restore',
    map: 'focus',
    confirmation: 'none',
  });
  assert.equal(sheetActionByIdV1(trail, 'download')?.returnContext.surface, 'trail_hub');

  const report = resolveSheetActionDescriptorsV1({
    entityKind: 'community_report',
    capabilities: { community_vote: true, reporting: true },
  });
  assert.equal(sheetActionByIdV1(report, 'helpful')?.destination, 'community_vote');
  assert.equal(sheetActionByIdV1(report, 'not_accurate')?.classification, 'mutating');
  assert.equal(sheetActionByIdV1(report, 'field_publish')?.available, false);
});

test('entity classification separates services and NPS children from generic places', () => {
  assert.equal(inferSheetActionEntityKindV1({ type: 'gas_station' }), 'fuel_service');
  assert.equal(inferSheetActionEntityKindV1({ subtype: 'dump station' }), 'fuel_service');
  assert.equal(inferSheetActionEntityKindV1({ type: 'vehicle-repair' }), 'fuel_service');
  assert.equal(inferSheetActionEntityKindV1({ source_label: 'National Park Service', type: 'viewpoint' }), 'nps_child');
  assert.equal(inferSheetActionEntityKindV1({ type: 'viewpoint' }), 'place');
  assert.equal(inferSheetActionEntityKindV1({}, 'trailhead'), 'trailhead');
});

test('every supported entity family resolves the common safe return contract', () => {
  const entityKinds = [
    'campground',
    'trail',
    'trailhead',
    'fuel_service',
    'place',
    'nps_child',
    'community_report',
  ] as const;
  for (const entityKind of entityKinds) {
    const actions = resolveSheetActionDescriptorsV1({
      entityKind,
      capabilities: {
        coordinates: true,
        shareable: true,
      },
      returnContext: { surface: 'map', key: `${entityKind}-selection` },
    });
    const navigate = sheetActionByIdV1(actions, 'navigate');
    assert.equal(navigate?.available, true, `${entityKind} must support coordinate navigation`);
    assert.equal(navigate?.expectedState.map, 'navigation');
    assert.equal(navigate?.returnContext.key, `${entityKind}-selection`);
    const share = sheetActionByIdV1(actions, 'share');
    assert.equal(share?.available, true, `${entityKind} must expose share when supplied`);
  }
});

test('stable automation identifiers use action IDs rather than labels', () => {
  assert.equal(
    sheetActionTestIDV1('place-sheet-camp-ridb-2323', 'add_to_trip'),
    'place-sheet-camp-ridb-2323-action-add-to-trip',
  );
});
