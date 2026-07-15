import { assembleForwardPass, type MissionScene } from '../copilotStoryboard';
import { routeRatioForPoint } from '../routeProjection';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`routeProjection contract failed: ${message}`);
}

function beat(input: {
  id: string;
  type: 'camp_arrival' | 'monument_orbit';
  title: string;
  lat: number;
  lng: number;
}): MissionScene {
  return {
    id: input.id,
    type: input.type,
    title: input.title,
    subtitle: '',
    durationMs: 6000,
    focus: { lat: input.lat, lng: input.lng },
    camera: { mode: input.type === 'camp_arrival' ? 'fly' : 'orbit' },
    layers: {},
    narration: '',
    callouts: [],
  };
}

const unevenRoute: [number, number][] = [[0, 0], [1, 0], [4, 0]];
const projectedRatio = routeRatioForPoint(unevenRoute, 0.5, 2.5);
assert(Math.abs(projectedRatio - 0.625) < 0.002, 'projection uses distance along a segment, not nearest vertex index');

const closeRatioRoute: [number, number][] = [[0, 0], [1, 0]];
const distinctBeats = assembleForwardPass({
  route: closeRatioRoute,
  beats: [
    beat({ id: 'camp-nearby', type: 'camp_arrival', title: 'Creek camp', lat: 0, lng: 0.5 }),
    beat({ id: 'view-nearby', type: 'monument_orbit', title: 'Canyon overlook', lat: 0, lng: 0.51 }),
  ],
});
assert(distinctBeats.some(scene => scene.id === 'camp-nearby'), 'keeps the camp beat');
assert(distinctBeats.some(scene => scene.id === 'view-nearby'), 'keeps a physically distinct scenic beat at a nearby route ratio');

const duplicateBeats = assembleForwardPass({
  route: closeRatioRoute,
  beats: [
    beat({ id: 'view-duplicate', type: 'monument_orbit', title: 'Camp overlook', lat: 0, lng: 0.5 }),
    beat({ id: 'camp-duplicate', type: 'camp_arrival', title: 'Camp overlook', lat: 0, lng: 0.5005 }),
  ],
});
assert(!duplicateBeats.some(scene => scene.id === 'view-duplicate'), 'collapses a second beat for the same physical place');
assert(duplicateBeats.some(scene => scene.id === 'camp-duplicate'), 'keeps the preferred camp beat for a duplicate place');

export const routeProjectionContract = { projectedRatio, distinctBeats, duplicateBeats };
