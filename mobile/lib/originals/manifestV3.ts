import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import {
  ORIGINALS_LONG_FORM_CAPABILITIES,
  ORIGINALS_LONG_FORM_CONTRACT_ID,
} from './clientCapabilities';
import { OriginalManifestError, validateOriginalManifest } from './manifest';
import {
  compileOriginalManifestV2,
  listOriginalChapterSelections,
  validateOriginalManifestV2,
} from './manifestV2';
import type {
  OriginalChapterSelectionItemV2,
  OriginalChapterSelectionV2,
  OriginalCompiledChapterManifestV3,
  OriginalManifestV2,
  OriginalManifestV3,
  OriginalRouteVariantV3,
  OriginalSelectablePlaybackItemV1,
  OriginalSelectableReferenceV3,
  OriginalStoryV2,
  OriginalTriggerV1,
} from './types';

const SHA256_RE = /^[a-f0-9]{64}$/;
const STABLE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,239}$/i;
const MAX_DELIVERY_REFERENCES = 250;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;

type JsonRecord = Record<string, unknown>;
type CanonicalFloat = { readonly __trailhead_canonical_float__: number };

function compareDeliveryReferences(
  left: { sequence: number; story_id: string },
  right: { sequence: number; story_id: string },
) {
  if (left.sequence !== right.sequence) return left.sequence - right.sequence;
  // Python canonicalization uses Unicode code-point ordering, not locale collation.
  return left.story_id < right.story_id ? -1 : left.story_id > right.story_id ? 1 : 0;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertRecord(value: unknown, label: string): asserts value is JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OriginalManifestError(`${label} must be an object.`);
  }
}

function assertAllowedKeys(value: JsonRecord, label: string, allowed: readonly string[]) {
  const accepted = new Set(allowed);
  const unsupported = Object.keys(value).filter(key => !accepted.has(key)).sort();
  if (unsupported.length) {
    throw new OriginalManifestError(
      `${label} contains unsupported fields: ${unsupported.join(', ')}.`,
    );
  }
}

function stableId(value: unknown, label: string): string {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (!STABLE_ID_RE.test(clean)) {
    throw new OriginalManifestError(`${label} must be a stable identifier.`);
  }
  return clean;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new OriginalManifestError(`${label} must be a positive integer.`);
  }
  return Number(value);
}

function finiteNumber(
  value: unknown,
  label: string,
  minimum?: number,
  maximum?: number,
): number {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || (minimum != null && value < minimum)
    || (maximum != null && value > maximum)
  ) {
    throw new OriginalManifestError(`${label} must be a valid number.`);
  }
  return value;
}

function exactBoolean(value: unknown, expected: boolean, label: string): boolean {
  if (value !== expected) {
    throw new OriginalManifestError(`${label} must be ${String(expected)}.`);
  }
  return expected;
}

function normalizeCoordinates(value: unknown, label: string) {
  assertRecord(value, label);
  assertAllowedKeys(value, label, ['lat', 'lng']);
  return {
    lat: finiteNumber(value.lat, `${label}.lat`, -90, 90),
    lng: finiteNumber(value.lng, `${label}.lng`, -180, 180),
  };
}

