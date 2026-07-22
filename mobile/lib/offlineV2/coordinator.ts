import { createQueuedArtifactStates, transitionOfflineArtifactState } from './artifactState';
import { validateOfflineBundleManifest } from './manifest';
import type {
  OfflineBundleManifestRepository,
  OfflineBundleStageV2,
} from './repository';
import type { OfflineRendererReadinessAdapter } from './renderer';
import type {
  OfflineArtifactStateV2,
  OfflineBundleArtifactV2,
  OfflineBundleCommitReceiptV2,
  OfflineBundleCapabilitiesV2,
  OfflineBundleInspectionV2,
  OfflineBundleInstallationV2,
  OfflineBundleManifestV2,
  OfflineMapRenderer,
} from './types';
import {
  validateOfflineArtifactFile,
  type OfflineArtifactValidationAdapter,
} from './validation';

export type OfflineTransferProgress = Readonly<{
  received_bytes: number;
  total_bytes: number;
  etag?: string;
  resume_token?: string;
}>;

/** File transports implement Range/ETag details without coupling the coordinator to Expo. */
export interface OfflineArtifactTransferAdapter {
  download(
    artifact: OfflineBundleArtifactV2,
    destination: string,
    options: Readonly<{
      signal?: AbortSignal;
      etag?: string;
      resume_token?: string;
      onProgress?: (progress: OfflineTransferProgress) => void;
    }>,
  ): Promise<Readonly<{ etag?: string; resume_token?: string }>>;
  pause?(artifactId: string): Promise<Readonly<{ resume_token?: string }>>;
  cancel?(artifactId: string): Promise<void>;
}

/** Native renderer adapters own style-pack/tile-region preparation and cleanup. */
export interface OfflineRendererDownloadAdapter extends OfflineRendererReadinessAdapter {
  prepare(
    manifest: OfflineBundleManifestV2,
    options: Readonly<{
      signal?: AbortSignal;
      onProgress?: (progress: OfflineTransferProgress) => void;
    }>,
  ): Promise<OfflineBundleInstallationV2['renderer']>;
  pause?(manifest: OfflineBundleManifestV2): Promise<void>;
  resume?(manifest: OfflineBundleManifestV2): Promise<void>;
  remove?(installation: OfflineBundleInstallationV2['renderer']): Promise<void>;
}

export type OfflineBundleStartV2 = Readonly<{
  manifest: OfflineBundleManifestV2;
  stage: OfflineBundleStageV2;
  artifact_states: Readonly<Record<string, OfflineArtifactStateV2>>;
}>;

export type OfflineBundleInspectionOptions = Readonly<{
  // Reserved for forward-compatible inspection controls.
}>;

export interface OfflineDownloadCoordinator {
  createInitialState(manifest: OfflineBundleManifestV2): Readonly<Record<string, OfflineArtifactStateV2>>;
  begin(manifest: OfflineBundleManifestV2): Promise<OfflineBundleStartV2>;
  commit(
    start: OfflineBundleStartV2,
    rendererInstallation: OfflineBundleInstallationV2['renderer'],
    options?: Readonly<{ repair?: boolean }>,
  ): Promise<Readonly<{
    installation: OfflineBundleInstallationV2;
    receipt: OfflineBundleCommitReceiptV2;
  }>>;
  inspect(
    manifest: OfflineBundleManifestV2,
    installation: OfflineBundleInstallationV2 | null,
    options?: OfflineBundleInspectionOptions,
  ): Promise<OfflineBundleInspectionV2>;
}

function freezeStates(states: Record<string, OfflineArtifactStateV2>) {
  return Object.freeze(states);
}

function stateFor(
  artifact: OfflineBundleArtifactV2,
  previous: OfflineArtifactStateV2 | undefined,
  status: OfflineArtifactStateV2['status'],
  update: Parameters<typeof transitionOfflineArtifactState>[2] = {},
) {
  const carried = {
    received_bytes: previous?.received_bytes ?? 0,
    total_bytes: artifact.bytes,
    ...(previous?.local_uri ? { local_uri: previous.local_uri } : {}),
  };
  let current = transitionOfflineArtifactState(
    createQueuedArtifactStates([artifact], update.updated_at_ms)[artifact.id],
    'queued',
    carried,
  );
  if (status === 'queued') return transitionOfflineArtifactState(current, status, update);
  if (status === 'error') return transitionOfflineArtifactState(current, status, update);
  current = transitionOfflineArtifactState(current, 'downloading', carried);
  if (status === 'downloading') return transitionOfflineArtifactState(current, status, update);
  if (status === 'paused') return transitionOfflineArtifactState(current, status, update);
  if (status === 'partial') return transitionOfflineArtifactState(current, status, update);
  current = transitionOfflineArtifactState(current, 'verifying', carried);
  if (status === 'verifying') return transitionOfflineArtifactState(current, status, update);
  return transitionOfflineArtifactState(current, status, update);
}

