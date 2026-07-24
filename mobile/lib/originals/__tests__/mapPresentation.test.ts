import assert from 'node:assert/strict';
import {
  ORIGINALS_MAPBOX_STYLE_URI,
  originalOwnsMapContext,
  originalOfflineStyleURI,
  resolveOriginalMainMapPresentation,
} from '../mapPresentation';

const current = {
  mapLayer: 'topo' as const,
  premiumMapStyle: 'standard' as const,
  rendererMode: 'maplibre' as const,
};

assert.equal(
  originalOfflineStyleURI('rnmapbox'),
  'mapbox://styles/mapbox/outdoors-v12',
  'RNMapbox Originals must download the same approved style shown on the main map',
);
assert.equal(originalOfflineStyleURI('maplibre'), undefined);
assert.equal(ORIGINALS_MAPBOX_STYLE_URI, 'mapbox://styles/mapbox/outdoors-v12');

assert.deepEqual(
  resolveOriginalMainMapPresentation(current, {
    originalActive: true,
    mapboxAvailable: true,
  }),
  {
    mapLayer: 'extreme',
    premiumMapStyle: 'outdoors',
    rendererMode: 'mapbox',
  },
);

assert.equal(
  resolveOriginalMainMapPresentation(current, {
    originalActive: false,
    mapboxAvailable: true,
  }),
  current,
  'ending the Original must reveal the unchanged user map presentation',
);
assert.equal(
  resolveOriginalMainMapPresentation(current, {
    originalActive: true,
    mapboxAvailable: false,
  }),
  current,
  'MapLibre-only installations keep the working Trailhead renderer',
);

assert.equal(
  originalOwnsMapContext({
    originalActive: true,
    navigationActive: false,
  }),
  true,
  'an active Original must suppress stale browse and trip context',
);
assert.equal(
  originalOwnsMapContext({
    originalActive: true,
    navigationActive: true,
  }),
  false,
  'navigation retains the higher-priority driving context',
);
assert.equal(
  originalOwnsMapContext({
    originalActive: false,
    navigationActive: false,
  }),
  false,
);

console.log('Originals main-map presentation tests passed.');
