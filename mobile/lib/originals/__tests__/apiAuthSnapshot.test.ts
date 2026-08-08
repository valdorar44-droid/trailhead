import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build, type Plugin } from 'esbuild';
import { originalManifestV2 } from './fixtures';

type OriginalsApiModule = typeof import('../api');

const consumerContractHeader = 'X-Trailhead-Originals-Consumer-Contract';
const capabilitiesHeader = 'X-Trailhead-Originals-Capabilities';
const expectedConsumerContract = 'originals_long_form_delivery_v1';
const expectedCapabilities = [
  'originals_capacity_scheduler_v1',
  'originals_manifest_v3',
  'originals_selectable_v1',
].join(',');

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
  './manifest': `
    export class OriginalManifestError extends Error {}
    export function validateOriginalManifest(value) { return value; }
  `,
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
  let responseBody: unknown = { guest_access: true, access_type: 'guest_free' };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(_url), headers: init?.headers as Record<string, string>, body: init?.body });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => responseBody,
    } as Response;
  }) as typeof fetch;

  try {
    await apiModule.originalsApi.acquire('moab', {
      version: 1,
      accessMode: 'explorer',
      authToken: 'account-a-token',
    });
    assert.equal(requests[0]?.headers.Authorization, 'Bearer account-a-token');
    assert.equal(requests[0]?.headers[consumerContractHeader], expectedConsumerContract);
    assert.equal(requests[0]?.headers[capabilitiesHeader], expectedCapabilities);
    assert.equal(
      requests[0]?.url,
      'https://trailhead.test/api/originals/moab/acquire?version=1&access_mode=explorer',
    );
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

    await apiModule.originalsApi.availability(undefined, null);
    assert.equal(requests[5]?.url, 'https://trailhead.test/api/product/features');
    assert.equal(requests[5]?.headers.Authorization, undefined, 'a pinned guest availability probe stays anonymous');
    assert.equal(requests[5]?.headers['X-Trailhead-Originals-Preview'], 'short-lived-preview');
    assert.equal(globals.__originalsStorageReads, 1, 'a pinned guest probe never rereads auth storage');

    await apiModule.originalsApi.availability(undefined, 'captured-account-token');
    assert.equal(requests[6]?.url, 'https://trailhead.test/api/product/features');
    assert.equal(requests[6]?.headers.Authorization, 'Bearer captured-account-token');
    assert.equal(requests[6]?.headers['X-Trailhead-Originals-Preview'], 'short-lived-preview');
    assert.equal(globals.__originalsStorageReads, 1, 'a pinned account probe never rereads auth storage');

    for (const request of requests) {
      assert.equal(
        request.headers[consumerContractHeader],
        expectedConsumerContract,
        'every Originals request declares the executable consumer contract',
      );
      assert.equal(
        request.headers[capabilitiesHeader],
        expectedCapabilities,
        'every Originals request declares the exact sorted capability set',
      );
    }

    const manifest = originalManifestV2();
    const publicPreview = {
      schema_version: 2,
      manifest_id: manifest.manifest_id,
      pack_id: manifest.pack_id,
      version: manifest.version,
      locale: manifest.locale,
      title: manifest.title,
      chapters: manifest.chapters.map(chapter => ({
        id: chapter.id,
        sequence: chapter.sequence,
        title: chapter.title,
        summary: chapter.summary,
        default_variant_id: chapter.default_variant_id,
        variants: chapter.variants.map(variant => ({
          id: variant.id,
          sequence: variant.sequence,
          title: variant.title,
          direction: variant.route.direction,
          distance_m: variant.route.distance_m,
          duration_s: variant.route.duration_s,
          story_count: variant.cue_refs.length,
          cue_count: 0,
        })),
      })),
    };
    const publicDetailResponse = {
      id: manifest.pack_id,
      slug: 'great-smoky-mountains-ridges-rivers-living-memory',
      version: manifest.version,
      manifest_preview: publicPreview,
    };
    responseBody = publicDetailResponse;
    const detail = await apiModule.originalsApi.detail(manifest.pack_id, undefined, null);
    assert.equal(detail.manifest_preview.schema_version, 2, 'the public detail parser accepts a redacted V2 preview');
    assert.equal(requests[7]?.headers.Authorization, undefined);

    responseBody = {
      ...publicDetailResponse,
      manifest_preview: { ...publicPreview, stories: manifest.stories },
    };
    await assert.rejects(
      () => apiModule.originalsApi.detail(manifest.pack_id, undefined, null),
      /unsupported fields: stories/,
      'public details reject narration-bearing V2 previews',
    );

    responseBody = manifest;
    const full = await apiModule.originalsApi.manifest(manifest.pack_id, manifest.version, undefined, null);
    assert.equal(full.schema_version, 2, 'the acquired manifest parser accepts the complete union bundle');

    const binding = {
      schema_version: 1 as const,
      binding_id: 'ovb_test_binding_12345678901234567890',
      revision: 1,
      vehicle_kind: 'passenger' as const,
      vehicle_length_ft: 19,
      is_towing: false,
      vehicle_class: 'passenger' as const,
      complete: true,
      updated_at: 1,
    };
    responseBody = { binding };
    const fetchedBinding = await apiModule.originalsApi.getVehicleBinding({
      authToken: 'captured-originals-token',
    });
    assert.equal(fetchedBinding.binding?.binding_id, binding.binding_id);
    assert.equal(requests.at(-1)?.headers.Authorization, 'Bearer captured-originals-token');
    assert.equal(requests.at(-1)?.url, 'https://trailhead.test/api/account/originals/vehicle-binding');

    responseBody = binding;
    await apiModule.originalsApi.putVehicleBinding({
      vehicle_kind: 'passenger',
      vehicle_length_ft: 19,
      is_towing: false,
    }, { authToken: 'captured-originals-token' });
    assert.equal(requests.at(-1)?.headers.Authorization, 'Bearer captured-originals-token');
    assert.equal(
      requests.at(-1)?.body,
      JSON.stringify({ vehicle_kind: 'passenger', vehicle_length_ft: 19, is_towing: false }),
    );
    assert.equal(String(requests.at(-1)?.body).includes('make'), false);

    responseBody = {
      schema_version: 1,
      pack_id: manifest.pack_id,
      version: manifest.version,
      manifest_id: manifest.manifest_id,
      chapter_id: 'mountain-crossing',
      variant_id: 'eastbound',
      status: 'check_required',
      can_start: false,
      reason_code: 'current_conditions_unavailable',
      message: 'Current operating information could not be verified.',
      notices: [],
    };
    const readiness = await apiModule.originalsApi.startReadiness(
      manifest.pack_id,
      manifest.version,
      {
        chapter_id: 'mountain-crossing',
        variant_id: 'eastbound',
        vehicle_binding_id: binding.binding_id,
      },
      { authToken: 'captured-originals-token' },
    );
    assert.equal(readiness.can_start, false);
    assert.equal(
      requests.at(-1)?.url,
      `https://trailhead.test/api/originals/${manifest.pack_id}/versions/${manifest.version}/start-readiness`,
    );
    assert.equal(
      requests.at(-1)?.body,
      JSON.stringify({
        chapter_id: 'mountain-crossing',
        variant_id: 'eastbound',
        vehicle_binding_id: binding.binding_id,
      }),
    );
    assert.equal(String(requests.at(-1)?.body).includes('vehicle_class'), false);
  } finally {
    globalThis.fetch = previousFetch;
  }

  console.log('Originals API auth snapshot tests passed.');
}

void main();