function normalizeTrigger(value: unknown, label: string): OriginalTriggerV1 {
  assertRecord(value, label);
  assertAllowedKeys(value, label, [
    'enter_radius_m', 'exit_radius_m', 'lead_time_s',
    'route_progress_start_m', 'route_progress_end_m',
    'approach_bearing_deg', 'bearing_tolerance_deg',
  ]);
  const enterRadius = finiteNumber(value.enter_radius_m, `${label}.enter_radius_m`, 50, 1_000);
  const exitRadius = finiteNumber(value.exit_radius_m, `${label}.exit_radius_m`, enterRadius);
  if (exitRadius < Math.max(enterRadius * 1.5, enterRadius + 50)) {
    throw new OriginalManifestError(`${label}.exit_radius_m must provide route hysteresis.`);
  }
  const routeStart = finiteNumber(value.route_progress_start_m, `${label}.route_progress_start_m`, 0);
  const routeEnd = finiteNumber(
    value.route_progress_end_m,
    `${label}.route_progress_end_m`,
    routeStart,
  );
  const result: OriginalTriggerV1 = {
    enter_radius_m: enterRadius,
    exit_radius_m: exitRadius,
    lead_time_s: finiteNumber(value.lead_time_s ?? 0, `${label}.lead_time_s`, 0, 120),
    route_progress_start_m: routeStart,
    route_progress_end_m: routeEnd,
  };
  if (value.approach_bearing_deg != null) {
    result.approach_bearing_deg = finiteNumber(
      value.approach_bearing_deg,
      `${label}.approach_bearing_deg`,
      0,
      359.999999,
    );
    result.bearing_tolerance_deg = finiteNumber(
      value.bearing_tolerance_deg ?? 45,
      `${label}.bearing_tolerance_deg`,
      1,
      180,
    );
  } else if (value.bearing_tolerance_deg != null) {
    throw new OriginalManifestError(
      `${label}.bearing_tolerance_deg requires approach_bearing_deg.`,
    );
  }
  return result;
}

function normalizeHardReference(value: unknown, label: string) {
  assertRecord(value, label);
  assertAllowedKeys(value, label, [
    'story_id', 'sequence', 'coordinates', 'explore_place_id', 'trigger',
  ]);
  const result = {
    story_id: stableId(value.story_id, `${label}.story_id`),
    sequence: positiveInteger(value.sequence, `${label}.sequence`),
    coordinates: normalizeCoordinates(value.coordinates, `${label}.coordinates`),
    trigger: normalizeTrigger(value.trigger, `${label}.trigger`),
  } as {
    story_id: string;
    sequence: number;
    coordinates: { lat: number; lng: number };
    explore_place_id?: string;
    trigger: OriginalTriggerV1;
  };
  if (value.explore_place_id != null) {
    result.explore_place_id = stableId(value.explore_place_id, `${label}.explore_place_id`);
  }
  return result;
}

