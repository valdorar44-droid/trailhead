import assert from 'node:assert/strict';
import { isTrailheadOriginalTripDocument, tripExperienceRefFromApi } from '../originalExperience';

const experienceRef = tripExperienceRefFromApi({
  kind: 'trailhead_original',
  pack_id: 'moab-original',
  version: 3,
  manifest_id: 'moab-original:v3',
});
assert.deepEqual(experienceRef, {
  kind: 'trailhead_original',
  packId: 'moab-original',
  version: 3,
  manifestId: 'moab-original:v3',
});
assert.equal(isTrailheadOriginalTripDocument({ experienceRef }), true);
assert.equal(tripExperienceRefFromApi({ ...experienceRef, pack_id: '', version: 0 }), undefined);
assert.equal(isTrailheadOriginalTripDocument({ experienceRef: undefined }), false);

console.log('Trip Original provenance tests passed.');
