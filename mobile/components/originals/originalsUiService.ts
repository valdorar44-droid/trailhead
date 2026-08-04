import { useStore } from '@/lib/store';
import { accountStorage } from '@/lib/storage';
import {
  ORIGINALS_ANALYTICS_EVENTS,
  originalAccessStore,
  originalLocalAccessIsCurrent,
  ORIGINAL_EXPLORER_ACCESS_REQUIRED,
  originalBundleStore,
  originalOwnerScopeForAccount,
  getOriginalPreviewToken,
  originalRestoreScopeIsCurrent,
  originalSessionStore,
  compileOriginalManifestV2Selections,
  resolveOriginalManifestForPlayback,
  originalSummaryForLocalAccess,
  trackOriginalsAnalyticsEvent,
  originalsApi,
  type OriginalBundleProgress,
  type OriginalBundleRecord,
  type OriginalAcquisition,
  type OriginalAccessMode,
  type OriginalDetail,
  type OriginalManifestPreviewV1,
  type OriginalManifestPreviewV2,
  type OriginalManifest,
  type OriginalManifestV1,
  type OriginalManifestV2,
  type OriginalLocalAccessV1,
  type OriginalOwnerScope,
  type OriginalSessionV1,
  type OriginalStopV1,
  type OriginalSummary,
} from '@/lib/originals';
import type {
  OriginalUiAcquireResult,
  OriginalUiBundleState,
  OriginalUiChapterSelection,
  OriginalUiDetail,
  OriginalUiSession,
  OriginalUiSource,
  OriginalUiStory,
  OriginalUiSummary,
} from './types';

type ListUiOptions = { includeOwnedState?: boolean };

const ORIGINAL_HERO_IMAGE_FALLBACKS: Record<string, string> = {
  // Mesa Arch at Island in the Sky. NPS / Neal Herbert; public-domain NPS
  // media. Keep this presentation fallback until the next
  // immutable Moab version carries the same licensed artwork in metadata.
  'moab-canyons-to-the-sky': 'https://www.nps.gov/common/uploads/structured_data/3C7A525D-1DD8-B71B-0B8E59D2EB39F6D0.jpg?maxwidth=1400&autorotate=false&quality=78&format=jpg',
  original_moab_canyons_to_sky: 'https://www.nps.gov/common/uploads/structured_data/3C7A525D-1DD8-B71B-0B8E59D2EB39F6D0.jpg?maxwidth=1400&autorotate=false&quality=78&format=jpg',
};

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

function originalHeroImageUrl(
  identity: { id: string; slug: string },
  metadata: Record<string, unknown>,
  downloadedArtworkUri?: string,
) {
  return textValue(metadata, ['hero_image_url', 'image_url'])
    || downloadedArtworkUri
    || ORIGINAL_HERO_IMAGE_FALLBACKS[identity.slug]
    || ORIGINAL_HERO_IMAGE_FALLBACKS[identity.id]
    || undefined;
}

function downloadedHeroArtwork(
  manifest: OriginalManifest,
  bundle: OriginalBundleRecord | null,
) {
  if (!bundle?.assets?.length) return undefined;
  const authoredArtworkIds = new Set(
    (manifest.schema_version === 1 ? manifest.stops : manifest.stories)
      .map(story => story.artwork_asset_id)
      .filter(Boolean),
  );
  return bundle.assets.find(asset => authoredArtworkIds.has(asset.id))?.local_uri
    || bundle.assets.find(asset => asset.kind === 'image')?.local_uri;
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

function formatCoverageRegion(value: string, fallback = 'Scenic drive') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === 'north_america') return 'North America';
  if (normalized === 'global') return 'Worldwide';
  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, character => character.toUpperCase());
}

export function originalSeasonLabel(months?: number[]) {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const valid = [...new Set((months ?? []).filter(month => Number.isInteger(month) && month >= 1 && month <= 12))]
    .sort((left, right) => left - right);
  if (!valid.length) return 'Seasonal';
  if (valid.length === 12) return 'Year-round';
  const ranges: Array<[number, number]> = [];
  valid.forEach(month => {
    const current = ranges[ranges.length - 1];
    if (current && month === current[1] + 1) current[1] = month;
    else ranges.push([month, month]);
  });
  return ranges.map(([start, end]) => (
    start === end ? names[start - 1] : `${names[start - 1]}–${names[end - 1]}`
  )).join(' · ');
}

export function originalPermanentUnlockOffer(detail: OriginalUiDetail | null | undefined) {
  const creditCost = Number(detail?.permanentPriceCredits);
  if (
    detail?.accessKind !== 'explorer_subscription'
    || !Number.isFinite(creditCost)
    || creditCost <= 0
  ) return null;
  return {
    creditCost,
    label: `Keep permanently · ${creditCost} credits`,
  };
}

function ownerScope(): OriginalOwnerScope {
  return originalOwnerScopeForAccount(useStore.getState().user?.id);
}

async function originalsAvailability(authToken: string | null) {
  const features = await originalsApi.availability(undefined, authToken).catch(() => null);
  return {
    verified: features != null,
    enabled: Boolean(features?.originals),
  };
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
  return originalLocalAccessIsCurrent(records.get(identityKey(packId, version)))
    || originalLocalAccessIsCurrent(records.get(identityKey(slug, version)));
}

