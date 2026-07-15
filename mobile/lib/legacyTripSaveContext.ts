export type LegacyTripSaveContext = {
  accountEpoch: number;
  accountId: string | null;
  ownerScope: string;
  repositoryInitialized: boolean;
};

export function legacyTripSaveContextIsCoherent(context: LegacyTripSaveContext) {
  const expectedOwnerScope = context.accountId == null
    ? 'anonymous'
    : `account:${String(context.accountId).trim()}`;
  return context.repositoryInitialized && context.ownerScope === expectedOwnerScope;
}

export function legacyTripSaveContextIsCurrent(
  expected: LegacyTripSaveContext,
  current: LegacyTripSaveContext,
) {
  return legacyTripSaveContextIsCoherent(expected)
    && legacyTripSaveContextIsCoherent(current)
    && current.accountEpoch === expected.accountEpoch
    && String(current.accountId ?? '') === String(expected.accountId ?? '')
    && current.ownerScope === expected.ownerScope;
}

export async function resolveLegacyTripSaveToken(
  tokenOverride: string | null | undefined,
  readStoredToken: () => Promise<string | null>,
  contextIsCurrent: () => boolean,
) {
  const token = tokenOverride === undefined ? await readStoredToken() : tokenOverride;
  return contextIsCurrent() ? token : undefined;
}

export async function reconcileLegacyTripSaveResponse<T>(
  contextIsCurrent: () => boolean,
  drainPendingMirror: () => Promise<void>,
  acknowledge: () => Promise<T>,
) {
  if (!contextIsCurrent()) return undefined;
  await drainPendingMirror();
  if (!contextIsCurrent()) return undefined;
  const result = await acknowledge();
  return contextIsCurrent() ? result : undefined;
}
