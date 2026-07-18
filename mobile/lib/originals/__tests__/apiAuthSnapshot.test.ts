import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build, type Plugin } from 'esbuild';

type OriginalsApiModule = typeof import('../api');

const stubs: Record<string, string> = {
  '../apiBase': `export const TRAILHEAD_API_BASE = 'https://trailhead.test';`,
  '../storage': `
    export const storage = {
      get: async () => {
        globalThis.__originalsStorageReads = (globalThis.__originalsStorageReads || 0) + 1;
        return globalThis.__originalsStoredToken || null;
      },
    };
  `,
  './manifest': `export function validateOriginalManifest(value) { return value; }`,
  './previewAccess': `export async function getOriginalPreviewToken() { return globalThis.__originalsPreviewToken || null; }`,
};

const stubDependencies: Plugin = {
  name: 'stub-originals-api-dependencies',
  setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => (
      Object.hasOwn(stubs, args.path)
        ? { path: args.path, namespace: 'originals-api-stub' }
        : null
    ));
    builder.onLoad({ filter: /.*/, namespace: 'originals-api-stub' }, args => ({
      contents: stubs[args.path],
      loader: 'js',
    }));
  },
};

async function loadApiModule(): Promise<OriginalsApiModule> {
  const result = await build({
    entryPoints: [path.resolve('lib/originals/api.ts')],
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
  evaluate(require, module, module.exports, path.resolve('lib/originals/api.test.cjs'), process.cwd());
  return module.exports as OriginalsApiModule;
}

async function main() {
  const apiModule = await loadApiModule();
  const requests: Array<{ url: string; headers: Record<string, string>; body?: BodyInit | null }> = [];
  const globals = globalThis as typeof globalThis & {
    __originalsStorageReads?: number;
    __originalsStoredToken?: string;
    __originalsPreviewToken?: string;
  };
  globals.__originalsStorageReads = 0;
  globals.__originalsStoredToken = 'later-account-token';
  globals.__originalsPreviewToken = 'short-lived-preview';
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(_url), headers: init?.headers as Record<string, string>, body: init?.body });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ guest_access: true, access_type: 'guest_free' }),
    } as Response;
  }) as typeof fetch;

  try {
    await apiModule.originalsApi.acquire('moab', { version: 1, authToken: 'account-a-token' });
    assert.equal(requests[0]?.headers.Authorization, 'Bearer account-a-token');
    assert.equal(globals.__originalsStorageReads, 0, 'a pinned operation never rereads a later account token');

    await apiModule.originalsApi.acquire('moab', { version: 1, authToken: null });
    assert.equal(requests[1]?.headers.Authorization, undefined, 'explicit null forces guest mode');
    assert.equal(globals.__originalsStorageReads, 0);

    await apiModule.originalsApi.acquire('moab', { version: 1 });
    assert.equal(requests[2]?.headers.Authorization, 'Bearer later-account-token');
    assert.equal(globals.__originalsStorageReads, 1, 'legacy reads still resolve auth when no snapshot is supplied');

    await apiModule.originalsApi.feedbackGuestToken('moab', 4, 'opaque-install-id');
    assert.equal(requests[3]?.headers.Authorization, undefined);
    assert.equal(requests[3]?.headers['X-Trailhead-Originals-Preview'], 'short-lived-preview');
    assert.equal(requests[3]?.headers['X-Trailhead-Install-ID'], 'opaque-install-id');
    assert.equal(requests[3]?.body, JSON.stringify({ pack_id: 'moab', version: 4 }));

    await apiModule.originalsApi.submitFeedback('moab', {
      version: 4,
      category: 'general',
      message: 'Good drive.',
      platform: 'ios',
    }, {
      idempotencyKey: 'feedback-key',
      authToken: null,
      guestToken: 'guest-feedback-token',
    });
    assert.equal(requests[4]?.headers.Authorization, undefined);
    assert.equal(requests[4]?.headers['Idempotency-Key'], 'feedback-key');
    assert.equal(requests[4]?.headers['X-Original-Feedback-Token'], 'guest-feedback-token');
  } finally {
    globalThis.fetch = previousFetch;
  }

  console.log('Originals API auth snapshot tests passed.');
}

void main();