function exactAccessRecord(
  records: Map<string, OriginalLocalAccessV1>,
  packId: string,
  slug: string,
  version: number,
  allowAdminPreview = false,
) {
  const candidates = [
    records.get(identityKey(packId, version)),
    records.get(identityKey(slug, version)),
  ];
  return candidates.find(candidate => originalLocalAccessIsCurrent(
    candidate,
    undefined,
    { allowAdminPreview },
  )) ?? null;
}

async function accessRecords(
  scope: OriginalOwnerScope = ownerScope(),
  accountId: string | number | null = useStore.getState().user?.id ?? null,
  requestEpoch = accountStorage.epoch(),
  requestToken: string | null = useStore.getState().token ?? null,
  requestIsAdmin = Boolean(useStore.getState().user?.is_admin),
) {
  const scopeIsCurrent = () => originalRestoreScopeIsCurrent(
    scope,
    requestEpoch,
    accountStorage.epoch(),
    useStore.getState().user?.id ?? null,
  );
  const local = await currentUserAccessRecords(scope, requestIsAdmin);
  if (!scopeIsCurrent()) throw new Error('The signed-in account changed. Try again.');
  if (requestToken && accountId != null && scope !== 'guest') {
    const owned = await originalsApi.owned(undefined, requestToken).catch(() => ({ items: [] }));
    if (!scopeIsCurrent()) throw new Error('The signed-in account changed. Try again.');
    const persisted = await accountStorage.run(async () => {
      if (!scopeIsCurrent()) return false;
      await Promise.all(owned.items.map(item => (
        originalAccessStore.recordEntitlement(item, accountId).catch(() => null)
      )));
      return scopeIsCurrent();
    }, requestEpoch);
    if (persisted !== true || !scopeIsCurrent()) throw new Error('The signed-in account changed. Try again.');
    const refreshed = await originalAccessStore.list(scope).catch(() => local);
    if (!scopeIsCurrent()) throw new Error('The signed-in account changed. Try again.');
    local.splice(0, local.length, ...refreshed);
  }
  const records = new Map<string, OriginalLocalAccessV1>();
  local.forEach(item => {
    records.set(identityKey(item.pack_id, item.version), item);
    records.set(identityKey(item.slug, item.version), item);
  });
  return records;
}

async function currentUserAccessRecords(scope: OriginalOwnerScope, isAdmin = Boolean(useStore.getState().user?.is_admin)) {
  const records = await originalAccessStore.list(scope).catch(() => []);
  return isAdmin ? records : records.filter(item => item.access_type !== 'admin_preview');
}

async function bundleMap(scope: OriginalOwnerScope = ownerScope()) {
  const records = await originalBundleStore.list(scope).catch(() => []);
  return new Map(records.map(item => [identityKey(item.pack_id, item.version), item]));
}

async function sessionMap(scope: OriginalOwnerScope = ownerScope()) {
  const sessions = (await originalSessionStore.list(scope).catch(() => []))
    .sort((a, b) => b.updated_at_ms - a.updated_at_ms);
  const byPack = new Map<string, OriginalSessionV1>();
  sessions.forEach(item => {
    const key = identityKey(item.pack_id, item.version);
    if (!byPack.has(key)) byPack.set(key, item);
  });
  return byPack;
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
  const metadataPolicy = record(meta.access_policy);
  const accessPolicy = item.access_policy ?? (
    metadataPolicy.schema_version === 1
      ? {
        schema_version: 1 as const,
        explorer_included: metadataPolicy.explorer_included === true,
        permanent_credit_price: Number(metadataPolicy.permanent_credit_price),
      }
      : undefined
  );
  const access = options.owned ? 'owned' : item.free || item.price_credits === 0 ? 'free' : 'paid';
  const terminalCount = options.session
    ? new Set([
      ...options.session.completed_stop_ids,
      ...options.session.skipped_stop_ids,
      ...options.session.missed_stop_ids,
    ]).size
    : 0;
  const totalStops = Math.max(storyCount, terminalCount);
  const region = textValue(meta, ['region', 'location_label'])
    || formatCoverageRegion(item.coverage_region);
  return {
    id: String(item.id),
    slug: item.slug,
    version: item.version,
    title: item.title,
    region,
    summary: item.summary,
    durationLabel: textValue(meta, ['duration_label'], formatDuration(durationS)),
    distanceLabel: textValue(meta, ['distance_label'], formatDistance(distanceM)),
    surfaceLabel: textValue(meta, ['surface_label', 'surface'], 'Paved'),
    seasonLabel: textValue(meta, ['season_label', 'season'], 'Seasonal'),
    storyCount: Math.max(1, storyCount || 1),
    offlineSizeLabel: textValue(meta, ['offline_size_label'], formatBytes(totalBytes)),
    priceCredits: item.price_credits,
    explorerPriceCredits: item.explorer_price_credits,
    explorerIncluded: accessPolicy?.explorer_included === true,
    permanentPriceCredits: Number.isFinite(accessPolicy?.permanent_credit_price)
      ? accessPolicy?.permanent_credit_price
      : item.price_credits,
    access,
    featured: item.featured,
    heroImageUrl: originalHeroImageUrl(item, meta),
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
    const role = textValue(item, ['role']) === 'operational' ? 'operational' : 'story';
    const authorityValue = textValue(item, ['authority']);
    const authority = authorityValue === 'official' || authorityValue === 'authoritative' ? authorityValue : undefined;
    return {
      label: textValue(item, ['label', 'title', 'publisher'], 'Official source'),
      url: textValue(item, ['url']) || undefined,
      role,
      authority,
      scope: stringList(item, ['scope']),
    };
  });
}

