import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { validateOriginalManifest } from '../lib/originals/manifest';
import {
  ORIGINAL_LONG_FORM_SCHEDULER_DEFAULTS,
  validateOriginalLongFormSelection,
} from '../lib/originals/longFormScheduler';
import { projectPointToOriginalRoute } from '../lib/originals/routeProjection';
import type {
  OriginalCompiledChapterManifestV3,
  OriginalSelectablePlaybackPlanV1,
} from '../lib/originals/types';

const SHA256_RE = /^[a-f0-9]{64}$/;
const STABLE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,239}$/i;

export const ORIGINAL_LONG_FORM_VALIDATION_GATES = {
  route_end_tail_limit_s: 240,
  trigger_to_play_latency_limit_s: 180,
  capacity_guard_s: 30,
  speed_fixtures_mph: [15, 36, 65, 75],
} as const;

type JsonRecord = Record<string, unknown>;

type ValidatorInput = {
  schema_version: 1;
  compiled: unknown;
  options?: {
    validator_source_sha256?: string;
    delivery_contract_sha256?: string;
    audio_binding_sha256?: string;
    preflight?: OriginalLongFormPreflightBindingV1;
  };
};

type OriginalLongFormPreflightBindingV1 = {
  schema_version: 1;
  evidence_id: string;
  product_id: string;
  chapter_id: string;
  variant_id: string;
  artifact_path: string;
  artifact_sha256: string;
  readiness_artifact_path: string;
  readiness_artifact_sha256: string;
  readiness_source_set_sha256: string;
  input_bindings_sha256: string;
  s3g_runtime_source_baseline_sha256: string;
  semantic_contract_sha256: string;
};

type OriginalLongFormValidationInputV1 = OriginalCompiledChapterManifestV3 & {
  audio_evidence: {
    schema_version: 2;
    source: 'server_verified_publication_metadata';
    items: Array<{
      item_id: string;
      audio_asset_id: string;
      asset_sha256: string;
      asset_bytes: number;
      transcript_sha256: string;
      manifest_duration_ms: number;
      probed_duration_ms: number;
      generator: {
        generated: boolean;
        provider: 'cartesia' | 'elevenlabs' | null;
        model_id: string | null;
        voice_id: string | null;
        commercial_license_attested: boolean;
        metadata_sha256: string;
      };
      artwork: null | {
        asset_id: string;
        asset_sha256: string;
        asset_bytes: number;
        width: number;
        height: number;
      };
    }>;
  };
};

function assertRecord(value: unknown, label: string): asserts value is JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function stableId(value: unknown, label: string) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (!STABLE_ID_RE.test(clean)) throw new Error(`${label} must be a stable identifier.`);
  return clean;
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonicalJsonValue(entry)]),
    );
  }
  return value;
}

function sha256Json(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalJsonValue(value)))
    .digest('hex');
}

