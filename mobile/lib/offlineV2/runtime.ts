import { transitionOfflineArtifactState } from './artifactState';
import type {
  OfflineArtifactTransferAdapter,
  OfflineDownloadCoordinator,
  OfflineRendererDownloadAdapter,
} from './coordinator';
import type { OfflineBundleJobStoreV2, OfflineBundleDownloadJobV2 } from './jobStore';
import type { OfflineBundleManifestRepository } from './repository';
import type {
  OfflineArtifactStateV2,
  OfflineBundleArtifactV2,
  OfflineBundleInstallationV2,
  OfflineBundleManifestV2,
} from './types';
import type {
  OfflineBundlePreparationClientV2,
  OfflineBundlePreparationV2,
  OfflineBundlePrepareRequestV2,
} from './preparation';
import {
  awaitOfflineVerificationV1,
  type OfflineVerificationPhaseCodeV1,
} from './verification';

export type OfflineBundleRuntimeStorageV2 = Readonly<{
  freeDiskBytes(): Promise<number | null>;
}>;

export type OfflineBundleRuntimeInputV2 = Readonly<{
  owner_scope: string;
  client_ref?: string;
  label: string;
  request: OfflineBundlePrepareRequestV2;
}>;

export type OfflineBundleRuntimeListenerV2 = (job: OfflineBundleDownloadJobV2) => void;

export interface OfflineBundleRuntimeV2 {
  create(input: OfflineBundleRuntimeInputV2): Promise<OfflineBundleDownloadJobV2>;
  resume(jobId: string): Promise<OfflineBundleDownloadJobV2>;
  pause(jobId: string): Promise<OfflineBundleDownloadJobV2>;
  cancel(jobId: string): Promise<void>;
  remove(bundleId: string): Promise<void>;
  /** Revalidates committed bytes, SQLite, and the native renderer without downloading. */
  inspect(jobId: string): Promise<OfflineBundleDownloadJobV2>;
  get(jobId: string): Promise<OfflineBundleDownloadJobV2 | null>;
  list(ownerScope: string): Promise<readonly OfflineBundleDownloadJobV2[]>;
  subscribe(listener: OfflineBundleRuntimeListenerV2): () => void;
}

function abortError(message = 'Offline download paused.') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function isAbort(error: unknown) {
  return (error as { name?: string } | null)?.name === 'AbortError';
}

function jobId(now: number) {
  return `offline-${now}-${Math.random().toString(36).slice(2, 10)}`;
}

function errorRecord(error: unknown) {
  const item = error as { code?: unknown; message?: unknown } | null;
  const message = typeof item?.message === 'string' && item.message
    ? item.message
    : 'This offline download could not be completed.';
  const normalized = message.toLowerCase();
  const inferredCode = /checksum|sha-?256|hash|integrity|wrong size|expected .* bytes|cannot be verified|could not be verified|quick_check|fts5|r-tree|rtree/.test(normalized)
    ? 'offline_integrity_failed'
    : 'offline_download_failed';
  return Object.freeze({
    code: typeof item?.code === 'string' ? item.code : inferredCode,
    message,
  });
}

function repairRequired(code: string) {
  return code === 'manifest_checksum_mismatch'
    || code === 'offline_integrity_failed'
    || code === 'bundle_identity_mismatch';
}

function updateArtifact(
  states: Readonly<Record<string, OfflineArtifactStateV2>>,
  artifact: OfflineBundleArtifactV2,
  status: OfflineArtifactStateV2['status'],
  update: Parameters<typeof transitionOfflineArtifactState>[2] = {},
) {
  const current = states[artifact.id];
  if (!current) throw new Error(`Offline artifact ${artifact.id} has no state.`);
  return Object.freeze({
    ...states,
    [artifact.id]: transitionOfflineArtifactState(current, status, update),
  });
}

function markDownloading(
  states: Readonly<Record<string, OfflineArtifactStateV2>>,
  artifact: OfflineBundleArtifactV2,
  now: number,
) {
  let current = states[artifact.id];
  if (!current) throw new Error(`Offline artifact ${artifact.id} has no state.`);
  if (current.status === 'ready' || current.status === 'verifying') {
    current = transitionOfflineArtifactState(current, 'partial', { updated_at_ms: now });
  }
  return Object.freeze({
    ...states,
    [artifact.id]: transitionOfflineArtifactState(current, 'downloading', { updated_at_ms: now }),
  });
}

