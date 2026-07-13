import {
  routeGeometryContentSignature,
  routeGeometryMatchesWaypointIdentity,
  routeGeometryMatchesWaypointsInOrder,
  plannerWaypointSignature,
  routeWaypointSignature,
  withRouteWaypointIdentity,
} from '../routeWaypointSignature';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`route waypoint identity contract failed: ${message}`);
}

const orderedWaypoints = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 1 },
  { lat: 0, lng: 2 },
  { lat: 0, lng: 3 },
];

const signature = routeWaypointSignature(orderedWaypoints);
assert(signature === 'rwp1:0,0|1,0|2,0|3,0', 'signature preserves exact coordinate order');
assert(
  routeWaypointSignature([orderedWaypoints[0], { lat: 4, lng: 4, route_point_type: 'side_stop' }, ...orderedWaypoints.slice(1)]) === signature,
  'side stops do not change routing identity',
);
assert(
  routeWaypointSignature([...orderedWaypoints].reverse()) !== signature,
  'reversing stops changes routing identity',
);
assert(
  routeWaypointSignature([{ lat: null, lng: null }, ...orderedWaypoints]) === signature,
  'missing coordinates are not coerced to the Gulf of Guinea',
);

const route: [number, number][] = [[0, 0], [1, 0], [2, 0], [3, 0]];
assert(routeGeometryMatchesWaypointsInOrder(route, orderedWaypoints), 'legacy geometry accepts ordered stops');
assert(
  !routeGeometryMatchesWaypointsInOrder(route, [orderedWaypoints[0], orderedWaypoints[2], orderedWaypoints[1], orderedWaypoints[3]]),
  'legacy geometry rejects reversed intermediate stops',
);
assert(
  !routeGeometryMatchesWaypointsInOrder(
    [[-105, 39.7], [0, 0]],
    [{ lat: 39.7, lng: -105 }, { lat: 0, lng: 0 }],
  ),
  'geometry rejects continent-scale jumps between adjacent points',
);

const thereAndBack: [number, number][] = [[0, 0], [1, 0], [2, 0], [1, 0], [0, 0]];
assert(
  routeGeometryMatchesWaypointsInOrder(thereAndBack, [orderedWaypoints[0], orderedWaypoints[1], orderedWaypoints[2], orderedWaypoints[1], orderedWaypoints[0]]),
  'legacy matching supports ordered there-and-back routes',
);

assert(
  routeGeometryMatchesWaypointIdentity({ coords: route, routeWaypointSignature: signature }, orderedWaypoints),
  'signed geometry accepts its exact waypoint identity',
);
assert(
  !routeGeometryMatchesWaypointIdentity({ coords: route, routeWaypointSignature: routeWaypointSignature([...orderedWaypoints].reverse()) }, orderedWaypoints),
  'signed geometry rejects a mismatched identity even when coordinates overlap',
);
assert(
  !routeGeometryMatchesWaypointIdentity({ coords: [], routeWaypointSignature: signature }, orderedWaypoints),
  'a matching signature cannot make empty geometry valid',
);
assert(
  !routeGeometryMatchesWaypointIdentity({ coords: [[0, 0], [0, 10], [3, 0]], routeWaypointSignature: signature }, orderedWaypoints),
  'a matching signature cannot hide missing ordered stops',
);

const plannerWaypoints = [
  { day: 1, type: 'start', lat: 38.5733, lng: -109.5498 },
  { day: 1, type: 'waypoint', lat: 38.7, lng: -109.7, route_point_type: 'side_stop' },
  { day: 2, type: 'camp', lat: 38.66, lng: -109.31, route_point_type: 'through' },
];
const backendRoutableSignature = plannerWaypointSignature(plannerWaypoints, true);
assert(
  backendRoutableSignature === '-109.54980,38.57330:1:start:break|-109.31000,38.66000:2:camp:through',
  'planner-compatible signature matches the backend format',
);
assert(
  routeGeometryMatchesWaypointIdentity(
    { coords: [[-109.5498, 38.5733], [-109.31, 38.66]], routableWaypointSignature: backendRoutableSignature },
    plannerWaypoints,
  ),
  'planner geometry accepts the backend routable signature',
);

assert(
  routeGeometryContentSignature([[0, 0], [1, 0], [2, 0]])
    !== routeGeometryContentSignature([[0, 0], [1.1, 0], [2, 0]]),
  'same-count coordinate edits change geometry identity',
);

const stamped = withRouteWaypointIdentity({ coords: route }, orderedWaypoints);
assert(stamped.routeWaypointSignature === signature, 'new trip saves receive the exact mobile identity');
assert(
  stamped.routableWaypointSignature === plannerWaypointSignature(orderedWaypoints, true),
  'new trip saves receive the planner-compatible routable identity',
);

console.log('route waypoint signature tests passed');