function sha256Bytes(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

const CHECKED_DELIVERY_EVIDENCE = new Map([
  [
    'great_smoky_mountains_ridges_rivers_living_memory:roaring_fork:one_way',
    {
      evidence_id: 'smokies_roaring_fork_delivery_v3',
      artifact_path: 'originals/smokies/roaring_fork_trigger_preflight_v1.json',
      readiness_path: 'originals/smokies/roaring_fork_delivery_readiness_v3.json',
    },
  ],
]);

function checkedDeliverySemantics(
  preflight: JsonRecord,
  stoppedAvailabilityRadiusById: JsonRecord,
) {
  const rawEntries = preflight.entries;
  const summary = preflight.delivery_summary;
  const rawCapacity = preflight.capacity_admission_input;
  if (!Array.isArray(rawEntries) || !Array.isArray(rawCapacity)) {
    throw new Error('Checked long-form delivery evidence is incomplete.');
  }
  assertRecord(summary, 'Checked long-form delivery summary');
  const capacityById = new Map(rawCapacity.map((row, index) => {
    assertRecord(row, `Checked capacity row ${index}`);
    return [String(row.id ?? ''), row];
  }));
  const entries = rawEntries.map((row, index) => {
    assertRecord(row, `Checked delivery entry ${index}`);
    assertRecord(row.delivery, `Checked delivery entry ${index} policy`);
    const id = stableId(row.id, `Checked delivery entry ${index} id`);
    const stableOrder = Number(row.stable_order);
    const mode = String(row.delivery.mode ?? '');
    if (!Number.isInteger(stableOrder) || stableOrder < 1 || ![
      'hard_auto', 'capacity_deeper', 'stopped_deeper', 'completion_deeper',
    ].includes(mode)) throw new Error(`Checked delivery entry ${id} is invalid.`);
    const normalized: JsonRecord = { id, stable_order: stableOrder, mode };
    if (row.projected_coordinate != null) normalized.coordinates = row.projected_coordinate;
    if (mode === 'hard_auto' || mode === 'capacity_deeper') {
      assertRecord(row.trigger, `Checked delivery entry ${id} trigger`);
      const trigger = row.trigger;
      normalized.trigger = Object.fromEntries([
        'enter_radius_m', 'exit_radius_m', 'lead_time_s',
        'route_progress_start_m', 'route_progress_end_m',
        'approach_bearing_deg', 'bearing_tolerance_deg',
      ].filter(key => trigger[key] != null).map(key => [key, trigger[key]]));
    }
    const delivery = row.delivery;
    if (mode === 'hard_auto') {
      normalized.delivery = {
        priority: delivery.priority,
        queue_policy: delivery.queue_policy,
        optional_content_may_delay: delivery.optional_content_may_delay,
      };
    } else if (mode === 'capacity_deeper') {
      const capacity = capacityById.get(id);
      if (!capacity) throw new Error(`Checked capacity entry ${id} is incomplete.`);
      assertRecord(capacity.next_hard_auto, `Checked capacity entry ${id} next hard cue`);
      normalized.delivery = {
        admission_policy_id: delivery.admission_policy_id,
        next_hard_auto_story_id: capacity.next_hard_auto.id,
        guard_before_next_hard_auto_window_s: delivery.guard_before_next_hard_auto_window_s,
        fallback_mode: delivery.fallback_mode,
        may_queue_behind_capacity: delivery.may_queue_behind_capacity,
        may_wait_for_active_hard_auto: delivery.may_wait_for_active_hard_auto,
      };
    } else if (mode === 'stopped_deeper') {
      normalized.delivery = {
        availability: delivery.availability,
        experience_group_id: delivery.experience_group_id,
        requires_user_confirmed_parked: delivery.requires_user_confirmed_parked,
        motion_inference_allowed: delivery.motion_inference_allowed,
        parking_availability: delivery.parking_availability,
        parking_promise: delivery.parking_promise,
        availability_radius_m: delivery.availability === 'at_landmark_user_confirmed_parked'
          ? stoppedAvailabilityRadiusById[id]
          : null,
      };
    } else {
      normalized.delivery = {
        availability: delivery.availability,
        requires_route_completion: delivery.requires_route_completion,
      };
    }
    return normalized;
  }).sort((left, right) => Number(left.stable_order) - Number(right.stable_order));
  if (entries.some((entry, index) => entry.stable_order !== index + 1)) {
    throw new Error('Checked long-form delivery order is not contiguous.');
  }
  assertRecord(preflight.input_bindings, 'Checked long-form input bindings');
  assertRecord(preflight.route, 'Checked long-form route');
  return {
    route_geometry_sha256: preflight.input_bindings.geometry_sha256,
    route_distance_m: preflight.route.evidence_distance_m,
    entries,
    entry_ids_by_mode: summary.entry_ids_by_mode,
    ogle_prelude_entry_ids: summary.ogle_prelude_entry_ids,
  };
}

function compiledDeliverySemantics(compiled: OriginalLongFormValidationInputV1) {
  const hard = compiled.manifest.stops;
  const optional = compiled.selectable.items;
  const total = hard.length + optional.length;
  const optionalOrders = new Set(optional.map(item => item.sequence));
  const hardOrders = Array.from({ length: total }, (_, index) => index + 1)
    .filter(order => !optionalOrders.has(order));
  if (
    hardOrders.length !== hard.length
    || optionalOrders.size !== optional.length
    || [...optionalOrders].some(order => !Number.isInteger(order) || order < 1 || order > total)
  ) throw new Error('Compiled long-form delivery order is invalid.');
  const entries: JsonRecord[] = hard.map((item, index) => ({
    id: item.id,
    stable_order: hardOrders[index],
    mode: 'hard_auto',
    coordinates: item.coordinates,
    trigger: item.trigger,
    delivery: {
      priority: 'must_play',
      queue_policy: 'durable_fifo_among_hard_auto',
      optional_content_may_delay: false,
    },
  }));
  for (const item of optional) {
    const delivery = item.delivery;
    const normalized: JsonRecord = {
      id: item.id,
      stable_order: item.sequence,
      mode: delivery.mode,
    };
    if (item.coordinates != null) normalized.coordinates = item.coordinates;
    if (delivery.mode === 'capacity_deeper') {
      normalized.trigger = item.trigger;
      normalized.delivery = {
        admission_policy_id: delivery.admission_policy_id,
        next_hard_auto_story_id: delivery.next_hard_auto_story_id,
        guard_before_next_hard_auto_window_s: delivery.guard_before_next_hard_auto_window_s,
        fallback_mode: delivery.fallback_mode,
        may_queue_behind_capacity: delivery.may_queue_behind_capacity,
        may_wait_for_active_hard_auto: delivery.may_wait_for_active_hard_auto,
      };
    } else if (delivery.mode === 'stopped_deeper') {
      normalized.delivery = {
        availability: delivery.availability,
        experience_group_id: delivery.experience_group_id,
        requires_user_confirmed_parked: delivery.requires_user_confirmed_parked,
        motion_inference_allowed: delivery.motion_inference_allowed,
        parking_availability: delivery.parking_availability,
        parking_promise: delivery.parking_promise,
        availability_radius_m: delivery.availability_radius_m ?? null,
      };
    } else {
      normalized.delivery = {
        availability: delivery.availability,
        requires_route_completion: delivery.requires_route_completion,
      };
    }
    entries.push(normalized);
  }
  entries.sort((left, right) => (
    Number(left.stable_order) - Number(right.stable_order)
    || String(left.id).localeCompare(String(right.id))
  ));
  const idsByMode: Record<string, string[]> = {
    capacity_deeper: [], completion_deeper: [], hard_auto: [], stopped_deeper: [],
  };
  for (const entry of entries) idsByMode[String(entry.mode)].push(String(entry.id));
  return {
    route_geometry_sha256: sha256Json(compiled.manifest.route.geometry),
    route_distance_m: compiled.manifest.route.distance_m,
    entries,
    entry_ids_by_mode: idsByMode,
    ogle_prelude_entry_ids: entries
      .filter(entry => (
        entry.mode === 'stopped_deeper'
        && (entry.delivery as JsonRecord).experience_group_id === 'ogle_prelude'
      ))
      .map(entry => entry.id),
  };
}

function verifiedS3gPreflightBinding(
  compiled: OriginalLongFormValidationInputV1,
): OriginalLongFormPreflightBindingV1 {
  const productId = String(compiled.manifest.pack_id ?? '').trim();
  const chapterId = compiled.selection.chapter_id;
  const variantId = compiled.selection.variant_id;
  const registry = CHECKED_DELIVERY_EVIDENCE.get(`${productId}:${chapterId}:${variantId}`);
  if (!registry) {
    throw new Error('No checked long-form delivery evidence is registered for this chapter variant.');
  }
  const artifactPath = registry.artifact_path;
  const bytes = readFileSync(artifactPath);
  const preflight = JSON.parse(bytes.toString('utf8')) as JsonRecord;
  assertRecord(preflight.runtime_capacity, 'S3G preflight runtime_capacity');
  assertRecord(preflight.input_bindings, 'S3G preflight input_bindings');
  const runtime = preflight.runtime_capacity;
  const inputs = preflight.input_bindings;
  if (
    preflight.schema_version !== 2
    || preflight.authoring_only !== true
    || preflight.product_id !== productId
    || preflight.chapter_id !== chapterId
    || preflight.variant_id !== variantId
    || runtime.gates_weakened !== false
    || runtime.route_end_audio_backlog_limit_s !== 240
    || runtime.trigger_to_play_latency_limit_s !== 180
    || runtime.capacity_hard_auto_guard_s !== 30
  ) throw new Error('S3G long-form preflight safety contract is invalid.');
  for (const [pathKey, hashKey] of [
    ['editorial_packet_path', 'editorial_packet_sha256'],
    ['official_route_evidence_path', 'official_route_evidence_sha256'],
    ['source_dossier_path', 'source_dossier_sha256'],
  ] as const) {
    const sourcePath = String(inputs[pathKey] ?? '').trim();
    const expected = String(inputs[hashKey] ?? '').trim().toLowerCase();
    if (!sourcePath || !SHA256_RE.test(expected) || sha256Bytes(readFileSync(sourcePath)) !== expected) {
      throw new Error(`S3G long-form preflight input ${pathKey} drifted.`);
    }
  }
  assertRecord(runtime.source_sha256_by_path, 'S3G runtime source baseline');
  const frozenSources = runtime.source_sha256_by_path;
  if (
    !Object.keys(frozenSources).length
    || Object.entries(frozenSources).some(([path, hash]) => (
      !path || !SHA256_RE.test(String(hash ?? ''))
    ))
  ) throw new Error('S3G long-form runtime source baseline is invalid.');
  const readinessBytes = readFileSync(registry.readiness_path);
  const readiness = JSON.parse(readinessBytes.toString('utf8')) as JsonRecord;
  assertRecord(readiness.source_sha256_by_path, 'Checked consumer readiness source set');
  assertRecord(
    readiness.stopped_availability_radius_m_by_id,
    'Checked stopped-story radius evidence',
  );
  const readinessSources = readiness.source_sha256_by_path;
  const stoppedRadiusById = readiness.stopped_availability_radius_m_by_id;
  if (
    readiness.schema_version !== 1
    || readiness.kind !== 'original_long_form_consumer_readiness'
    || readiness.evidence_id !== registry.evidence_id
    || readiness.product_id !== productId
    || readiness.chapter_id !== chapterId
    || readiness.variant_id !== variantId
    || readiness.preflight_sha256 !== sha256Bytes(bytes)
    || readiness.consumer_delivery_modes_supported !== true
    || readiness.consumer_runtime_status !== 'ready_for_real_audio_validation'
    || readiness.real_audio_required !== true
    || readiness.authoring_estimates_accepted !== false
    || sha256Json(readiness.gates) !== sha256Json(ORIGINAL_LONG_FORM_VALIDATION_GATES)
    || Object.keys(stoppedRadiusById).length !== 1
    || stoppedRadiusById.rf_story_06 !== 250
    || !Object.keys(readinessSources).length
  ) throw new Error('Checked long-form consumer readiness contract is invalid.');
  for (const [sourcePath, sourceHash] of Object.entries(readinessSources)) {
    if (!sourcePath || !SHA256_RE.test(String(sourceHash ?? ''))
      || sha256Bytes(readFileSync(sourcePath)) !== sourceHash) {
      throw new Error(`Checked long-form consumer readiness source drifted: ${sourcePath}`);
    }
  }
  const expectedSemantics = checkedDeliverySemantics(preflight, stoppedRadiusById);
  const actualSemantics = compiledDeliverySemantics(compiled);
  const semanticHash = sha256Json(expectedSemantics);
  if (
    readiness.delivery_semantics_sha256 !== semanticHash
    || sha256Json(actualSemantics) !== semanticHash
  ) throw new Error(
    `Compiled long-form delivery semantics drifted from checked evidence (${semanticHash.slice(0, 12)}/${sha256Json(actualSemantics).slice(0, 12)}).`,
  );
  return {
    schema_version: 1,
    evidence_id: registry.evidence_id,
    product_id: productId,
    chapter_id: chapterId,
    variant_id: variantId,
    artifact_path: artifactPath,
    artifact_sha256: sha256Bytes(bytes),
    readiness_artifact_path: registry.readiness_path,
    readiness_artifact_sha256: sha256Bytes(readinessBytes),
    readiness_source_set_sha256: sha256Json(readinessSources),
    input_bindings_sha256: sha256Json(inputs),
    s3g_runtime_source_baseline_sha256: sha256Json(frozenSources),
    semantic_contract_sha256: semanticHash,
  };
}

function validateSelectablePlan(value: unknown): OriginalSelectablePlaybackPlanV1 {
  assertRecord(value, 'compiled.selectable');
  if (value.schema_version !== 1) throw new Error('Selectable plan schema is unsupported.');
  if (value.contract_id !== 'originals_long_form_delivery_v1') {
    throw new Error('Selectable plan contract is unsupported.');
  }
  const deliveryHash = String(value.delivery_contract_sha256 ?? '').trim().toLowerCase();
  if (!SHA256_RE.test(deliveryHash)) {
    throw new Error('Selectable plan delivery contract hash is invalid.');
  }
  if (!Array.isArray(value.items) || value.items.length > 250) {
    throw new Error('Selectable plan items are invalid.');
  }
  const ids = new Set<string>();
  for (const [index, rawItem] of value.items.entries()) {
    assertRecord(rawItem, `compiled.selectable.items[${index}]`);
    const id = stableId(rawItem.id, `compiled.selectable.items[${index}].id`);
    if (ids.has(id)) throw new Error(`Selectable item ${id} is duplicated.`);
    ids.add(id);
    stableId(rawItem.audio_asset_id, `Selectable item ${id} audio_asset_id`);
    const duration = Number(rawItem.audio_duration_s);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`Selectable item ${id} audio duration is invalid.`);
    }
    assertRecord(rawItem.delivery, `Selectable item ${id} delivery`);
    const mode = rawItem.delivery.mode;
    if (mode === 'capacity_deeper') {
      if (rawItem.delivery.guard_before_next_hard_auto_window_s !== 30) {
        throw new Error(`Selectable item ${id} changed the capacity guard.`);
      }
      if (
        rawItem.delivery.may_queue_behind_capacity !== false
        || rawItem.delivery.may_wait_for_active_hard_auto !== true
        || rawItem.delivery.fallback_mode !== 'completion_deeper'
      ) {
        throw new Error(`Selectable item ${id} has an unsafe capacity policy.`);
      }
    } else if (mode === 'stopped_deeper') {
      if (
        rawItem.delivery.requires_user_confirmed_parked !== true
        || rawItem.delivery.motion_inference_allowed !== false
        || rawItem.delivery.parking_availability !== 'not_checked'
        || rawItem.delivery.parking_promise !== false
      ) {
        throw new Error(`Selectable item ${id} has an unsafe parked policy.`);
      }
    } else if (mode !== 'completion_deeper') {
      throw new Error(`Selectable item ${id} has an unsupported delivery mode.`);
    }
  }
  return value as unknown as OriginalSelectablePlaybackPlanV1;
}

