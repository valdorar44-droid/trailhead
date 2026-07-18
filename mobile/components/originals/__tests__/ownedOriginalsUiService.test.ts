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
      list: async () => [],
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
      owned: (...args) => globalThis.__ownedOriginalsOwned(...args),
      list: async () => ({ items: [] }),
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

async function main() {
  const globals = globalThis as typeof globalThis & {
    __ownedOriginalsState?: { user: { id: string } | null; token: string | null };
    __ownedOriginalsPreviewToken?: string | null;
    __ownedOriginalsEpoch?: number;
    __ownedOriginalsAccess?: Record<string, unknown[]>;
    __ownedOriginalsWrites?: unknown[];
    __ownedOriginalsOwned?: (...args: unknown[]) => Promise<unknown>;
    __ownedOriginalsBundleList?: (...args: unknown[]) => Promise<unknown>;
    __ownedOriginalsBundleGet?: (...args: unknown[]) => Promise<unknown>;
    __ownedOriginalsManifestLoad?: (...args: unknown[]) => Promise<unknown>;
    __ownedOriginalsBundleVerify?: (...args: unknown[]) => Promise<unknown>;
    __ownedOriginalsBundleDownload?: (...args: unknown[]) => Promise<unknown>;
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
  globals.__ownedOriginalsBundleList = async () => [];
  globals.__ownedOriginalsBundleGet = async () => null;
  globals.__ownedOriginalsManifestLoad = async () => null;
  globals.__ownedOriginalsBundleVerify = async () => false;
  globals.__ownedOriginalsBundleDownload = async () => { throw new Error('unused'); };
  globals.__ownedOriginalsSessionLoad = async () => null;
  globals.__ownedOriginalsDetail = async () => { throw new Error('unused'); };
  globals.__ownedOriginalsManifest = async () => { throw new Error('unused'); };
  globals.__ownedOriginalsRemovals = 0;
  const service = await loadService();

  const guest = await service.listOwnedOriginals();
  assert.equal(guest.items.length, 1);
  assert.equal(guest.items[0]?.access, 'owned');
  assert.equal(guest.items[0]?.downloadState, 'not_downloaded');
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
  };
  const manifest = {
    pack_id: 'moab-original',
    version: 1,
    title: summary.title,
    route: { direction: 'Moab loop', duration_s: 3600, distance_m: 10000 },
    stops: [],
    assets: [],
    offline_map: { estimated_bytes: 0 },
    safety: { summary: 'Drive safely.', emergency_note: '', disclaimers: [] },
    access: { surface: 'Paved', vehicle: '', fees: '', accessibility_notes: '' },
    season: { recommended_months: [], closures_note: '' },
  };
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

  let previewDownloadArgs: unknown[] = [];
  globals.__ownedOriginalsState = { user: null, token: null };
  globals.__ownedOriginalsEpoch = 6;
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

  console.log('Owned Originals UI service tests passed.');
}

void main();
