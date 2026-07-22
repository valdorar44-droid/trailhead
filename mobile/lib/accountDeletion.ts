export type AccountDeletionAuthMethod = 'password' | 'apple' | 'google';

export function accountDeletionAuthMethod(authProvider?: string | null): AccountDeletionAuthMethod {
  const provider = String(authProvider || '').trim().toLowerCase();
  if (provider === 'apple' || provider === 'google') return provider;
  return 'password';
}

export function accountDeletionConfirmationMatches(value: string): boolean {
  return value.trim() === 'DELETE';
}

export function accountDeletionAuthorizationIsFresh(
  expiresAt: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  return Number.isFinite(expiresAt) && expiresAt > nowSeconds;
}
