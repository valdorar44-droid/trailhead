import { applyWebCameraTransition } from '../webCameraTransition';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`webCameraTransition contract failed: ${message}`);
}

const calls: string[] = [];
const cameraPayloads: Array<Record<string, unknown>> = [];
const map = {
  easeTo: (camera: Record<string, unknown>) => {
    calls.push('easeTo');
    cameraPayloads.push(camera);
  },
  flyTo: () => calls.push('flyTo'),
};

assert(
  applyWebCameraTransition(map, { duration: 120 }, 'linearTo') === 'easeTo',
  'continuous flyover frames use a direct easing path',
);
assert(calls.join(',') === 'easeTo', 'linearTo does not start a globe flyTo arc');
const linearEasing = cameraPayloads[0]?.easing;
assert(
  typeof linearEasing === 'function' && (linearEasing as (progress: number) => number)(0.35) === 0.35,
  'linearTo keeps constant velocity when translated to Mapbox easeTo',
);

calls.length = 0;
assert(
  applyWebCameraTransition(map, { duration: 2600 }, 'flyTo') === 'flyTo',
  'establishing shots keep the flyTo transition',
);
assert(calls.join(',') === 'flyTo', 'flyTo reaches the map flyTo implementation');

calls.length = 0;
assert(
  applyWebCameraTransition(map, { duration: 120 }, 'easeTo') === 'easeTo',
  'explicit easeTo remains supported',
);

export const webCameraTransitionContract = { calls };