function setRendererArtifactStatus(
  job: OfflineBundleDownloadJobV2,
  status: OfflineArtifactStateV2['status'],
  now: number,
) {
  let states = job.artifact_states;
  for (const artifact of job.manifest?.artifacts ?? []) {
    if (artifact.storage === 'file') continue;
    const current = states[artifact.id];
    if (!current || current.status === status) continue;
    states = status === 'downloading'
      ? markDownloading(states, artifact, now)
      : updateArtifact(states, artifact, status, { updated_at_ms: now });
  }
  return states;
}

export function createOfflineBundleRuntimeV2(input: Readonly<{
  ownerScope: string;
  preparation: OfflineBundlePreparationClientV2;
  coordinator: OfflineDownloadCoordinator;
  repository: OfflineBundleManifestRepository;
  jobs: OfflineBundleJobStoreV2;
  transfer: OfflineArtifactTransferAdapter;
  renderer: OfflineRendererDownloadAdapter;
  storage: OfflineBundleRuntimeStorageV2;
  validateSearchIndex?: (path: string, expectedRecords?: number) => Promise<void>;
  canOperate?: () => boolean;
  verification_timeout_ms?: number;
  now?: () => number;
}>): OfflineBundleRuntimeV2 {
  const now = input.now ?? Date.now;
  const listeners = new Set<OfflineBundleRuntimeListenerV2>();
  const active = new Map<string, Promise<OfflineBundleDownloadJobV2>>();
  const controllers = new Map<string, AbortController>();
  const pauseRequested = new Set<string>();
  const activeArtifacts = new Map<string, string>();
  const memory = new Map<string, OfflineBundleDownloadJobV2>();
  let lastProgressSave = 0;

  const assertCanOperate = () => {
    if (input.canOperate?.() === false) {
      const error = new Error('This offline download belongs to a previous account session.');
      (error as Error & { code?: string }).code = 'offline_account_scope_inactive';
      throw error;
    }
  };

  const publish = async (job: OfflineBundleDownloadJobV2, persist = true) => {
    memory.set(job.job_id, job);
    listeners.forEach(listener => listener(job));
    if (persist) await input.jobs.save(job);
    return job;
  };

  const replace = (
    job: OfflineBundleDownloadJobV2,
    update: Partial<OfflineBundleDownloadJobV2>,
  ): OfflineBundleDownloadJobV2 => Object.freeze({
    ...job,
    ...update,
    updated_at_ms: now(),
  });

  const noteVerification = (
    current: OfflineBundleDownloadJobV2,
    phaseCode: OfflineVerificationPhaseCodeV1,
    artifactKind?: OfflineBundleArtifactV2['kind'],
  ) => {
    const next = replace(current, {
      status: 'verifying',
      verification: Object.freeze({
        phase_code: phaseCode,
        ...(artifactKind ? { artifact_kind: artifactKind } : {}),
        started_at_ms: now(),
      }),
    });
    memory.set(next.job_id, next);
    listeners.forEach(listener => listener(next));
    void input.jobs.save(next);
    return next;
  };

  const run = async (initial: OfflineBundleDownloadJobV2) => {
    assertCanOperate();
    let job = initial;
    const controller = new AbortController();
    controllers.set(job.job_id, controller);
    pauseRequested.delete(job.job_id);
    try {
      if (!job.manifest) {
        job = await publish(replace(job, {
          status: 'preparing', error: undefined, verification: undefined,
        }));
        const preparationOptions = {
          signal: controller.signal,
          onPreparation: (preparation: OfflineBundlePreparationV2) => {
            job = replace(job, { preparation });
            void publish(job);
          },
        } as const;
        const resumablePreparation = job.preparation
          && (job.preparation.status === 'queued' || job.preparation.status === 'running')
          && input.preparation.resume;
        const manifest = resumablePreparation
          ? await input.preparation.resume!(job.preparation!.id, preparationOptions)
          : await input.preparation.prepare(job.request, preparationOptions);
        job = await publish(replace(job, {
          manifest,
          status: 'queued',
          verification: undefined,
          artifact_states: input.coordinator.createInitialState(manifest),
        }));
      }

      const manifest = job.manifest;
      if (!manifest) throw new Error('The offline bundle manifest is missing.');
      if (manifest.renderer.id !== input.renderer.renderer) {
        throw new Error(`This download requires ${manifest.renderer.id}, but the active map uses ${input.renderer.renderer}.`);
      }
      const current = await input.repository.getCurrentInstallation(manifest.bundle_id);
      if (current?.revision === manifest.revision) {
        const inspection = await input.coordinator.inspect(manifest, current);
        if (inspection.ready) {
          return publish(replace(job, {
            status: 'ready',
            artifact_states: inspection.artifact_states,
            renderer_installation: current.renderer,
            error: undefined,
            verification: undefined,
          }));
        }
        // A committed stage is moved into its immutable live directory. If a
        // later renderer/file probe fails, never reuse that old staging handle.
        // A repair starts in a fresh temporary directory while the previous
        // installation remains available until the replacement commits.
        job = await publish(replace(job, {
          status: inspection.status === 'repair_required' ? 'repair_required' : 'queued',
          start: undefined,
          artifact_states: input.coordinator.createInitialState(manifest),
          resume_tokens: Object.freeze({}),
          renderer_installation: undefined,
          verification: undefined,
          error: inspection.diagnostics[0]
            ? Object.freeze({
                code: inspection.status === 'repair_required'
                  ? 'offline_integrity_failed'
                  : 'offline_bundle_not_ready',
                message: inspection.diagnostics[0],
              })
            : undefined,
        }));
      }

      if (!job.start) {
        const freeBytes = await input.storage.freeDiskBytes();
        const reserve = Math.max(32 * 1024 * 1024, Math.ceil(manifest.required_storage_bytes * 0.1));
        if (freeBytes != null && freeBytes < manifest.required_storage_bytes + reserve) {
          const error = new Error('Not enough free storage for this offline download.');
          (error as Error & { code?: string }).code = 'insufficient_storage';
          throw error;
        }
        const start = await input.coordinator.begin(manifest);
        job = await publish(replace(job, {
          start,
          artifact_states: start.artifact_states,
          status: 'queued',
          verification: undefined,
        }));
      }

      const start = job.start;
      if (!start) throw new Error('The offline staging directory is missing.');
      for (const artifact of manifest.artifacts.filter(item => item.storage === 'file')) {
        if (controller.signal.aborted) throw abortError();
        const destination = input.repository.artifactPath(start.stage, artifact.id);
        const previous = job.artifact_states[artifact.id];
        if (previous?.status === 'ready') continue;
        if (previous?.status === 'verifying') {
          try {
            if (artifact.kind === 'search_index' && input.validateSearchIndex) {
              job = noteVerification(job, 'search_index', artifact.kind);
              await awaitOfflineVerificationV1(
                input.validateSearchIndex(destination, artifact.record_count),
                { signal: controller.signal, timeout_ms: input.verification_timeout_ms },
              );
            }
            continue;
          } catch (error) {
            if (isAbort(error)
              || (error as { code?: unknown } | null)?.code === 'offline_verification_timeout') {
              throw error;
            }
            // Semantic SQLite validation is as authoritative as byte/hash
            // validation. Redownload instead of retrying a corrupt resume token.
            job = await publish(replace(job, {
              status: 'repair_required',
              artifact_states: updateArtifact(job.artifact_states, artifact, 'repair_required', {
                error_code: 'offline_integrity_failed',
                error_message: 'The offline search index needs repair.',
                updated_at_ms: now(),
              }),
              resume_tokens: Object.freeze(Object.fromEntries(
                Object.entries(job.resume_tokens).filter(([id]) => id !== artifact.id),
              )),
            }));
          }
        }
        job = await publish(replace(job, {
          status: 'downloading',
          verification: undefined,
          artifact_states: markDownloading(job.artifact_states, artifact, now()),
          error: undefined,
        }));
        activeArtifacts.set(job.job_id, artifact.id);
        const result = await input.transfer.download(artifact, destination, {
          signal: controller.signal,
          etag: artifact.sha256,
          resume_token: job.resume_tokens[artifact.id],
          onProgress: progress => {
            job = replace(job, {
              artifact_states: updateArtifact(job.artifact_states, artifact, 'downloading', {
                received_bytes: progress.received_bytes,
                total_bytes: artifact.bytes,
                updated_at_ms: now(),
              }),
              resume_tokens: progress.resume_token
                ? Object.freeze({ ...job.resume_tokens, [artifact.id]: progress.resume_token })
                : job.resume_tokens,
            });
            memory.set(job.job_id, job);
            listeners.forEach(listener => listener(job));
            if (now() - lastProgressSave >= 750) {
              lastProgressSave = now();
              void input.jobs.save(job);
            }
          },
        });
        activeArtifacts.delete(job.job_id);
        job = await publish(replace(job, {
          status: 'verifying',
          artifact_states: updateArtifact(job.artifact_states, artifact, 'verifying', {
            received_bytes: artifact.bytes,
            total_bytes: artifact.bytes,
            local_uri: destination,
            updated_at_ms: now(),
          }),
          resume_tokens: result.resume_token
            ? Object.freeze({ ...job.resume_tokens, [artifact.id]: result.resume_token })
            : job.resume_tokens,
        }));
        if (artifact.kind === 'search_index' && input.validateSearchIndex) {
          job = noteVerification(job, 'search_index', artifact.kind);
          await awaitOfflineVerificationV1(
            input.validateSearchIndex(destination, artifact.record_count),
            { signal: controller.signal, timeout_ms: input.verification_timeout_ms },
          );
        }
      }

      if (controller.signal.aborted) throw abortError();
      job = await publish(replace(job, {
        status: 'downloading',
        verification: undefined,
        artifact_states: setRendererArtifactStatus(job, 'downloading', now()),
      }));
      const rendererInstallation = await input.renderer.prepare(manifest, {
        signal: controller.signal,
        onProgress: progress => {
          const rendererArtifacts = manifest.artifacts.filter(artifact => artifact.storage !== 'file');
          let states = job.artifact_states;
          for (const artifact of rendererArtifacts) {
            states = updateArtifact(states, artifact, 'downloading', {
              received_bytes: Math.min(artifact.bytes, progress.received_bytes),
              total_bytes: artifact.bytes,
              updated_at_ms: now(),
            });
          }
          job = replace(job, { artifact_states: states });
          memory.set(job.job_id, job);
          listeners.forEach(listener => listener(job));
        },
      });
      job = await publish(replace(job, {
        status: 'verifying',
        renderer_installation: rendererInstallation,
        artifact_states: setRendererArtifactStatus(job, 'verifying', now()),
      }));

      const repair = Boolean(current
        && current.bundle_id === manifest.bundle_id
        && current.revision === manifest.revision
        && current.manifest_sha256 === manifest.manifest_sha256);
      const committed = await awaitOfflineVerificationV1(
        input.coordinator.commit(start, rendererInstallation, {
          repair,
          on_verification_phase: (phase, kind) => {
            job = noteVerification(job, phase, kind);
          },
        }),
        { signal: controller.signal, timeout_ms: input.verification_timeout_ms },
      );
      job = await publish(replace(job, {
        status: 'ready',
        artifact_states: committed.installation.artifacts,
        renderer_installation: committed.installation.renderer,
        error: undefined,
        verification: undefined,
      }));
      return job;
    } catch (error) {
      if (isAbort(error) || pauseRequested.has(job.job_id)) {
        let states = job.artifact_states;
        for (const artifact of job.manifest?.artifacts ?? []) {
          const state = states[artifact.id];
          if (state?.status === 'downloading') {
            states = updateArtifact(states, artifact, 'paused', { updated_at_ms: now() });
          }
        }
        return publish(replace(job, {
          status: 'paused', artifact_states: states, error: undefined, verification: undefined,
        }));
      }
      const record = errorRecord(error);
      const needsRepair = repairRequired(record.code);
      if (needsRepair && job.start) {
        // Retrying the same staged bytes and resume token can loop forever
        // after a checksum or SQLite integrity failure.
        await input.repository.discardStage(job.start.stage).catch(() => undefined);
      }
      return publish(replace(job, {
        status: needsRepair ? 'repair_required' : 'error',
        ...(needsRepair && job.manifest ? {
          start: undefined,
          artifact_states: input.coordinator.createInitialState(job.manifest),
          resume_tokens: Object.freeze({}),
          renderer_installation: undefined,
        } : {}),
        error: record,
      }));
    } finally {
      controllers.delete(job.job_id);
      activeArtifacts.delete(job.job_id);
      pauseRequested.delete(job.job_id);
    }
  };

  const resume = async (jobIdValue: string) => {
    assertCanOperate();
    const existing = active.get(jobIdValue);
    if (existing) return existing;
    const job = memory.get(jobIdValue) ?? await input.jobs.get(jobIdValue);
    if (!job) throw new Error('This offline download is no longer available.');
    const promise = run(job).finally(() => active.delete(jobIdValue));
    active.set(jobIdValue, promise);
    return promise;
  };

  const inspect = async (jobIdValue: string) => {
    assertCanOperate();
    let job = memory.get(jobIdValue) ?? await input.jobs.get(jobIdValue);
    if (!job) throw new Error('This offline download is no longer available.');
    const manifest = job.manifest;
    if (!manifest) return job;
    const installation = await input.repository.getCurrentInstallation(manifest.bundle_id);
    const inspection = await input.coordinator.inspect(manifest, installation);
    let artifactStates = inspection.artifact_states;
    let diagnostic = inspection.diagnostics[0];
    let ready = inspection.ready;
    if (ready && input.validateSearchIndex) {
      for (const artifact of manifest.artifacts.filter(item => item.kind === 'search_index')) {
        const state = artifactStates[artifact.id];
        if (state?.status !== 'ready' || !state.local_uri) continue;
        try {
          await input.validateSearchIndex(state.local_uri, artifact.record_count);
        } catch (error) {
          ready = false;
          diagnostic = error instanceof Error ? error.message : 'The offline search index needs repair.';
          artifactStates = Object.freeze({
            ...artifactStates,
            [artifact.id]: transitionOfflineArtifactState(state, 'repair_required', {
              error_code: 'offline_integrity_failed',
              error_message: diagnostic,
              updated_at_ms: now(),
            }),
          });
        }
      }
    }
    job = replace(job, {
      status: ready ? 'ready' : 'repair_required',
      artifact_states: artifactStates,
      renderer_installation: installation?.renderer,
      error: ready ? undefined : Object.freeze({
        code: 'offline_integrity_failed',
        message: diagnostic || 'This offline download needs repair.',
      }),
    });
    return publish(job);
  };

  return {
    async create(createInput) {
      assertCanOperate();
      if (createInput.owner_scope !== input.ownerScope) {
        throw new Error('The offline download belongs to a different account scope.');
      }
      const timestamp = now();
      const job: OfflineBundleDownloadJobV2 = Object.freeze({
        schema_version: 2,
        job_id: jobId(timestamp),
        owner_scope: createInput.owner_scope,
        ...(createInput.client_ref ? { client_ref: createInput.client_ref } : {}),
        label: createInput.label.trim() || 'Offline area',
        status: 'preparing',
        request: createInput.request,
        artifact_states: Object.freeze({}),
        resume_tokens: Object.freeze({}),
        created_at_ms: timestamp,
        updated_at_ms: timestamp,
      });
      await publish(job);
      void resume(job.job_id);
      return job;
    },
    resume,
    inspect,
    async pause(jobIdValue) {
      let job = memory.get(jobIdValue) ?? await input.jobs.get(jobIdValue);
      if (!job) throw new Error('This offline download is no longer available.');
      pauseRequested.add(jobIdValue);
      const artifactId = activeArtifacts.get(jobIdValue);
      if (artifactId) {
        const paused = await input.transfer.pause?.(artifactId).catch(() => undefined);
        if (paused?.resume_token) {
          job = memory.get(jobIdValue) ?? job;
          const next = replace(job, {
            resume_tokens: Object.freeze({ ...job.resume_tokens, [artifactId]: paused.resume_token }),
          });
          job = await publish(next);
        }
      }
      if (job.manifest) await input.renderer.pause?.(job.manifest).catch(() => undefined);
      controllers.get(jobIdValue)?.abort();
      return active.get(jobIdValue) ?? publish(replace(memory.get(jobIdValue) ?? job, { status: 'paused' }));
    },
    async cancel(jobIdValue) {
      pauseRequested.add(jobIdValue);
      const job = memory.get(jobIdValue) ?? await input.jobs.get(jobIdValue);
      const artifactId = activeArtifacts.get(jobIdValue);
      if (artifactId) await input.transfer.cancel?.(artifactId).catch(() => undefined);
      controllers.get(jobIdValue)?.abort();
      await active.get(jobIdValue)?.catch(() => undefined);
      const latest = memory.get(jobIdValue) ?? job;
      if (latest?.start) await input.repository.discardStage(latest.start.stage).catch(() => undefined);
      await input.jobs.remove(jobIdValue);
      memory.delete(jobIdValue);
    },
    async remove(bundleId) {
      const installation = await input.repository.getCurrentInstallation(bundleId);
      if (!installation) return;
      // Native renderer deletion is part of the removal transaction. If it
      // fails, retain the repository pointer and job so the UI cannot claim
      // storage was removed while an RNMapbox pack remains orphaned.
      await input.renderer.remove?.(installation.renderer);
      await input.repository.removeCurrentInstallation(bundleId);
      const persisted = await input.jobs.list(input.ownerScope);
      const matching = persisted.filter(job => job.manifest?.bundle_id === bundleId);
      for (const job of matching) {
        await input.jobs.remove(job.job_id).catch(() => undefined);
        memory.delete(job.job_id);
      }
    },
    get(jobIdValue) {
      return memory.has(jobIdValue)
        ? Promise.resolve(memory.get(jobIdValue) ?? null)
        : input.jobs.get(jobIdValue);
    },
    list(ownerScope) {
      return input.jobs.list(ownerScope);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