function compiledManifestSources(
  manifest: OriginalManifestV1,
  operational: OriginalUiSource[] = [],
) {
  const sources = new Map<string, OriginalUiSource>();
  manifest.stops.forEach(stop => stop.citations.forEach(citation => {
    const value: OriginalUiSource = {
      label: citation.title,
      url: citation.url,
      role: citation.role === 'operational' ? 'operational' : 'story',
      authority: citation.authority || undefined,
      scope: Array.isArray(citation.scope) ? citation.scope : [],
    };
    sources.set(`${value.role}:${value.url || value.label}`, value);
  }));
  operational.forEach(source => sources.set(`${source.role}:${source.url || source.label}`, source));
  return [...sources.values()];
}

function previewChapterSelections(
  preview: OriginalManifestPreviewV2,
): OriginalUiChapterSelection[] {
  return [...preview.chapters]
    .sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id))
    .flatMap(chapter => [...chapter.variants]
      .sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id))
      .map(variant => ({
        chapterId: chapter.id,
        chapterSequence: chapter.sequence,
        chapterTitle: chapter.title,
        chapterSummary: chapter.summary,
        variantId: variant.id,
        variantSequence: variant.sequence,
        variantTitle: variant.title,
        isDefault: variant.id === chapter.default_variant_id,
        direction: variant.direction,
        durationLabel: formatDuration(variant.duration_s),
        distanceLabel: formatDistance(variant.distance_m),
        storyCount: variant.story_count,
        cueCount: variant.cue_count,
      })));
}

function manifestChapterSelections(
  manifest: OriginalManifestV2,
  sessions: OriginalSessionV1[] = [],
): OriginalUiChapterSelection[] {
  const chapters = new Map(manifest.chapters.map(chapter => [chapter.id, chapter]));
  return compileOriginalManifestV2Selections(manifest).map(({ selection, compiled }) => {
    const chapter = chapters.get(selection.chapter_id)!;
    const routeManifest = compiled.manifest;
    const matchingSession = sessions.find(session => (
      session.chapter_selection?.chapter_id === selection.chapter_id
      && session.chapter_selection.variant_id === selection.variant_id
    )) ?? null;
    const operational = chapter.operational_sources.map(source => ({
      label: source.title,
      url: source.url,
      role: 'operational' as const,
      authority: source.authority,
      scope: [...source.scope],
    }));
    return {
      chapterId: selection.chapter_id,
      chapterSequence: selection.chapter_sequence,
      chapterTitle: selection.chapter_title,
      chapterSummary: selection.chapter_summary,
      variantId: selection.variant_id,
      variantSequence: selection.variant_sequence,
      variantTitle: selection.variant_title,
      isDefault: selection.is_default,
      direction: selection.direction,
      durationLabel: formatDuration(selection.duration_s),
      distanceLabel: formatDistance(selection.distance_m),
      storyCount: selection.story_count,
      cueCount: selection.cue_count,
      route: routeManifest.route,
      stories: manifestStories(routeManifest, matchingSession),
      surfaceLabel: routeManifest.access.surface,
      seasonLabel: originalSeasonLabel(routeManifest.season.recommended_months),
      safetyNotes: [
        routeManifest.safety.summary,
        routeManifest.safety.emergency_note,
        ...routeManifest.safety.disclaimers,
      ].filter(Boolean),
      accessNotes: [
        routeManifest.access.vehicle,
        routeManifest.access.fees,
        routeManifest.access.accessibility_notes,
        routeManifest.season.closures_note,
      ].filter(Boolean),
      sources: compiledManifestSources(routeManifest, operational),
    };
  });
}

function defaultChapterSelection(
  selections: OriginalUiChapterSelection[],
  session?: OriginalSessionV1 | null,
) {
  if (session?.chapter_selection) {
    const resumed = selections.find(selection => (
      selection.chapterId === session.chapter_selection?.chapter_id
      && selection.variantId === session.chapter_selection.variant_id
    ));
    if (resumed) return resumed;
  }
  return selections.find(selection => selection.isDefault) ?? selections[0];
}

export function selectOriginalUiChapter(
  detail: OriginalUiDetail,
  chapterId: string,
  variantId: string,
): OriginalUiDetail {
  if (detail.manifestSchemaVersion !== 2) return detail;
  const selection = detail.chapterSelections?.find(item => (
    item.chapterId === chapterId && item.variantId === variantId
  ));
  if (!selection) return detail;
  const stories = selection.stories ?? [];
  return {
    ...detail,
    durationLabel: selection.durationLabel,
    distanceLabel: selection.distanceLabel,
    surfaceLabel: selection.surfaceLabel || detail.surfaceLabel,
    seasonLabel: selection.seasonLabel || detail.seasonLabel,
    storyCount: selection.storyCount,
    cueCount: selection.cueCount,
    overview: selection.chapterSummary,
    routeLabel: `${selection.chapterTitle} · ${selection.variantTitle}`,
    route: selection.route,
    previewStory: stories.find(story => Boolean(story.transcript)),
    stories,
    safetyNotes: selection.safetyNotes ?? detail.safetyNotes,
    accessNotes: selection.accessNotes ?? detail.accessNotes,
    sources: selection.sources ?? detail.sources,
    defaultChapterId: selection.chapterId,
    defaultVariantId: selection.variantId,
  };
}

