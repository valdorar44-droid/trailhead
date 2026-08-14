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
  completedResourceSize: number;
  sizeMb: number;
};

export type SouthWestNorthEastBounds = [[number, number], [number, number]];
export type MapLibreOfflineBounds = [[number, number], [number, number]];

type OfflineStyleSource = {
  tiles?: unknown;
  bounds?: unknown;
};

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

async function nativeOfflinePackStatus(pack: NativeOfflinePackStatusSource) {
  const source = pack.status;
  return typeof source === 'function'
    ? await source.call(pack)
    : source ?? {};
}

/**
 * MapLibre exposes an OfflinePack's latest status through an async status()
 * method. Keep the normalization separate from the native module so this
 * contract can be exercised in Node and remains tolerant of older snapshots.
 */
export async function installedOfflinePackStatus(
  pack: NativeOfflinePackStatusSource,
): Promise<InstalledOfflinePackStatus> {
  const status = await nativeOfflinePackStatus(pack);
  const percentage = Math.max(0, Math.min(100, finiteNumber(status.percentage)));
  const bytes = Math.max(0, finiteNumber(status.completedResourceSize));
  return {
    name: pack.name || 'unknown',
    percentage,
    complete: percentage >= 100,
    completedResourceSize: bytes,
    sizeMb: Math.round(bytes / 1_048_576 * 10) / 10,
  };
}

/**
 * Inspect exactly one physical native pack without hiding native errors or
 * accepting an ambiguous/incomplete result. Display megabytes are deliberately
 * derived only after the exact byte count has passed the safe-integer check.
 */
export async function installedOfflinePackStatusStrict(
  packs: NativeOfflinePackStatusSource[],
  expectedPhysicalName: string,
): Promise<InstalledOfflinePackStatus & { complete: true }> {
  if (!Array.isArray(packs)) {
    throw new Error('The native offline map pack list could not be verified.');
  }
  const matches = packs.filter(pack => pack?.name === expectedPhysicalName);
  if (matches.length === 0) {
    throw new Error('The exact native offline map pack is missing.');
  }
  if (matches.length !== 1) {
    throw new Error('The exact native offline map pack is duplicated.');
  }
  const status = await nativeOfflinePackStatus(matches[0]);
  const percentage = status.percentage;
  if (typeof percentage !== 'number' || !Number.isFinite(percentage) || percentage < 100) {
    throw new Error('The exact native offline map pack is incomplete.');
  }
  const bytes = status.completedResourceSize;
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error('The exact native offline map byte count is not a safe integer.');
  }
  return {
    name: expectedPhysicalName,
    percentage: Math.min(100, percentage),
    complete: true,
    completedResourceSize: bytes,
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

/**
 * Verifies that the style's Trailhead vector source can cover the complete
 * requested box. A source without explicit bounds is global. This prevents a
 * native SDK from reaching 100% after downloading only empty out-of-coverage
 * responses from an older style document.
 */
export function offlineStyleCoversBounds(
  style: unknown,
  bounds: SouthWestNorthEastBounds,
) {
  if (!style || typeof style !== 'object') return false;
  const sources = (style as { sources?: unknown }).sources;
  if (!sources || typeof sources !== 'object') return false;
  const source = Object.values(sources as Record<string, OfflineStyleSource>).find(candidate => (
    Array.isArray(candidate?.tiles)
    && candidate.tiles.some(tile => String(tile).includes('/api/tiles/'))
  ));
  if (!source) return false;
  if (source.bounds === undefined) return true;
  if (!Array.isArray(source.bounds) || source.bounds.length !== 4) return false;
  const [sourceWest, sourceSouth, sourceEast, sourceNorth] = source.bounds.map(Number);
  if (![sourceWest, sourceSouth, sourceEast, sourceNorth].every(Number.isFinite)) return false;
  const [[west, south], [east, north]] = bounds;
  return sourceWest <= west
    && sourceSouth <= south
    && sourceEast >= east
    && sourceNorth >= north;
}
