import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearMapCampSelectionPhaseV1,
  currentMapCampSelectionPhaseV1,
  mapCampSelectionDiagnosticAllowedV1,
  mapCampSelectionErrorCodeV1,
  markMapCampSelectionPhaseV1,
  type MapCampSelectionPhaseV1,
} from '../mapCampSelectionCore';
import { sanitizeTelemetryEvent } from '../sanitize';

const phases: MapCampSelectionPhaseV1[] = [
  'selection_received',
  'camera_handoff',
  'sheet_identity',
  'peek_render',
  'detail_commit',
  'full_render',
];

test('camp selection diagnostics retain only fixed phase codes', () => {
  for (const phase of phases) {
    markMapCampSelectionPhaseV1(phase);
    assert.equal(currentMapCampSelectionPhaseV1(), phase);
    const errorCode = mapCampSelectionErrorCodeV1();
    const sanitized = sanitizeTelemetryEvent({
      platform: 'javascript',
      message: 'Kirch Flat at 36.879,-119.148 failed for private@example.com',
      tags: {
        error_code: errorCode,
        campground_id: 'place:usfs:private',
        coordinates: '36.879,-119.148',
      },
      exception: { values: [{ type: 'TypeError', value: 'private campground error' }] },
    });
    assert.equal(sanitized.tags?.error_code, errorCode);
    const serialized = JSON.stringify(sanitized);
    assert.equal(serialized.includes('Kirch Flat'), false);
    assert.equal(serialized.includes('36.879'), false);
    assert.equal(serialized.includes('private@example.com'), false);
    assert.equal(serialized.includes('place:usfs:private'), false);
    assert.equal(serialized.includes('private campground error'), false);
  }
  clearMapCampSelectionPhaseV1();
  assert.equal(currentMapCampSelectionPhaseV1(), null);
  assert.equal(mapCampSelectionErrorCodeV1(), 'map_camp_unknown_phase');
});

test('diagnostics fail closed outside an authenticated preview admin session', () => {
  assert.equal(mapCampSelectionDiagnosticAllowedV1({ channel: 'preview', authenticated: true, isAdmin: true }), true);
  assert.equal(mapCampSelectionDiagnosticAllowedV1({ channel: 'production', authenticated: true, isAdmin: true }), false);
  assert.equal(mapCampSelectionDiagnosticAllowedV1({ channel: 'preview', authenticated: false, isAdmin: true }), false);
  assert.equal(mapCampSelectionDiagnosticAllowedV1({ channel: 'preview', authenticated: true, isAdmin: false }), false);
});
