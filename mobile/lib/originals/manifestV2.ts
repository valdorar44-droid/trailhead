import { OriginalManifestError, validateOriginalManifest } from './manifest';
import type {
  OriginalCompiledChapterManifestV2,
  OriginalChapterSelectionItemV2,
  OriginalChapterSelectionV2,
  OriginalChapterV2,
  OriginalBoundsV1,
  OriginalManifestV1,
  OriginalManifestV2,
  OriginalRouteV1,
  OriginalRouteVariantV2,
  OriginalStoryV2,
} from './types';

function assertText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new OriginalManifestError(`${label} is required.`);
  }
}

function assertFinite(value: unknown, label: string, minimum?: number): asserts value is number {
  if (!Number.isFinite(value) || (minimum != null && Number(value) < minimum)) {
    throw new OriginalManifestError(`${label} must be a finite number${minimum != null ? ` >= ${minimum}` : ''}.`);
  }
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new OriginalManifestError(`${label} must be a positive integer.`);
  }
}

function assertArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new OriginalManifestError(`${label} must contain at least one item.`);
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OriginalManifestError(`${label} must be an object.`);
  }
}

function assertStableId(value: unknown, label: string): asserts value is string {
  assertText(value, label);
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(value)) {
    throw new OriginalManifestError(`${label} must be a stable identifier.`);
  }
}

function assertReviewDate(value: unknown, label: string): asserts value is string {
  assertText(value, label);
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed)) {
    throw new OriginalManifestError(`${label} must be an ISO calendar date.`);
  }
  const todayUtc = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  if (parsed > todayUtc) {
    throw new OriginalManifestError(`${label} cannot be in the future.`);
  }
}

function assertUnique(values: string[], label: string) {
  if (new Set(values).size !== values.length) {
    throw new OriginalManifestError(`${label} must be unique.`);
  }
}

function validateBounds(bounds: OriginalBoundsV1, label: string) {
  assertRecord(bounds, label);
  assertFinite(bounds.north, `${label}.north`, -90);
  assertFinite(bounds.south, `${label}.south`, -90);
  assertFinite(bounds.east, `${label}.east`, -180);
  assertFinite(bounds.west, `${label}.west`, -180);
  if (
    Math.abs(bounds.north) > 90
    || Math.abs(bounds.south) > 90
    || Math.abs(bounds.east) > 180
    || Math.abs(bounds.west) > 180
    || bounds.north < bounds.south
    || bounds.east < bounds.west
  ) {
    throw new OriginalManifestError(`${label} is outside valid non-wrapping bounds.`);
  }
}

function assertUnionCoversRoute(
  unionBounds: OriginalBoundsV1,
  routeBounds: OriginalBoundsV1,
  label: string,
) {
  const tolerance = 1e-6;
  if (
    routeBounds.north > unionBounds.north + tolerance
    || routeBounds.south < unionBounds.south - tolerance
    || routeBounds.east > unionBounds.east + tolerance
    || routeBounds.west < unionBounds.west - tolerance
  ) {
    throw new OriginalManifestError(`${label} is not covered by the union offline_map bounds.`);
  }
}

function assertUnionContainsCoordinate(
  unionBounds: OriginalBoundsV1,
  coordinate: { lat: number; lng: number },
  label: string,
) {
  assertFinite(coordinate?.lat, `${label}.lat`, -90);
  assertFinite(coordinate?.lng, `${label}.lng`, -180);
  if (
    Math.abs(coordinate.lat) > 90
    || Math.abs(coordinate.lng) > 180
    || coordinate.lat > unionBounds.north
    || coordinate.lat < unionBounds.south
    || coordinate.lng > unionBounds.east
    || coordinate.lng < unionBounds.west
  ) {
    throw new OriginalManifestError(`${label} is not covered by the union offline_map bounds.`);
  }
}

function assertContiguousSequence(
  entries: ReadonlyArray<{ sequence: number }>,
  label: string,
) {
  const ordered = entries.map((entry, index) => {
    assertRecord(entry, `${label}[${index}]`);
    return entry.sequence;
  }).sort((a, b) => a - b);
  ordered.forEach((sequence, index) => {
    assertPositiveInteger(sequence, `${label}[${index}].sequence`);
    if (sequence !== index + 1) {
      throw new OriginalManifestError(`${label} sequences must be contiguous starting at 1.`);
    }
  });
}

