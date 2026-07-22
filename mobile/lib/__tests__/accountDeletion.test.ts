import assert from 'node:assert/strict';
import {
  accountDeletionAuthMethod,
  accountDeletionAuthorizationIsFresh,
  accountDeletionConfirmationMatches,
} from '../accountDeletion';

assert.equal(accountDeletionAuthMethod('apple'), 'apple');
assert.equal(accountDeletionAuthMethod('GOOGLE'), 'google');
assert.equal(accountDeletionAuthMethod(null), 'password');
assert.equal(accountDeletionAuthMethod('unknown'), 'password');

assert.equal(accountDeletionConfirmationMatches('DELETE'), true);
assert.equal(accountDeletionConfirmationMatches(' DELETE '), true);
assert.equal(accountDeletionConfirmationMatches('delete'), false);
assert.equal(accountDeletionConfirmationMatches('DELETE ACCOUNT'), false);

assert.equal(accountDeletionAuthorizationIsFresh(1_100, 1_000), true);
assert.equal(accountDeletionAuthorizationIsFresh(1_000, 1_000), false);
assert.equal(accountDeletionAuthorizationIsFresh(Number.NaN, 1_000), false);

console.log('Account deletion policy tests passed.');
