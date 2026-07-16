import { useStore } from '@/lib/store';
import { api } from '@/lib/api';
import { storage } from '@/lib/storage';
import {
  originalAccessStore,
  originalBundleStore,
  originalSessionStore,
  originalsApi,
  type OriginalBundleProgress,
  type OriginalBundleRecord,
  type OriginalAcquisition,
  type OriginalDetail,
  type OriginalManifestPreviewV1,
  type OriginalManifestV1,
  type OriginalLocalAccessV1,
  type OriginalOwnerScope,
  type OriginalSessionV1,
  type OriginalStopV1,
  type OriginalSummary,
} from '@/lib/originals';
import type {
  OriginalUiAcquireResult,
  OriginalUiBundleState,
  OriginalUiDetail,
  OriginalUiSession,
  OriginalUiSource,
  OriginalUiStory,
  OriginalUiSummary,
} from './types';

type ListUiOptions = { includeOwnedState?: boolean };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textValue(source: Record<string, unknown>, keys: string[], fallback = '') {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return fallback;
}

function numberValue(source: Record<string, unknown>, keys: string[], fallback = 0) {
  for (const key of keys) {
    const value = Number(source[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return fallback;
}

function stringList(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
  }
  return [];
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '4–6 hr';
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes} min`;
  return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
}

function formatDistance(meters: number) {
  if (!Number.isFinite(meters) || meters <= 0) return 'Scenic drive';
  return `${Math.round(meters / 1609.344)} mi`;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Offline';
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
}

function seasonLabel(months?: number[]) {
  if (!months?.length) return 'Year-round';
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const valid = months.filter(month => month >= 1 && month <= 12);
  if (!valid.length || valid.length >= 10) return 'Year-round';
  return `${names[valid[0] - 1]}–${names[valid[valid.length - 1] - 1]}`;
}

function ownerScope(): OriginalOwnerScope {
  const userId = useStore.getState().user?.id;
  return userId == null ? 'guest' : `account:${String(userId)}`;
}

function identityKey(id: string, version: number) {
  return `${id}@${version}`;
}

function hasExactAccess(
  records: Map<string, OriginalLocalAccessV1>,
  packId: string,
  slug: string,
  version: number,
) {
  return records.has(identityKey(packId, version)) || records.has(identityKey(slug, version));
}

async function accessRecords() {
  const scope = ownerScope();
  const local = await originalAccessStore.list(scope).catch(() => []);
  if (useStore.getState().token && scope !== 'guest') {
    const owned = await originalsApi.owned().catch(() => ({ items: [] }));
    const accountId = scope.slice('account:'.length);
    await Promise.all(owned.items.map(item => (
      originalAccessStore.recordEntitlement(item, accountId).catch(() => null)
    )));
    const refreshed = await originalAccessStore.list(scope).catch(() => local);
    local.splice(0, local.length, ...refreshed);
  }
  const records = new Map<string, OriginalLocalAccessV1>();
  local.forEach(item => {
    records.set(identityKey(item.pack_id, item.version), item);
    records.set(identityKey(item.slug, item.version), item);
  });
  return records;
}

async function bundleMap() {
  const records = await originalBundleStore.list(ownerScope()).catch(() => []);
  return new Map(records.map(item => [identityKey(item.pack_id, item.version), item]));
}

async function sessionMap() {
  const sessions = await originalSessionStore.list(ownerScope()).catch(() => []);
  return new Map(sessions.map(item => [identityKey(item.pack_id, item.version), item]));
}

function summaryToUi(
  item: OriginalSummary,
  options: { owned?: boolean; bundle?: OriginalBundleRecord | null; session?: OriginalSessionV1 | null } = {},
): OriginalUiSummary {
  const meta = record(item.public_metadata);
  const route = record(meta.route);
  const distanceM = numberValue(meta, ['distance_m', 'route_distance_m'], numberValue(route, ['distance_m']));
  const durationS = numberValue(meta, ['duration_s', 'route_duration_s'], numberValue(route, ['duration_s']));
  const storyCount = numberValue(meta, ['story_count', 'stop_count'], 0);
  const totalBytes = numberValue(meta, ['offline_bytes', 'offline_size_bytes', 'bundle_bytes'], options.bundle?.total_bytes || 0);
  const access = options.owned ? 'owned' : item.free || item.price_credits === 0 ? 'free' : 'paid';
  const terminalCount = options.session
    ? new Set([
      ...options.session.completed_stop_ids,
      ...options.session.skipped_stop_ids,
      ...options.session.missed_stop_ids,
    ]).size
    : 0;
  const totalStops = Math.max(storyCount, terminalCount);
  return {
    id: String(item.id),
    slug: item.slug,
    version: item.version,
    title: item.title,
    region: item.coverage_region || textValue(meta, ['region'], 'Scenic drive'),
    summary: item.summary,
    durationLabel: textValue(meta, ['duration_label'], formatDuration(durationS)),
    distanceLabel: textValue(meta, ['distance_label'], formatDistance(distanceM)),
    surfaceLabel: textValue(meta, ['surface_label', 'surface'], 'Paved'),
    seasonLabel: textValue(meta, ['season_label', 'season'], 'Year-round'),
    storyCount: Math.max(1, storyCount || 1),
    offlineSizeLabel: textValue(meta, ['offline_size_label'], formatBytes(totalBytes)),
    priceCredits: item.price_credits,
    explorerPriceCredits: item.explorer_price_credits,
    access,
    featured: item.featured,
    heroImageUrl: textValue(meta, ['hero_image_url', 'image_url']) || undefined,
    progress: totalStops ? terminalCount / totalStops : 0,
    downloadState: options.bundle ? 'ready' : 'not_downloaded',
  };
}

function previewStories(preview: OriginalManifestPreviewV1, meta: Record<string, unknown>): OriginalUiStory[] {
  const storyMeta = Array.isArray(meta.stories) ? meta.stories.map(record) : [];
  return preview.stops.map(stop => {
    const authored = storyMeta.find(item => String(item.id || '') === stop.id) || storyMeta[stop.sequence - 1] || {};
    return {
      id: stop.id,
      sequence: stop.sequence,
      title: stop.title,
      transcript: textValue(authored, ['preview', 'transcript_excerpt', 'transcript']),
      durationLabel: textValue(authored, ['duration_label'], 'Story'),
    };
  });
}

function manifestStories(manifest: OriginalManifestV1, session?: OriginalSessionV1 | null): OriginalUiStory[] {
  return manifest.stops.map(stop => ({
    id: stop.id,
    sequence: stop.sequence,
    title: stop.title,
    transcript: stop.transcript,
    durationLabel: formatDuration(stop.audio_duration_s),
    completed: Boolean(session?.completed_stop_ids.includes(stop.id)),
    skipped: Boolean(session?.skipped_stop_ids.includes(stop.id)),
    missed: Boolean(session?.missed_stop_ids.includes(stop.id)),
    replayable: Boolean(
      session?.completed_stop_ids.includes(stop.id)
      || session?.skipped_stop_ids.includes(stop.id)
      || session?.missed_stop_ids.includes(stop.id)
    ),
  }));
}

function sourceList(meta: Record<string, unknown>): OriginalUiSource[] {
  const values = Array.isArray(meta.sources) ? meta.sources : [];
  return values.map(value => {
    const item = record(value);
    return { label: textValue(item, ['label', 'title', 'publisher'], 'Official source'), url: textValue(item, ['url']) || undefined };
  });
}

function detailToUi(item: OriginalDetail, owned: boolean, bundle: OriginalBundleRecord | null, session: OriginalSessionV1 | null): OriginalUiDetail {
  const base = summaryToUi(item, { owned, bundle, session });
  const meta = record(item.public_metadata);
  const preview = item.manifest_preview;
  const stories = previewStories(preview, meta);
  const previewMeta = record(meta.preview_story);
  const previewStory = Object.keys(previewMeta).length ? {
    id: textValue(previewMeta, ['id'], stories[0]?.id || 'preview'),
    sequence: numberValue(previewMeta, ['sequence'], stories[0]?.sequence || 1),
    title: textValue(previewMeta, ['title'], stories[0]?.title || 'Preview'),
    transcript: textValue(previewMeta, ['transcript', 'excerpt']),
    durationLabel: textValue(previewMeta, ['duration_label'], 'Preview'),
  } : stories.find(story => story.transcript);
  const totalOfflineBytes = numberValue(meta, ['offline_bytes', 'offline_size_bytes', 'bundle_bytes'], preview.offline_map?.estimated_bytes || 0);
  return {
    ...base,
    durationLabel: textValue(meta, ['duration_label'], formatDuration(preview.route.duration_s)),
    distanceLabel: textValue(meta, ['distance_label'], formatDistance(preview.route.distance_m)),
    surfaceLabel: preview.access.surface || base.surfaceLabel,
    seasonLabel: textValue(meta, ['season_label'], seasonLabel(preview.season.recommended_months)),
    storyCount: preview.stops.length,
    offlineSizeLabel: textValue(meta, ['offline_size_label'], formatBytes(totalOfflineBytes)),
    overview: textValue(meta, ['overview'], item.summary),
    routeLabel: textValue(meta, ['route_label'], `${item.coverage_region} · ${preview.route.direction || 'Fixed route'}`),
    route: preview.route,
    previewStory,
    stories,
    highlights: stringList(meta, ['highlights', 'route_highlights']).slice(0, 5),
    safetyNotes: [preview.safety.summary, preview.safety.emergency_note, ...preview.safety.disclaimers].filter(Boolean),
    accessNotes: [preview.access.vehicle, preview.access.fees, preview.access.accessibility_notes, preview.season.closures_note].filter(Boolean),
    sources: sourceList(meta),
  };
}

function cachedManifestToUi(
  manifest: OriginalManifestV1,
  access: OriginalLocalAccessV1,
  bundle: OriginalBundleRecord | null,
  session: OriginalSessionV1 | null,
): OriginalUiDetail {
  const citations = new Map<string, OriginalUiSource>();
  manifest.stops.forEach(stop => stop.citations.forEach(citation => {
    citations.set(citation.url || citation.title, { label: citation.title, url: citation.url });
  }));
  const stories = manifestStories(manifest, session);
  const terminalCount = session
    ? new Set([
      ...session.completed_stop_ids,
      ...session.skipped_stop_ids,
      ...session.missed_stop_ids,
    ]).size
    : 0;
  return {
    id: manifest.pack_id,
    slug: access.slug,
    version: manifest.version,
    title: manifest.title || access.title,
    region: manifest.route.direction || 'Downloaded scenic drive',
    summary: manifest.safety.summary,
    durationLabel: formatDuration(manifest.route.duration_s),
    distanceLabel: formatDistance(manifest.route.distance_m),
    surfaceLabel: manifest.access.surface || 'Fixed route',
    seasonLabel: seasonLabel(manifest.season.recommended_months),
    storyCount: manifest.stops.length,
    offlineSizeLabel: formatBytes(bundle?.total_bytes ?? (
      manifest.assets.reduce((sum, asset) => sum + asset.bytes, 0)
      + manifest.offline_map.estimated_bytes
    )),
    priceCredits: 0,
    explorerPriceCredits: 0,
    access: 'owned',
    featured: false,
    progress: manifest.stops.length ? terminalCount / manifest.stops.length : 0,
    downloadState: bundle ? 'ready' : 'not_downloaded',
    overview: manifest.safety.summary,
    routeLabel: manifest.route.direction || 'Saved offline route',
    route: manifest.route,
    previewStory: stories.find(story => Boolean(story.transcript)),
    stories,
    highlights: [
      `${manifest.stops.length} location-triggered stories`,
      `${formatDistance(manifest.route.distance_m)} fixed route`,
      'Saved for offline playback',
    ],
    safetyNotes: [
      manifest.safety.summary,
      manifest.safety.emergency_note,
      ...manifest.safety.disclaimers,
    ].filter(Boolean),
    accessNotes: [
      manifest.access.vehicle,
      manifest.access.fees,
      manifest.access.accessibility_notes,
      manifest.season.closures_note,
    ].filter(Boolean),
    sources: [...citations.values()],
  };
}

async function cachedDetail(id: string, requestedVersion?: number) {
  const scope = ownerScope();
  const accesses = await originalAccessStore.list(scope).catch(() => []);
  const matching = accesses
    .filter(item => item.pack_id === id || item.slug === id)
    .filter(item => requestedVersion == null || item.version === requestedVersion)
    .sort((a, b) => b.version - a.version);
  for (const access of matching) {
    const bundle = await originalBundleStore.get(scope, access.pack_id, access.version);
    if (!bundle) continue;
    const manifest = await originalBundleStore.loadManifest(
      scope,
      access.pack_id,
      access.version,
      false,
    );
    if (!manifest) continue;
    const session = await originalSessionStore.load(scope, access.pack_id, access.version).catch(() => null);
    const verified = await originalBundleStore.verify(scope, access.pack_id, access.version);
    return {
      ...cachedManifestToUi(manifest, access, bundle, session),
      downloadState: verified ? 'ready' as const : 'error' as const,
    };
  }
  return null;
}

async function detailContext(item: OriginalDetail) {
  const [access, bundles, sessions] = await Promise.all([accessRecords(), bundleMap(), sessionMap()]);
  const packKey = identityKey(String(item.id), item.version);
  const slugKey = identityKey(item.slug, item.version);
  const bundle = bundles.get(packKey) || bundles.get(slugKey) || null;
  const session = sessions.get(packKey) || sessions.get(slugKey) || null;
  return { owned: hasExactAccess(access, String(item.id), item.slug, item.version), bundle, session };
}

export async function listOriginals(_options: ListUiOptions = {}): Promise<OriginalUiSummary[]> {
  const config = await api.getConfig().catch(() => null);
  if (!config) throw new Error('Trailhead Originals availability could not be verified. Connect and try again.');
  if (!config.originals_enabled) throw new Error('Trailhead Originals are not enabled in this release.');
  const [catalog, access, bundles, sessions] = await Promise.all([
    originalsApi.list({ limit: 40 }),
    accessRecords(),
    bundleMap(),
    sessionMap(),
  ]);
  const items = Array.isArray(catalog?.items) ? catalog.items : [];
  const normalized = items
    .map(item => summaryToUi(item, {
      owned: hasExactAccess(access, String(item.id), item.slug, item.version),
      bundle: bundles.get(identityKey(String(item.id), item.version)) || bundles.get(identityKey(item.slug, item.version)),
      session: sessions.get(identityKey(String(item.id), item.version)) || sessions.get(identityKey(item.slug, item.version)),
    }))
    .sort((a, b) => Number(b.featured) - Number(a.featured));
  return normalized;
}

export async function listOwnedOriginals() {
  const [online, ownedResponse, bundles, sessions] = await Promise.all([
    listOriginals({ includeOwnedState: true }).catch(() => []),
    useStore.getState().token
      ? originalsApi.owned().catch(() => ({ items: [] }))
      : Promise.resolve({ items: [] }),
    bundleMap(),
    sessionMap(),
  ]);
  const pinnedOnline = ownedResponse.items.map(item => {
    const pack = item.pack;
    const key = identityKey(String(pack.id), pack.version);
    const slugKey = identityKey(pack.slug, pack.version);
    return summaryToUi(pack, {
      owned: true,
      bundle: bundles.get(key) || bundles.get(slugKey),
      session: sessions.get(key) || sessions.get(slugKey),
    });
  });
  const localAccess = await originalAccessStore.list(ownerScope()).catch(() => []);
  const cached = (await Promise.all(localAccess.map(item => cachedDetail(item.pack_id, item.version))))
    .filter(Boolean) as OriginalUiDetail[];
  const byVersion = new Map<string, OriginalUiSummary>();
  [...online, ...pinnedOnline, ...cached].forEach(item => {
    if (item.access === 'owned' || item.downloadState === 'ready') {
      byVersion.set(identityKey(item.id, item.version), item);
    }
  });
  return [...byVersion.values()];
}

export async function restoreOwnedOriginals() {
  const accountId = useStore.getState().user?.id;
  if (accountId == null || !useStore.getState().token) throw new Error('Sign in to restore Originals.');
  const restored = await originalsApi.restore();
  if (String(useStore.getState().user?.id ?? '') !== String(accountId)) {
    throw new Error('The signed-in account changed while Originals were restoring.');
  }
  await Promise.all(restored.items.map(item => (
    originalAccessStore.recordEntitlement(item, accountId)
  )));
  return restored.items.length;
}

export async function getOriginalDetail(id: string, requestedVersion?: number): Promise<OriginalUiDetail> {
  const local = await cachedDetail(id, requestedVersion);
  const config = await api.getConfig().catch(() => null);
  if (config?.originals_enabled) {
    try {
      const item = await originalsApi.detail(id);
      if (requestedVersion == null || item.version === requestedVersion) {
        const context = await detailContext(item);
        return detailToUi(item, context.owned, context.bundle, context.session);
      }
      const scope = ownerScope();
      const access = (await originalAccessStore.list(scope)).find(value => (
        (value.pack_id === id || value.slug === id) && value.version === requestedVersion
      ));
      if (access) {
        const [ownedManifest, ownedBundle, ownedSession] = await Promise.all([
          originalsApi.manifest(access.pack_id, requestedVersion),
          originalBundleStore.get(scope, access.pack_id, requestedVersion),
          originalSessionStore.load(scope, access.pack_id, requestedVersion),
        ]);
        return cachedManifestToUi(ownedManifest, access, ownedBundle, ownedSession);
      }
    } catch {
      // A verified, exact-version local copy remains usable in airplane mode.
    }
  }
  if (local) return local;
  throw new Error(config
    ? 'Trailhead Originals are not available in this release.'
    : 'Trailhead Originals availability could not be verified. Connect and try again.');
}

export async function acquireOriginal(id: string, version: number): Promise<OriginalUiAcquireResult> {
  const acquisition: OriginalAcquisition = await originalsApi.acquire(id, {
    idempotencyKey: `original:${id}:${version}`,
    version,
  });
  if ('guest_access' in acquisition && acquisition.guest_access) {
    await originalAccessStore.claimGuest(acquisition);
    return { access: 'owned', alreadyOwned: false };
  }
  const userId = useStore.getState().user?.id;
  if (userId != null) await originalAccessStore.recordEntitlement(acquisition, userId);
  return {
    access: 'owned',
    alreadyOwned: acquisition.already_owned,
    creditBalance: acquisition.credit_balance,
  };
}

export async function getOriginalBundleState(id: string, version: number): Promise<OriginalUiBundleState> {
  const scope = ownerScope();
  const accesses = await originalAccessStore.list(scope).catch(() => []);
  const exactAccess = accesses.find(item => (
    (item.pack_id === id || item.slug === id) && item.version === version
  ));
  const anyAccess = exactAccess ?? accesses
    .filter(item => item.pack_id === id || item.slug === id)
    .sort((a, b) => b.version - a.version)[0];
  if (!anyAccess) {
    return { state: 'not_downloaded', progress: 0, downloadedBytes: 0, totalBytes: 0 };
  }
  const exact = exactAccess
    ? await originalBundleStore.get(scope, exactAccess.pack_id, version)
    : null;
  const bundle = exact ?? await originalBundleStore.getPinned(scope, anyAccess.pack_id);
  if (!bundle) return { state: 'not_downloaded', progress: 0, downloadedBytes: 0, totalBytes: 0 };
  const bundleAccess = accesses.find(item => (
    item.pack_id === bundle.pack_id && item.version === bundle.version
  ));
  if (!bundleAccess) {
    return { state: 'not_downloaded', progress: 0, downloadedBytes: 0, totalBytes: 0 };
  }
  const verified = await originalBundleStore.verify(scope, bundle.pack_id, bundle.version);
  return {
    state: verified ? (bundle.version === version ? 'ready' : 'update_available') : 'error',
    progress: verified ? 1 : 0,
    downloadedBytes: verified ? bundle.total_bytes : 0,
    totalBytes: bundle.total_bytes,
    installedVersion: bundle.version,
    ...(!verified ? { error: 'Downloaded files need to be verified again.' } : {}),
  };
}

function progressState(value: OriginalBundleProgress): OriginalUiBundleState {
  return {
    state: 'downloading',
    progress: value.percentage / 100,
    downloadedBytes: value.completed_bytes,
    totalBytes: value.total_bytes,
  };
}

export async function downloadOriginalBundle(
  id: string,
  version: number,
  onProgress?: (value: OriginalUiBundleState) => void,
) {
  const scope = ownerScope();
  const access = (await originalAccessStore.list(scope)).find(item => (
    (item.pack_id === id || item.slug === id) && item.version === version
  ));
  if (!access) throw new Error('Acquire this exact Original version before downloading it.');
  const manifest = await originalsApi.manifest(access.pack_id, version);
  const token = await storage.get('trailhead_token').catch(() => null);
  const record = await originalBundleStore.download(manifest, {
    ownerScope: scope,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    onProgress: value => onProgress?.(progressState(value)),
  });
  return {
    state: 'ready',
    progress: 1,
    downloadedBytes: record.total_bytes,
    totalBytes: record.total_bytes,
  } satisfies OriginalUiBundleState;
}

function storyForStop(stop: OriginalStopV1 | undefined, session?: OriginalSessionV1 | null): OriginalUiStory | undefined {
  if (!stop) return undefined;
  return {
    id: stop.id,
    sequence: stop.sequence,
    title: stop.title,
    transcript: stop.transcript,
    durationLabel: formatDuration(stop.audio_duration_s),
    completed: Boolean(session?.completed_stop_ids.includes(stop.id)),
    skipped: Boolean(session?.skipped_stop_ids.includes(stop.id)),
    missed: Boolean(session?.missed_stop_ids.includes(stop.id)),
    replayable: Boolean(
      session?.completed_stop_ids.includes(stop.id)
      || session?.skipped_stop_ids.includes(stop.id)
      || session?.missed_stop_ids.includes(stop.id)
    ),
  };
}

export function originalSessionToUi(
  session: OriginalSessionV1,
  manifest: OriginalManifestV1,
  muted = false,
): OriginalUiSession {
  const terminal = new Set([...session.completed_stop_ids, ...session.skipped_stop_ids, ...session.missed_stop_ids]);
  const current = manifest.stops.find(stop => stop.id === session.current_stop_id);
  const next = manifest.stops.find(stop => !terminal.has(stop.id) && stop.id !== session.current_stop_id);
  const status = session.status === 'completed'
    ? 'completed'
    : session.tracking_state === 'off_route'
      ? 'off_route'
      : session.tracking_state === 'poor_accuracy'
        ? 'location_unavailable'
        : session.user_paused || session.status === 'paused'
          ? 'paused'
          : session.status === 'active'
            ? 'active'
            : 'ready';
  return {
    status,
    originalId: session.pack_id,
    version: session.version,
    currentStory: storyForStop(current, session),
    nextStory: storyForStop(next, session),
    playedCount: session.completed_stop_ids.length,
    missedCount: session.missed_stop_ids.length,
    totalCount: manifest.stops.length,
    progress: manifest.stops.length ? terminal.size / manifest.stops.length : 0,
    audioPosition: session.current_audio_position_ms / 1000,
    audioDuration: current?.audio_duration_s || 0,
    muted,
    userPaused: session.user_paused,
    message: status === 'off_route' ? 'Rejoin the published route to re-arm the next story.' : status === 'location_unavailable' ? 'Waiting for location accuracy to improve.' : undefined,
  };
}

export { manifestStories };