function validateStory(story: OriginalStoryV2, index: number) {
  const label = `stories[${index}]`;
  assertRecord(story, label);
  assertStableId(story.id, `${label}.id`);
  if (story.kind !== 'story' && story.kind !== 'cue') {
    throw new OriginalManifestError(`${label}.kind must be story or cue.`);
  }
  assertText(story.title, `${label}.title`);
  assertText(story.transcript, `${label}.transcript`);
  assertStableId(story.audio_asset_id, `${label}.audio_asset_id`);
  assertFinite(story.audio_duration_s, `${label}.audio_duration_s`, 1);
  if (story.artwork_asset_id != null) {
    assertStableId(story.artwork_asset_id, `${label}.artwork_asset_id`);
  }
  assertArray(story.citations, `${label}.citations`);
  story.citations.forEach((citation, citationIndex) => {
    assertRecord(citation, `${label}.citations[${citationIndex}]`);
    const citationLabel = `${label}.citations[${citationIndex}]`;
    assertText(citation.title, `${citationLabel}.title`);
    assertText(citation.url, `${citationLabel}.url`);
    assertText(citation.publisher, `${citationLabel}.publisher`);
    if (citation.role !== 'story') {
      throw new OriginalManifestError(`${citationLabel}.role must be story.`);
    }
    if (citation.authority !== 'official' && citation.authority !== 'authoritative') {
      throw new OriginalManifestError(`${citationLabel}.authority is invalid.`);
    }
    assertReviewDate(citation.reviewed_at, `${citationLabel}.reviewed_at`);
    if (!['public_domain', 'licensed', 'permission_confirmed', 'reference_only'].includes(
      citation.rights_status,
    )) {
      throw new OriginalManifestError(`${citationLabel}.rights_status is invalid.`);
    }
    assertArray(citation.affected_claims, `${citationLabel}.affected_claims`);
    citation.affected_claims.forEach((claimId, claimIndex) => {
      assertStableId(claimId, `${citationLabel}.affected_claims[${claimIndex}]`);
    });
    assertUnique(citation.affected_claims, `${citationLabel}.affected_claims`);
  });
}

function validateVariant(
  chapter: OriginalChapterV2,
  variant: OriginalRouteVariantV2,
  index: number,
  storyIds: Set<string>,
  referencedStoryIds: Set<string>,
  unionBounds: OriginalBoundsV1,
) {
  const label = `chapters.${chapter.id}.variants[${index}]`;
  assertRecord(variant, label);
  assertStableId(variant.id, `${label}.id`);
  assertPositiveInteger(variant.sequence, `${label}.sequence`);
  assertText(variant.title, `${label}.title`);
  assertArray(variant.cue_refs, `${label}.cue_refs`);
  assertContiguousSequence(variant.cue_refs, `${label}.cue_refs`);
  const refIds = variant.cue_refs.map((reference, referenceIndex) => {
    assertRecord(reference, `${label}.cue_refs[${referenceIndex}]`);
    assertStableId(reference.story_id, `${label}.cue_refs[${referenceIndex}].story_id`);
    if (!storyIds.has(reference.story_id)) {
      throw new OriginalManifestError(
        `${label}.cue_refs[${referenceIndex}] references an unknown story.`,
      );
    }
    assertUnionContainsCoordinate(
      unionBounds,
      reference.coordinates,
      `${label}.cue_refs[${referenceIndex}].coordinates`,
    );
    referencedStoryIds.add(reference.story_id);
    return reference.story_id;
  });
  assertUnique(refIds, `${label}.cue_refs story references`);
}

function cloneRoute(route: OriginalRouteV1): OriginalRouteV1 {
  return {
    ...route,
    geometry: {
      type: 'LineString',
      coordinates: route.geometry.coordinates.map(coordinate => [coordinate[0], coordinate[1]]),
    },
    bounds: { ...route.bounds },
  };
}

