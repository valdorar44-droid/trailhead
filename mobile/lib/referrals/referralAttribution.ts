import { storage } from '@/lib/storage';
import { normalizeReferralCode } from './referralLinks';

export { canonicalReferralUrl, normalizeReferralCode, referralCodeFromUrl } from './referralLinks';

const PENDING_REFERRAL_KEY = 'trailhead_pending_referral_code';

export async function rememberReferralCode(code: string) {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return;
  await storage.set(PENDING_REFERRAL_KEY, normalized);
}

export async function getPendingReferralCode(): Promise<string> {
  return normalizeReferralCode(await storage.get(PENDING_REFERRAL_KEY).catch(() => ''));
}

export async function clearPendingReferralCode(): Promise<void> {
  await storage.del(PENDING_REFERRAL_KEY).catch(() => {});
}

export async function getReferralAttributionEnabled(): Promise<boolean> {
  return false;
}

export function referralAttributionIsAvailable(): boolean {
  return false;
}

export async function setReferralAttributionEnabled(_enabled: boolean): Promise<void> {
  // Trailhead now uses first-party App/Universal Links and manual codes only.
  // The legacy switch remains as a no-op for stored profile-state compatibility.
}
