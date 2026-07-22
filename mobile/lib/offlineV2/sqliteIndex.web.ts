import type { OfflineBoundsV2 } from './types';

export type OfflineSearchIndexResultV2 = Readonly<{
  result_id: string;
  canonical_place_id?: string;
  title: string;
  subtitle?: string;
  kind: string;
  lat: number;
  lng: number;
  parent_destination?: string;
}>;

const unavailable = 'Offline search indexes are available in the Trailhead mobile app.';

export async function validateExpoOfflineSearchIndex(
  _path: string,
  _expectedRecords?: number,
) {
  throw new Error(unavailable);
}

export async function searchExpoOfflineIndex(_input: Readonly<{
  path: string;
  query: string;
  bounds?: OfflineBoundsV2;
  limit?: number;
}>): Promise<readonly OfflineSearchIndexResultV2[]> {
  return Object.freeze([]);
}
