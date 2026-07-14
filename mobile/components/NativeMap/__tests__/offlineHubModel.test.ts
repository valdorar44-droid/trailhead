import assert from 'node:assert/strict';
import {
  displayOfflineDownloadName,
  offlineRegionIdsForPoints,
  summarizeOfflineRegion,
} from '../offlineHubModel';
import type { FileDownloadState } from '@/lib/useOfflineFiles';

const state = (status: FileDownloadState['status'], progress = 0, bytes = 0): FileDownloadState => ({
  status,
  progress,
  downloadedBytes: bytes,
  totalBytes: bytes || 100,
  speedBps: 0,
  etaSec: 0,
  fileSizeMb: status === 'complete' ? bytes / 1_048_576 : 0,
  localPath: '/offline/test',
});

{
  const summary = summarizeOfflineRegion({
    map: state('complete', 100, 20_971_520),
    routing: state('complete', 100, 10_485_760),
  });
  assert.equal(summary.ready, true);
  assert.equal(summary.status, 'Ready offline');
  assert.equal(summary.storedBytes, 31_457_280);
}

{
  const summary = summarizeOfflineRegion({
    map: state('downloading', 54, 54),
    routing: state('idle'),
  });
  assert.equal(summary.active, true);
  assert.equal(summary.status, 'Downloading 54%');
}

{
  const ids = offlineRegionIdsForPoints([
    { lat: 38.57, lng: -109.55 },
    { lat: 39.1, lng: -110.7 },
    { lat: 44.5, lng: -110.6 },
  ], {
    ut: { bounds: { n: 42, s: 36.9, e: -109, w: -114.1 } },
    wy: { bounds: { n: 45, s: 41, e: -104.1, w: -111.1 } },
  });
  assert.deepEqual(ids, ['ut', 'wy']);
}

assert.equal(displayOfflineDownloadName('Moab-to-Swell-corridor'), 'Moab to Swell');

console.log('Offline hub model tests passed.');
