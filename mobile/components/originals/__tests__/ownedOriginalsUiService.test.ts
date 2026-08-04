import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build, type Plugin } from 'esbuild';

type UiService = typeof import('../originalsUiService');

const stubs: Record<string, string> = {
  '@/lib/store': `
    const state = () => globalThis.__ownedOriginalsState;
    export function useStore(selector) { return selector(state()); }
    useStore.getState = state;
  `,
  '@/lib/api': `
    export const api = {
      getConfig: async () => ({ originals_enabled: true }),
      productFeatures: async () => ({ originals: true }),
    };
  `,
  '@/lib/storage': `
    export const accountStorage = {
      epoch: () => globalThis.__ownedOriginalsEpoch,
      run: async (operation, epoch) => epoch === globalThis.__ownedOriginalsEpoch ? operation() : undefined,
      subscribe: () => () => {},
    };
  `,
  '@/lib/originals': `
    export const ORIGINALS_ANALYTICS_EVENTS = { downloadResult: 'originals_download_result' };
    export const ORIGINAL_EXPLORER_ACCESS_REQUIRED = 'An active Explorer membership is required to play this Original.';
    export function compileOriginalManifestV2Selections(...args) { return globalThis.__ownedOriginalsCompileSelections(...args); }
    export function originalLocalAccessIsCurrent(access, nowSeconds = Math.floor(Date.now() / 1000), options = {}) {
      if (!access) return false;
      if (access.access_type === 'guest_free' || access.access_type === 'entitled' || access.access_type === 'permanent') return true;
      if (access.access_type === 'admin_preview') return Boolean(options.allowAdminPreview);
      return access.access_type === 'explorer_subscription'
        && access.access_active === true
        && typeof access.access_expires_at === 'number'
        && access.access_expires_at > nowSeconds;
    }
    export function trackOriginalsAnalyticsEvent() {}
    export async function getOriginalPreviewToken() { return globalThis.__ownedOriginalsPreviewToken || null; }
    export const originalAccessStore = {
      list: async (scope) => (globalThis.__ownedOriginalsAccess[scope] || []),
      recordEntitlement: async (...args) => { globalThis.__ownedOriginalsWrites.push(args); },
      remove: async () => {},
      claimGuest: async () => {},
    };
    export const originalBundleStore = {
      list: (...args) => globalThis.__ownedOriginalsBundleList(...args),
      get: (...args) => globalThis.__ownedOriginalsBundleGet(...args),
      loadManifest: (...args) => globalThis.__ownedOriginalsManifestLoad(...args),
      verify: (...args) => globalThis.__ownedOriginalsBundleVerify(...args),
      download: (...args) => globalThis.__ownedOriginalsBundleDownload(...args),
      remove: async () => { globalThis.__ownedOriginalsRemovals += 1; },
    };
    export const originalSessionStore = {
      list: (...args) => globalThis.__ownedOriginalsSessionList(...args),
      load: (...args) => globalThis.__ownedOriginalsSessionLoad(...args),
    };
    export const originalOwnerScopeForAccount = id => id == null ? 'guest' : 'account:' + String(id);
    export const originalRestoreScopeIsCurrent = (scope, epoch, currentEpoch, id) => (
      epoch === currentEpoch && scope === (id == null ? 'guest' : 'account:' + String(id))
    );
    export const originalSummaryForLocalAccess = access => access.pack_summary || ({
      id: access.pack_id,
      slug: access.slug,
      content_kind: 'original_drive',
      version: access.version,
      title: access.title,
      summary: 'Saved Trailhead Original.',
      price_credits: 0,
      explorer_price_credits: 0,
      free: access.access_type === 'guest_free',
      coverage_region: '',
      public_metadata: {},
      published_at: access.claimed_at_ms,
      featured: false,
    });
    export const originalsApi = {
      availability: (...args) => globalThis.__ownedOriginalsAvailability(...args),
      owned: (...args) => globalThis.__ownedOriginalsOwned(...args),
      list: (...args) => globalThis.__ownedOriginalsList(...args),
      restore: async () => ({ items: [] }),
      detail: (...args) => globalThis.__ownedOriginalsDetail(...args),
      manifest: (...args) => globalThis.__ownedOriginalsManifest(...args),
      acquire: async () => { throw new Error('unused'); },
    };
  `,
};

