import assert from 'node:assert/strict';
import { campMarkerVisual, isPrimaryRvCamp } from '../lib/campMarkerVisual';

const mixedBlm = {
  name: "King's Bottom Campground",
  land_type: 'Federal Campground',
  source: 'ridb',
  verified_source: 'Recreation.gov',
  source_badge: 'Recreation.gov',
  tags: ['blm', 'rv', 'tent', 'walk_in'],
  site_types: ['RV', 'Tent', 'Walk-in'],
  amenities: ['Water', 'Restrooms'],
  description: 'Campsites are located along the banks of the Colorado River. Tents and small trailers are supported.',
};

const mixedNps = {
  name: 'Goose Island Campground',
  land_type: 'National Park',
  source: 'ridb',
  verified_source: 'Recreation.gov',
  tags: ['blm', 'nps', 'rv', 'tent', 'waterfront'],
  site_types: ['RV', 'Tent', 'Group'],
  amenities: ['Water', 'Restrooms', 'Shade'],
  description: "Riverside camping for tents, RV's and trailers.",
};

const rvResort = {
  name: 'Portal RV Resort - Moab',
  land_type: 'Glamping',
  source: 'geoapify',
  verified_source: 'Geoapify Places',
  tags: ['commercial', 'campground', 'private', 'private_stay', 'glamping', 'tent'],
  site_types: ['Glamping'],
};

const dispersed = {
  name: 'Dispersed tent site',
  land_type: 'Dispersed',
  source: 'trailhead',
  tags: ['camp', 'dispersed', 'tent'],
  site_types: ['Tent'],
};

assert.equal(isPrimaryRvCamp(mixedBlm), false);
assert.equal(campMarkerVisual(mixedBlm).code, 'C');
assert.equal(isPrimaryRvCamp(mixedNps), false);
assert.equal(campMarkerVisual(mixedNps).code, 'C');
assert.equal(isPrimaryRvCamp(rvResort), true);
assert.equal(campMarkerVisual(rvResort).code, 'RV');
assert.equal(campMarkerVisual(dispersed).code, 'D');

console.log('camp marker visual audit passed');
