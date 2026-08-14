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

  await preview.saveOriginalPreviewAccess(token, expiresAtMs, nowMs);
  await preview.clearOriginalPreviewAccessStrict();
  assert.equal(await preview.getOriginalPreviewToken(nowMs), null);
  await preview.clearOriginalPreviewAccessStrict();
  assert.equal(await preview.getOriginalPreviewToken(nowMs), null, 'strict preview credential cleanup is idempotent');

  const cleanupIdentity = {
    owner_scope: 'account:admin-7' as const,
    pack_id: 'smokies-r2',
    version: 1_000_000_002,
    manifest_id: 'smokies-r2-private-manifest',
  };
  await preview.saveOriginalPrivateReviewCleanupIdentity(cleanupIdentity, nowMs);
  const restartedPreview = await loadPreviewAccess();
  assert.deepEqual(
    await restartedPreview.getOriginalPrivateReviewCleanupIdentity(),
    {
      schema_version: 1,
      ...cleanupIdentity,
      created_at_ms: nowMs,
    },
    'the exact account-bound cleanup identity survives a process/module restart',
  );
  await assert.rejects(
    restartedPreview.saveOriginalPrivateReviewCleanupIdentity({
      ...cleanupIdentity,
      manifest_id: 'replacement-manifest',
    }, nowMs + 1),
    /Finish the existing private review cleanup/,
  );
  await assert.rejects(
    restartedPreview.saveOriginalPrivateReviewCleanupIdentity(cleanupIdentity, nowMs + 1),
    /Finish the existing private review cleanup/,
    'a duplicate acquisition cannot race cleanup even for the same immutable revision',
  );
  assert.equal(
    (await restartedPreview.getOriginalPrivateReviewCleanupIdentity())?.manifest_id,
    cleanupIdentity.manifest_id,
    'a mismatched replay cannot replace the pending identity',
  );
  await assert.rejects(
    restartedPreview.clearOriginalPrivateReviewCleanupIdentityStrict({
      ...cleanupIdentity,
      pack_id: 'another-pack',
    }),
    /identity changed/,
  );
  assert.ok(await restartedPreview.getOriginalPrivateReviewCleanupIdentity());
  await restartedPreview.clearOriginalPrivateReviewCleanupIdentityStrict(cleanupIdentity);
  await restartedPreview.clearOriginalPrivateReviewCleanupIdentityStrict(cleanupIdentity);
  assert.equal(
    await restartedPreview.getOriginalPrivateReviewCleanupIdentity(),
    null,
    'exact cleanup marker removal is idempotent',
  );

  const fieldIdentity = {
    ...cleanupIdentity,
    review_mode: 'field' as const,
    chapter_id: 'mountain_crossing',
    variant_id: 'tn_to_nc',
    validation_selection_id: 'mountain_crossing:tn_to_nc',
    delivery_contract_sha256: 'a'.repeat(64),
  };
  const fieldAcquisitions = await Promise.allSettled([
    restartedPreview.beginOriginalPrivateFieldReviewRecovery(fieldIdentity, nowMs + 2),
    restartedPreview.beginOriginalPrivateFieldReviewRecovery(fieldIdentity, nowMs + 2),
  ]);
  assert.equal(fieldAcquisitions.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(fieldAcquisitions.filter(result => result.status === 'rejected').length, 1);
  assert.equal(
    (await restartedPreview.getOriginalPrivateReviewCleanupIdentity())?.schema_version,
    2,
  );
  assert.equal(
    (await restartedPreview.getOriginalPrivateReviewCleanupIdentity() as any)?.recovery_state,
    'acquiring',
    'a crash during acquisition remains cleanup-only',
  );
  await assert.rejects(
    restartedPreview.requireConsumedOriginalPrivateFieldReviewRecovery(fieldIdentity),
    /No exact one-time private field recovery/,
  );
  await assert.rejects(
    restartedPreview.armOriginalPrivateFieldReviewRecovery({
      ...fieldIdentity,
      variant_id: 'nc_to_tn',
    }, nowMs + 3),
    /state changed/,
    'selection mismatch cannot arm another field route',
  );
  await restartedPreview.armOriginalPrivateFieldReviewRecovery(fieldIdentity, nowMs + 3);
  const coldLaunchClaims = await Promise.allSettled([
    restartedPreview.consumeOriginalPrivateFieldReviewRecovery(fieldIdentity, nowMs + 4),
    restartedPreview.consumeOriginalPrivateFieldReviewRecovery(fieldIdentity, nowMs + 4),
  ]);
  assert.equal(coldLaunchClaims.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(coldLaunchClaims.filter(result => result.status === 'rejected').length, 1);
  assert.equal(
    (await restartedPreview.requireConsumedOriginalPrivateFieldReviewRecovery(fieldIdentity)).recovery_state,
    'recovery_consumed',
  );
  await assert.rejects(
    restartedPreview.consumeOriginalPrivateFieldReviewRecovery(fieldIdentity, nowMs + 5),
    /state changed/,
    'a second cold launch cannot consume the one-time lease again',
  );
  await assert.rejects(
    restartedPreview.requireConsumedOriginalPrivateFieldReviewRecovery({
      ...fieldIdentity,
      delivery_contract_sha256: 'b'.repeat(64),
    }),
    /No exact one-time private field recovery/,
  );
  await restartedPreview.clearOriginalPrivateReviewCleanupIdentityStrict(fieldIdentity);
  assert.equal(await restartedPreview.getOriginalPrivateReviewCleanupIdentity(), null);

  const concurrentAcquisitions = await Promise.allSettled([
    restartedPreview.saveOriginalPrivateReviewCleanupIdentity(cleanupIdentity, nowMs + 6),
    restartedPreview.saveOriginalPrivateReviewCleanupIdentity(cleanupIdentity, nowMs + 6),
  ]);
  assert.equal(concurrentAcquisitions.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(concurrentAcquisitions.filter(result => result.status === 'rejected').length, 1);
  await restartedPreview.clearOriginalPrivateReviewCleanupIdentityStrict(cleanupIdentity);

  globals.__previewStorage!.set(
    'trailhead_originals_private_review_cleanup_v1',
    JSON.stringify({ schema_version: 1, ...cleanupIdentity, owner_scope: 'guest', created_at_ms: nowMs }),
  );
  await assert.rejects(
    restartedPreview.getOriginalPrivateReviewCleanupIdentity(),
    /could not be verified/,
    'a corrupt or non-account marker remains fail closed',
  );
  assert.ok(
    globals.__previewStorage!.has('trailhead_originals_private_review_cleanup_v1'),
    'an unverifiable cleanup marker is never silently discarded',
  );
  globals.__previewStorage!.delete('trailhead_originals_private_review_cleanup_v1');

  globals.__previewStorage!.set(
    'trailhead_originals_private_review_cleanup_v1',
    JSON.stringify({
      schema_version: 2,
      ...fieldIdentity,
      recovery_state: 'recoverable_once',
      validation_selection_id: '',
      created_at_ms: nowMs,
      updated_at_ms: nowMs,
    }),
  );
  await assert.rejects(
    restartedPreview.getOriginalPrivateReviewCleanupIdentity(),
    /could not be verified/,
    'a corrupt field binding never becomes resumable',
  );
  const corruptCleanupTarget = await restartedPreview.getOriginalPrivateReviewCleanupIdentityForCleanup();
  assert.deepEqual(
    corruptCleanupTarget,
    {
      schema_version: 1,
      ...cleanupIdentity,
      created_at_ms: nowMs,
    },
    'a corrupt field marker exposes only its exact base tuple for cleanup',
  );
  await restartedPreview.clearOriginalPrivateReviewCleanupIdentityStrict(cleanupIdentity);
  assert.equal(
    await restartedPreview.getOriginalPrivateReviewCleanupIdentityForCleanup(),
    null,
    'corrupt field state is deleted only through the exact cleanup target',
  );

  console.log('Originals internal preview access tests passed.');
}

void main();
