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

export type OriginalAdminDraftPreviewSelection = {
  chapter_id: string;
  chapter_sequence: number;
  chapter_title: string;
  variant_id: string;
  variant_sequence: number;
  variant_title: string;
  direction: string;
  is_default: boolean;
};

export type OriginalAdminDraftPreviewPlan = {
  schema_version: 1 | 2 | 3;
  selections: OriginalAdminDraftPreviewSelection[];
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

function draftRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function draftString(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function draftSequence(value: unknown, label: string) {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return Number(value);
}

/**
 * Project only the chapter/variant identities needed to enter a private draft
 * preview. The admin list already carries the server-normalized draft; this
 * parser deliberately drops transcripts, assets, and all other private data.
 */
export function originalAdminDraftPreviewPlan(input: unknown): OriginalAdminDraftPreviewPlan {
  const manifest = draftRecord(input, 'Original admin draft manifest');
  const schemaVersion = manifest.schema_version;
  if (schemaVersion === 1) return { schema_version: 1, selections: [] };
  if (schemaVersion !== 2 && schemaVersion !== 3) {
    throw new Error('Original admin draft manifest schema_version must be 1, 2, or 3.');
  }
  if (!Array.isArray(manifest.chapters) || manifest.chapters.length === 0) {
    throw new Error('Original admin draft manifest chapters are required.');
  }
  const chapterIds = new Set<string>();
  const chapterSequences = new Set<number>();
  const selectionKeys = new Set<string>();
  const selections: OriginalAdminDraftPreviewSelection[] = [];
  manifest.chapters.forEach((chapterValue, chapterIndex) => {
    const chapter = draftRecord(chapterValue, `Original admin draft chapter ${chapterIndex + 1}`);
    const chapterId = draftString(chapter.id, `Original admin draft chapter ${chapterIndex + 1} id`);
    if (chapterIds.has(chapterId)) throw new Error(`Original admin draft chapter ${chapterId} is duplicated.`);
    chapterIds.add(chapterId);
    const chapterSequence = draftSequence(
      chapter.sequence,
      `Original admin draft chapter ${chapterId} sequence`,
    );
    if (chapterSequences.has(chapterSequence)) {
      throw new Error(`Original admin draft chapter sequence ${chapterSequence} is duplicated.`);
    }
    chapterSequences.add(chapterSequence);
    const chapterTitle = draftString(chapter.title, `Original admin draft chapter ${chapterId} title`);
    const defaultVariantId = draftString(
      chapter.default_variant_id,
      `Original admin draft chapter ${chapterId} default_variant_id`,
    );
    if (!Array.isArray(chapter.variants) || chapter.variants.length === 0) {
      throw new Error(`Original admin draft chapter ${chapterId} variants are required.`);
    }
    let defaultVariantCount = 0;
    const variantSequences = new Set<number>();
    chapter.variants.forEach((variantValue, variantIndex) => {
      const variant = draftRecord(
        variantValue,
        `Original admin draft chapter ${chapterId} variant ${variantIndex + 1}`,
      );
      const variantId = draftString(
        variant.id,
        `Original admin draft chapter ${chapterId} variant ${variantIndex + 1} id`,
      );
      const selectionKey = `${chapterId}:${variantId}`;
      if (selectionKeys.has(selectionKey)) {
        throw new Error(`Original admin draft selection ${selectionKey} is duplicated.`);
      }
      selectionKeys.add(selectionKey);
      const route = draftRecord(variant.route, `Original admin draft selection ${selectionKey} route`);
      const variantSequence = draftSequence(
        variant.sequence,
        `Original admin draft selection ${selectionKey} sequence`,
      );
      if (variantSequences.has(variantSequence)) {
        throw new Error(
          `Original admin draft chapter ${chapterId} variant sequence ${variantSequence} is duplicated.`,
        );
      }
      variantSequences.add(variantSequence);
      const isDefault = variantId === defaultVariantId;
      if (isDefault) defaultVariantCount += 1;
      selections.push({
        chapter_id: chapterId,
        chapter_sequence: chapterSequence,
        chapter_title: chapterTitle,
        variant_id: variantId,
        variant_sequence: variantSequence,
        variant_title: draftString(variant.title, `Original admin draft selection ${selectionKey} title`),
        direction: draftString(route.direction, `Original admin draft selection ${selectionKey} direction`),
        is_default: isDefault,
      });
    });
    if (defaultVariantCount !== 1) {
      throw new Error(`Original admin draft chapter ${chapterId} must have exactly one default variant.`);
    }
  });
  selections.sort((left, right) => (
    left.chapter_sequence - right.chapter_sequence
    || left.variant_sequence - right.variant_sequence
    || left.chapter_id.localeCompare(right.chapter_id)
    || left.variant_id.localeCompare(right.variant_id)
  ));
  return { schema_version: schemaVersion, selections };
}

export function originalAdminDraftPreviewRouteParams(
  draftId: string,
  schemaVersion: 1 | 2 | 3,
  selection?: Pick<OriginalAdminDraftPreviewSelection, 'chapter_id' | 'variant_id'>,
) {
  const id = draftString(draftId, 'Original admin draft id');
  if (schemaVersion === 1) {
    if (selection) throw new Error('A V1 Original admin draft cannot use a chapter selection.');
    return { id };
  }
  if (!selection) {
    throw new Error(`OriginalManifestV${schemaVersion} admin preview requires a chapter and direction.`);
  }
  return {
    id,
    chapter: draftString(selection.chapter_id, 'Original admin draft chapter id'),
    variant: draftString(selection.variant_id, 'Original admin draft variant id'),
  };
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
