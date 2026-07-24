import assert from 'node:assert/strict';
import test from 'node:test';

import { communityReportNotes } from '../communityReportPresentation';

test('community report notes preserve ordinary field observations', () => {
  assert.equal(
    communityReportNotes({ type: 'road_report', description: 'Deep washout after the second crossing.' }),
    'Deep washout after the second crossing.',
  );
});

test('GPX report notes never expose the imported filename', () => {
  assert.equal(
    communityReportNotes({
      type: 'gpx_import',
      description: 'food\nImported from GPX: final_boss_trip.gpx',
    }),
    'food',
  );
});

test('an import-only description becomes an omitted note', () => {
  assert.equal(
    communityReportNotes({ type: 'gpx_import', description: 'Imported from GPX: personal-route.gpx' }),
    '',
  );
});