function buildCompiledManifest(
  manifest: OriginalManifestV2,
  chapter: OriginalChapterV2,
  variant: OriginalRouteVariantV2,
): OriginalManifestV1 {
  const stories = new Map(manifest.stories.map(story => [story.id, story]));
  return {
    schema_version: 1,
    // Keep the union bundle identity stable. Selection identity is returned
    // alongside this V1-shaped route and must key future V2 session storage.
    manifest_id: manifest.manifest_id,
    pack_id: manifest.pack_id,
    version: manifest.version,
    locale: manifest.locale,
    title: `${manifest.title} — ${chapter.title}`,
    route: cloneRoute(variant.route),
    stops: [...variant.cue_refs]
      .sort((a, b) => a.sequence - b.sequence || a.story_id.localeCompare(b.story_id))
      .map(reference => {
        const story = stories.get(reference.story_id);
        if (!story) {
          throw new OriginalManifestError(`Unknown story ${reference.story_id}.`);
        }
        return {
          id: story.id,
          sequence: reference.sequence,
          title: story.title,
          coordinates: { ...reference.coordinates },
          explore_place_id: reference.explore_place_id,
          transcript: story.transcript,
          audio_asset_id: story.audio_asset_id,
          audio_duration_s: story.audio_duration_s,
          artwork_asset_id: story.artwork_asset_id,
          trigger: { ...reference.trigger },
          citations: story.citations.map(citation => ({
            title: citation.title,
            url: citation.url,
            publisher: citation.publisher,
            reviewed_at: citation.reviewed_at,
            role: citation.role,
            authority: citation.authority,
            scope: [...citation.affected_claims],
          })),
        };
      }),
    assets: [...manifest.assets]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(asset => ({ ...asset })),
    offline_map: {
      ...manifest.offline_map,
      bounds: { ...manifest.offline_map.bounds },
    },
    safety: {
      ...chapter.safety,
      disclaimers: [...chapter.safety.disclaimers],
    },
    access: { ...chapter.access },
    season: {
      ...chapter.season,
      recommended_months: [...chapter.season.recommended_months],
    },
    review: { ...manifest.review },
  };
}

function resolveSelection(
  manifest: OriginalManifestV2,
  selection: OriginalChapterSelectionV2,
) {
  const chapter = manifest.chapters.find(candidate => candidate.id === selection.chapter_id);
  if (!chapter) {
    throw new OriginalManifestError(`Unknown chapter ${selection.chapter_id}.`);
  }
  const variantId = selection.variant_id ?? chapter.default_variant_id;
  const variant = chapter.variants.find(candidate => candidate.id === variantId);
  if (!variant) {
    throw new OriginalManifestError(`Unknown variant ${variantId} for chapter ${chapter.id}.`);
  }
  return { chapter, variant };
}

