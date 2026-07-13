export type RouteBuilderOrderStop = {
  day: number;
  type?: string | null;
  routeShapeRole?: string | null;
  routeProgressMi?: number | null;
  camp?: unknown;
  gas?: unknown;
  poi?: unknown;
};

function routeOrderWeight(stop: RouteBuilderOrderStop) {
  if (stop.routeShapeRole === 'start') return 0;
  if (stop.type === 'start') return 2;
  if (stop.routeShapeRole === 'destination') return 60;
  if (stop.routeShapeRole === 'outbound_anchor') return 65;
  if (stop.routeShapeRole === 'overnight') return 80;
  if (stop.routeShapeRole === 'return_anchor') return 100;
  return 50;
}

function finiteProgress(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function stopRouteProgressMi(stop: RouteBuilderOrderStop) {
  const direct = finiteProgress(stop.routeProgressMi);
  if (direct != null) return direct;
  for (const place of [stop.camp, stop.gas, stop.poi]) {
    const nested = finiteProgress(
      place && typeof place === 'object'
        ? (place as { route_progress_mi?: unknown }).route_progress_mi
        : null,
    );
    if (nested != null) return nested;
  }
  return null;
}

/** Keeps same-day round-trip stops in their actual order along the provider route. */
export function orderRouteBuilderStops<T extends RouteBuilderOrderStop>(stops: readonly T[]) {
  return [...stops].sort((a, b) => {
    const dayOrder = a.day - b.day;
    if (dayOrder) return dayOrder;
    const aProgress = stopRouteProgressMi(a);
    const bProgress = stopRouteProgressMi(b);
    if (aProgress != null && bProgress != null && Math.abs(aProgress - bProgress) > 0.01) {
      return aProgress - bProgress;
    }
    return routeOrderWeight(a) - routeOrderWeight(b)
      || stops.indexOf(a) - stops.indexOf(b);
  });
}