function normalizeSelectableReference(value: unknown, label: string): OriginalSelectableReferenceV3 {
  assertRecord(value, label);
  assertAllowedKeys(value, label, [
    'story_id', 'sequence', 'coordinates', 'explore_place_id', 'trigger', 'delivery',
  ]);
  const common = {
    story_id: stableId(value.story_id, `${label}.story_id`),
    sequence: positiveInteger(value.sequence, `${label}.sequence`),
    ...(value.coordinates != null
      ? { coordinates: normalizeCoordinates(value.coordinates, `${label}.coordinates`) }
      : {}),
    ...(value.explore_place_id != null
      ? { explore_place_id: stableId(value.explore_place_id, `${label}.explore_place_id`) }
      : {}),
  };
  assertRecord(value.delivery, `${label}.delivery`);
  const delivery = value.delivery;
  if (delivery.mode === 'capacity_deeper') {
    assertAllowedKeys(delivery, `${label}.delivery`, [
      'mode', 'admission_policy_id', 'next_hard_auto_story_id',
      'guard_before_next_hard_auto_window_s', 'fallback_mode',
      'may_queue_behind_capacity', 'may_wait_for_active_hard_auto',
    ]);
    if (!('coordinates' in common) || value.trigger == null) {
      throw new OriginalManifestError(
        `${label} capacity delivery requires coordinates and a trigger.`,
      );
    }
    if (delivery.admission_policy_id !== 'capacity_before_next_hard_v1') {
      throw new OriginalManifestError(`${label}.delivery admission policy is unsupported.`);
    }
    if (delivery.fallback_mode !== 'completion_deeper') {
      throw new OriginalManifestError(`${label}.delivery fallback must be completion_deeper.`);
    }
    if (delivery.guard_before_next_hard_auto_window_s !== 30) {
      throw new OriginalManifestError(`${label}.delivery capacity guard must be 30 seconds.`);
    }
    return {
      ...common,
      coordinates: normalizeCoordinates(value.coordinates, `${label}.coordinates`),
      trigger: normalizeTrigger(value.trigger, `${label}.trigger`),
      delivery: {
        mode: 'capacity_deeper',
        admission_policy_id: 'capacity_before_next_hard_v1',
        next_hard_auto_story_id: stableId(
          delivery.next_hard_auto_story_id,
          `${label}.delivery.next_hard_auto_story_id`,
        ),
        guard_before_next_hard_auto_window_s: 30,
        fallback_mode: 'completion_deeper',
        may_queue_behind_capacity: exactBoolean(
          delivery.may_queue_behind_capacity,
          false,
          `${label}.delivery.may_queue_behind_capacity`,
        ) as false,
        may_wait_for_active_hard_auto: exactBoolean(
          delivery.may_wait_for_active_hard_auto,
          true,
          `${label}.delivery.may_wait_for_active_hard_auto`,
        ) as true,
      },
    };
  }
  if (delivery.mode === 'stopped_deeper') {
    assertAllowedKeys(delivery, `${label}.delivery`, [
      'mode', 'availability', 'experience_group_id',
      'requires_user_confirmed_parked', 'motion_inference_allowed',
      'parking_availability', 'parking_promise', 'availability_radius_m',
    ]);
    if (value.trigger != null) {
      throw new OriginalManifestError(`${label} stopped delivery cannot have a trigger.`);
    }
    if (
      delivery.availability !== 'before_route_user_confirmed_parked'
      && delivery.availability !== 'at_landmark_user_confirmed_parked'
    ) {
      throw new OriginalManifestError(`${label}.delivery stopped availability is unsupported.`);
    }
    let availabilityRadius: number | undefined;
    if (delivery.availability === 'at_landmark_user_confirmed_parked') {
      if (!('coordinates' in common)) {
        throw new OriginalManifestError(
          `${label} landmark stopped delivery requires coordinates.`,
        );
      }
      availabilityRadius = finiteNumber(
        delivery.availability_radius_m,
        `${label}.delivery.availability_radius_m`,
        50,
        1_000,
      );
    } else if (delivery.availability_radius_m != null) {
      throw new OriginalManifestError(
        `${label} before-route stopped delivery cannot have an availability radius.`,
      );
    }
    if (delivery.parking_availability !== 'not_checked') {
      throw new OriginalManifestError(
        `${label}.delivery parking availability must be not_checked.`,
      );
    }
    return {
      ...common,
      delivery: {
        mode: 'stopped_deeper',
        availability: delivery.availability,
        ...(delivery.experience_group_id != null
          ? {
            experience_group_id: stableId(
              delivery.experience_group_id,
              `${label}.delivery.experience_group_id`,
            ),
          }
          : {}),
        requires_user_confirmed_parked: exactBoolean(
          delivery.requires_user_confirmed_parked,
          true,
          `${label}.delivery.requires_user_confirmed_parked`,
        ) as true,
        motion_inference_allowed: exactBoolean(
          delivery.motion_inference_allowed,
          false,
          `${label}.delivery.motion_inference_allowed`,
        ) as false,
        parking_availability: 'not_checked',
        parking_promise: exactBoolean(
          delivery.parking_promise,
          false,
          `${label}.delivery.parking_promise`,
        ) as false,
        ...(availabilityRadius != null ? { availability_radius_m: availabilityRadius } : {}),
      },
    };
  }
  if (delivery.mode === 'completion_deeper') {
    assertAllowedKeys(delivery, `${label}.delivery`, [
      'mode', 'availability', 'requires_route_completion',
    ]);
    if (value.trigger != null) {
      throw new OriginalManifestError(`${label} completion delivery cannot have a trigger.`);
    }
    if (delivery.availability !== 'after_route_completion') {
      throw new OriginalManifestError(`${label}.delivery completion availability is unsupported.`);
    }
    return {
      ...common,
      delivery: {
        mode: 'completion_deeper',
        availability: 'after_route_completion',
        requires_route_completion: exactBoolean(
          delivery.requires_route_completion,
          true,
          `${label}.delivery.requires_route_completion`,
        ) as true,
      },
    };
  }
  throw new OriginalManifestError(`${label}.delivery mode is unsupported.`);
}

