export type RouteRenderReadyOptions = {
  coords: [number, number][];
  lastRouteCoordsRef: { current: [number, number][] };
  routeOverlayReadyRef: { current: boolean };
  timeoutMs?: number;
  settleMs?: number;
};

function coordsMatch(a: [number, number][], b: [number, number][]) {
  if (a.length < 2 || b.length < 2) return false;
  const startA = a[0];
  const endA = a[a.length - 1];
  const startB = b[0];
  const endB = b[b.length - 1];
  const near = (p: [number, number], q: [number, number]) =>
    Math.abs(p[0] - q[0]) < 0.02 && Math.abs(p[1] - q[1]) < 0.02;
  return near(startA, startB) && near(endA, endB);
}

/** Wait until the scout route is synced to the map before starting the cinematic fly. */
export async function waitForRouteRenderReady(options: RouteRenderReadyOptions): Promise<boolean> {
  const {
    coords,
    lastRouteCoordsRef,
    routeOverlayReadyRef,
    timeoutMs = 2500,
    settleMs = 400,
  } = options;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const synced = coordsMatch(coords, lastRouteCoordsRef.current) && routeOverlayReadyRef.current;
    if (synced) {
      await new Promise(resolve => setTimeout(resolve, settleMs));
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  return coordsMatch(coords, lastRouteCoordsRef.current);
}

export function waitForRealtimeConnected(
  isConnected: () => boolean,
  timeoutMs = 6000,
  pollMs = 150,
): Promise<boolean> {
  if (isConnected()) return Promise.resolve(true);
  const started = Date.now();
  return new Promise(resolve => {
    const timer = setInterval(() => {
      if (isConnected()) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, pollMs);
  });
}