function validateCompiled(value: unknown): OriginalLongFormValidationInputV1 {
  assertRecord(value, 'compiled');
  assertRecord(value.selection, 'compiled.selection');
  const selection = value.selection;
  stableId(selection.validation_selection_id, 'compiled.selection.validation_selection_id');
  stableId(selection.chapter_id, 'compiled.selection.chapter_id');
  stableId(selection.variant_id, 'compiled.selection.variant_id');
  const selectionHash = String(selection.delivery_contract_sha256 ?? '').trim().toLowerCase();
  if (!SHA256_RE.test(selectionHash)) {
    throw new Error('Compiled selection delivery contract hash is invalid.');
  }
  const manifest = validateOriginalManifest(value.manifest);
  const selectable = validateSelectablePlan(value.selectable);
  assertRecord(value.audio_evidence, 'compiled.audio_evidence');
  if (
    value.audio_evidence.schema_version !== 2
    || value.audio_evidence.source !== 'server_verified_publication_metadata'
    || !Array.isArray(value.audio_evidence.items)
  ) {
    throw new Error('Server-verified narration publication evidence is missing.');
  }
  if (selectable.delivery_contract_sha256 !== selectionHash) {
    throw new Error('Compiled selection and selectable delivery hashes differ.');
  }
  const hardIds = new Set(manifest.stops.map(stop => stop.id));
  for (const item of selectable.items) {
    if (hardIds.has(item.id)) {
      throw new Error(`Optional item ${item.id} leaked into hard route progress.`);
    }
  }
  return {
    selection: selection as OriginalCompiledChapterManifestV3['selection'],
    manifest,
    selectable,
    audio_evidence: value.audio_evidence as OriginalLongFormValidationInputV1['audio_evidence'],
  };
}