function capabilitiesFor(
  manifest: OfflineBundleManifestV2,
  states: Readonly<Record<string, OfflineArtifactStateV2>>,
): OfflineBundleCapabilitiesV2 {
  const allReady = (...kinds: OfflineBundleArtifactV2['kind'][]) => {
    const matching = manifest.artifacts.filter(artifact => kinds.includes(artifact.kind));
    return matching.length > 0 && matching.every(artifact => states[artifact.id]?.status === 'ready');
  };
  return Object.freeze({
    map: manifest.capabilities.map && allReady('map_style', 'map_tiles'),
    places: manifest.capabilities.places && allReady('places'),
    trails: manifest.capabilities.trails && allReady('trails'),
    search: manifest.capabilities.search && allReady('search_index'),
    routing: manifest.capabilities.routing && allReady('routing'),
    contours: manifest.capabilities.contours && allReady('contours'),
    media: manifest.capabilities.media && allReady('thumbnail', 'media'),
  });
}

function wholeInspection(
  status: OfflineBundleInspectionV2['status'],
  states: Readonly<Record<string, OfflineArtifactStateV2>>,
  capabilities: OfflineBundleCapabilitiesV2,
  diagnostics: string[],
): OfflineBundleInspectionV2 {
  return Object.freeze({
    status,
    ready: status === 'ready',
    artifact_states: states,
    capability_readiness: capabilities,
    diagnostics: Object.freeze([...new Set(diagnostics)]),
  });
}