function detailToUi(
  item: OriginalDetail,
  owned: boolean,
  bundle: OriginalBundleRecord | null,
  session: OriginalSessionV1 | null,
  downloadedManifest?: OriginalManifest | null,
  accessKind?: OriginalLocalAccessV1['access_type'],
  selectionSessions: OriginalSessionV1[] = session ? [session] : [],
): OriginalUiDetail {
  const base = { ...summaryToUi(item, { owned, bundle, session }), accessKind };
  const meta = record(item.public_metadata);
  const preview = item.manifest_preview;
  if (preview.schema_version === 2) {
    const selections = downloadedManifest?.schema_version === 2
      ? manifestChapterSelections(downloadedManifest, selectionSessions)
      : previewChapterSelections(preview);
    const selected = defaultChapterSelection(selections, session);
    if (!selected) throw new Error('This Original does not contain a selectable route chapter.');
    const totalOfflineBytes = numberValue(
      meta,
      ['offline_bytes', 'offline_size_bytes', 'bundle_bytes'],
      Number(preview.offline_map?.estimated_bytes) || 0,
    );
    const initial: OriginalUiDetail = {
      ...base,
      manifestSchemaVersion: 2,
      durationLabel: selected.durationLabel,
      distanceLabel: selected.distanceLabel,
      surfaceLabel: selected.surfaceLabel || base.surfaceLabel,
      seasonLabel: selected.seasonLabel || base.seasonLabel,
      storyCount: selected.storyCount,
      cueCount: selected.cueCount,
      offlineSizeLabel: textValue(meta, ['offline_size_label'], formatBytes(totalOfflineBytes)),
      overview: selected.chapterSummary,
      routeLabel: `${selected.chapterTitle} · ${selected.variantTitle}`,
      route: selected.route,
      previewStory: selected.stories?.find(story => Boolean(story.transcript)),
      stories: selected.stories ?? [],
      chapterSelections: selections,
      defaultChapterId: selected.chapterId,
      defaultVariantId: selected.variantId,
      highlights: stringList(meta, ['highlights', 'route_highlights']).slice(0, 5),
      safetyNotes: selected.safetyNotes ?? [],
      accessNotes: selected.accessNotes ?? [],
      sources: selected.sources ?? sourceList(meta),
    };
    return selectOriginalUiChapter(initial, selected.chapterId, selected.variantId);
  }
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
    manifestSchemaVersion: 1,
    durationLabel: textValue(meta, ['duration_label'], formatDuration(preview.route.duration_s)),
    distanceLabel: textValue(meta, ['distance_label'], formatDistance(preview.route.distance_m)),
    surfaceLabel: preview.access.surface || base.surfaceLabel,
    seasonLabel: textValue(meta, ['season_label'], originalSeasonLabel(preview.season.recommended_months)),
    storyCount: preview.stops.length,
    offlineSizeLabel: textValue(meta, ['offline_size_label'], formatBytes(totalOfflineBytes)),
    overview: textValue(meta, ['overview'], item.summary),
    routeLabel: textValue(meta, ['route_label'], `${base.region} · ${preview.route.direction || 'Fixed route'}`),
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
  manifest: OriginalManifest,
  access: OriginalLocalAccessV1,
  bundle: OriginalBundleRecord | null,
  session: OriginalSessionV1 | null,
  selectionSessions: OriginalSessionV1[] = session ? [session] : [],
): OriginalUiDetail {
  const cachedMetadata = record(access.pack_summary?.public_metadata);
  if (manifest.schema_version === 2) {
    const selections = manifestChapterSelections(manifest, selectionSessions);
    const selected = defaultChapterSelection(selections, session);
    if (!selected) throw new Error('This downloaded Original has no selectable route chapter.');
    const stories = selected.stories ?? [];
    const terminalCount = session
      ? new Set([
        ...session.completed_stop_ids,
        ...session.skipped_stop_ids,
        ...session.missed_stop_ids,
      ]).size
      : 0;
    const region = textValue(cachedMetadata, ['region', 'location_label'])
      || formatCoverageRegion(access.pack_summary?.coverage_region || '');
    const initial: OriginalUiDetail = {
      id: manifest.pack_id,
      slug: access.slug,
      version: manifest.version,
      title: manifest.title || access.title,
      region,
      summary: access.pack_summary?.summary || selected.chapterSummary,
      durationLabel: selected.durationLabel,
      distanceLabel: selected.distanceLabel,
      surfaceLabel: selected.surfaceLabel || 'Scenic drive',
      seasonLabel: selected.seasonLabel || 'Check current conditions',
      storyCount: selected.storyCount,
      cueCount: selected.cueCount,
      offlineSizeLabel: formatBytes(bundle?.total_bytes ?? (
        manifest.assets.reduce((sum, asset) => sum + asset.bytes, 0)
        + manifest.offline_map.estimated_bytes
      )),
      priceCredits: access.pack_summary?.price_credits ?? 0,
      explorerPriceCredits: access.pack_summary?.explorer_price_credits ?? 0,
      explorerIncluded: access.pack_summary?.access_policy?.explorer_included,
      permanentPriceCredits: access.pack_summary?.access_policy?.permanent_credit_price,
      access: 'owned',
      accessKind: access.access_type,
      adminPreview: access.access_type === 'admin_preview',
      featured: access.pack_summary?.featured ?? false,
      heroImageUrl: originalHeroImageUrl(
        { id: manifest.pack_id, slug: access.slug },
        cachedMetadata,
        downloadedHeroArtwork(manifest, bundle),
      ),
      progress: stories.length ? terminalCount / stories.length : 0,
      downloadState: bundle ? 'ready' : 'not_downloaded',
      manifestSchemaVersion: 2,
      overview: selected.chapterSummary,
      routeLabel: `${selected.chapterTitle} · ${selected.variantTitle}`,
      route: selected.route,
      previewStory: stories.find(story => Boolean(story.transcript)),
      stories,
      chapterSelections: selections,
      defaultChapterId: selected.chapterId,
      defaultVariantId: selected.variantId,
      highlights: [
        `${selected.storyCount} full stories · ${selected.cueCount} shorter cues`,
        `${selected.distanceLabel} route`,
        'Saved for offline playback',
      ],
      safetyNotes: selected.safetyNotes ?? [],
      accessNotes: selected.accessNotes ?? [],
      sources: selected.sources ?? [],
    };
    return selectOriginalUiChapter(initial, selected.chapterId, selected.variantId);
  }
  const citations = new Map<string, OriginalUiSource>();
  manifest.stops.forEach(stop => stop.citations.forEach(citation => {
    citations.set(citation.url || citation.title, {
      label: citation.title,
      url: citation.url,
      role: citation.role === 'operational' ? 'operational' : 'story',
      authority: citation.authority || undefined,
      scope: Array.isArray(citation.scope) ? citation.scope : [],
    });
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
    seasonLabel: originalSeasonLabel(manifest.season.recommended_months),
    storyCount: manifest.stops.length,
    offlineSizeLabel: formatBytes(bundle?.total_bytes ?? (
      manifest.assets.reduce((sum, asset) => sum + asset.bytes, 0)
      + manifest.offline_map.estimated_bytes
    )),
    priceCredits: 0,
    explorerPriceCredits: 0,
    access: 'owned',
    accessKind: access.access_type,
    adminPreview: access.access_type === 'admin_preview',
    featured: false,
    heroImageUrl: originalHeroImageUrl(
      { id: manifest.pack_id, slug: access.slug },
      cachedMetadata,
      downloadedHeroArtwork(manifest, bundle),
    ),
    progress: manifest.stops.length ? terminalCount / manifest.stops.length : 0,
    downloadState: bundle ? 'ready' : 'not_downloaded',
    manifestSchemaVersion: 1,
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

async function cachedAccessDetail(access: OriginalLocalAccessV1, scope: OriginalOwnerScope) {
  if (!originalLocalAccessIsCurrent(access, undefined, {
    allowAdminPreview: Boolean(useStore.getState().user?.is_admin),
  })) return null;
  const bundle = await originalBundleStore.get(scope, access.pack_id, access.version);
  if (!bundle) return null;
  const manifest = await originalBundleStore.loadManifest(
    scope,
    access.pack_id,
    access.version,
    false,
  );
  if (!manifest) return null;
  const selectionSessions = (await originalSessionStore.list(scope).catch(() => []))
    .filter(item => item.pack_id === access.pack_id && item.version === access.version)
    .sort((left, right) => right.updated_at_ms - left.updated_at_ms);
  const session = selectionSessions[0] ?? null;
  const verified = await originalBundleStore.verify(scope, access.pack_id, access.version);
  return {
    ...cachedManifestToUi(manifest, access, bundle, session, selectionSessions),
    downloadState: verified ? 'ready' as const : 'error' as const,
  };
}

async function cachedDetail(
  id: string,
  requestedVersion?: number,
  scope: OriginalOwnerScope = ownerScope(),
  isAdmin = Boolean(useStore.getState().user?.is_admin),
) {
  const accesses = await currentUserAccessRecords(scope, isAdmin);
  const matching = accesses
    .filter(item => item.pack_id === id || item.slug === id)
    .filter(item => requestedVersion == null || item.version === requestedVersion)
    .sort((a, b) => b.version - a.version);
  for (const access of matching) {
    const detail = await cachedAccessDetail(access, scope);
    if (detail) return detail;
  }
  return null;
}

async function detailContext(
  item: OriginalDetail,
  scope: OriginalOwnerScope,
  accountId: string | number | null,
  requestEpoch: number,
  requestToken: string | null,
  requestIsAdmin: boolean,
) {
  const [access, bundles, allSessions] = await Promise.all([
    accessRecords(scope, accountId, requestEpoch, requestToken, requestIsAdmin),
    bundleMap(scope),
    originalSessionStore.list(scope).catch(() => []),
  ]);
  const packKey = identityKey(String(item.id), item.version);
  const slugKey = identityKey(item.slug, item.version);
  const bundle = bundles.get(packKey) || bundles.get(slugKey) || null;
  const selectionSessions = allSessions
    .filter(session => (
      (session.pack_id === String(item.id) || session.pack_id === item.slug)
      && session.version === item.version
    ))
    .sort((left, right) => right.updated_at_ms - left.updated_at_ms);
  const session = selectionSessions[0] ?? null;
  const exactAccess = exactAccessRecord(
    access,
    String(item.id),
    item.slug,
    item.version,
    requestIsAdmin,
  );
  const manifest = bundle && exactAccess
    ? await originalBundleStore.loadManifest(scope, bundle.pack_id, bundle.version, false).catch(() => null)
    : null;
  return {
    owned: Boolean(exactAccess),
    accessKind: exactAccess?.access_type,
    bundle,
    session,
    selectionSessions,
    manifest,
  };
}

export async function listOriginals(_options: ListUiOptions = {}): Promise<OriginalUiSummary[]> {
  const accountId = useStore.getState().user?.id ?? null;
  const scope = originalOwnerScopeForAccount(accountId);
  const requestEpoch = accountStorage.epoch();
  const requestToken = accountId == null ? null : useStore.getState().token ?? null;
  const requestIsAdmin = Boolean(useStore.getState().user?.is_admin);
  const scopeIsCurrent = () => originalRestoreScopeIsCurrent(
    scope,
    requestEpoch,
    accountStorage.epoch(),
    useStore.getState().user?.id ?? null,
  );
  const availability = await originalsAvailability(requestToken);
  if (!scopeIsCurrent()) throw new Error('The signed-in account changed. Try again.');
  if (!availability.verified) throw new Error('Trailhead Originals availability could not be verified. Connect and try again.');
  if (!availability.enabled) throw new Error('Trailhead Originals are not enabled in this release.');
  const [catalog, access, bundles, sessions] = await Promise.all([
    originalsApi.list({ limit: 40, authToken: requestToken }),
    accessRecords(scope, accountId, requestEpoch, requestToken, requestIsAdmin),
    bundleMap(scope),
    sessionMap(scope),
  ]);
  if (!scopeIsCurrent()) throw new Error('The signed-in account changed. Try again.');
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

export type OriginalOwnedUiLoadResult = {
  items: OriginalUiSummary[];
  verified: boolean;
  stale: boolean;
  error?: string;
};

const OWNED_REFRESH_ERROR = 'Your Originals could not refresh. Check your connection and retry.';
const ACCOUNT_CHANGED_ERROR = 'The signed-in account changed. Try again.';

export async function listOwnedOriginals(): Promise<OriginalOwnedUiLoadResult> {
  const accountId = useStore.getState().user?.id ?? null;
  const scope = originalOwnerScopeForAccount(accountId);
  const requestEpoch = accountStorage.epoch();
  const requestToken = useStore.getState().token ?? null;
  const hadToken = Boolean(requestToken);
  const scopeIsCurrent = () => originalRestoreScopeIsCurrent(
    scope,
    requestEpoch,
    accountStorage.epoch(),
    useStore.getState().user?.id ?? null,
  );
  const staleResult = (): OriginalOwnedUiLoadResult => ({
    items: [],
    verified: false,
    stale: true,
  });

  const [bundles, sessions, localAccess] = await Promise.all([
    bundleMap(scope),
    sessionMap(scope),
    originalAccessStore.list(scope).catch(() => []),
  ]);
  if (!scopeIsCurrent()) return staleResult();

  const localEntries = (await Promise.all(localAccess
    .filter(item => item.access_type !== 'admin_preview')
    .map(async access => {
      const pack = originalSummaryForLocalAccess(access);
      const packKey = identityKey(String(pack.id), pack.version);
      const accessKey = identityKey(access.pack_id, access.version);
      const slugKey = identityKey(access.slug, access.version);
      const bundle = bundles.get(packKey) || bundles.get(accessKey) || bundles.get(slugKey) || null;
      const session = sessions.get(packKey) || sessions.get(accessKey) || sessions.get(slugKey) || null;
      const cached = bundle
        ? await cachedAccessDetail(access, scope).catch(() => null)
        : null;
      return {
        placeholder: summaryToUi(pack, {
          owned: originalLocalAccessIsCurrent(access),
          bundle,
          session,
        }),
        cached,
      };
    })));
  if (!scopeIsCurrent()) return staleResult();

  const byVersion = new Map<string, OriginalUiSummary>();
  localEntries.forEach(({ placeholder }) => (
    byVersion.set(identityKey(placeholder.id, placeholder.version), placeholder)
  ));
  const applyCachedItems = () => localEntries.forEach(({ cached }) => {
    if (cached) byVersion.set(identityKey(cached.id, cached.version), cached);
  });
  applyCachedItems();
  const mergedItems = () => [...byVersion.values()]
    .sort((a, b) => Number(b.featured) - Number(a.featured) || a.title.localeCompare(b.title));

  // Guest ownership is device-local and authoritative. A free Original must
  // remain visible here immediately after acquisition, before its bundle is downloaded.
  if (scope === 'guest' || !hadToken) {
    return { items: mergedItems(), verified: true, stale: false };
  }
  if (accountId == null) return staleResult();
  const ownedAccountId = accountId;

  const availability = await originalsAvailability(requestToken);
  if (!scopeIsCurrent()) return staleResult();
  if (!availability.verified) {
    return { items: mergedItems(), verified: false, stale: false, error: OWNED_REFRESH_ERROR };
  }
  if (!availability.enabled) {
    return { items: mergedItems(), verified: true, stale: false };
  }

  let ownedResponse;
  try {
    ownedResponse = await originalsApi.owned(undefined, requestToken);
  } catch {
    if (!scopeIsCurrent()) return staleResult();
    return { items: mergedItems(), verified: false, stale: false, error: OWNED_REFRESH_ERROR };
  }
  if (!scopeIsCurrent()) return staleResult();

  ownedResponse.items.forEach(item => {
    const pack = item.pack;
    const key = identityKey(String(pack.id), pack.version);
    const slugKey = identityKey(pack.slug, pack.version);
    byVersion.set(key, summaryToUi(pack, {
      owned: true,
      bundle: bundles.get(key) || bundles.get(slugKey),
      session: sessions.get(key) || sessions.get(slugKey),
    }));
  });
  // A verified local manifest is authoritative for offline/corrupt state and
  // listening progress; the server response supplies ownership metadata only.
  applyCachedItems();

  const persisted = await accountStorage.run(async () => {
    if (!scopeIsCurrent()) return false;
    await Promise.all(ownedResponse.items.map(item => (
      originalAccessStore.recordEntitlement(item, ownedAccountId).catch(() => null)
    )));
    return scopeIsCurrent();
  }, requestEpoch);
  if (persisted !== true || !scopeIsCurrent()) return staleResult();

  return { items: mergedItems(), verified: true, stale: false };
}

export async function restoreOwnedOriginals() {
  const accountId = useStore.getState().user?.id ?? null;
  const requestToken = useStore.getState().token ?? null;
  if (accountId == null || !requestToken) throw new Error('Sign in to restore Originals.');
  const restoreAccountId = accountId;
  const scope = originalOwnerScopeForAccount(accountId);
  const requestEpoch = accountStorage.epoch();
  const scopeIsCurrent = () => originalRestoreScopeIsCurrent(
    scope,
    requestEpoch,
    accountStorage.epoch(),
    useStore.getState().user?.id ?? null,
  );
  const restored = await originalsApi.restore(undefined, requestToken);
  if (!scopeIsCurrent()) throw new Error(ACCOUNT_CHANGED_ERROR);
  const persisted = await accountStorage.run(async () => {
    if (!scopeIsCurrent()) return false;
    await Promise.all(restored.items.map(item => (
      originalAccessStore.recordEntitlement(item, restoreAccountId)
    )));
    return scopeIsCurrent();
  }, requestEpoch);
  if (persisted !== true || !scopeIsCurrent()) throw new Error(ACCOUNT_CHANGED_ERROR);
  return restored.items.length;
}

export async function getOriginalDetail(id: string, requestedVersion?: number): Promise<OriginalUiDetail> {
  const accountId = useStore.getState().user?.id ?? null;
  const scope = originalOwnerScopeForAccount(accountId);
  const requestEpoch = accountStorage.epoch();
  const requestToken = accountId == null ? null : useStore.getState().token ?? null;
  const requestIsAdmin = Boolean(useStore.getState().user?.is_admin);
  const scopeIsCurrent = () => originalRestoreScopeIsCurrent(
    scope,
    requestEpoch,
    accountStorage.epoch(),
    useStore.getState().user?.id ?? null,
  );
  const local = await cachedDetail(id, requestedVersion, scope, requestIsAdmin);
  if (!scopeIsCurrent()) throw new Error(ACCOUNT_CHANGED_ERROR);
  const availability = await originalsAvailability(requestToken);
  if (!scopeIsCurrent()) throw new Error(ACCOUNT_CHANGED_ERROR);
  if (availability.enabled) {
    try {
      const item = await originalsApi.detail(id, undefined, requestToken);
      if (!scopeIsCurrent()) throw new Error(ACCOUNT_CHANGED_ERROR);
      if (requestedVersion == null || item.version === requestedVersion) {
        const context = await detailContext(
          item,
          scope,
          accountId,
          requestEpoch,
          requestToken,
          requestIsAdmin,
        );
        if (!scopeIsCurrent()) throw new Error(ACCOUNT_CHANGED_ERROR);
      return detailToUi(
        item,
        context.owned,
        context.bundle,
       context.session,
       context.manifest,
       context.accessKind,
       context.selectionSessions,
     );
      }
      const access = (await originalAccessStore.list(scope)).find(value => (
        (value.pack_id === id || value.slug === id) && value.version === requestedVersion
      ));
      if (!scopeIsCurrent()) throw new Error(ACCOUNT_CHANGED_ERROR);
      if (access && originalLocalAccessIsCurrent(access, undefined, {
        allowAdminPreview: requestIsAdmin,
      })) {
        const [ownedManifest, ownedBundle, ownedSessions] = await Promise.all([
          originalsApi.manifest(access.pack_id, requestedVersion, undefined, requestToken),
          originalBundleStore.get(scope, access.pack_id, requestedVersion),
          originalSessionStore.list(scope).then(sessions => sessions
            .filter(session => (
              session.pack_id === access.pack_id && session.version === requestedVersion
            ))
            .sort((left, right) => right.updated_at_ms - left.updated_at_ms)),
        ]);
        if (!scopeIsCurrent()) throw new Error(ACCOUNT_CHANGED_ERROR);
        return cachedManifestToUi(
          ownedManifest,
          access,
          ownedBundle,
          ownedSessions[0] ?? null,
          ownedSessions,
        );
      }
    } catch (requestError) {
      if (!scopeIsCurrent()) throw new Error(ACCOUNT_CHANGED_ERROR);
      // A verified, exact-version local copy remains usable in airplane mode.
    }
  }
  if (!scopeIsCurrent()) throw new Error(ACCOUNT_CHANGED_ERROR);
  if (local) return local;
  throw new Error(availability.verified
    ? 'Trailhead Originals are not available in this release.'
    : 'Trailhead Originals availability could not be verified. Connect and try again.');
}

export async function acquireOriginal(
  id: string,
  version: number,
  accessMode: OriginalAccessMode = 'permanent',
): Promise<OriginalUiAcquireResult> {
  const accountId = useStore.getState().user?.id ?? null;
  const requestToken = accountId == null ? null : useStore.getState().token ?? null;
  if (accountId != null && !requestToken) throw new Error('Sign in to acquire this Original.');
  const scope = originalOwnerScopeForAccount(accountId);
  const requestEpoch = accountStorage.epoch();
  const scopeIsCurrent = () => originalRestoreScopeIsCurrent(
    scope,
    requestEpoch,
    accountStorage.epoch(),
    useStore.getState().user?.id ?? null,
  );
  const acquisition: OriginalAcquisition = await originalsApi.acquire(id, {
    idempotencyKey: `original:${id}:${version}:${accessMode}`,
    version,
    accessMode,
    authToken: requestToken,
  });
  if (!scopeIsCurrent()) throw new Error(ACCOUNT_CHANGED_ERROR);
  if ('guest_access' in acquisition && acquisition.guest_access) {
    const persisted = await accountStorage.run(async () => {
      if (!scopeIsCurrent()) return false;
      await originalAccessStore.claimGuest(acquisition);
      return scopeIsCurrent();
    }, requestEpoch);
    if (persisted !== true || !scopeIsCurrent()) throw new Error(ACCOUNT_CHANGED_ERROR);
    return { access: 'owned', alreadyOwned: false };
  }
  if (accountId == null) throw new Error(ACCOUNT_CHANGED_ERROR);
  const persisted = await accountStorage.run(async () => {
    if (!scopeIsCurrent()) return false;
    await originalAccessStore.recordEntitlement(acquisition, accountId);
    return scopeIsCurrent();
  }, requestEpoch);
  if (persisted !== true || !scopeIsCurrent()) throw new Error(ACCOUNT_CHANGED_ERROR);
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
  const exactPreview = exactAccess?.access_type === 'admin_preview';
  if (exactPreview && !useStore.getState().user?.is_admin) {
    return { state: 'not_downloaded', progress: 0, downloadedBytes: 0, totalBytes: 0 };
  }
  const productionAccesses = accesses.filter(item => item.access_type !== 'admin_preview');
  const anyAccess = exactAccess ?? productionAccesses
    .filter(item => item.pack_id === id || item.slug === id)
    .sort((a, b) => b.version - a.version)[0];
  if (!anyAccess) {
    return { state: 'not_downloaded', progress: 0, downloadedBytes: 0, totalBytes: 0 };
  }
  const exact = exactAccess
    ? await originalBundleStore.get(scope, exactAccess.pack_id, version)
    : null;
  let bundle = exact;
  if (!bundle) {
    const candidates = productionAccesses
      .filter(item => item.pack_id === anyAccess.pack_id || item.slug === id)
      .sort((a, b) => b.version - a.version);
    for (const candidate of candidates) {
      bundle = await originalBundleStore.get(scope, candidate.pack_id, candidate.version);
      if (bundle) break;
    }
  }
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

function originalDownloadResult(error: unknown) {
  if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('free storage') || message.includes('not enough storage')) return 'insufficient_storage';
  if (message.includes('checksum') || message.includes('wrong size') || message.includes('corrupt')) return 'corrupt';
  return 'failed';
}

export async function downloadOriginalBundle(
  id: string,
  version: number,
  onProgress?: (value: OriginalUiBundleState) => void,
) {
  try {
    const accountId = useStore.getState().user?.id ?? null;
    const scope = originalOwnerScopeForAccount(accountId);
    const requestEpoch = accountStorage.epoch();
    const requestToken = accountId == null ? null : useStore.getState().token ?? null;
    const scopeIsCurrent = () => originalRestoreScopeIsCurrent(
      scope,
      requestEpoch,
      accountStorage.epoch(),
      useStore.getState().user?.id ?? null,
    );
    const access = (await originalAccessStore.list(scope)).find(item => (
      (item.pack_id === id || item.slug === id) && item.version === version
    ));
    if (!scopeIsCurrent()) throw new Error(ACCOUNT_CHANGED_ERROR);
    if (!access) throw new Error('Acquire this exact Original version before downloading it.');
    if (!originalLocalAccessIsCurrent(access)) {
      if (access.access_type === 'explorer_subscription') {
        throw new Error(ORIGINAL_EXPLORER_ACCESS_REQUIRED);
      }
      throw new Error('Restore or acquire this exact Original version before downloading it.');
    }
    const manifest = await originalsApi.manifest(access.pack_id, version, undefined, requestToken);
    if (!scopeIsCurrent()) throw new Error(ACCOUNT_CHANGED_ERROR);
    const previewToken = await getOriginalPreviewToken().catch(() => null);
    if (!scopeIsCurrent()) throw new Error(ACCOUNT_CHANGED_ERROR);
    const controller = new AbortController();
    const unsubscribe = accountStorage.subscribe(() => {
      if (!scopeIsCurrent()) controller.abort();
    });
    let record;
    try {
      record = await originalBundleStore.download(manifest, {
        ownerScope: scope,
        headers: {
          ...(requestToken ? { Authorization: `Bearer ${requestToken}` } : {}),
          ...(previewToken ? { 'X-Trailhead-Originals-Preview': previewToken } : {}),
        },
        signal: controller.signal,
        onProgress: value => {
          if (scopeIsCurrent()) onProgress?.(progressState(value));
        },
      });
    } finally {
      unsubscribe();
    }
    if (!scopeIsCurrent()) throw new Error(ACCOUNT_CHANGED_ERROR);
    trackOriginalsAnalyticsEvent(ORIGINALS_ANALYTICS_EVENTS.downloadResult, {
      pack_id: id,
      version,
      result: 'ready',
    });
    return {
      state: 'ready',
      progress: 1,
      downloadedBytes: record.total_bytes,
      totalBytes: record.total_bytes,
    } satisfies OriginalUiBundleState;
  } catch (error) {
    trackOriginalsAnalyticsEvent(ORIGINALS_ANALYTICS_EVENTS.downloadResult, {
      pack_id: id,
      version,
      result: originalDownloadResult(error),
    });
    throw error;
  }
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