export function originalLongFormAudioBindingSha256(
  compiled: OriginalLongFormValidationInputV1,
) {
  const assets = new Map(compiled.manifest.assets.map(asset => [asset.id, asset]));
  const references = [
    ...compiled.manifest.stops.map(stop => ({
      item_id: stop.id,
      audio_asset_id: stop.audio_asset_id,
      audio_duration_s: stop.audio_duration_s,
      transcript: stop.transcript,
      artwork_asset_id: stop.artwork_asset_id,
    })),
    ...compiled.selectable.items.map(item => ({
      item_id: item.id,
      audio_asset_id: item.audio_asset_id,
      audio_duration_s: item.audio_duration_s,
      transcript: item.transcript,
      artwork_asset_id: item.artwork_asset_id,
    })),
  ].sort((left, right) => (
    left.item_id.localeCompare(right.item_id)
    || left.audio_asset_id.localeCompare(right.audio_asset_id)
  ));
  const evidence = new Map<string, OriginalLongFormValidationInputV1['audio_evidence']['items'][number]>();
  for (const item of compiled.audio_evidence.items) {
    if (!item || typeof item !== 'object' || evidence.has(item.item_id)) {
      throw new Error('Server-probed narration duration evidence ids are invalid.');
    }
    evidence.set(item.item_id, item);
  }
  if (evidence.size !== references.length) {
    throw new Error('Server-probed narration duration evidence coverage is incomplete.');
  }
  const seenItems = new Set<string>();
  const binding = references.map(reference => {
    if (seenItems.has(reference.item_id)) {
      throw new Error(`Narrative item ${reference.item_id} is duplicated.`);
    }
    seenItems.add(reference.item_id);
    const asset = assets.get(reference.audio_asset_id);
    if (
      !asset
      || asset.kind !== 'narration'
      || !Number.isInteger(asset.bytes)
      || asset.bytes <= 0
      || !SHA256_RE.test(asset.sha256)
    ) {
      throw new Error(`Narrative item ${reference.item_id} has no verified narration asset.`);
    }
    const measured = evidence.get(reference.item_id);
    const transcript = String(reference.transcript ?? '').trim().split(/\s+/).join(' ');
    if (!transcript) {
      throw new Error(`Narrative item ${reference.item_id} has no reviewed transcript.`);
    }
    const transcriptSha256 = createHash('sha256').update(transcript).digest('hex');
    const manifestDurationMs = Math.round(reference.audio_duration_s * 1000);
    const probedDurationMs = measured?.probed_duration_ms;
    if (
      !measured
      || measured.audio_asset_id !== asset.id
      || measured.asset_sha256 !== asset.sha256
      || measured.asset_bytes !== asset.bytes
      || measured.transcript_sha256 !== transcriptSha256
      || measured.manifest_duration_ms !== manifestDurationMs
      || !Number.isInteger(probedDurationMs)
      || Number(probedDurationMs) <= 0
      || Math.abs(manifestDurationMs - Number(probedDurationMs))
        > Math.max(250, Math.round(Number(probedDurationMs) * 0.05))
    ) {
      throw new Error(
        `Narrative item ${reference.item_id} does not match its verified narration evidence.`,
      );
    }
    assertRecord(measured.generator, `Narrative item ${reference.item_id} generator evidence`);
    const generator = measured.generator;
    if (generator.generated === true) {
      if (
        !['cartesia', 'elevenlabs'].includes(String(generator.provider ?? ''))
        || typeof generator.model_id !== 'string'
        || !generator.model_id.trim()
        || typeof generator.voice_id !== 'string'
        || !generator.voice_id.trim()
        || generator.commercial_license_attested !== true
        || !SHA256_RE.test(String(generator.metadata_sha256 ?? ''))
      ) {
        throw new Error(
          `Narrative item ${reference.item_id} generator or commercial license evidence is invalid.`,
        );
      }
    } else if (
      generator.generated !== false
      || generator.provider !== null
      || generator.model_id !== null
      || generator.voice_id !== null
      || generator.commercial_license_attested !== false
      || generator.metadata_sha256 !== sha256Json({})
    ) {
      throw new Error(
        `Narrative item ${reference.item_id} non-generated narration evidence is invalid.`,
      );
    }
    let artwork: null | {
      asset_bytes: number;
      asset_id: string;
      asset_sha256: string;
      height: number;
      width: number;
    } = null;
    if (reference.artwork_asset_id) {
      const artworkAsset = assets.get(reference.artwork_asset_id);
      const artworkEvidence = measured.artwork;
      if (
        !artworkAsset
        || artworkAsset.kind !== 'image'
        || !artworkAsset.mime_type.startsWith('image/')
        || !Number.isInteger(artworkAsset.bytes)
        || artworkAsset.bytes <= 0
        || !SHA256_RE.test(artworkAsset.sha256)
        || !artworkEvidence
        || artworkEvidence.asset_id !== artworkAsset.id
        || artworkEvidence.asset_sha256 !== artworkAsset.sha256
        || artworkEvidence.asset_bytes !== artworkAsset.bytes
        || !Number.isInteger(artworkEvidence.width)
        || artworkEvidence.width < 320
        || !Number.isInteger(artworkEvidence.height)
        || artworkEvidence.height < 180
      ) {
        throw new Error(
          `Narrative item ${reference.item_id} artwork does not match its verified media evidence.`,
        );
      }
      artwork = {
        asset_bytes: artworkAsset.bytes,
        asset_id: artworkAsset.id,
        asset_sha256: artworkAsset.sha256,
        height: artworkEvidence.height,
        width: artworkEvidence.width,
      };
    } else if (measured.artwork !== null) {
      throw new Error(`Narrative item ${reference.item_id} has unexpected artwork evidence.`);
    }
    return {
      asset_bytes: asset.bytes,
      asset_id: asset.id,
      asset_sha256: asset.sha256,
      artwork,
      generator: {
        commercial_license_attested: generator.commercial_license_attested,
        generated: generator.generated,
        metadata_sha256: generator.metadata_sha256,
        model_id: generator.model_id,
        provider: generator.provider,
        voice_id: generator.voice_id,
      },
      item_id: reference.item_id,
      manifest_duration_ms: manifestDurationMs,
      probed_duration_ms: Number(probedDurationMs),
      transcript_sha256: transcriptSha256,
    };
  });
  if (!binding.length) throw new Error('Long-form validation requires real narration assets.');
  return {
    binding,
    binding_sha256: sha256Json(binding),
    referenced_item_count: binding.length,
    unique_asset_count: new Set(binding.map(item => item.asset_id)).size,
    verified_artwork_count: binding.filter(item => item.artwork !== null).length,
    verified_generated_asset_count: new Set(
      binding.filter(item => item.generator.generated).map(item => item.asset_id),
    ).size,
  };
}

