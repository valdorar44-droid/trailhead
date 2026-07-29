import assert from 'node:assert/strict';
import {
  acceptTrailRecordingPoint,
  completeTrailRecording,
  createTrailRecordingSession,
  decideTrailRecordingPoint,
  pauseTrailRecording,
  recordingElapsedMs,
  resumeTrailRecording,
  type TrailRecordingPoint,
} from '../trailRecordingSession';

let session = createTrailRecordingSession({
  id: 'recording-1',
  trailId: 'trail-1',
  trailName: 'Mesa trail',
  routeCoordinates: [[-109.55, 38.55], [-109.54, 38.55]],
  nowMs: 1_000,
});
assert.equal(session.routeCoordinates.length, 2);
assert.equal(session.followActive, true);
const first: TrailRecordingPoint = {
  lat: 38.55,
  lng: -109.55,
  accuracyM: 8,
  timestampMs: 2_000,
};
session = acceptTrailRecordingPoint(session, first);
assert.equal(session.pointCount, 1);

assert.equal(decideTrailRecordingPoint(session, { ...first, timestampMs: 2_500 }).reason, 'duplicate');
assert.equal(decideTrailRecordingPoint(session, { ...first, lat: 39.5, timestampMs: 3_000 }).reason, 'implausible_jump');
assert.equal(decideTrailRecordingPoint(session, { ...first, accuracyM: 150, timestampMs: 4_000 }).reason, 'poor_accuracy');

session = acceptTrailRecordingPoint(session, {
  ...first,
  lng: -109.549,
  timestampMs: 12_000,
  speedMps: 9,
});
assert.equal(session.pointCount, 2);
assert.ok(session.distanceM > 70);

session = pauseTrailRecording(session, 15_000);
assert.equal(session.status, 'paused');
assert.equal(recordingElapsedMs(session, 20_000), 14_000);
assert.equal(acceptTrailRecordingPoint(session, { ...first, timestampMs: 20_000 }).pointCount, 2);

session = resumeTrailRecording(session, 25_000);
assert.equal(session.status, 'recording');
session = completeTrailRecording(session, 30_000);
assert.equal(session.status, 'complete');
assert.equal(session.activeDurationMs, 19_000);
assert.equal(session.endedAtMs, 30_000);

console.log('trail recording session tests passed');
