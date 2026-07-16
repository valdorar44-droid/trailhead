import type { OriginalOwnerScope } from './types';

export function originalOwnerScopeForAccount(
  accountId: string | number | null | undefined,
): OriginalOwnerScope {
  return accountId == null ? 'guest' : `account:${accountId}`;
}

export function originalRestoreScopeIsCurrent(
  ownerScope: OriginalOwnerScope,
  capturedEpoch: number,
  currentEpoch: number,
  currentAccountId: string | number | null | undefined,
) {
  return capturedEpoch === currentEpoch
    && originalOwnerScopeForAccount(currentAccountId) === ownerScope;
}

export function originalVersionAccessIsExact(acquiredVersion: number, requestedVersion: number) {
  return Number.isInteger(acquiredVersion)
    && Number.isInteger(requestedVersion)
    && acquiredVersion === requestedVersion;
}