type DeliveryTimingEvent = {
  id: string;
  kind: 'hard' | 'capacity';
  arrival_s: number;
  duration_s: number;
  sequence: number;
  available_audio_s: number | null;
  required_audio_s: number | null;
  window_end_s: number | null;
  next_hard_window_start_s: number | null;
};

function roundedMetric(value: number) {
  return Number(Math.max(0, value).toFixed(6));
}

/**
 * Compute the publication timing gates from immutable probed durations. Hard
 * cues preempt capacity audio; hard-on-hard overlap remains FIFO.
 */
export function computeOriginalLongFormDeliveryMetrics(
  compiled: OriginalLongFormValidationInputV1,
) {
  const measuredDuration = new Map(
    compiled.audio_evidence.items.map(item => [
      item.item_id,
      item.probed_duration_ms / 1000,
    ]),
  );
  const hardById = new Map(compiled.manifest.stops.map(stop => [stop.id, stop]));
  const capacityItems = compiled.selectable.items
    .filter(item => item.delivery.mode === 'capacity_deeper')
    .sort((left, right) => left.sequence - right.sequence);
  const routeDistanceM = Number(compiled.manifest.route.distance_m);
  if (!Number.isFinite(routeDistanceM) || routeDistanceM <= 0) {
    throw new Error('Compiled route distance is invalid for delivery timing.');
  }
  const routeCoordinates = compiled.manifest.route.geometry.coordinates;
  const progressFor = (
    coordinates: { lng: number; lat: number } | undefined,
    startM: number,
    endM: number,
  ) => {
    const projected = coordinates
      ? projectPointToOriginalRoute(routeCoordinates, [coordinates.lng, coordinates.lat])
      : null;
    return projected?.route_progress_m ?? ((startM + endM) / 2);
  };
  const fixtures = ORIGINAL_LONG_FORM_VALIDATION_GATES.speed_fixtures_mph.map(speedMph => {
    const speedMps = speedMph * 0.44704;
    const routeTravelS = routeDistanceM / speedMps;
    const events: DeliveryTimingEvent[] = [
      ...compiled.manifest.stops.map(stop => {
        const progress = progressFor(
          stop.coordinates,
          stop.trigger.route_progress_start_m,
          stop.trigger.route_progress_end_m,
        );
        return {
          id: stop.id,
          kind: 'hard' as const,
          arrival_s: progress / speedMps,
          duration_s: measuredDuration.get(stop.id) ?? 0,
          sequence: stop.sequence,
          available_audio_s: null,
          required_audio_s: null,
          window_end_s: null,
          next_hard_window_start_s: null,
        };
      }),
      ...capacityItems.map(item => {
        if (item.delivery.mode !== 'capacity_deeper' || !item.trigger) {
          throw new Error(`Capacity item ${item.id} is missing its trigger contract.`);
        }
        const nextHard = hardById.get(item.delivery.next_hard_auto_story_id);
        if (!nextHard) throw new Error(`Capacity item ${item.id} has no next hard cue.`);
        const progress = progressFor(
          item.coordinates,
          item.trigger.route_progress_start_m,
          item.trigger.route_progress_end_m,
        );
        const availableAudioS = Math.max(
          0,
          nextHard.trigger.route_progress_start_m - progress,
        ) / speedMps;
        const durationS = measuredDuration.get(item.id) ?? 0;
        return {
          id: item.id,
          kind: 'capacity' as const,
          arrival_s: progress / speedMps,
          duration_s: durationS,
          sequence: item.sequence,
          available_audio_s: availableAudioS,
          required_audio_s: durationS + item.delivery.guard_before_next_hard_auto_window_s,
          window_end_s: item.trigger.route_progress_end_m / speedMps,
          next_hard_window_start_s: nextHard.trigger.route_progress_start_m / speedMps,
        };
      }),
    ].sort((left, right) => (
      left.arrival_s - right.arrival_s
      || (left.kind === right.kind ? 0 : left.kind === 'hard' ? -1 : 1)
      || left.sequence - right.sequence
      || left.id.localeCompare(right.id)
    ));
    let active: (DeliveryTimingEvent & { finish_s: number }) | null = null;
    const hardQueue: Array<DeliveryTimingEvent & { queued_at_s: number }> = [];
    let capacityCandidate: (DeliveryTimingEvent & { ready_s: number }) | null = null;
    let maximumLatencyS = 0;
    const admitted: string[] = [];
    const rejected: string[] = [];
    const startHard = (event: DeliveryTimingEvent, startS: number) => {
      maximumLatencyS = Math.max(maximumLatencyS, startS - event.arrival_s);
      active = { ...event, finish_s: startS + event.duration_s };
    };
    const advanceTo = (targetS: number) => {
      while (true) {
        const activeFinish = active?.finish_s ?? Number.POSITIVE_INFINITY;
        const candidateReady = capacityCandidate?.ready_s ?? Number.POSITIVE_INFINITY;
        const nextTime = Math.min(activeFinish, candidateReady);
        if (!Number.isFinite(nextTime) || nextTime > targetS) break;
        if (candidateReady <= activeFinish) {
          const candidate = capacityCandidate;
          capacityCandidate = null;
          if (
            candidate
            && !active
            && hardQueue.length === 0
            && candidate.ready_s <= Number(candidate.window_end_s)
            && Number(candidate.next_hard_window_start_s) - candidate.ready_s
              >= Number(candidate.required_audio_s)
          ) {
            admitted.push(candidate.id);
            maximumLatencyS = Math.max(
              maximumLatencyS,
              candidate.ready_s - candidate.arrival_s,
            );
            active = {
              ...candidate,
              finish_s: candidate.ready_s + candidate.duration_s,
            };
          } else if (candidate) rejected.push(candidate.id);
          continue;
        }
        const finishedAt = activeFinish;
        active = null;
        const nextHard = hardQueue.shift();
        if (nextHard) startHard(nextHard, finishedAt);
      }
    };
    for (const event of events) {
      if (!Number.isFinite(event.duration_s) || event.duration_s <= 0) {
        throw new Error(`Narrative item ${event.id} has no probed timing duration.`);
      }
      advanceTo(event.arrival_s);
      if (event.kind === 'hard') {
        if (capacityCandidate) {
          rejected.push(capacityCandidate.id);
          capacityCandidate = null;
        }
        const currentActive = active as (DeliveryTimingEvent & { finish_s: number }) | null;
        if (currentActive?.kind === 'capacity') {
          // Production drops capacity_auto on hard preemption. It is never
          // resumed or converted into a queued selectable story.
          active = null;
        }
        if (active) hardQueue.push({ ...event, queued_at_s: event.arrival_s });
        else startHard(event, event.arrival_s);
        continue;
      }
      const dwellS = (
        ORIGINAL_LONG_FORM_SCHEDULER_DEFAULTS.minimum_reliable_dwell_ms / 1000
      ) + 0.1;
      if (
        !active
        && hardQueue.length === 0
        && !capacityCandidate
        && event.arrival_s + dwellS <= Number(event.window_end_s)
        && Number(event.next_hard_window_start_s) - (event.arrival_s + dwellS)
          >= Number(event.required_audio_s)
      ) {
        // This is an in-window candidate, not queued audio. It still needs a
        // second fresh reliable fix after the production scheduler dwell.
        capacityCandidate = { ...event, ready_s: event.arrival_s + dwellS };
      } else {
        rejected.push(event.id);
      }
    }
    advanceTo(routeTravelS);
    if (capacityCandidate) {
      rejected.push(capacityCandidate.id);
      capacityCandidate = null;
    }
    const finalActive = active as (DeliveryTimingEvent & { finish_s: number }) | null;
    const activeRemainingS = finalActive
      ? Math.max(0, finalActive.finish_s - routeTravelS)
      : 0;
    const queuedRemainingS = hardQueue.reduce(
      (total, event) => total + event.duration_s,
      0,
    );
    const routeEndBacklogS = activeRemainingS + queuedRemainingS;
    const withinLimits = routeEndBacklogS
      <= ORIGINAL_LONG_FORM_VALIDATION_GATES.route_end_tail_limit_s
      && maximumLatencyS
      <= ORIGINAL_LONG_FORM_VALIDATION_GATES.trigger_to_play_latency_limit_s;
    return {
      speed_mph: speedMph,
      route_travel_s: roundedMetric(routeTravelS),
      route_end_backlog_audio_s: roundedMetric(routeEndBacklogS),
      maximum_trigger_to_play_latency_s: roundedMetric(maximumLatencyS),
      admitted_capacity_ids: admitted,
      rejected_capacity_ids: rejected,
      within_limits: withinLimits,
    };
  });
  return {
    schema_version: 1 as const,
    duration_basis: 'server_probed_immutable_audio' as const,
    speed_fixtures: fixtures,
    valid: fixtures.every(fixture => fixture.within_limits),
  };
}

