import type {
  OriginalManifest,
  OriginalManifestV1,
  OriginalSelectablePlaybackItemV1,
  OriginalSelectablePlaybackPlanV1,
} from './types';

export type OriginalAdminPreviewReviewMode =
  | 'hard_auto'
  | OriginalSelectablePlaybackItemV1['delivery']['mode'];

export type OriginalAdminPreviewReviewEntry = {
  id: string;
  sequence: number;
  title: string;
  transcript: string;
  audio_asset_id: string;
  artwork_asset_id?: string;
  audio_duration_s: number;
  mode: OriginalAdminPreviewReviewMode;
  mode_label: string;
};

export type OriginalAdminPreviewRenderableReviewEntry = OriginalAdminPreviewReviewEntry & {
  artwork_asset_id: string;
  artwork_uri: string;
};

type OriginalAdminPreviewLocalAsset = {
  id: string;
  kind: string;
  local_uri: string;
};

export type OriginalAdminPreviewExitSurface =
  | 'android_back'
  | 'top_close'
  | 'end_test'
  | 'completion_exit'
  | 'privilege_loss';

export function originalAdminPreviewSelectionRequired(
  manifest: Pick<OriginalManifest, 'schema_version'>,
) {
  return manifest.schema_version !== 1;
}

export function originalAdminPreviewExitAction(
  _surface: OriginalAdminPreviewExitSurface,
  state: { privateReviewActive: boolean; cleanupPending: boolean },
) {
  return state.privateReviewActive || state.cleanupPending
    ? 'exact_private_cleanup' as const
    : 'simulation_stop' as const;
}

function selectableModeLabel(item: OriginalSelectablePlaybackItemV1) {
  if (item.delivery.mode === 'capacity_deeper') return 'CAPACITY STORY';
  if (item.delivery.mode === 'completion_deeper') return 'AFTER ROUTE';
  return item.delivery.availability === 'before_route_user_confirmed_parked'
    ? 'PARKED BEFORE ROUTE'
    : 'PARKED AT LANDMARK';
}

/**
 * Build the exact, ungrouped content-review list for an authenticated admin
 * Trigger Lab session. This is deliberately unavailable to ordinary/public
 * playback and does not claim to validate delivery scheduling.
 */
export function originalAdminPreviewReviewEntries(
  manifest: OriginalManifestV1 | null | undefined,
  selectablePlan: OriginalSelectablePlaybackPlanV1 | null | undefined,
  access: { isAdmin: boolean; simulation: boolean; privatePreview: boolean },
): OriginalAdminPreviewReviewEntry[] {
  if (
    !access.isAdmin
    || !access.simulation
    || !access.privatePreview
    || !manifest
    || !selectablePlan
  ) return [];
  const totalStories = manifest.stops.length + selectablePlan.items.length;
  const selectableSequences = new Set(selectablePlan.items.map(item => item.sequence));
  const hardSequences = Array.from({ length: totalStories }, (_, index) => index + 1)
    .filter(sequence => !selectableSequences.has(sequence));
  if (hardSequences.length !== manifest.stops.length) {
    throw new Error('The private review sequence does not cover every story exactly once.');
  }
  const entries: OriginalAdminPreviewReviewEntry[] = [
    ...manifest.stops.map((stop, index) => ({
      id: stop.id,
      sequence: hardSequences[index],
      title: stop.title,
      transcript: stop.transcript,
      audio_asset_id: stop.audio_asset_id,
      ...(stop.artwork_asset_id ? { artwork_asset_id: stop.artwork_asset_id } : {}),
      audio_duration_s: stop.audio_duration_s,
      mode: 'hard_auto' as const,
      mode_label: 'HARD CUE',
    })),
    ...selectablePlan.items.map(item => ({
      id: item.id,
      sequence: item.sequence,
      title: item.title,
      transcript: item.transcript,
      audio_asset_id: item.audio_asset_id,
      ...(item.artwork_asset_id ? { artwork_asset_id: item.artwork_asset_id } : {}),
      audio_duration_s: item.audio_duration_s,
      mode: item.delivery.mode,
      mode_label: selectableModeLabel(item),
    })),
  ].sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) {
    throw new Error('The private review list contains a duplicate story identity.');
  }
  return entries;
}

/**
 * Resolve review artwork only from the verified local bundle. Private review
 * fails closed instead of silently substituting a remote or unrelated image.
 */
export function originalAdminPreviewRenderableReviewEntries(
  entries: readonly OriginalAdminPreviewReviewEntry[],
  assets: readonly OriginalAdminPreviewLocalAsset[] | null | undefined,
): OriginalAdminPreviewRenderableReviewEntry[] {
  if (!entries.length) return [];
  if (!assets) throw new Error('The verified private review artwork is unavailable on this device.');
  return entries.map(entry => {
    if (!entry.artwork_asset_id) {
      throw new Error(`Private review story ${entry.id} has no approved artwork identity.`);
    }
    const matches = assets.filter(asset => (
      asset.id === entry.artwork_asset_id
      && asset.kind === 'image'
      && Boolean(asset.local_uri?.trim())
    ));
    if (matches.length !== 1) {
      throw new Error(`Approved artwork ${entry.artwork_asset_id} is not uniquely available in the verified bundle.`);
    }
    return {
      ...entry,
      artwork_asset_id: entry.artwork_asset_id,
      artwork_uri: matches[0].local_uri,
    };
  });
}
