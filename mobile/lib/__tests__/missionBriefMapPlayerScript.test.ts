import { getMissionBriefMapPlayerScript } from '@/lib/missionBriefMapPlayerScript';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`missionBriefMapPlayerScript contract failed: ${message}`);
}

const route: [number, number][] = [[0, 0], [1, 0], [4, 0]];
const script = getMissionBriefMapPlayerScript();
const loadHelpers = new Function(
  'window',
  '_routeCoords',
  `${script}; return { sliceCoords: sliceCoords, pointAtRatio: pointAtRatio };`,
) as (
  windowValue: { __missionBriefData: { scenes: never[]; route: [number, number][]; checkpoints: never[] } },
  routeCoords: [number, number][],
) => {
  sliceCoords: (slice: [number, number]) => [number, number][];
  pointAtRatio: (ratio: number) => [number, number];
};

const helpers = loadHelpers({
  __missionBriefData: { scenes: [], route, checkpoints: [] },
}, route);
const halfway = helpers.pointAtRatio(0.5);
assert(Math.abs(halfway[0] - 2) < 0.002, 'seek point follows traveled distance instead of vertex count');

const middle = helpers.sliceCoords([0.25, 0.75]);
assert(Math.abs(middle[0][0] - 1) < 0.002, 'scene slice interpolates its metric start');
assert(Math.abs(middle[middle.length - 1][0] - 3) < 0.002, 'scene slice interpolates its metric end');

export const missionBriefMapPlayerScriptContract = { halfway, middle };
