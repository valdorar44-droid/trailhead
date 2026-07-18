import {
  joinOriginalPath,
  recoverOriginalPath,
  writeOriginalTextAtomically,
  type OriginalFileAdapter,
} from './fileAdapter';

export const ORIGINAL_FEEDBACK_CATEGORIES = [
  'general',
  'trigger_timing',
  'audio',
  'map',
  'offline',
  'access_info',
  'safety',
  'other',
] as const;

export type OriginalFeedbackCategory = typeof ORIGINAL_FEEDBACK_CATEGORIES[number];
export type OriginalFeedbackPlatform = 'ios' | 'android' | 'web';

export type OriginalFeedbackPayloadV1 = {
  version: number;
  stop_id?: string;
  category: OriginalFeedbackCategory;
  rating?: number;
  message: string;
  platform: OriginalFeedbackPlatform;
  app_version?: string;
  runtime_version?: string;
  release_cohort?: string;
  contact_consent?: boolean;
};

export type PendingOriginalFeedbackV1 = {
  schema_version: 1;
  idempotency_key: string;
  pack_id: string;
  payload: OriginalFeedbackPayloadV1;
  authentication: 'guest' | 'signed_in';
  created_at_ms: number;
  updated_at_ms: number;
  attempt_count: number;
  last_error?: string;
};

export type OriginalFeedbackReceiptV1 = {
  schema_version: 1;
  idempotency_key: string;
  pack_id: string;
  version: number;
  submitted_at_ms: number;
  server_receipt_id?: string;
};

type OriginalFeedbackIndexV1 = {
  schema_version: 1;
  install_id?: string;
  pending: PendingOriginalFeedbackV1[];
  receipts: OriginalFeedbackReceiptV1[];
};

const MAX_PENDING = 100;
const MAX_RECEIPTS = 100;
const emptyIndex = (): OriginalFeedbackIndexV1 => ({ schema_version: 1, pending: [], receipts: [] });

function randomInstallId() {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  return randomUUID ? randomUUID() : `install-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cleanIndex(value: unknown): OriginalFeedbackIndexV1 {
  const candidate = value && typeof value === 'object' ? value as Partial<OriginalFeedbackIndexV1> : {};
  if (candidate.schema_version !== 1) return emptyIndex();
  return {
    schema_version: 1,
    ...(typeof candidate.install_id === 'string' && candidate.install_id ? { install_id: candidate.install_id } : {}),
    pending: Array.isArray(candidate.pending) ? candidate.pending.slice(0, MAX_PENDING) : [],
    receipts: Array.isArray(candidate.receipts) ? candidate.receipts.slice(0, MAX_RECEIPTS) : [],
  };
}

export type OriginalFeedbackStore = ReturnType<typeof createOriginalFeedbackStore>;

export function createOriginalFeedbackStore(
  files: OriginalFileAdapter,
  root = joinOriginalPath(files.documentDirectory, 'originals/feedback'),
) {
  const indexPath = joinOriginalPath(root, '_index.json');
  let operationTail: Promise<unknown> = Promise.resolve();
  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationTail.then(operation, operation);
    operationTail = result.catch(() => undefined);
    return result;
  };
  const readIndex = async () => {
    try {
      await recoverOriginalPath(files, indexPath);
      return cleanIndex(JSON.parse(await files.readText(indexPath)));
    } catch {
      return emptyIndex();
    }
  };
  const writeIndex = (index: OriginalFeedbackIndexV1) => (
    writeOriginalTextAtomically(files, indexPath, JSON.stringify(index))
  );

  return {
    getOrCreateInstallId() {
      return serialized(async () => {
        const index = await readIndex();
        if (!index.install_id) {
          index.install_id = randomInstallId();
          await writeIndex(index);
        }
        return index.install_id;
      });
    },

    listPending(packId?: string, version?: number) {
      return serialized(async () => (await readIndex()).pending.filter(item => (
        (packId == null || item.pack_id === packId)
        && (version == null || item.payload.version === version)
      )));
    },

    listReceipts(packId?: string, version?: number) {
      return serialized(async () => (await readIndex()).receipts.filter(item => (
        (packId == null || item.pack_id === packId)
        && (version == null || item.version === version)
      )));
    },

    enqueue(item: PendingOriginalFeedbackV1) {
      return serialized(async () => {
        const index = await readIndex();
        index.pending = [
          item,
          ...index.pending.filter(existing => existing.idempotency_key !== item.idempotency_key),
        ].slice(0, MAX_PENDING);
        await writeIndex(index);
        return item;
      });
    },

    recordFailure(idempotencyKey: string, message: string, updatedAtMs = Date.now()) {
      return serialized(async () => {
        const index = await readIndex();
        index.pending = index.pending.map(item => item.idempotency_key === idempotencyKey ? {
          ...item,
          attempt_count: item.attempt_count + 1,
          last_error: message.slice(0, 500),
          updated_at_ms: updatedAtMs,
        } : item);
        await writeIndex(index);
      });
    },

    recordSuccess(idempotencyKey: string, serverReceiptId?: string, submittedAtMs = Date.now()) {
      return serialized(async () => {
        const index = await readIndex();
        const pending = index.pending.find(item => item.idempotency_key === idempotencyKey);
        if (!pending) return null;
        const receipt: OriginalFeedbackReceiptV1 = {
          schema_version: 1,
          idempotency_key: idempotencyKey,
          pack_id: pending.pack_id,
          version: pending.payload.version,
          submitted_at_ms: submittedAtMs,
          ...(serverReceiptId ? { server_receipt_id: serverReceiptId } : {}),
        };
        index.pending = index.pending.filter(item => item.idempotency_key !== idempotencyKey);
        index.receipts = [receipt, ...index.receipts.filter(item => item.idempotency_key !== idempotencyKey)]
          .slice(0, MAX_RECEIPTS);
        await writeIndex(index);
        return receipt;
      });
    },
  };
}
