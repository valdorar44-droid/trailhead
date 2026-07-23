export type SearchCenterSnapshotV2 = Readonly<{ lat: number; lng: number }>;

export type FrozenSearchCenterStateV2 = Readonly<{
  active: boolean;
  sessionKey: string;
  center?: SearchCenterSnapshotV2;
}>;

/**
 * Keep a location-biased search anchored while its UI is open. Raw GPS jitter
 * must not change the controller context and restart the active generation;
 * explicit viewport changes remain owned by Search this area.
 */
export function nextFrozenSearchCenterStateV2(
  previous: FrozenSearchCenterStateV2,
  active: boolean,
  liveCenter: SearchCenterSnapshotV2 | null | undefined,
  sessionKey: string,
): FrozenSearchCenterStateV2 {
  const center = finiteSearchCenter(liveCenter);
  if (!active) return { active: false, sessionKey, center: undefined };
  if (!previous.active || previous.sessionKey !== sessionKey) {
    return { active: true, sessionKey, center };
  }
  if (!previous.center && center) return { ...previous, center };
  return previous;
}

function finiteSearchCenter(
  center: SearchCenterSnapshotV2 | null | undefined,
): SearchCenterSnapshotV2 | undefined {
  if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return undefined;
  if (center.lat < -90 || center.lat > 90 || center.lng < -180 || center.lng > 180) return undefined;
  return { lat: center.lat, lng: center.lng };
}