export function validateOriginalManifestV2(input: unknown): OriginalManifestV2 {
  if (!input || typeof input !== 'object') {
    throw new OriginalManifestError('Manifest must be an object.');
  }
  const manifest = input as OriginalManifestV2;
  if (manifest.schema_version !== 2) {
    throw new OriginalManifestError('Unsupported Originals V2 manifest schema.');
  }
  assertText(manifest.manifest_id, 'manifest_id');
  assertStableId(manifest.pack_id, 'pack_id');
  assertPositiveInteger(manifest.version, 'version');
  assertText(manifest.locale, 'locale');
  assertText(manifest.title, 'title');
  assertArray(manifest.assets, 'assets');
  manifest.assets.forEach((asset, assetIndex) => {
    assertRecord(asset, `assets[${assetIndex}]`);
    assertText(asset.id, `assets[${assetIndex}].id`);
  });
  assertRecord(manifest.offline_map, 'offline_map');
  assertRecord(manifest.offline_map.bounds, 'offline_map.bounds');
  validateBounds(manifest.offline_map.bounds, 'offline_map.bounds');
  assertRecord(manifest.review, 'review');
  assertArray(manifest.stories, 'stories');
  manifest.stories.forEach(validateStory);
  const storyIds = manifest.stories.map(story => story.id);
  assertUnique(storyIds, 'Story IDs');
  const storyIdSet = new Set(storyIds);
  const assetsById = new Map(manifest.assets.map(asset => [asset.id, asset]));
  manifest.stories.forEach((story, storyIndex) => {
    const asset = assetsById.get(story.audio_asset_id);
    if (!asset || asset.kind !== 'narration') {
      throw new OriginalManifestError(`stories[${storyIndex}].audio_asset_id must reference a narration asset.`);
    }
    if (asset.mime_type !== 'audio/mpeg') {
      throw new OriginalManifestError(
        `stories[${storyIndex}].audio asset format must be audio/mpeg.`,
      );
    }
  });
  assertArray(manifest.chapters, 'chapters');
  assertContiguousSequence(manifest.chapters, 'chapters');
  const chapterIds = manifest.chapters.map(chapter => chapter.id);
  manifest.chapters.forEach((chapter, chapterIndex) => {
    assertStableId(chapter.id, `chapters[${chapterIndex}].id`);
  });
  assertUnique(chapterIds, 'Chapter IDs');
  const chapterIdSet = new Set(chapterIds);
  const referencedStoryIds = new Set<string>();
  const validationSelectionIds: string[] = [];
  manifest.chapters.forEach((chapter, chapterIndex) => {
    const label = `chapters[${chapterIndex}]`;
    assertRecord(chapter, label);
    assertPositiveInteger(chapter.sequence, `${label}.sequence`);
    assertText(chapter.title, `${label}.title`);
    assertText(chapter.summary, `${label}.summary`);
    assertStableId(chapter.default_variant_id, `${label}.default_variant_id`);
    assertRecord(chapter.safety, `${label}.safety`);
    assertText(chapter.safety.summary, `${label}.safety.summary`);
    assertText(chapter.safety.emergency_note, `${label}.safety.emergency_note`);
    if (!Array.isArray(chapter.safety.disclaimers)) {
      throw new OriginalManifestError(`${label}.safety.disclaimers must be an array.`);
    }
    chapter.safety.disclaimers.forEach((disclaimer, disclaimerIndex) => {
      assertText(disclaimer, `${label}.safety.disclaimers[${disclaimerIndex}]`);
    });
    assertRecord(chapter.access, `${label}.access`);
    assertText(chapter.access.surface, `${label}.access.surface`);
    assertText(chapter.access.vehicle, `${label}.access.vehicle`);
    assertText(chapter.access.fees, `${label}.access.fees`);
    assertText(chapter.access.accessibility_notes, `${label}.access.accessibility_notes`);
    assertRecord(chapter.season, `${label}.season`);
    assertArray(chapter.season.recommended_months, `${label}.season.recommended_months`);
    chapter.season.recommended_months.forEach((month, monthIndex) => {
      if (!Number.isInteger(month) || month < 1 || month > 12) {
        throw new OriginalManifestError(
          `${label}.season.recommended_months[${monthIndex}] must be an integer from 1 to 12.`,
        );
      }
    });
    assertUnique(
      chapter.season.recommended_months.map(String),
      `${label}.season.recommended_months`,
    );
    assertText(chapter.season.closures_note, `${label}.season.closures_note`);
    assertArray(chapter.operational_sources, `${label}.operational_sources`);
    const availableScopes = new Set<string>();
    chapter.operational_sources.forEach((source, sourceIndex) => {
      const sourceLabel = `${label}.operational_sources[${sourceIndex}]`;
      assertRecord(source, sourceLabel);
      assertText(source.title, `${sourceLabel}.title`);
      assertText(source.url, `${sourceLabel}.url`);
      assertReviewDate(source.reviewed_at, `${sourceLabel}.reviewed_at`);
      if (source.role !== 'operational') {
        throw new OriginalManifestError(`${sourceLabel}.role must be operational.`);
      }
      if (source.authority !== 'official' && source.authority !== 'authoritative') {
        throw new OriginalManifestError(`${sourceLabel}.authority is invalid.`);
      }
      assertArray(source.scope, `${sourceLabel}.scope`);
      source.scope.forEach((scope, scopeIndex) => {
        assertText(scope, `${sourceLabel}.scope[${scopeIndex}]`);
        availableScopes.add(scope);
      });
    });
    if (chapter.operational_readiness?.policy !== 'required_before_start') {
      throw new OriginalManifestError(
        `${label}.operational_readiness.policy must be required_before_start.`,
      );
    }
    assertArray(
      chapter.operational_readiness.source_scopes,
      `${label}.operational_readiness.source_scopes`,
    );
    assertUnique(
      chapter.operational_readiness.source_scopes,
      `${label}.operational_readiness.source_scopes`,
    );
    chapter.operational_readiness.source_scopes.forEach(scope => {
      assertText(scope, `${label}.operational_readiness.source_scopes`);
      if (!availableScopes.has(scope)) {
        throw new OriginalManifestError(
          `${label}.operational_readiness references operational scope ${scope} without a source.`,
        );
      }
    });
    if (!Array.isArray(chapter.operational_readiness.alternate_chapter_ids)) {
      throw new OriginalManifestError(
        `${label}.operational_readiness.alternate_chapter_ids must be an array.`,
      );
    }
    assertUnique(
      chapter.operational_readiness.alternate_chapter_ids,
      `${label}.operational_readiness.alternate_chapter_ids`,
    );
    chapter.operational_readiness.alternate_chapter_ids.forEach(alternateId => {
      assertStableId(alternateId, `${label}.operational_readiness.alternate_chapter_ids`);
      if (alternateId === chapter.id || !chapterIdSet.has(alternateId)) {
        throw new OriginalManifestError(
          `${label}.operational_readiness has an invalid alternate chapter reference.`,
        );
      }
    });
    assertStableId(
      chapter.validation_selection?.selection_id,
      `${label}.validation_selection.selection_id`,
    );
    validationSelectionIds.push(chapter.validation_selection.selection_id);
    assertArray(
      chapter.validation_selection?.required_variant_ids,
      `${label}.validation_selection.required_variant_ids`,
    );
    assertArray(chapter.variants, `${label}.variants`);
    assertContiguousSequence(chapter.variants, `${label}.variants`);
    const variantIds = chapter.variants.map(variant => variant.id);
    assertUnique(variantIds, `${label} variant IDs`);
    if (!variantIds.includes(chapter.default_variant_id)) {
      throw new OriginalManifestError(`${label}.default_variant_id does not reference a variant.`);
    }
    assertUnique(
      chapter.validation_selection.required_variant_ids,
      `${label}.validation_selection.required_variant_ids`,
    );
    chapter.validation_selection.required_variant_ids.forEach((variantId, variantIdIndex) => {
      assertStableId(
        variantId,
        `${label}.validation_selection.required_variant_ids[${variantIdIndex}]`,
      );
    });
    const requiredVariantIds = [...chapter.validation_selection.required_variant_ids].sort();
    const expectedVariantIds = [...variantIds].sort();
    if (
      requiredVariantIds.length !== expectedVariantIds.length
      || requiredVariantIds.some((variantId, index) => variantId !== expectedVariantIds[index])
    ) {
      throw new OriginalManifestError(
        `${label}.validation_selection must require every chapter variant exactly once.`,
      );
    }
    chapter.variants.forEach((variant, variantIndex) => {
      validateVariant(
        chapter,
        variant,
        variantIndex,
        storyIdSet,
        referencedStoryIds,
        manifest.offline_map.bounds,
      );
      assertRecord(variant.route, `${label}.variants[${variantIndex}].route`);
      assertText(variant.route.profile, `${label}.variants[${variantIndex}].route.profile`);
      assertText(variant.route.direction, `${label}.variants[${variantIndex}].route.direction`);
      assertRecord(variant.route.geometry, `${label}.variants[${variantIndex}].route.geometry`);
      assertArray(
        variant.route.geometry.coordinates,
        `${label}.variants[${variantIndex}].route.geometry.coordinates`,
      );
      assertRecord(variant.route.bounds, `${label}.variants[${variantIndex}].route.bounds`);
      validateBounds(variant.route.bounds, `${label}.variants[${variantIndex}].route.bounds`);
      assertUnionCoversRoute(
        manifest.offline_map.bounds,
        variant.route.bounds,
        `${label}.variants[${variantIndex}].route.bounds`,
      );
      validateOriginalManifest(buildCompiledManifest(manifest, chapter, variant));
    });
  });
  assertUnique(validationSelectionIds, 'Chapter validation selection IDs');
  const unreferencedStories = storyIds.filter(storyId => !referencedStoryIds.has(storyId));
  if (unreferencedStories.length > 0) {
    throw new OriginalManifestError(
      `Every shared story must be referenced; missing: ${unreferencedStories.join(', ')}.`,
    );
  }
  return manifest;
}

