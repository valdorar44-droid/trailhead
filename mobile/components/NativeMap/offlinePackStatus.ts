export type NativeOfflinePackStatus = {
  percentage?: number;
  completedResourceSize?: number;
};

export type NativeOfflinePackStatusSource = {
  name?: string | null;
  status?: NativeOfflinePackStatus | (() => Promise<NativeOfflinePackStatus>);
};

export type InstalledOfflinePackStatus = {
  name: string;
  percentage: number;
  complete: boolean;
  sizeMb: number;
};

export type SouthWestNorthEastBounds = [[number, number], [number, number]];
export type MapLibreOfflineBounds = [[number, number], [number, number]];

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * MapLibre exposes an OfflinePack's latest status through an async status()
 * method. Keep the normalization separate from the native module so this
 * contract can be exercised in Node and remains tolerant of older snapshots.
 */
export async function installedOfflinePackStatus(
  pack: NativeOfflinePackStatusSource,
): Promise<InstalledOfflinePackStatus> {
  const source = pack.status;
  const status = typeof source === 'function'
    ? await source.call(pack)
    : source ?? {};
  const percentage = Math.max(0, Math.min(100, finiteNumber(status.percentage)));
  const bytes = Math.max(0, finiteNumber(status.completedResourceSize));
  return {
    name: pack.name || 'unknown',
    percentage,
    complete: percentage >= 100,
    sizeMb: Math.round(bytes / 1_048_576 * 10) / 10,
  };
}

export async function installedOfflinePackStatuses(
  packs: NativeOfflinePackStatusSource[],
) {
  const settled = await Promise.allSettled(packs.map(installedOfflinePackStatus));
  return settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
}

/** MapLibre's offline API accepts [north-east, south-west], unlike our route bounds. */
export function mapLibreOfflinePackBounds(
  bounds: SouthWestNorthEastBounds,
): MapLibreOfflineBounds {
  return [bounds[1], bounds[0]];
}
