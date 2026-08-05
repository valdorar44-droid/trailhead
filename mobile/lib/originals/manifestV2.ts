import { OriginalManifestError, validateOriginalManifest } from './manifest';
import type {
  OriginalCompiledChapterManifestV2,
  OriginalChapterSelectionItemV2,
  OriginalChapterSelectionV2,
  OriginalChapterV2,
  OriginalBoundsV1,
  OriginalManifestV1,
  OriginalManifest,
  OriginalManifestPreview,
  OriginalManifestPreviewV1,
  OriginalManifestPreviewV2,
  OriginalManifestV2,
  OriginalRouteV1,
  OriginalRouteVariantV2,
  OriginalStoryV2,
  OriginalSessionV1,
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

function assertAllowedKeys(
  value: Record<string, unknown>,
  label: string,
  allowed: readonly string[],
) {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).filter(key => !allowedKeys.has(key));
  if (unknown.length) {
    throw new OriginalManifestError(`${label} contains unsupported fields: ${unknown.join(', ')}.`);
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
  assertAllowedKeys(bounds, label, ['north', 'south', 'east', 'west']);
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
  assertAllowedKeys(story, label, [
    'id', 'kind', 'title', 'transcript', 'audio_asset_id', 'audio_duration_s',
    'artwork_asset_id', 'citations',
  ]);
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
    assertAllowedKeys(citation, citationLabel, [
      'title', 'url', 'publisher', 'role', 'authority', 'reviewed_at',
      'rights_status', 'affected_claims', 'cultural_approval_record_id',
      'cultural_approval_record_sha256', 'cultural_approved_at',
      'cultural_pronunciation_bundle_sha256',
    ]);
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
    const approvalFields = [
      'cultural_approval_record_id',
      'cultural_approval_record_sha256',
      'cultural_approved_at',
    ] as const;
    const presentApprovalFields = approvalFields.filter(key => citation[key] != null);
    if (presentApprovalFields.length > 0 && presentApprovalFields.length !== approvalFields.length) {
      throw new OriginalManifestError(`${citationLabel} cultural approval evidence is incomplete.`);
    }
    if (presentApprovalFields.length) {
      assertStableId(
        citation.cultural_approval_record_id,
        `${citationLabel}.cultural_approval_record_id`,
      );
      assertText(
        citation.cultural_approval_record_sha256,
        `${citationLabel}.cultural_approval_record_sha256`,
      );
      if (!/^[a-f0-9]{64}$/i.test(citation.cultural_approval_record_sha256)) {
        throw new OriginalManifestError(
          `${citationLabel}.cultural_approval_record_sha256 must be a SHA-256 digest.`,
        );
      }
      assertReviewDate(citation.cultural_approved_at, `${citationLabel}.cultural_approved_at`);
      if (citation.cultural_pronunciation_bundle_sha256 != null) {
        assertText(
          citation.cultural_pronunciation_bundle_sha256,
          `${citationLabel}.cultural_pronunciation_bundle_sha256`,
        );
        if (!/^[a-f0-9]{64}$/i.test(citation.cultural_pronunciation_bundle_sha256)) {
          throw new OriginalManifestError(
            `${citationLabel}.cultural_pronunciation_bundle_sha256 must be a SHA-256 digest.`,
          );
        }
      }
    }
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
  assertAllowedKeys(variant, label, ['id', 'sequence', 'title', 'route', 'cue_refs']);
  assertStableId(variant.id, `${label}.id`);
  assertPositiveInteger(variant.sequence, `${label}.sequence`);
  assertText(variant.title, `${label}.title`);
  assertArray(variant.cue_refs, `${label}.cue_refs`);
  assertContiguousSequence(variant.cue_refs, `${label}.cue_refs`);
  const refIds = variant.cue_refs.map((reference, referenceIndex) => {
    assertRecord(reference, `${label}.cue_refs[${referenceIndex}]`);
    assertAllowedKeys(reference, `${label}.cue_refs[${referenceIndex}]`, [
      'story_id', 'sequence', 'coordinates', 'explore_place_id', 'trigger',
    ]);
    assertRecord(reference.coordinates, `${label}.cue_refs[${referenceIndex}].coordinates`);
    assertAllowedKeys(reference.coordinates, `${label}.cue_refs[${referenceIndex}].coordinates`, ['lat', 'lng']);
    assertRecord(reference.trigger, `${label}.cue_refs[${referenceIndex}].trigger`);
    assertAllowedKeys(reference.trigger, `${label}.cue_refs[${referenceIndex}].trigger`, [
      'enter_radius_m', 'exit_radius_m', 'lead_time_s', 'route_progress_start_m',
      'route_progress_end_m', 'approach_bearing_deg', 'bearing_tolerance_deg',
    ]);
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

function validateRoute(route: OriginalRouteV1, label: string) {
  assertRecord(route, label);
  assertAllowedKeys(route, label, [
    'profile', 'direction', 'geometry', 'bounds', 'distance_m', 'duration_s',
  ]);
  assertText(route.profile, `${label}.profile`);
  assertText(route.direction, `${label}.direction`);
  assertRecord(route.geometry, `${label}.geometry`);
  assertAllowedKeys(route.geometry, `${label}.geometry`, ['type', 'coordinates']);
  if (route.geometry.type !== 'LineString') {
    throw new OriginalManifestError(`${label}.geometry must be a LineString.`);
  }
  assertArray(route.geometry.coordinates, `${label}.geometry.coordinates`);
  route.geometry.coordinates.forEach((coordinate, coordinateIndex) => {
    if (!Array.isArray(coordinate) || coordinate.length !== 2) {
      throw new OriginalManifestError(`${label}.geometry.coordinates[${coordinateIndex}] is invalid.`);
    }
    assertFinite(coordinate[0], `${label}.geometry.coordinates[${coordinateIndex}][0]`, -180);
    assertFinite(coordinate[1], `${label}.geometry.coordinates[${coordinateIndex}][1]`, -90);
    if (Math.abs(coordinate[0]) > 180 || Math.abs(coordinate[1]) > 90) {
      throw new OriginalManifestError(`${label}.geometry.coordinates[${coordinateIndex}] is invalid.`);
    }
  });
  assertRecord(route.bounds, `${label}.bounds`);
  validateBounds(route.bounds, `${label}.bounds`);
  assertFinite(route.distance_m, `${label}.distance_m`, 1);
  assertFinite(route.duration_s, `${label}.duration_s`, 1);
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
  assertAllowedKeys(manifest, 'manifest', [
    'schema_version', 'manifest_id', 'pack_id', 'version', 'locale', 'title',
    'stories', 'chapters', 'assets', 'offline_map', 'review',
  ]);
  assertText(manifest.manifest_id, 'manifest_id');
  assertStableId(manifest.pack_id, 'pack_id');
  assertPositiveInteger(manifest.version, 'version');
  assertText(manifest.locale, 'locale');
  assertText(manifest.title, 'title');
  assertArray(manifest.assets, 'assets');
  manifest.assets.forEach((asset, assetIndex) => {
    const label = `assets[${assetIndex}]`;
    assertRecord(asset, label);
    assertAllowedKeys(asset, label, ['id', 'kind', 'path', 'mime_type', 'bytes', 'sha256']);
    assertStableId(asset.id, `${label}.id`);
    assertText(asset.kind, `${label}.kind`);
    assertText(asset.path, `${label}.path`);
    assertText(asset.mime_type, `${label}.mime_type`);
    assertFinite(asset.bytes, `${label}.bytes`, 1);
    assertText(asset.sha256, `${label}.sha256`);
    if (!/^[a-f0-9]{64}$/i.test(asset.sha256)) {
      throw new OriginalManifestError(`${label}.sha256 must be a SHA-256 digest.`);
    }
  });
  assertUnique(manifest.assets.map(asset => asset.id), 'Asset IDs');
  assertRecord(manifest.offline_map, 'offline_map');
  assertAllowedKeys(manifest.offline_map, 'offline_map', [
    'region_id', 'bounds', 'min_zoom', 'max_zoom', 'estimated_bytes',
  ]);
  assertText(manifest.offline_map.region_id, 'offline_map.region_id');
  assertRecord(manifest.offline_map.bounds, 'offline_map.bounds');
  validateBounds(manifest.offline_map.bounds, 'offline_map.bounds');
  assertFinite(manifest.offline_map.min_zoom, 'offline_map.min_zoom', 0);
  assertFinite(manifest.offline_map.max_zoom, 'offline_map.max_zoom', 0);
  assertFinite(manifest.offline_map.estimated_bytes, 'offline_map.estimated_bytes', 0);
  if (manifest.offline_map.max_zoom < manifest.offline_map.min_zoom) {
    throw new OriginalManifestError('offline_map.max_zoom must be at least min_zoom.');
  }
  assertRecord(manifest.review, 'review');
  assertAllowedKeys(manifest.review, 'review', [
    'editorial_status', 'field_drive_completed_at', 'source_review_completed_at',
  ]);
  assertText(manifest.review.editorial_status, 'review.editorial_status');
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
    assertAllowedKeys(chapter, label, [
      'id', 'sequence', 'title', 'summary', 'default_variant_id', 'safety',
      'access', 'season', 'operational_sources', 'operational_readiness',
      'validation_selection', 'variants',
    ]);
    assertPositiveInteger(chapter.sequence, `${label}.sequence`);
    assertText(chapter.title, `${label}.title`);
    assertText(chapter.summary, `${label}.summary`);
    assertStableId(chapter.default_variant_id, `${label}.default_variant_id`);
    assertRecord(chapter.safety, `${label}.safety`);
    assertAllowedKeys(chapter.safety, `${label}.safety`, [
      'summary', 'emergency_note', 'disclaimers',
    ]);
    assertText(chapter.safety.summary, `${label}.safety.summary`);
    assertText(chapter.safety.emergency_note, `${label}.safety.emergency_note`);
    if (!Array.isArray(chapter.safety.disclaimers)) {
      throw new OriginalManifestError(`${label}.safety.disclaimers must be an array.`);
    }
    chapter.safety.disclaimers.forEach((disclaimer, disclaimerIndex) => {
      assertText(disclaimer, `${label}.safety.disclaimers[${disclaimerIndex}]`);
    });
    assertRecord(chapter.access, `${label}.access`);
    assertAllowedKeys(chapter.access, `${label}.access`, [
      'surface', 'vehicle', 'fees', 'accessibility_notes',
    ]);
    assertText(chapter.access.surface, `${label}.access.surface`);
    assertText(chapter.access.vehicle, `${label}.access.vehicle`);
    assertText(chapter.access.fees, `${label}.access.fees`);
    assertText(chapter.access.accessibility_notes, `${label}.access.accessibility_notes`);
    assertRecord(chapter.season, `${label}.season`);
    assertAllowedKeys(chapter.season, `${label}.season`, ['recommended_months', 'closures_note']);
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
      assertAllowedKeys(source, sourceLabel, [
        'title', 'url', 'publisher', 'reviewed_at', 'role', 'authority', 'scope',
      ]);
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
    assertRecord(chapter.operational_readiness, `${label}.operational_readiness`);
    assertAllowedKeys(chapter.operational_readiness, `${label}.operational_readiness`, [
      'policy', 'candidate_id', 'candidate_sha256', 'source_scopes',
      'alternate_chapter_ids',
    ]);
    if (chapter.operational_readiness.policy !== 'required_before_start') {
      throw new OriginalManifestError(
        `${label}.operational_readiness.policy must be required_before_start.`,
      );
    }
    assertStableId(
      chapter.operational_readiness.candidate_id,
      `${label}.operational_readiness.candidate_id`,
    );
    if (!/^[a-f0-9]{64}$/.test(chapter.operational_readiness.candidate_sha256)) {
      throw new OriginalManifestError(
        `${label}.operational_readiness.candidate_sha256 must be a SHA-256 digest.`,
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
    assertRecord(chapter.validation_selection, `${label}.validation_selection`);
    assertAllowedKeys(chapter.validation_selection, `${label}.validation_selection`, [
      'selection_id', 'required_variant_ids',
    ]);
    assertStableId(
      chapter.validation_selection.selection_id,
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
      validateRoute(variant.route, `${label}.variants[${variantIndex}].route`);
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

function listSelectionsFromValidatedManifest(
  manifest: OriginalManifestV2,
): OriginalChapterSelectionItemV2[] {
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

function compileSelectionFromValidatedManifest(
  manifest: OriginalManifestV2,
  selection: OriginalChapterSelectionV2,
): OriginalCompiledChapterManifestV2 {
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

export function listOriginalChapterSelections(
  input: unknown,
): OriginalChapterSelectionItemV2[] {
  return listSelectionsFromValidatedManifest(validateOriginalManifestV2(input));
}

/** Validate the union once, then compile every selectable route for detail hydration. */
export function compileOriginalManifestV2Selections(input: unknown) {
  const manifest = validateOriginalManifestV2(input);
  return listSelectionsFromValidatedManifest(manifest).map(selection => ({
    selection,
    compiled: compileSelectionFromValidatedManifest(manifest, {
      chapter_id: selection.chapter_id,
      variant_id: selection.variant_id,
    }),
  }));
}

export function compileOriginalManifestV2(
  input: unknown,
  selection: OriginalChapterSelectionV2,
): OriginalCompiledChapterManifestV2 {
  const manifest = validateOriginalManifestV2(input);
  return compileSelectionFromValidatedManifest(manifest, selection);
}

export function validateOriginalConsumerManifest(input: unknown): OriginalManifest {
  const schemaVersion = input && typeof input === 'object'
    ? Number((input as { schema_version?: unknown }).schema_version)
    : 0;
  if (schemaVersion === 1) return validateOriginalManifest(input);
  if (schemaVersion === 2) return validateOriginalManifestV2(input);
  throw new OriginalManifestError('Unsupported Originals manifest schema.');
}

function validatePreviewIdentity(input: Record<string, unknown>) {
  assertText(input.manifest_id, 'manifest_preview.manifest_id');
  assertStableId(input.pack_id, 'manifest_preview.pack_id');
  assertPositiveInteger(input.version, 'manifest_preview.version');
  assertText(input.locale, 'manifest_preview.locale');
  assertText(input.title, 'manifest_preview.title');
}

/** Validate the deliberately redacted public detail preview for either schema. */
export function validateOriginalManifestPreview(input: unknown): OriginalManifestPreview {
  assertRecord(input, 'manifest_preview');
  validatePreviewIdentity(input);
  if (input.schema_version === 1) {
    const preview = input as unknown as OriginalManifestPreviewV1;
    assertRecord(preview.route, 'manifest_preview.route');
    assertRecord(preview.route.geometry, 'manifest_preview.route.geometry');
    if (preview.route.geometry.type !== 'LineString') {
      throw new OriginalManifestError('manifest_preview.route.geometry must be a LineString.');
    }
    assertArray(preview.route.geometry.coordinates, 'manifest_preview.route.geometry.coordinates');
    assertFinite(preview.route.distance_m, 'manifest_preview.route.distance_m', 1);
    assertFinite(preview.route.duration_s, 'manifest_preview.route.duration_s', 1);
    assertArray(preview.stops, 'manifest_preview.stops');
    preview.stops.forEach((stop, index) => {
      assertRecord(stop, `manifest_preview.stops[${index}]`);
      assertStableId(stop.id, `manifest_preview.stops[${index}].id`);
      assertPositiveInteger(stop.sequence, `manifest_preview.stops[${index}].sequence`);
      assertText(stop.title, `manifest_preview.stops[${index}].title`);
      assertRecord(stop.coordinates, `manifest_preview.stops[${index}].coordinates`);
      assertFinite(stop.coordinates.lat, `manifest_preview.stops[${index}].coordinates.lat`, -90);
      assertFinite(stop.coordinates.lng, `manifest_preview.stops[${index}].coordinates.lng`, -180);
    });
    assertRecord(preview.safety, 'manifest_preview.safety');
    assertRecord(preview.access, 'manifest_preview.access');
    assertRecord(preview.season, 'manifest_preview.season');
    return preview;
  }
  if (input.schema_version !== 2) {
    throw new OriginalManifestError('Unsupported Originals manifest preview schema.');
  }
  assertAllowedKeys(input, 'manifest_preview', [
    'schema_version', 'manifest_id', 'pack_id', 'version', 'locale', 'title',
    'chapters', 'offline_map',
  ]);
  const preview = input as unknown as OriginalManifestPreviewV2;
  if (preview.offline_map != null) {
    assertRecord(preview.offline_map, 'manifest_preview.offline_map');
    assertAllowedKeys(preview.offline_map, 'manifest_preview.offline_map', [
      'region_id', 'bounds', 'min_zoom', 'max_zoom', 'estimated_bytes',
    ]);
    if (preview.offline_map.bounds != null) {
      assertRecord(preview.offline_map.bounds, 'manifest_preview.offline_map.bounds');
      validateBounds(preview.offline_map.bounds, 'manifest_preview.offline_map.bounds');
    }
  }
  assertArray(preview.chapters, 'manifest_preview.chapters');
  assertContiguousSequence(preview.chapters, 'manifest_preview.chapters');
  const chapterIds: string[] = [];
  preview.chapters.forEach((chapter, chapterIndex) => {
    const label = `manifest_preview.chapters[${chapterIndex}]`;
    assertRecord(chapter, label);
    assertAllowedKeys(chapter, label, [
      'id', 'sequence', 'title', 'summary', 'default_variant_id', 'variants',
    ]);
    assertStableId(chapter.id, `${label}.id`);
    chapterIds.push(chapter.id);
    assertText(chapter.title, `${label}.title`);
    assertText(chapter.summary, `${label}.summary`);
    assertStableId(chapter.default_variant_id, `${label}.default_variant_id`);
    assertArray(chapter.variants, `${label}.variants`);
    assertContiguousSequence(chapter.variants, `${label}.variants`);
    const variantIds: string[] = [];
    chapter.variants.forEach((variant, variantIndex) => {
      const variantLabel = `${label}.variants[${variantIndex}]`;
      assertRecord(variant, variantLabel);
      assertAllowedKeys(variant, variantLabel, [
        'id', 'sequence', 'title', 'direction', 'distance_m', 'duration_s',
        'story_count', 'cue_count',
      ]);
      assertStableId(variant.id, `${variantLabel}.id`);
      variantIds.push(variant.id);
      assertText(variant.title, `${variantLabel}.title`);
      assertText(variant.direction, `${variantLabel}.direction`);
      assertFinite(variant.distance_m, `${variantLabel}.distance_m`, 1);
      assertFinite(variant.duration_s, `${variantLabel}.duration_s`, 1);
      if (!Number.isInteger(variant.story_count) || variant.story_count < 0) {
        throw new OriginalManifestError(`${variantLabel}.story_count must be a non-negative integer.`);
      }
      if (!Number.isInteger(variant.cue_count) || variant.cue_count < 0) {
        throw new OriginalManifestError(`${variantLabel}.cue_count must be a non-negative integer.`);
      }
    });
    assertUnique(variantIds, `${label} variant IDs`);
    if (!variantIds.includes(chapter.default_variant_id)) {
      throw new OriginalManifestError(`${label}.default_variant_id does not reference a variant.`);
    }
  });
  assertUnique(chapterIds, 'manifest_preview chapter IDs');
  return preview;
}

export function resolveOriginalManifestForPlayback(
  input: unknown,
  selection?: OriginalChapterSelectionV2,
) {
  const manifest = validateOriginalConsumerManifest(input);
  if (manifest.schema_version === 1) {
    if (selection) {
      throw new OriginalManifestError('A chapter selection cannot be used with a V1 Original.');
    }
    return { source_schema_version: 1 as const, manifest, selection: undefined };
  }
  if (!selection?.chapter_id || !selection.variant_id) {
    throw new OriginalManifestError('Choose a chapter and direction before starting this Original.');
  }
  const compiled = compileOriginalManifestV2(manifest, selection);
  return {
    source_schema_version: 2 as const,
    manifest: compiled.manifest,
    selection: {
      schema_version: 1 as const,
      ...compiled.selection,
    },
  };
}

export function resolveOriginalManifestForSession(
  input: unknown,
  session: Pick<OriginalSessionV1, 'chapter_selection'>,
) {
  const manifest = validateOriginalConsumerManifest(input);
  if (manifest.schema_version === 1) {
    if (session.chapter_selection) {
      throw new OriginalManifestError('The saved chapter does not match this V1 Original.');
    }
    return manifest;
  }
  const selection = session.chapter_selection;
  if (!selection) {
    throw new OriginalManifestError('The saved Original is missing its chapter selection.');
  }
  const compiled = compileOriginalManifestV2(manifest, {
    chapter_id: selection.chapter_id,
    variant_id: selection.variant_id,
  });
  if (compiled.selection.validation_selection_id !== selection.validation_selection_id) {
    throw new OriginalManifestError('The saved chapter validation identity no longer matches this Original.');
  }
  return compiled.manifest;
}
