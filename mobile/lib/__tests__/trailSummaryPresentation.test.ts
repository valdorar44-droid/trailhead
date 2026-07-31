import assert from 'node:assert/strict';
import test from 'node:test';

import { trailSummaryForDisplay } from '../trailSummaryPresentation';

test('fact-only generated trail summaries are omitted', () => {
  assert.equal(trailSummaryForDisplay('1.6 miles. Point-to-point. Moderate. Hiking trail.'), '');
  assert.equal(trailSummaryForDisplay('3 mi · Loop · Easy · Biking trail'), '');
});

test('real trail descriptions remain available', () => {
  assert.equal(
    trailSummaryForDisplay('A shaded river trail follows the canyon to the lower falls.'),
    'A shaded river trail follows the canyon to the lower falls.',
  );
});

test('unsupported filler summaries are omitted', () => {
  assert.equal(trailSummaryForDisplay('Check local rules before using this mapped trail.'), '');
});
