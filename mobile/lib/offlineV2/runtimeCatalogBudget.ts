export const OFFLINE_V2_RUNTIME_DOCUMENT_ARTIFACT_BYTE_LIMIT = 8 * 1024 * 1024;
export const OFFLINE_V2_RUNTIME_DOCUMENT_TOTAL_BYTE_LIMIT = 12 * 1024 * 1024;

export type RuntimeOfflineDocumentBudgetDecision = Readonly<{
  materialize: boolean;
  next_claimed_bytes: number;
  reason: 'accepted' | 'invalid_size' | 'artifact_limit' | 'catalog_limit';
}>;

/**
 * Protect the mobile Java/JS bridge from whole-file JSON allocations. Search
 * indexes remain authoritative when a verified places/trails document is too
 * large to materialize safely in one process.
 */
export function claimRuntimeOfflineDocumentBudget(
  claimedBytes: number,
  artifactBytes: number,
): RuntimeOfflineDocumentBudgetDecision {
  if (!Number.isSafeInteger(claimedBytes) || claimedBytes < 0
    || !Number.isSafeInteger(artifactBytes) || artifactBytes < 0) {
    return Object.freeze({
      materialize: false,
      next_claimed_bytes: Math.max(0, Number.isSafeInteger(claimedBytes) ? claimedBytes : 0),
      reason: 'invalid_size',
    });
  }
  if (artifactBytes > OFFLINE_V2_RUNTIME_DOCUMENT_ARTIFACT_BYTE_LIMIT) {
    return Object.freeze({
      materialize: false,
      next_claimed_bytes: claimedBytes,
      reason: 'artifact_limit',
    });
  }
  if (claimedBytes + artifactBytes > OFFLINE_V2_RUNTIME_DOCUMENT_TOTAL_BYTE_LIMIT) {
    return Object.freeze({
      materialize: false,
      next_claimed_bytes: claimedBytes,
      reason: 'catalog_limit',
    });
  }
  return Object.freeze({
    materialize: true,
    next_claimed_bytes: claimedBytes + artifactBytes,
    reason: 'accepted',
  });
}
