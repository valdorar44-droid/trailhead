import assert from 'node:assert/strict';
import test from 'node:test';

import { sourcePackItemCampPin } from '../exploreSourcePackHandoff';

test('official campground child opens the campground sheet with source facts', () => {
  const camp = sourcePackItemCampPin({
    source_id: 'place:usfs:camp-1',
    title: 'Canyon Camp',
    category: 'campground',
    kind: 'developed_campground',
    lat: 37.1,
    lng: -119.1,
    source: 'usfs',
    source_label: 'USDA Forest Service',
    url: 'https://www.fs.usda.gov/recarea/canyon-camp',
    reservation_url: 'https://www.recreation.gov/camping/campgrounds/123',
    amenities: ['Accessible toilet'],
  });

  assert.ok(camp);
  assert.equal(camp.id, 'place:usfs:camp-1');
  assert.equal(camp.source_badge, 'USDA Forest Service');
  assert.equal(camp.reservable, true);
  assert.equal(camp.ada, true);
  assert.deepEqual(camp.site_types, ['developed_campground']);
  assert.equal(camp.description, '');
});

test('non-camp source children continue through the shared place handoff', () => {
  assert.equal(sourcePackItemCampPin({
    source_id: 'place:blm:view-1',
    title: 'Canyon View',
    category: 'viewpoint',
    lat: 38.5,
    lng: -109.5,
  }), null);
});