export function runOriginalLongFormDeliveryValidation(input: ValidatorInput) {
  if (input?.schema_version !== 1) throw new Error('Unsupported validator input schema_version.');
  const sourceHash = String(input.options?.validator_source_sha256 ?? '').trim().toLowerCase();
  const expectedDeliveryHash = String(
    input.options?.delivery_contract_sha256 ?? '',
  ).trim().toLowerCase();
  const expectedAudioHash = String(input.options?.audio_binding_sha256 ?? '').trim().toLowerCase();
  if (!SHA256_RE.test(sourceHash)) throw new Error('A trusted validator source hash is required.');
  if (!SHA256_RE.test(expectedDeliveryHash)) {
    throw new Error('An expected delivery contract hash is required.');
  }
  if (!SHA256_RE.test(expectedAudioHash)) {
    throw new Error('An expected narration binding hash is required.');
  }
  const compiled = validateCompiled(input.compiled);
  const preflight = verifiedS3gPreflightBinding(compiled);
  const suppliedPreflightHash = sha256Json(input.options?.preflight);
  const verifiedPreflightHash = sha256Json(preflight);
  if (suppliedPreflightHash !== verifiedPreflightHash) {
    const supplied = (input.options?.preflight ?? {}) as unknown as JsonRecord;
    const verified = preflight as unknown as JsonRecord;
    const mismatchedField = Array.from(new Set([
      ...Object.keys(supplied), ...Object.keys(verified),
    ])).sort().find(key => sha256Json(supplied[key]) !== sha256Json(verified[key]));
    throw new Error(
      `S3G long-form preflight binding drifted before validation (${mismatchedField ?? 'shape'}:${suppliedPreflightHash.slice(0, 12)}/${verifiedPreflightHash.slice(0, 12)}).`,
    );
  }
  if (compiled.selection.delivery_contract_sha256 !== expectedDeliveryHash) {
    throw new Error('Compiled delivery contract hash drifted before validation.');
  }
  const audio = originalLongFormAudioBindingSha256(compiled);
  if (audio.binding_sha256 !== expectedAudioHash) {
    throw new Error('Compiled narration binding drifted before validation.');
  }
  const characterization = validateOriginalLongFormSelection(
    compiled.manifest,
    compiled.selectable,
  );
  const deliveryMetrics = computeOriginalLongFormDeliveryMetrics(compiled);
  const passed = characterization.valid === true && deliveryMetrics.valid === true;
  return {
    schema_version: 1,
    report_type: 'OriginalLongFormDeliveryValidationReportV1',
    contract_id: 'originals_long_form_delivery_v1',
    validator_source_sha256: sourceHash,
    selection: compiled.selection,
    delivery_contract_sha256: expectedDeliveryHash,
    audio: {
      binding_sha256: audio.binding_sha256,
      referenced_item_count: audio.referenced_item_count,
      unique_asset_count: audio.unique_asset_count,
      verified_artwork_count: audio.verified_artwork_count,
      verified_generated_asset_count: audio.verified_generated_asset_count,
    },
    preflight,
    gates: ORIGINAL_LONG_FORM_VALIDATION_GATES,
    characterization,
    delivery_metrics: deliveryMetrics,
    passed,
    issues: passed ? [] : ['Long-form delivery characterization or timing gate failed.'],
  };
}

function main() {
  const input = JSON.parse(readFileSync(0, 'utf8')) as ValidatorInput;
  process.stdout.write(`${JSON.stringify(runOriginalLongFormDeliveryValidation(input))}\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : 'Originals long-form validation failed.';
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exitCode = 1;
}
