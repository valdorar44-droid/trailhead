import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accountInventoryIsVisible,
  accountInventoryRequestIsCurrent,
  accountInventoryRequiresCleanup,
  accountInventoryScope,
} from '../accountInventoryScope';

test('old-owner inventory is hidden immediately when account identity changes', () => {
  const accountA = accountInventoryScope(7, 'account-a');
  const accountB = accountInventoryScope(7, 'account-b');
  assert.equal(accountInventoryIsVisible(accountA.key, accountA, false), true);
  assert.equal(accountInventoryIsVisible(accountA.key, accountB, false), false);
});

test('cleanup hides inventory and rejects reads even before the user identity changes', () => {
  const accountA = accountInventoryScope(7, 'account-a');
  assert.equal(accountInventoryIsVisible(accountA.key, accountA, true), false);
  assert.equal(accountInventoryRequestIsCurrent(accountA, 7, 'account-a', true), false);
});

test('a delayed old-owner read cannot commit after cleanup or into the next account', () => {
  const oldRequest = accountInventoryScope(7, 'account-a');
  assert.equal(accountInventoryRequestIsCurrent(oldRequest, 8, 'account-a', false), false);
  assert.equal(accountInventoryRequestIsCurrent(oldRequest, 8, 'account-b', false), false);

  const newRequest = accountInventoryScope(8, 'account-b');
  assert.equal(accountInventoryRequestIsCurrent(newRequest, 8, 'account-b', false), true);
});

test('a direct account switch cannot reinterpret shared legacy files before cleanup', () => {
  const accountA = accountInventoryScope(7, 'account-a');
  const accountBWithoutCleanup = accountInventoryScope(7, 'account-b');
  const accountBAfterCleanup = accountInventoryScope(8, 'account-b');
  assert.equal(accountInventoryRequiresCleanup(accountA, accountBWithoutCleanup), true);
  assert.equal(accountInventoryRequiresCleanup(accountA, accountBAfterCleanup), false);
  assert.equal(accountInventoryRequiresCleanup(accountInventoryScope(7, null), accountBWithoutCleanup), false);
});

test('anonymous and signed-in owner scopes remain distinct', () => {
  const guest = accountInventoryScope(4, null);
  const account = accountInventoryScope(4, 42);
  assert.equal(guest.owner_scope, 'anonymous');
  assert.equal(account.owner_scope, 'account:42');
  assert.notEqual(guest.key, account.key);
});
