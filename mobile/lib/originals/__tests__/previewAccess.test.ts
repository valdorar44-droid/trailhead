import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build, type Plugin } from 'esbuild';

type PreviewAccessModule = typeof import('../previewAccess');

const storageStub = `
  const values = globalThis.__previewStorage || (globalThis.__previewStorage = new Map());
  export const storage = {
    get: async key => values.get(key) || null,
    set: async (key, value) => { values.set(key, value); },
    del: async key => { values.delete(key); },
  };
`;

const stubDependencies: Plugin = {
  name: 'stub-preview-access-storage',
  setup(builder) {
    builder.onResolve({ filter: /^\.\.\/storage$/ }, () => ({
      path: '../storage', namespace: 'preview-access-stub',
    }));
    builder.onLoad({ filter: /.*/, namespace: 'preview-access-stub' }, () => ({
      contents: storageStub, loader: 'js',
    }));
  },
};

async function loadPreviewAccess(): Promise<PreviewAccessModule> {
  const result = await build({
    entryPoints: [path.resolve('lib/originals/previewAccess.ts')],
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
  evaluate(require, module, module.exports, path.resolve('lib/originals/previewAccess.test.cjs'), process.cwd());
  return module.exports as PreviewAccessModule;
}

function signedPreviewToken(expiresAtSeconds: number) {
  const payload = Buffer.from(JSON.stringify({ v: 1, exp: expiresAtSeconds })).toString('base64url');
  return `${payload}.opaque-signature`;
}

async function main() {
  const globals = globalThis as typeof globalThis & { __previewStorage?: Map<string, string> };
  globals.__previewStorage?.clear();
  const preview = await loadPreviewAccess();
  const nowMs = Date.now();
  const expiresAtMs = nowMs + 60 * 60 * 1_000;
  const token = signedPreviewToken(expiresAtMs / 1_000);

  const destination = await preview.consumeOriginalPreviewUrl(
    `trailhead://originals/moab?originals_preview_token=${encodeURIComponent(token)}`,
  );
  assert.deepEqual(destination, { pathname: '/originals/[id]', params: { id: 'moab' } });
  assert.equal(await preview.getOriginalPreviewToken(nowMs), token);
  assert.equal(await preview.getOriginalPreviewToken(expiresAtMs + 1), null, 'the signed server expiry is honored');

  const v2Token = signedPreviewToken((nowMs + 30 * 60 * 1_000) / 1_000);
  const v2Destination = await preview.consumeOriginalPreviewUrl(
    `trailhead://originals/preview?id=smokies&chapter=mountain_crossing&variant=eastbound&originals_preview_token=${encodeURIComponent(v2Token)}`,
  );
  assert.deepEqual(v2Destination, {
    pathname: '/originals/preview',
    params: {
      id: 'smokies',
      chapter: 'mountain_crossing',
      variant: 'eastbound',
    },
  });
  assert.equal(await preview.getOriginalPreviewToken(nowMs), v2Token);

  globals.__previewStorage?.clear();
  await assert.rejects(
    preview.consumeOriginalPreviewUrl(
      `trailhead://originals/preview?id=smokies&chapter=mountain_crossing&originals_preview_token=${encodeURIComponent(v2Token)}`,
    ),
    /Choose a chapter and route/,
  );
  assert.equal(await preview.getOriginalPreviewToken(nowMs), null, 'an incomplete V2 link is never stored');

  await assert.rejects(
    preview.consumeOriginalPreviewUrl(
      `https://trailhead.app/originals/moab?originals_preview_token=${encodeURIComponent(token)}`,
    ),
    /accepted only through the Trailhead app link/,
  );
  assert.equal(await preview.getOriginalPreviewToken(nowMs), null, 'an HTTPS token is never stored');

  const longToken = signedPreviewToken((nowMs + 48 * 60 * 60 * 1_000) / 1_000);
  await preview.saveOriginalPreviewAccess(longToken, undefined, nowMs);
  assert.equal(await preview.getOriginalPreviewToken(nowMs + 24 * 60 * 60 * 1_000 + 1), null, 'local preview access never exceeds 24 hours');

  console.log('Originals internal preview access tests passed.');
}

void main();
