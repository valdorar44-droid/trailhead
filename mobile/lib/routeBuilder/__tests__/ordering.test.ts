import { orderRouteBuilderStops } from '../ordering';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`route builder ordering failed: ${message}`);
}

for (const days of [2, 4, 6]) {
  const turnaroundDay = Math.ceil(days / 2);
  const ordered = orderRouteBuilderStops([
    { day: turnaroundDay, type: 'waypoint', routeShapeRole: 'destination', routeProgressMi: 500, name: 'turnaround' },
    { day: days, type: 'waypoint', routeShapeRole: 'return_anchor', routeProgressMi: 1000, name: 'return' },
    { day: 1, type: 'start', routeShapeRole: 'start', routeProgressMi: 0, name: 'start' },
    { day: turnaroundDay, type: 'camp', routeShapeRole: 'overnight', routeProgressMi: 440, name: 'outbound camp' },
  ]);
  assert(
    ordered.findIndex(stop => stop.name === 'outbound camp') < ordered.findIndex(stop => stop.name === 'turnaround'),
    `${days}-day there-and-back keeps the outbound camp before the turnaround`,
  );
}

const oddDay = orderRouteBuilderStops([
  { day: 3, type: 'camp', routeShapeRole: 'overnight', routeProgressMi: 560, name: 'return camp' },
  { day: 3, type: 'waypoint', routeShapeRole: 'destination', routeProgressMi: 500, name: 'turnaround' },
]);
assert(oddDay[0].name === 'turnaround', 'a return-leg camp remains after the turnaround');

console.log('route builder ordering tests passed');
