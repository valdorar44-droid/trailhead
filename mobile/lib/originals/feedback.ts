import type {
  OriginalFeedbackPayloadV1,
  OriginalFeedbackStore,
  PendingOriginalFeedbackV1,
} from './feedbackStore';

type FeedbackApi = {
  feedbackGuestToken(packId: string, version: number, installId: string): Promise<{ token: string }>;
  submitFeedback(
    packId: string,
    payload: OriginalFeedbackPayloadV1,
    options: { idempotencyKey: string; authToken?: string | null; guestToken?: string },
  ): Promise<Record<string, unknown>>;
};

function randomFeedbackKey() {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  return randomUUID ? randomUUID() : `original-feedback-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function receiptId(value: Record<string, unknown>) {
  const candidate = value.receipt_id ?? value.feedback_id ?? value.id;
  return typeof candidate === 'string' || typeof candidate === 'number' ? String(candidate) : undefined;
}

export async function deliverPendingOriginalFeedback(
  item: PendingOriginalFeedbackV1,
  dependencies: { store: OriginalFeedbackStore; api: FeedbackApi; authToken?: string | null },
) {
  try {
    const guestToken = item.authentication === 'guest'
      ? (await dependencies.api.feedbackGuestToken(
        item.pack_id,
        item.payload.version,
        await dependencies.store.getOrCreateInstallId(),
      )).token
      : undefined;
    if (item.authentication === 'signed_in' && !dependencies.authToken) {
      throw new Error('Sign in again to send this feedback.');
    }
    const response = await dependencies.api.submitFeedback(item.pack_id, item.payload, {
      idempotencyKey: item.idempotency_key,
      ...(item.authentication === 'signed_in' ? { authToken: dependencies.authToken } : { authToken: null, guestToken }),
    });
    await dependencies.store.recordSuccess(item.idempotency_key, receiptId(response));
    return { sent: true as const, idempotencyKey: item.idempotency_key };
  } catch (error: any) {
    const message = String(error?.message || 'Feedback is queued until Trailhead is online.');
    await dependencies.store.recordFailure(item.idempotency_key, message);
    return { sent: false as const, idempotencyKey: item.idempotency_key, error: message };
  }
}

export async function submitOriginalFeedback(
  input: {
    packId: string;
    payload: OriginalFeedbackPayloadV1;
    authentication: 'guest' | 'signed_in';
    idempotencyKey?: string;
    nowMs?: number;
  },
  dependencies: { store: OriginalFeedbackStore; api: FeedbackApi; authToken?: string | null },
) {
  const now = input.nowMs ?? Date.now();
  const pending: PendingOriginalFeedbackV1 = {
    schema_version: 1,
    idempotency_key: input.idempotencyKey || randomFeedbackKey(),
    pack_id: input.packId,
    payload: input.payload,
    authentication: input.authentication,
    created_at_ms: now,
    updated_at_ms: now,
    attempt_count: 0,
  };
  await dependencies.store.enqueue(pending);
  return deliverPendingOriginalFeedback(pending, dependencies);
}

export async function retryOriginalFeedback(
  dependencies: { store: OriginalFeedbackStore; api: FeedbackApi; authToken?: string | null },
  packId?: string,
  version?: number,
) {
  const pending = await dependencies.store.listPending(packId, version);
  const results = [];
  for (const item of pending) results.push(await deliverPendingOriginalFeedback(item, dependencies));
  return results;
}
