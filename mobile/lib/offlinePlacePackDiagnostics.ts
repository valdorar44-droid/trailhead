export type OfflinePlacePackPointMetadataV1 = {
  pack_id: string;
  point_count: number;
};

export type OfflinePlacePackDiagnosticsInventoryV1 = {
  packCount: number;
  pointCount: number;
  pointCountUnknownPackCount: number;
  storageBytes: number;
};

type CollectOfflinePlacePackDiagnosticsInput = {
  packIds: readonly string[];
  pointMetadata: readonly OfflinePlacePackPointMetadataV1[];
  getFileSize: (packId: string) => Promise<number>;
};

function validPointCount(value: unknown): number | null {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

export function parseOfflinePlacePackPointMetadataV1(
  value: unknown,
): OfflinePlacePackPointMetadataV1[] {
  if (!value || typeof value !== 'object') return [];
  const candidate = value as { schema?: unknown; packs?: unknown };
  if (candidate.schema !== 'offline_place_pack_point_metadata_v1' || !Array.isArray(candidate.packs)) {
    return [];
  }

  const seen = new Set<string>();
  const rows: OfflinePlacePackPointMetadataV1[] = [];
  for (const row of candidate.packs) {
    if (!row || typeof row !== 'object') continue;
    const packId = String((row as { pack_id?: unknown }).pack_id || '').trim();
    const pointCount = validPointCount((row as { point_count?: unknown }).point_count);
    if (!packId || pointCount === null || seen.has(packId)) continue;
    seen.add(packId);
    rows.push({ pack_id: packId, point_count: pointCount });
  }
  return rows;
}

export function nextOfflinePlacePackPointMetadataV1(
  current: readonly OfflinePlacePackPointMetadataV1[],
  packId: string,
  pointCount: number,
): OfflinePlacePackPointMetadataV1[] {
  const normalizedPackId = String(packId || '').trim();
  const normalizedPointCount = validPointCount(pointCount);
  if (!normalizedPackId || normalizedPointCount === null) return [...current];
  return [
    { pack_id: normalizedPackId, point_count: normalizedPointCount },
    ...current.filter(row => row.pack_id !== normalizedPackId),
  ];
}

export async function collectOfflinePlacePackDiagnosticsV1({
  packIds,
  pointMetadata,
  getFileSize,
}: CollectOfflinePlacePackDiagnosticsInput): Promise<OfflinePlacePackDiagnosticsInventoryV1> {
  const uniquePackIds = [...new Set(packIds.filter(id => typeof id === 'string' && id.length > 0))];
  const pointCounts = new Map(
    pointMetadata.map(row => [row.pack_id, validPointCount(row.point_count)] as const),
  );
  const fileSizes = await Promise.all(uniquePackIds.map(async packId => {
    const size = await getFileSize(packId).catch(() => 0);
    return Number.isSafeInteger(size) && size >= 0 ? size : 0;
  }));

  let pointCount = 0;
  let pointCountUnknownPackCount = 0;
  for (const packId of uniquePackIds) {
    const count = pointCounts.get(packId);
    if (count === null || count === undefined) {
      pointCountUnknownPackCount += 1;
    } else {
      pointCount += count;
    }
  }

  return {
    packCount: uniquePackIds.length,
    pointCount,
    pointCountUnknownPackCount,
    storageBytes: fileSizes.reduce((total, size) => total + size, 0),
  };
}