export function createOfflineDownloadCoordinator(input: Readonly<{
  activeRenderer: OfflineMapRenderer;
  files: OfflineArtifactValidationAdapter;
  repository: OfflineBundleManifestRepository;
  rendererAdapters: Partial<Record<OfflineMapRenderer, OfflineRendererReadinessAdapter>>;
  now?: () => number;
}>): OfflineDownloadCoordinator {
  const now = input.now ?? Date.now;

  return {
    createInitialState(manifestInput) {
      const manifest = validateOfflineBundleManifest(manifestInput);
      return createQueuedArtifactStates(manifest.artifacts, now());
    },

    async begin(manifestInput) {
      const manifest = validateOfflineBundleManifest(manifestInput);
      await input.repository.verifyManifest(manifest);
      const stage = await input.repository.createStage(manifest);
      return Object.freeze({
        manifest,
        stage,
        artifact_states: createQueuedArtifactStates(manifest.artifacts, now()),
      });
    },

    async commit(start, rendererInstallation, options = {}) {
      const manifest = validateOfflineBundleManifest(start.manifest);
      await input.repository.verifyManifest(manifest);
      if (start.stage.bundle_id !== manifest.bundle_id || start.stage.revision !== manifest.revision) {
        throw new Error('The staged bundle does not match its manifest identity.');
      }
      if (manifest.renderer.id !== input.activeRenderer
        || rendererInstallation.renderer !== input.activeRenderer) {
        throw new Error('The staged bundle does not match the active map renderer.');
      }
      const rendererAdapter = input.rendererAdapters[manifest.renderer.id];
      if (!rendererAdapter) throw new Error(`No ${manifest.renderer.id} offline adapter is available.`);
      const rendererReadiness = await rendererAdapter.inspect(manifest, rendererInstallation);
      if (!rendererReadiness.ready
        || !rendererReadiness.style_ready
        || !rendererReadiness.tiles_ready
        || !rendererReadiness.render_probe_ready) {
        throw new Error(rendererReadiness.diagnostics[0] || 'The active renderer probe did not pass.');
      }

      const verifiedAt = now();
      const states: Record<string, OfflineArtifactStateV2> = {};
      for (const artifact of manifest.artifacts) {
        if (artifact.storage !== 'file') {
          states[artifact.id] = stateFor(artifact, start.artifact_states[artifact.id], 'ready', {
            received_bytes: artifact.bytes,
            total_bytes: artifact.bytes,
            updated_at_ms: verifiedAt,
          });
          continue;
        }
        const stagedPath = input.repository.artifactPath(start.stage, artifact.id);
        const result = await validateOfflineArtifactFile(input.files, artifact, stagedPath);
        if (!result.valid) {
          if (artifact.required || result.code !== 'missing') throw new Error(result.message);
          states[artifact.id] = stateFor(artifact, start.artifact_states[artifact.id], 'queued', {
            updated_at_ms: verifiedAt,
          });
          continue;
        }
        const livePath = `${start.stage.final_directory_uri.replace(/\/+$/, '')}/artifacts/${encodeURIComponent(artifact.id).replace(/%/g, '_')}`;
        states[artifact.id] = stateFor(artifact, start.artifact_states[artifact.id], 'ready', {
          received_bytes: artifact.bytes,
          total_bytes: artifact.bytes,
          local_uri: livePath,
          updated_at_ms: verifiedAt,
        });
      }
      const requiredIds = manifest.artifacts.filter(artifact => artifact.required).map(artifact => artifact.id);
      const receipt: OfflineBundleCommitReceiptV2 = Object.freeze({
        schema_version: 2,
        bundle_id: manifest.bundle_id,
        revision: manifest.revision,
        manifest_sha256: manifest.manifest_sha256,
        verified_required_artifact_ids: Object.freeze([...requiredIds]),
        renderer: Object.freeze({
          id: manifest.renderer.id,
          style_ready: true,
          tiles_ready: true,
          render_probe_ready: true,
        }),
        verified_at_ms: verifiedAt,
      });
      const installation: OfflineBundleInstallationV2 = Object.freeze({
        schema_version: 2,
        bundle_id: manifest.bundle_id,
        revision: manifest.revision,
        manifest_sha256: manifest.manifest_sha256,
        directory_uri: start.stage.final_directory_uri,
        artifacts: freezeStates(states),
        renderer: rendererInstallation,
        installed_at_ms: verifiedAt,
        verified_at_ms: verifiedAt,
      });
      await input.repository.commitStage(start.stage, installation, receipt, options);
      return Object.freeze({ installation, receipt });
    },

    async inspect(manifestInput, installation, options = {}) {
      const manifest = validateOfflineBundleManifest(manifestInput);
      try {
        await input.repository.verifyManifest(manifest);
      } catch (error) {
        const states = freezeStates(Object.fromEntries(manifest.artifacts.map(artifact => [
          artifact.id,
          stateFor(artifact, installation?.artifacts[artifact.id], 'repair_required', {
            error_code: 'manifest_checksum_mismatch',
            error_message: 'The offline manifest checksum could not be verified.',
            updated_at_ms: now(),
          }),
        ])));
        return wholeInspection(
          'repair_required',
          states,
          capabilitiesFor(manifest, states),
          [error instanceof Error ? error.message : 'The offline manifest cannot be verified.'],
        );
      }
      const initial = createQueuedArtifactStates(manifest.artifacts, now());
      if (!installation) {
        return wholeInspection('queued', initial, capabilitiesFor(manifest, initial), []);
      }
      const diagnostics: string[] = [];
      if (installation.bundle_id !== manifest.bundle_id) {
        const states = freezeStates(Object.fromEntries(manifest.artifacts.map(artifact => [
          artifact.id,
          stateFor(artifact, undefined, 'repair_required', {
            error_code: 'bundle_identity_mismatch',
            error_message: 'The installed bundle has a different identity.',
            updated_at_ms: now(),
          }),
        ])));
        diagnostics.push('The installed bundle identity does not match this manifest.');
        return wholeInspection('repair_required', states, capabilitiesFor(manifest, states), diagnostics);
      }
      if (installation.revision !== manifest.revision) {
        const states = freezeStates(Object.fromEntries(manifest.artifacts.map(artifact => [
          artifact.id,
          stateFor(artifact, installation.artifacts[artifact.id], 'needs_update', { updated_at_ms: now() }),
        ])));
        diagnostics.push(`Installed revision ${installation.revision} must be updated to ${manifest.revision}.`);
        return wholeInspection('needs_update', states, capabilitiesFor(manifest, states), diagnostics);
      }
      if (installation.manifest_sha256.toLowerCase() !== manifest.manifest_sha256.toLowerCase()) {
        const states = freezeStates(Object.fromEntries(manifest.artifacts.map(artifact => [
          artifact.id,
          stateFor(artifact, installation.artifacts[artifact.id], 'repair_required', {
            error_code: 'manifest_checksum_mismatch',
            error_message: 'The installed manifest checksum does not match.',
            updated_at_ms: now(),
          }),
        ])));
        diagnostics.push('The installed manifest cannot be verified.');
        return wholeInspection('repair_required', states, capabilitiesFor(manifest, states), diagnostics);
      }

      const states: Record<string, OfflineArtifactStateV2> = {};
      let rendererRepair = false;
      let rendererPartial = false;
      const rendererArtifacts = manifest.artifacts.filter(artifact => artifact.storage !== 'file');
      const rendererAdapter = input.rendererAdapters[manifest.renderer.id];
      if (manifest.renderer.id !== input.activeRenderer || installation.renderer.renderer !== input.activeRenderer) {
        rendererRepair = true;
        diagnostics.push(`The bundle uses ${manifest.renderer.id}, but the active map uses ${input.activeRenderer}.`);
      } else if (!rendererAdapter) {
        rendererRepair = true;
        diagnostics.push(`No ${manifest.renderer.id} offline adapter is available.`);
      } else {
        const readiness = await rendererAdapter.inspect(manifest, installation.renderer).catch(error => ({
          renderer: manifest.renderer.id,
          ready: false,
          style_ready: false,
          tiles_ready: false,
          render_probe_ready: false,
          diagnostics: [error instanceof Error ? error.message : 'The renderer readiness check failed.'],
        }));
        diagnostics.push(...readiness.diagnostics);
        if (!readiness.ready) {
          rendererPartial = !readiness.style_ready || !readiness.tiles_ready;
          rendererRepair = !rendererPartial || (readiness.style_ready && readiness.tiles_ready && !readiness.render_probe_ready);
        }
        for (const artifact of rendererArtifacts) {
          const artifactReady = artifact.storage === 'renderer_style_pack'
            ? readiness.style_ready
            : readiness.tiles_ready;
          const status = artifactReady && readiness.render_probe_ready
            ? 'ready'
            : rendererRepair ? 'repair_required' : 'partial';
          states[artifact.id] = stateFor(artifact, installation.artifacts[artifact.id], status, {
            ...(status === 'repair_required' ? {
              error_code: 'renderer_probe_failed',
              error_message: readiness.diagnostics[0] || 'The offline map must be repaired.',
            } : {}),
            updated_at_ms: now(),
          });
        }
      }
      if ((rendererRepair || rendererPartial) && rendererArtifacts.some(artifact => !states[artifact.id])) {
        for (const artifact of rendererArtifacts) {
          states[artifact.id] = stateFor(
            artifact,
            installation.artifacts[artifact.id],
            rendererRepair ? 'repair_required' : 'partial',
            {
              ...(rendererRepair ? {
                error_code: 'renderer_mismatch',
                error_message: diagnostics[0] || 'The offline map must be repaired.',
              } : {}),
              updated_at_ms: now(),
            },
          );
        }
      }

      for (const artifact of manifest.artifacts.filter(item => item.storage === 'file')) {
        const installed = installation.artifacts[artifact.id];
        if (!installed?.local_uri) {
          states[artifact.id] = stateFor(artifact, installed, artifact.required ? 'partial' : 'queued', { updated_at_ms: now() });
          if (artifact.required) diagnostics.push(`Required artifact ${artifact.id} is missing.`);
          continue;
        }
        const validation = await validateOfflineArtifactFile(input.files, artifact, installed.local_uri);
        if (validation.valid) {
          states[artifact.id] = stateFor(artifact, installed, 'ready', {
            received_bytes: artifact.bytes,
            total_bytes: artifact.bytes,
            local_uri: installed.local_uri,
            updated_at_ms: now(),
          });
        } else {
          const missing = validation.code === 'missing';
          states[artifact.id] = stateFor(artifact, installed, missing ? (artifact.required ? 'partial' : 'queued') : 'repair_required', {
            local_uri: installed.local_uri,
            ...(!missing ? { error_code: validation.code, error_message: validation.message } : {}),
            updated_at_ms: now(),
          });
          if (artifact.required || !missing) diagnostics.push(validation.message);
        }
      }

      const immutableStates = freezeStates(states);
      const requiredStates = manifest.artifacts.filter(artifact => artifact.required).map(artifact => immutableStates[artifact.id]);
      const status = requiredStates.some(state => state?.status === 'repair_required' || state?.status === 'error')
        ? 'repair_required'
        : requiredStates.some(state => state?.status !== 'ready')
        ? 'partial'
        : 'ready';
      return wholeInspection(status, immutableStates, capabilitiesFor(manifest, immutableStates), diagnostics);
    },
  };
}