export function listOriginalChapterSelections(
  input: unknown,
): OriginalChapterSelectionItemV2[] {
  const manifest = validateOriginalManifestV2(input);
  const stories = new Map(manifest.stories.map(story => [story.id, story]));
  return [...manifest.chapters]
    .sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id))
    .flatMap(chapter => [...chapter.variants]
      .sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id))
      .map(variant => ({
        chapter_id: chapter.id,
        chapter_sequence: chapter.sequence,
        chapter_title: chapter.title,
        chapter_summary: chapter.summary,
        variant_id: variant.id,
        variant_sequence: variant.sequence,
        variant_title: variant.title,
        is_default: variant.id === chapter.default_variant_id,
        direction: variant.route.direction,
        distance_m: variant.route.distance_m,
        duration_s: variant.route.duration_s,
        story_count: variant.cue_refs.filter(reference => stories.get(reference.story_id)?.kind === 'story').length,
        cue_count: variant.cue_refs.filter(reference => stories.get(reference.story_id)?.kind === 'cue').length,
        validation_selection_id: chapter.validation_selection.selection_id,
      })));
}

export function compileOriginalManifestV2(
  input: unknown,
  selection: OriginalChapterSelectionV2,
): OriginalCompiledChapterManifestV2 {
  const manifest = validateOriginalManifestV2(input);
  const { chapter, variant } = resolveSelection(manifest, selection);
  return {
    selection: {
      validation_selection_id: chapter.validation_selection.selection_id,
      chapter_id: chapter.id,
      variant_id: variant.id,
    },
    manifest: validateOriginalManifest(buildCompiledManifest(manifest, chapter, variant)),
  };
}
