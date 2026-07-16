import assert from 'node:assert/strict';
import { routeBuilderRequestFromGeoUrl } from '../carNavigationIntent';

assert.deepEqual(
  routeBuilderRequestFromGeoUrl('geo:0,0?q=38.5733%2C-109.5498%28Moab%29&intent=add_a_stop'),
  {
    destination: '38.5733,-109.5498(Moab)',
    action: 'add_a_stop',
  },
  'coordinate navigation requests must keep their exact location instead of geocoding only the label',
);

assert.deepEqual(
  routeBuilderRequestFromGeoUrl('geo:0,0?q=Devils%20Garden&intent=directions'),
  { destination: 'Devils Garden', action: 'directions' },
);

assert.deepEqual(
  routeBuilderRequestFromGeoUrl('geo:38.57,-109.53'),
  { destination: '38.57,-109.53', action: 'navigation' },
);

assert.equal(routeBuilderRequestFromGeoUrl('https://example.com'), null);

console.log('car navigation intent tests passed');