const stubDependencies: Plugin = {
  name: 'stub-owned-originals-ui-service',
  setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => (
      Object.hasOwn(stubs, args.path)
        ? { path: args.path, namespace: 'owned-originals-stub' }
        : null
    ));
    builder.onLoad({ filter: /.*/, namespace: 'owned-originals-stub' }, args => ({
      contents: stubs[args.path],
      loader: 'js',
    }));
  },
};

async function loadService(): Promise<UiService> {
  const result = await build({
    entryPoints: [path.resolve('components/originals/originalsUiService.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    write: false,
    plugins: [stubDependencies],
  });
  const output = result.outputFiles[0]?.text;
  assert.ok(output);
  const require = createRequire(import.meta.url);
  const module = { exports: {} as Record<string, unknown> };
  const evaluate = new Function('require', 'module', 'exports', '__filename', '__dirname', output);
  evaluate(require, module, module.exports, path.resolve('components/originals/originalsUiService.test.cjs'), process.cwd());
  return module.exports as UiService;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const summary = {
  id: 'moab-original',
  slug: 'moab-canyons-to-the-sky',
  content_kind: 'original_drive',
  version: 1,
  title: 'Moab: Canyons to the Sky',
  summary: 'A self-guided scenic drive.',
  price_credits: 0,
  explorer_price_credits: 0,
  free: true,
  coverage_region: 'Moab, Utah',
  public_metadata: { story_count: 11 },
  published_at: 1,
  featured: true,
};

const guestAccess = {
  schema_version: 1,
  pack_id: 'moab-original',
  version: 1,
  slug: summary.slug,
  title: summary.title,
  owner_scope: 'guest',
  access_type: 'guest_free',
  pack_summary: summary,
  claimed_at_ms: 1,
  updated_at_ms: 1,
};

const MOAB_NPS_HERO_PREFIX = 'https://www.nps.gov/common/uploads/structured_data/3C7A525D-1DD8-B71B-0B8E59D2EB39F6D0.jpg';
const DOWNLOADED_ARTWORK_URI = 'file:///originals/moab/mesa-arch.jpg';
const AUTHORED_ARTWORK_URI = 'https://cdn.gettrailhead.app/originals/moab-authored.jpg';

async function main() {
  const globals = globalThis as typeof globalThis & {
    __ownedOriginalsState?: { user: { id: string } | null; token: string | null };
    __ownedOriginalsPreviewToken?: string | null;
    __ownedOriginalsEpoch?: number;
    __ownedOriginalsAccess?: Record<string, unknown[]>;
    __ownedOriginalsWrites?: unknown[];
    __ownedOriginalsOwned?: (...args: unknown[]) => Promise<unknown>;
    __ownedOriginalsAvailability?: (...args: unknown[]) => Promise<unknown>;
    __ownedOriginalsList?: (...args: unknown[]) => Promise<unknown>;
    __ownedOriginalsBundleList?: (...args: unknown[]) => Promise<unknown>;
    __ownedOriginalsBundleGet?: (...args: unknown[]) => Promise<unknown>;
    __ownedOriginalsManifestLoad?: (...args: unknown[]) => Promise<unknown>;
    __ownedOriginalsBundleVerify?: (...args: unknown[]) => Promise<unknown>;
    __ownedOriginalsBundleDownload?: (...args: unknown[]) => Promise<unknown>;
    __ownedOriginalsSessionList?: (...args: unknown[]) => Promise<unknown[]>;
    __ownedOriginalsCompileSelections?: (...args: unknown[]) => unknown[];
    __ownedOriginalsSessionLoad?: (...args: unknown[]) => Promise<unknown>;
    __ownedOriginalsDetail?: (...args: unknown[]) => Promise<unknown>;
    __ownedOriginalsManifest?: (...args: unknown[]) => Promise<unknown>;
    __ownedOriginalsRemovals?: number;
  };
  globals.__ownedOriginalsState = { user: null, token: null };
  globals.__ownedOriginalsPreviewToken = null;
  globals.__ownedOriginalsEpoch = 0;
  globals.__ownedOriginalsAccess = { guest: [guestAccess] };
  globals.__ownedOriginalsWrites = [];
  globals.__ownedOriginalsOwned = async () => ({ items: [] });
  globals.__ownedOriginalsAvailability = async () => ({ originals: true });
  globals.__ownedOriginalsList = async () => ({ items: [] });
  globals.__ownedOriginalsBundleList = async () => [];
  globals.__ownedOriginalsBundleGet = async () => null;
  globals.__ownedOriginalsManifestLoad = async () => null;
  globals.__ownedOriginalsBundleVerify = async () => false;
  globals.__ownedOriginalsBundleDownload = async () => { throw new Error('unused'); };
  globals.__ownedOriginalsSessionList = async () => [];
  globals.__ownedOriginalsCompileSelections = () => [];
  globals.__ownedOriginalsSessionLoad = async () => null;
  globals.__ownedOriginalsDetail = async () => { throw new Error('unused'); };
  globals.__ownedOriginalsManifest = async () => { throw new Error('unused'); };
  globals.__ownedOriginalsRemovals = 0;
  const service = await loadService();

  const guest = await service.listOwnedOriginals();
  assert.equal(guest.items.length, 1);
  assert.equal(guest.items[0]?.access, 'owned');
  assert.equal(guest.items[0]?.downloadState, 'not_downloaded');
  assert.ok(guest.items[0]?.heroImageUrl?.startsWith(MOAB_NPS_HERO_PREFIX), 'Moab never falls back to the generic oval artwork');
  assert.equal(guest.error, undefined);

  globals.__ownedOriginalsState = { user: { id: 'A' }, token: 'token-a' };
  globals.__ownedOriginalsAccess = { 'account:A': [{ ...guestAccess, owner_scope: 'account:A', access_type: 'entitled' }] };
  globals.__ownedOriginalsOwned = async () => { throw new Error('offline'); };
  const offline = await service.listOwnedOriginals();
  assert.equal(offline.items.length, 1, 'remote failure preserves durable local ownership');
  assert.match(offline.error ?? '', /could not refresh/i);

  const ownedEntered = deferred<void>();
  const ownedGate = deferred<unknown>();
  globals.__ownedOriginalsOwned = async () => {
    ownedEntered.resolve();
    return ownedGate.promise;
  };
  const stale = service.listOwnedOriginals();
  await ownedEntered.promise;
  globals.__ownedOriginalsState = { user: { id: 'B' }, token: 'token-b' };
  globals.__ownedOriginalsEpoch = 1;
  ownedGate.resolve({ items: [{ pack: summary }] });
  const staleResult = await stale;
  assert.equal(staleResult.stale, true);
  assert.equal(globals.__ownedOriginalsWrites?.length, 0, 'a stale A response cannot persist into A or B');

  const detailEntered = deferred<void>();
  const detailGate = deferred<unknown>();
  const accountAccess = { ...guestAccess, owner_scope: 'account:A', access_type: 'entitled' };
  const bundle = {
    pack_id: 'moab-original',
    version: 1,
    total_bytes: 10,
    assets: [{ id: 'mesa-arch', kind: 'image', local_uri: DOWNLOADED_ARTWORK_URI }],
  };
  const manifest = {
    schema_version: 1,
    manifest_id: 'moab-original:1',
    pack_id: 'moab-original',
    version: 1,
    locale: 'en-US',
    title: summary.title,
    route: {
      profile: 'driving',
      direction: 'Moab loop',
      duration_s: 3600,
      distance_m: 10000,
      geometry: { type: 'LineString', coordinates: [[-109.6, 38.5], [-109.5, 38.6]] },
      bounds: { north: 38.6, south: 38.5, east: -109.5, west: -109.6 },
    },
    stops: [],
    assets: [],
    offline_map: {
      region_id: 'moab-original:1',
      bounds: { north: 38.6, south: 38.5, east: -109.5, west: -109.6 },
      min_zoom: 8,
      max_zoom: 16,
      estimated_bytes: 0,
    },
    safety: { summary: 'Drive safely.', emergency_note: '', disclaimers: [] },
    access: { surface: 'Paved', vehicle: '', fees: '', accessibility_notes: '' },
    season: { recommended_months: [], closures_note: '' },
    review: { editorial_status: 'approved' },
  };
  globals.__ownedOriginalsState = { user: null, token: null };
  globals.__ownedOriginalsEpoch = 2;
  globals.__ownedOriginalsAccess = { guest: [guestAccess] };
  globals.__ownedOriginalsBundleList = async () => [bundle];
  globals.__ownedOriginalsBundleGet = async () => bundle;
  globals.__ownedOriginalsManifestLoad = async () => manifest;
  globals.__ownedOriginalsBundleVerify = async () => true;
  const downloadedGuest = await service.listOwnedOriginals();
  assert.equal(
    downloadedGuest.items[0]?.heroImageUrl,
    DOWNLOADED_ARTWORK_URI,
    'a verified download prefers local Original artwork in airplane mode',
  );
  const authoredGuestAccess = {
    ...guestAccess,
    pack_summary: {
      ...summary,
      public_metadata: { ...summary.public_metadata, hero_image_url: AUTHORED_ARTWORK_URI },
    },
  };
  globals.__ownedOriginalsAccess = { guest: [authoredGuestAccess] };
  const authoredDownloadedGuest = await service.listOwnedOriginals();
  assert.equal(
    authoredDownloadedGuest.items[0]?.heroImageUrl,
    AUTHORED_ARTWORK_URI,
    'explicit authored artwork wins when a published version provides it',
  );

  globals.__ownedOriginalsState = { user: { id: 'A' }, token: 'token-a' };
  globals.__ownedOriginalsEpoch = 2;
  globals.__ownedOriginalsAccess = { 'account:A': [accountAccess] };
  globals.__ownedOriginalsBundleGet = async () => bundle;
  globals.__ownedOriginalsManifestLoad = async () => manifest;
  globals.__ownedOriginalsBundleVerify = async () => true;
  globals.__ownedOriginalsDetail = async () => {
    detailEntered.resolve();
    return detailGate.promise;
  };
  const staleDetail = service.getOriginalDetail('moab-original', 1);
  await detailEntered.promise;
  globals.__ownedOriginalsState = { user: { id: 'B' }, token: 'token-b' };
  globals.__ownedOriginalsEpoch = 3;
  detailGate.resolve(summary);
  await assert.rejects(staleDetail, /account changed/i, 'A transcripts never fall back into B after a stale request');
  assert.equal(globals.__ownedOriginalsRemovals, 0, 'a detail read never deletes another scope admin preview');

  const manifestEntered = deferred<void>();
  const manifestGate = deferred<unknown>();
  let bundleDownloads = 0;
  globals.__ownedOriginalsState = { user: { id: 'A' }, token: 'token-a' };
  globals.__ownedOriginalsEpoch = 4;
  globals.__ownedOriginalsAccess = { 'account:A': [accountAccess] };
  globals.__ownedOriginalsManifest = async () => {
    manifestEntered.resolve();
    return manifestGate.promise;
  };
  globals.__ownedOriginalsBundleDownload = async () => {
    bundleDownloads += 1;
    return bundle;
  };
  const staleDownload = service.downloadOriginalBundle('moab-original', 1);
  await manifestEntered.promise;
  globals.__ownedOriginalsState = { user: { id: 'B' }, token: 'token-b' };
  globals.__ownedOriginalsEpoch = 5;
  manifestGate.resolve(manifest);
  await assert.rejects(staleDownload, /account changed/i);
  assert.equal(bundleDownloads, 0, 'an account switch during manifest fetch never starts a bundle download');

  const staleProgress: unknown[] = [];
  globals.__ownedOriginalsState = { user: { id: 'A' }, token: 'token-a' };
  globals.__ownedOriginalsEpoch = 6;
  globals.__ownedOriginalsAccess = { 'account:A': [accountAccess] };
  globals.__ownedOriginalsManifest = async () => manifest;
  globals.__ownedOriginalsBundleDownload = async (_manifest, options: any) => {
    globals.__ownedOriginalsState = { user: { id: 'B' }, token: 'token-b' };
    globals.__ownedOriginalsEpoch = 7;
    options.onProgress?.({
      percentage: 50,
      completed_bytes: 5,
      total_bytes: 10,
    });
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  };
  await assert.rejects(
    service.downloadOriginalBundle('moab-original', 1, progress => staleProgress.push(progress)),
    /aborted/i,
  );
  assert.equal(staleProgress.length, 0, 'an old-owner download cannot publish progress into the next account');

  let previewDownloadArgs: unknown[] = [];
  globals.__ownedOriginalsState = { user: null, token: null };
  globals.__ownedOriginalsEpoch = 8;
  globals.__ownedOriginalsAccess = { guest: [guestAccess] };
  globals.__ownedOriginalsPreviewToken = 'internal-preview-token';
  globals.__ownedOriginalsManifest = async () => manifest;
  globals.__ownedOriginalsBundleDownload = async (...args) => {
    previewDownloadArgs = args;
    return { ...bundle, owner_scope: 'guest' };
  };
  const previewDownload = await service.downloadOriginalBundle('moab-original', 1);
  const previewDownloadOptions = previewDownloadArgs[1] as {
    ownerScope?: string;
    headers?: Record<string, string>;
  };
  assert.equal(previewDownload.state, 'ready');
  assert.equal(previewDownloadOptions.ownerScope, 'guest', 'preview credentials never change ownership scope');
  assert.deepEqual(previewDownloadOptions.headers, {
    'X-Trailhead-Originals-Preview': 'internal-preview-token',
  }, 'guest asset GETs receive the stored internal preview credential');
  assert.equal(globals.__ownedOriginalsWrites?.length, 0, 'downloading with preview access never creates ownership');

  const availabilityCalls: unknown[][] = [];
  const catalogCalls: unknown[][] = [];
  globals.__ownedOriginalsState = { user: null, token: null };
  globals.__ownedOriginalsEpoch = 7;
  globals.__ownedOriginalsAccess = { guest: [] };
  globals.__ownedOriginalsPreviewToken = 'internal-preview-token';
  globals.__ownedOriginalsAvailability = async (...args) => {
    availabilityCalls.push(args);
    return { originals: true };
  };
  globals.__ownedOriginalsList = async (...args) => {
    catalogCalls.push(args);
    return {
      items: [{
        ...summary,
        coverage_region: 'north_america',
        access_policy: {
          schema_version: 1,
          explorer_included: true,
          permanent_credit_price: 900,
        },
        public_metadata: { ...summary.public_metadata, hero_image_url: AUTHORED_ARTWORK_URI },
      }],
    };
  };
  const guestPreviewCatalog = await service.listOriginals();
  assert.equal(guestPreviewCatalog.length, 1, 'a guest preview credential unlocks the internal catalog');
  assert.equal(guestPreviewCatalog[0]?.heroImageUrl, AUTHORED_ARTWORK_URI);
  assert.equal(guestPreviewCatalog[0]?.region, 'North America', 'internal coverage slugs are formatted for people');
  assert.equal(guestPreviewCatalog[0]?.explorerIncluded, true);
  assert.equal(guestPreviewCatalog[0]?.permanentPriceCredits, 900);
  assert.deepEqual(availabilityCalls[0], [undefined, null], 'guest availability is explicitly pinned anonymous');
  assert.equal((catalogCalls[0]?.[0] as { authToken?: string | null })?.authToken, null);

  globals.__ownedOriginalsState = { user: { id: 'A' }, token: 'token-a' };
  globals.__ownedOriginalsEpoch = 8;
  globals.__ownedOriginalsAccess = { 'account:A': [] };
  globals.__ownedOriginalsOwned = async () => ({ items: [] });
  const accountPreviewCatalog = await service.listOriginals();
  assert.equal(accountPreviewCatalog.length, 1);
  assert.deepEqual(availabilityCalls[1], [undefined, 'token-a'], 'account availability uses the captured bearer snapshot');
  assert.equal((catalogCalls[1]?.[0] as { authToken?: string | null })?.authToken, 'token-a');

  let disabledCatalogCalls = 0;
  globals.__ownedOriginalsState = { user: null, token: null };
  globals.__ownedOriginalsEpoch = 9;
  globals.__ownedOriginalsAccess = { guest: [] };
  globals.__ownedOriginalsAvailability = async () => ({ originals: false });
  globals.__ownedOriginalsList = async () => {
    disabledCatalogCalls += 1;
    return { items: [summary] };
  };
  await assert.rejects(service.listOriginals(), /not enabled/i);
  assert.equal(disabledCatalogCalls, 0, 'a verified disabled release never requests the catalog');

  globals.__ownedOriginalsAvailability = async () => { throw new Error('offline'); };
  await assert.rejects(service.listOriginals(), /availability could not be verified/i);

  assert.equal(service.originalSeasonLabel([]), 'Seasonal', 'missing months never claim year-round access');
  assert.equal(service.originalSeasonLabel([1, 2, 11, 12]), 'Jan–Feb · Nov–Dec');
  assert.equal(
    service.originalSeasonLabel([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    'Year-round',
  );

  const explorerOffer = service.originalPermanentUnlockOffer({
    accessKind: 'explorer_subscription',
    permanentPriceCredits: 900,
  } as any);
  assert.deepEqual(explorerOffer, {
    creditCost: 900,
    label: 'Keep permanently · 900 credits',
  });
  assert.equal(
    service.originalPermanentUnlockOffer({ accessKind: 'permanent', permanentPriceCredits: 900 } as any),
    null,
    'permanent owners are never offered the same mutation again',
  );

  const expiredAccess = {
    ...accountAccess,
    access_type: 'explorer_subscription',
    permanent: false,
    access_active: true,
    access_expires_at: Math.floor(Date.now() / 1_000) - 60,
  };
  let expiredManifestReads = 0;
  globals.__ownedOriginalsState = { user: { id: 'A' }, token: 'token-a' };
  globals.__ownedOriginalsEpoch = 10;
  globals.__ownedOriginalsAccess = { 'account:A': [expiredAccess] };
  globals.__ownedOriginalsAvailability = async () => ({ originals: true });
  globals.__ownedOriginalsOwned = async () => ({ items: [] });
  globals.__ownedOriginalsBundleList = async () => [{ ...bundle, owner_scope: 'account:A' }];
  globals.__ownedOriginalsSessionList = async () => [];
  globals.__ownedOriginalsManifestLoad = async () => {
    expiredManifestReads += 1;
    return { schema_version: 2, stories: [{ transcript: 'private narration' }] };
  };
  globals.__ownedOriginalsDetail = async () => ({
    ...summary,
    id: 'moab-original',
    access_policy: {
      schema_version: 1,
      explorer_included: true,
      permanent_credit_price: 900,
    },
    manifest_preview: {
      schema_version: 2,
      manifest_id: 'moab-original:1',
      pack_id: 'moab-original',
      version: 1,
      locale: 'en-US',
      title: summary.title,
      chapters: [{
        id: 'mountain-crossing',
        sequence: 1,
        title: 'Mountain Crossing',
        summary: 'Public chapter summary.',
        default_variant_id: 'eastbound',
        variants: [{
          id: 'eastbound',
          sequence: 1,
          title: 'Eastbound',
          direction: 'forward',
          distance_m: 12_000,
          duration_s: 3_600,
          story_count: 11,
          cue_count: 0,
        }],
      }],
    },
  });
  const expiredDetail = await service.getOriginalDetail('moab-original', 1);
  assert.notEqual(expiredDetail.access, 'owned', 'expired Explorer access is no longer treated as owned');
  assert.equal(expiredDetail.route, undefined, 'public detail cannot inherit downloaded route geometry');
  assert.equal(expiredDetail.stories.length, 0, 'public detail cannot inherit downloaded transcripts');
  assert.equal(expiredManifestReads, 0, 'expired access never reads the installed private V2 manifest');

  const compiledFor = (variant: string, stopId: string) => ({
    ...manifest,
    stops: [{
      id: stopId,
      sequence: 1,
      title: `${variant} story`,
      coordinates: { lat: 38.55, lng: -109.55 },
      transcript: `${variant} private transcript`,
      audio_asset_id: 'audio-1',
      audio_duration_s: 60,
      trigger: {
        enter_radius_m: 100,
        exit_radius_m: 150,
        lead_time_s: 0,
        route_progress_start_m: 0,
        route_progress_end_m: 500,
      },
      citations: [],
    }],
  });
  const selectionItem = (variant: string) => ({
    chapter_id: 'mountain-crossing',
    chapter_sequence: 1,
    chapter_title: 'Mountain Crossing',
    chapter_summary: 'A reviewed chapter.',
    variant_id: variant,
    variant_sequence: variant === 'eastbound' ? 1 : 2,
    variant_title: variant === 'eastbound' ? 'Eastbound' : 'Westbound',
    is_default: variant === 'eastbound',
    direction: variant,
    distance_m: 10_000,
    duration_s: 3_600,
    story_count: 1,
    cue_count: 0,
    validation_selection_id: 'mountain-crossing-v1',
  });
  globals.__ownedOriginalsCompileSelections = () => [
    { selection: selectionItem('eastbound'), compiled: { manifest: compiledFor('eastbound', 'east-story') } },
    { selection: selectionItem('westbound'), compiled: { manifest: compiledFor('westbound', 'west-story') } },
  ];
  globals.__ownedOriginalsAccess = { 'account:A': [{ ...accountAccess, access_type: 'permanent' }] };
  globals.__ownedOriginalsSessionList = async () => [{
    pack_id: 'moab-original',
    version: 1,
    chapter_selection: {
      chapter_id: 'mountain-crossing',
      variant_id: 'eastbound',
      validation_selection_id: 'mountain-crossing-v1',
    },
    completed_stop_ids: ['east-story'],
    skipped_stop_ids: [],
    missed_stop_ids: [],
    updated_at_ms: 10,
  }, {
    pack_id: 'moab-original',
    version: 1,
    chapter_selection: {
      chapter_id: 'mountain-crossing',
      variant_id: 'westbound',
      validation_selection_id: 'mountain-crossing-v1',
    },
    completed_stop_ids: [],
    skipped_stop_ids: ['west-story'],
    missed_stop_ids: [],
    updated_at_ms: 20,
  }];
  globals.__ownedOriginalsManifestLoad = async () => ({
    schema_version: 2,
    manifest_id: 'moab-original:1',
    pack_id: 'moab-original',
    version: 1,
    title: summary.title,
    stories: [],
    assets: [],
    offline_map: { estimated_bytes: 0 },
    chapters: [{
      id: 'mountain-crossing',
      operational_sources: [],
    }],
  });
  const hydratedSelections = await service.getOriginalDetail('moab-original', 1);
  const eastSelection = hydratedSelections.chapterSelections?.find(item => item.variantId === 'eastbound');
  const westSelection = hydratedSelections.chapterSelections?.find(item => item.variantId === 'westbound');
  assert.equal(eastSelection?.stories?.[0]?.completed, true, 'eastbound progress remains on eastbound');
  assert.equal(westSelection?.stories?.[0]?.skipped, true, 'westbound progress remains on westbound');
  assert.equal(westSelection?.stories?.[0]?.completed, false, 'one selection never borrows another selection progress');

  const selectedV2 = service.selectOriginalUiChapter({
    manifestSchemaVersion: 2,
    storyCount: 77,
    cueCount: 0,
    chapterSelections: [{
      chapterId: 'mountain-crossing',
      chapterSequence: 1,
      chapterTitle: 'Mountain Crossing',
      chapterSummary: 'A complete crossing of the Smokies.',
      variantId: 'eastbound',
      variantSequence: 1,
      variantTitle: 'Eastbound',
      isDefault: true,
      direction: 'forward',
      durationLabel: '2 hr 30 min',
      distanceLabel: '35 mi',
      storyCount: 45,
      cueCount: 32,
    }],
    stories: [],
    safetyNotes: [],
    accessNotes: [],
    sources: [],
  } as any, 'mountain-crossing', 'eastbound');
  assert.equal(selectedV2.storyCount, 45, 'the STORIES metric counts full stories only');
  assert.equal(selectedV2.cueCount, 32, 'shorter cues remain separately labelled');

  console.log('Owned Originals UI service tests passed.');
}

void main();