function canonicalFloat(value: number): CanonicalFloat {
  return { __trailhead_canonical_float__: value };
}

function isCanonicalFloat(value: unknown): value is CanonicalFloat {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === 1
    && typeof (value as CanonicalFloat).__trailhead_canonical_float__ === 'number',
  );
}

/** Match Python's JSON float spelling for the bounded manifest number ranges. */
function pythonFloatJson(value: number): string {
  if (!Number.isFinite(value)) {
    throw new OriginalManifestError('Delivery contract values must be finite.');
  }
  if (Object.is(value, -0)) return '-0.0';
  const absolute = Math.abs(value);
  if (absolute !== 0 && (absolute < 0.0001 || absolute >= 1e16)) {
    const [coefficient, rawExponent] = value.toExponential().split('e');
    const exponent = Number(rawExponent);
    const sign = exponent >= 0 ? '+' : '-';
    return `${coefficient}e${sign}${Math.abs(exponent).toString().padStart(2, '0')}`;
  }
  if (Number.isInteger(value)) return `${value.toString()}.0`;
  return value.toString();
}

function canonicalPythonJson(value: unknown): string {
  if (isCanonicalFloat(value)) {
    return pythonFloatJson(value.__trailhead_canonical_float__);
  }
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new OriginalManifestError('Delivery contract values must be finite.');
    }
    return Number.isInteger(value) ? value.toString() : value.toString();
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalPythonJson).join(',')}]`;
  }
  assertRecord(value, 'Delivery contract canonical value');
  return `{${Object.keys(value).sort().map(key => (
    `${JSON.stringify(key)}:${canonicalPythonJson(value[key])}`
  )).join(',')}}`;
}

function canonicalCoordinates(coordinates: { lat: number; lng: number }) {
  return {
    lat: canonicalFloat(coordinates.lat),
    lng: canonicalFloat(coordinates.lng),
  };
}

function canonicalTrigger(trigger: OriginalTriggerV1) {
  return {
    enter_radius_m: canonicalFloat(trigger.enter_radius_m),
    exit_radius_m: canonicalFloat(trigger.exit_radius_m),
    lead_time_s: canonicalFloat(trigger.lead_time_s),
    route_progress_start_m: canonicalFloat(trigger.route_progress_start_m),
    route_progress_end_m: canonicalFloat(trigger.route_progress_end_m),
    ...(trigger.approach_bearing_deg != null
      ? { approach_bearing_deg: canonicalFloat(trigger.approach_bearing_deg) }
      : {}),
    ...(trigger.bearing_tolerance_deg != null
      ? { bearing_tolerance_deg: canonicalFloat(trigger.bearing_tolerance_deg) }
      : {}),
  };
}

function canonicalReference(
  reference: ReturnType<typeof normalizeHardReference> | OriginalSelectableReferenceV3,
) {
  const result: JsonRecord = {
    story_id: reference.story_id,
    sequence: reference.sequence,
  };
  if ('coordinates' in reference && reference.coordinates != null) {
    result.coordinates = canonicalCoordinates(reference.coordinates);
  }
  if (reference.explore_place_id != null) {
    result.explore_place_id = reference.explore_place_id;
  }
  if ('trigger' in reference && reference.trigger != null) {
    result.trigger = canonicalTrigger(reference.trigger);
  }
  if ('delivery' in reference) {
    const delivery = clone(reference.delivery) as JsonRecord;
    if (typeof delivery.availability_radius_m === 'number') {
      delivery.availability_radius_m = canonicalFloat(delivery.availability_radius_m);
    }
    result.delivery = delivery;
  }
  return result;
}

function selectedStory(
  story: OriginalStoryV2,
  chapterId: string,
  variantId: string,
): OriginalStoryV2 {
  const override = story.variant_overrides?.find(
    candidate => candidate.chapter_id === chapterId && candidate.variant_id === variantId,
  );
  return override
    ? {
      ...story,
      title: override.title ?? story.title,
      transcript: override.transcript,
      audio_asset_id: override.audio_asset_id,
      audio_duration_s: override.audio_duration_s,
    }
    : story;
}

function routeGeometrySha256(route: OriginalRouteVariantV3['route']) {
  const coordinates = route?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    throw new OriginalManifestError('Delivery contract route geometry is required.');
  }
  const canonical = coordinates.map((point, index) => {
    if (!Array.isArray(point) || point.length !== 2) {
      throw new OriginalManifestError(`Delivery contract route coordinate ${index} is invalid.`);
    }
    const lng = finiteNumber(point[0], `Delivery contract route coordinate ${index} longitude`);
    const lat = finiteNumber(point[1], `Delivery contract route coordinate ${index} latitude`);
    return `${lng.toFixed(7)},${lat.toFixed(7)}`;
  }).join(';');
  return bytesToHex(sha256(utf8ToBytes(canonical)));
}

/** Canonical cross-platform hash of scheduling and effective narration identity. */
export function originalManifestV3DeliveryContractSha256(
  manifest: OriginalManifestV3,
  selection: Required<OriginalChapterSelectionV2>,
): string {
  const chapter = manifest.chapters?.find(item => item.id === selection.chapter_id);
  if (!chapter) {
    throw new OriginalManifestError('Original V3 delivery hash chapter was not found.');
  }
  const variant = chapter.variants?.find(item => item.id === selection.variant_id);
  if (!variant) {
    throw new OriginalManifestError('Original V3 delivery hash variant was not found.');
  }
  const stories = new Map((manifest.stories ?? []).map(story => [story.id, story]));
  const hard = (variant.cue_refs ?? []).map((reference, index) => (
    normalizeHardReference(reference, `delivery_hash.cue_refs[${index}]`)
  ));
  const selectable = (variant.selectable_refs ?? []).map((reference, index) => (
    normalizeSelectableReference(reference, `delivery_hash.selectable_refs[${index}]`)
  ));
  const references = [...hard, ...selectable]
    .sort(compareDeliveryReferences);
  const effectiveNarration = references.map(reference => {
    const shared = stories.get(reference.story_id);
    if (!shared) {
      throw new OriginalManifestError('Original V3 delivery hash references an unknown story.');
    }
    const story = selectedStory(shared, chapter.id, variant.id);
    return {
      id: story.id,
      kind: story.kind,
      audio_asset_id: story.audio_asset_id,
      audio_duration_s: canonicalFloat(finiteNumber(
        story.audio_duration_s,
        `Delivery contract story ${story.id} audio_duration_s`,
      )),
    };
  });
  const payload = {
    schema_version: 1,
    contract_id: ORIGINALS_LONG_FORM_CONTRACT_ID,
    chapter_id: chapter.id,
    variant_id: variant.id,
    route_geometry_sha256: routeGeometrySha256(variant.route),
    cue_refs: [...hard]
      .sort(compareDeliveryReferences)
      .map(canonicalReference),
    selectable_refs: [...selectable]
      .sort(compareDeliveryReferences)
      .map(canonicalReference),
    effective_narration: effectiveNarration,
  };
  return bytesToHex(sha256(utf8ToBytes(canonicalPythonJson(payload))));
}

function projectionReference(
  reference: ReturnType<typeof normalizeHardReference> | OriginalSelectableReferenceV3,
  variant: OriginalRouteVariantV3,
) {
  const first = variant.route.geometry.coordinates[0];
  const coordinates = 'coordinates' in reference && reference.coordinates
    ? clone(reference.coordinates)
    : { lat: Number(first[1]), lng: Number(first[0]) };
  const trigger = 'trigger' in reference && reference.trigger
    ? clone(reference.trigger)
    : {
      enter_radius_m: 100,
      exit_radius_m: 200,
      lead_time_s: 0,
      route_progress_start_m: 0,
      route_progress_end_m: Math.min(variant.route.distance_m, 100),
    };
  return {
    story_id: reference.story_id,
    sequence: reference.sequence,
    coordinates,
    ...(reference.explore_place_id != null
      ? { explore_place_id: reference.explore_place_id }
      : {}),
    trigger,
  };
}

function projectValidatedManifestToV2(manifest: OriginalManifestV3): OriginalManifestV2 {
  const projection = clone(manifest) as unknown as OriginalManifestV2 & JsonRecord;
  projection.schema_version = 2;
  delete projection.consumer_contract;
  projection.chapters.forEach((chapter, chapterIndex) => {
    const sourceChapter = manifest.chapters[chapterIndex];
    chapter.variants.forEach((variant, variantIndex) => {
      const sourceVariant = sourceChapter.variants[variantIndex];
      const combined = [...sourceVariant.cue_refs, ...sourceVariant.selectable_refs]
        .sort(compareDeliveryReferences);
      variant.cue_refs = combined.map((reference, index) => ({
        ...projectionReference(reference, sourceVariant),
        sequence: index + 1,
      }));
      delete (variant as unknown as JsonRecord).selectable_refs;
      delete (variant as unknown as JsonRecord).delivery_contract_sha256;
    });
  });
  return projection;
}

export function validateOriginalConsumerContractV1(value: unknown) {
  assertRecord(value, 'consumer_contract');
  assertAllowedKeys(value, 'consumer_contract', [
    'schema_version', 'contract_id', 'required_capabilities',
  ]);
  if (value.schema_version !== 1 || value.contract_id !== ORIGINALS_LONG_FORM_CONTRACT_ID) {
    throw new OriginalManifestError('Original V3 consumer contract is unsupported.');
  }
  if (
    !Array.isArray(value.required_capabilities)
    || value.required_capabilities.length !== ORIGINALS_LONG_FORM_CAPABILITIES.length
    || value.required_capabilities.some(
      (capability, index) => capability !== ORIGINALS_LONG_FORM_CAPABILITIES[index],
    )
  ) {
    throw new OriginalManifestError(
      'Original V3 required capabilities must match the canonical sorted capability set.',
    );
  }
  return {
    schema_version: 1 as const,
    contract_id: ORIGINALS_LONG_FORM_CONTRACT_ID,
    required_capabilities: [...ORIGINALS_LONG_FORM_CAPABILITIES] as [
      'originals_capacity_scheduler_v1',
      'originals_manifest_v3',
      'originals_selectable_v1',
    ],
  };
}

export function validateOriginalManifestV3(input: unknown): OriginalManifestV3 {
  assertRecord(input, 'manifest');
  assertAllowedKeys(input, 'manifest', [
    'schema_version', 'manifest_id', 'pack_id', 'version', 'locale', 'title',
    'stories', 'chapters', 'assets', 'offline_map', 'review', 'consumer_contract',
  ]);
  if (input.schema_version !== 3) {
    throw new OriginalManifestError('Unsupported Originals V3 manifest schema.');
  }
  const normalized = clone(input) as unknown as OriginalManifestV3;
  normalized.consumer_contract = validateOriginalConsumerContractV1(input.consumer_contract);
  if (!Array.isArray(normalized.stories) || normalized.stories.length === 0) {
    throw new OriginalManifestError('stories must contain at least one item.');
  }
  if (!Array.isArray(normalized.chapters) || normalized.chapters.length === 0) {
    throw new OriginalManifestError('chapters must contain at least one item.');
  }
  const storyIds = new Set(normalized.stories.map(story => String(story?.id ?? '').trim()));
  const referencedStoryIds = new Set<string>();
  normalized.chapters.forEach((chapter, chapterIndex) => {
    assertRecord(chapter, `chapters[${chapterIndex}]`);
    if (!Array.isArray(chapter.variants) || chapter.variants.length === 0) {
      throw new OriginalManifestError(`chapters[${chapterIndex}].variants must contain at least one item.`);
    }
    chapter.variants.forEach((variant, variantIndex) => {
      const label = `chapters[${chapterIndex}].variants[${variantIndex}]`;
      assertRecord(variant, label);
      assertAllowedKeys(variant, label, [
        'id', 'sequence', 'title', 'route', 'cue_refs', 'selectable_refs',
        'delivery_contract_sha256',
      ]);
      if (!Array.isArray(variant.cue_refs) || variant.cue_refs.length === 0) {
        throw new OriginalManifestError(`${label}.cue_refs requires at least one hard cue.`);
      }
      if (!Array.isArray(variant.selectable_refs)) {
        throw new OriginalManifestError(`${label}.selectable_refs must be an array.`);
      }
      variant.cue_refs = variant.cue_refs.map((reference, referenceIndex) => (
        normalizeHardReference(reference, `${label}.cue_refs[${referenceIndex}]`)
      ));
      variant.selectable_refs = variant.selectable_refs.map((reference, referenceIndex) => (
        normalizeSelectableReference(reference, `${label}.selectable_refs[${referenceIndex}]`)
      ));
      const combined = [...variant.cue_refs, ...variant.selectable_refs]
        .sort(compareDeliveryReferences);
      if (combined.length > MAX_DELIVERY_REFERENCES) {
        throw new OriginalManifestError(`${label} has more than 250 delivery references.`);
      }
      combined.forEach((reference, index) => {
        if (reference.sequence !== index + 1) {
          throw new OriginalManifestError(
            `${label} delivery sequence must be contiguous starting at 1.`,
          );
        }
      });
      const referenceIds = combined.map(reference => reference.story_id);
      if (new Set(referenceIds).size !== referenceIds.length) {
        throw new OriginalManifestError(
          `${label} stories must occur exactly once across cue_refs and selectable_refs.`,
        );
      }
      const unknown = referenceIds.filter(storyId => !storyIds.has(storyId));
      if (unknown.length) {
        throw new OriginalManifestError(
          `${label} references unknown stories: ${[...new Set(unknown)].sort().join(', ')}.`,
        );
      }
      referenceIds.forEach(storyId => referencedStoryIds.add(storyId));
      const hardById = new Map(variant.cue_refs.map(reference => [reference.story_id, reference]));
      variant.selectable_refs.forEach(reference => {
        if (reference.delivery.mode !== 'capacity_deeper') return;
        if (!('trigger' in reference)) {
          throw new OriginalManifestError(
            `${label} capacity story ${reference.story_id} is missing its trigger.`,
          );
        }
        const nextHard = hardById.get(reference.delivery.next_hard_auto_story_id);
        if (!nextHard) {
          throw new OriginalManifestError(
            `${label} capacity story ${reference.story_id} must name a hard cue in its variant.`,
          );
        }
        if (
          nextHard.sequence <= reference.sequence
          || reference.trigger.route_progress_start_m >= nextHard.trigger.route_progress_start_m
        ) {
          throw new OriginalManifestError(
            `${label} capacity story ${reference.story_id} must precede its next hard cue.`,
          );
        }
      });
      const suppliedHash = String(variant.delivery_contract_sha256 ?? '').trim().toLowerCase();
      if (!SHA256_RE.test(suppliedHash)) {
        throw new OriginalManifestError(`${label}.delivery_contract_sha256 is invalid.`);
      }
      variant.delivery_contract_sha256 = suppliedHash;
    });
  });

  // Reuse the established V2 contract for every shared field and for a
  // synthetic all-content projection. This projection is validation-only;
  // it is never handed to the V1 trigger runtime.
  validateOriginalManifestV2(projectValidatedManifestToV2(normalized));
  const missing = [...storyIds].filter(storyId => !referencedStoryIds.has(storyId)).sort();
  if (missing.length) {
    throw new OriginalManifestError(
      `Every shared story must be referenced; missing: ${missing.join(', ')}.`,
    );
  }
  normalized.chapters.forEach(chapter => {
    chapter.variants.forEach(variant => {
      const expected = originalManifestV3DeliveryContractSha256(normalized, {
        chapter_id: chapter.id,
        variant_id: variant.id,
      });
      if (variant.delivery_contract_sha256 !== expected) {
        throw new OriginalManifestError(
          `Original V3 variant ${variant.id} delivery contract hash does not match its canonical content.`,
        );
      }
    });
  });
  if (utf8ToBytes(JSON.stringify(normalized)).byteLength > MAX_MANIFEST_BYTES) {
    throw new OriginalManifestError('Original V3 manifest exceeds the size limit.');
  }
  return normalized;
}

function resolveSelection(
  manifest: OriginalManifestV3,
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

function selectableItem(
  reference: OriginalSelectableReferenceV3,
  story: OriginalStoryV2,
  chapterId: string,
  variantId: string,
): OriginalSelectablePlaybackItemV1 {
  const resolved = selectedStory(story, chapterId, variantId);
  return {
    id: resolved.id,
    kind: resolved.kind,
    sequence: reference.sequence,
    title: resolved.title,
    transcript: resolved.transcript,
    audio_asset_id: resolved.audio_asset_id,
    audio_duration_s: resolved.audio_duration_s,
    ...(resolved.artwork_asset_id != null ? { artwork_asset_id: resolved.artwork_asset_id } : {}),
    citations: clone(resolved.citations),
    ...('coordinates' in reference && reference.coordinates != null
      ? { coordinates: clone(reference.coordinates) }
      : {}),
    ...(reference.explore_place_id != null
      ? { explore_place_id: reference.explore_place_id }
      : {}),
    ...('trigger' in reference && reference.trigger != null
      ? { trigger: clone(reference.trigger) }
      : {}),
    delivery: clone(reference.delivery),
  };
}

function compileFromValidatedManifest(
  manifest: OriginalManifestV3,
  selection: OriginalChapterSelectionV2,
): OriginalCompiledChapterManifestV3 {
  const { chapter, variant } = resolveSelection(manifest, selection);
  const projection = projectValidatedManifestToV2(manifest);
  const projected = compileOriginalManifestV2(projection, {
    chapter_id: chapter.id,
    variant_id: variant.id,
  });
  const compiledById = new Map(projected.manifest.stops.map(stop => [stop.id, stop]));
  const hardStops = [...variant.cue_refs]
    .sort(compareDeliveryReferences)
    .map((reference, index) => {
      const stop = compiledById.get(reference.story_id);
      if (!stop) {
        throw new OriginalManifestError(`Unknown hard cue ${reference.story_id}.`);
      }
      return { ...clone(stop), sequence: index + 1 };
    });
  const hardManifest = validateOriginalManifest({
    ...projected.manifest,
    // Keep the typographic em dash produced by the shared V2 compiler.
    title: `${manifest.title} — ${chapter.title}`,
    stops: hardStops,
  });
  const stories = new Map(manifest.stories.map(story => [story.id, story]));
  const items = [...variant.selectable_refs]
    .sort(compareDeliveryReferences)
    .map(reference => {
      const story = stories.get(reference.story_id);
      if (!story) throw new OriginalManifestError(`Unknown story ${reference.story_id}.`);
      return selectableItem(reference, story, chapter.id, variant.id);
    });
  return {
    selection: {
      validation_selection_id: chapter.validation_selection.selection_id,
      chapter_id: chapter.id,
      variant_id: variant.id,
      delivery_contract_sha256: variant.delivery_contract_sha256,
    },
    manifest: hardManifest,
    selectable: {
      schema_version: 1,
      contract_id: ORIGINALS_LONG_FORM_CONTRACT_ID,
      delivery_contract_sha256: variant.delivery_contract_sha256,
      items,
    },
  };
}

export function listOriginalChapterSelectionsV3(
  input: unknown,
): OriginalChapterSelectionItemV2[] {
  const manifest = validateOriginalManifestV3(input);
  return listOriginalChapterSelections(projectValidatedManifestToV2(manifest));
}

export function compileOriginalManifestV3Selections(input: unknown) {
  const manifest = validateOriginalManifestV3(input);
  const selections = listOriginalChapterSelections(projectValidatedManifestToV2(manifest));
  return selections.map(selection => ({
    selection,
    compiled: compileFromValidatedManifest(manifest, {
      chapter_id: selection.chapter_id,
      variant_id: selection.variant_id,
    }),
  }));
}

export function compileOriginalManifestV3(
  input: unknown,
  selection: OriginalChapterSelectionV2,
): OriginalCompiledChapterManifestV3 {
  return compileFromValidatedManifest(validateOriginalManifestV3(input), selection);
}
