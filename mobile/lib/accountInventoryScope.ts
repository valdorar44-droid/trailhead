export type AccountInventoryOwnerId = string | number | null | undefined;

export type AccountInventoryScope = Readonly<{
  epoch: number;
  account_id: string;
  owner_scope: string;
  key: string;
}>;

function normalizedAccountId(accountId: AccountInventoryOwnerId) {
  return accountId == null ? '' : String(accountId);
}

/**
 * Account-owned files are currently stored in shared device directories while
 * sign-out cleanup removes the previous owner's files. Tag every in-memory
 * snapshot so a render can hide it synchronously when the account or cleanup
 * epoch changes, before a replacement read finishes.
 */
export function accountInventoryScope(
  epoch: number,
  accountId: AccountInventoryOwnerId,
): AccountInventoryScope {
  const normalizedId = normalizedAccountId(accountId);
  const ownerScope = normalizedId ? `account:${normalizedId}` : 'anonymous';
  return Object.freeze({
    epoch,
    account_id: normalizedId,
    owner_scope: ownerScope,
    key: `${epoch}:${ownerScope}`,
  });
}

export function accountInventoryIsVisible(
  storedScopeKey: string | null | undefined,
  currentScope: AccountInventoryScope,
  cleaning: boolean,
) {
  return !cleaning && Boolean(storedScopeKey) && storedScopeKey === currentScope.key;
}

export function accountInventoryRequestIsCurrent(
  requestedScope: AccountInventoryScope,
  currentEpoch: number,
  currentAccountId: AccountInventoryOwnerId,
  cleaning: boolean,
) {
  if (cleaning) return false;
  return requestedScope.key === accountInventoryScope(currentEpoch, currentAccountId).key;
}

/**
 * A direct switch away from a signed-in owner in the same cleanup epoch is not
 * safe to read from shared legacy directories. Wait for beginCleanup() to
 * advance the epoch before accepting files for the next owner.
 */
export function accountInventoryRequiresCleanup(
  previousScope: AccountInventoryScope,
  currentScope: AccountInventoryScope,
) {
  return previousScope.epoch === currentScope.epoch
    && Boolean(previousScope.account_id)
    && previousScope.account_id !== currentScope.account_id;
}
