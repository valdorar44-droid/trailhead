import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { BranchParams, BranchSubscriptionEvent } from 'react-native-branch';
import { storage } from '@/lib/storage';
import {
  normalizeReferralCode,
  referralCodeFromAttributionParams,
} from './referralLinks';

export { canonicalReferralUrl, normalizeReferralCode, referralCodeFromUrl } from './referralLinks';

const ATTRIBUTION_DISABLED_KEY = 'trailhead_branch_attribution_disabled';
const PENDING_REFERRAL_KEY = 'trailhead_pending_referral_code';
type BranchModule = typeof import('react-native-branch')['default'];
type ReferralHandler = (code: string) => boolean | void | Promise<boolean | void>;

let branchModulePromise: Promise<BranchModule | null> | null = null;

function branchConfig() {
  const raw = Constants.expoConfig?.extra?.branch as {
    attributionEnabled?: boolean;
    configured?: boolean;
    domain?: string;
  } | undefined;
  return {
    enabled: raw?.attributionEnabled !== false,
    configured: raw?.configured === true,
    domain: raw?.domain || 'go.gettrailhead.app',
  };
}

async function getBranchModule(): Promise<BranchModule | null> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  if (!branchModulePromise) {
    branchModulePromise = import('react-native-branch')
      .then(module => module.default)
      .catch(() => null);
  }
  return branchModulePromise;
}

function referralCodeFromBranchParams(params: BranchParams | undefined): string {
  return referralCodeFromAttributionParams(params as Record<string, unknown> | undefined);
}

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
  if (!branchConfig().enabled) return false;
  return await storage.get(ATTRIBUTION_DISABLED_KEY).catch(() => null) !== '1';
}

export async function setReferralAttributionEnabled(enabled: boolean): Promise<void> {
  if (enabled) await storage.del(ATTRIBUTION_DISABLED_KEY).catch(() => {});
  else {
    await storage.set(ATTRIBUTION_DISABLED_KEY, '1').catch(() => {});
    // A code captured by the SDK before opt-out is attribution data. Remove it;
    // the visible registration field remains available for manual entry.
    await clearPendingReferralCode();
  }
  const branch = await getBranchModule();
  branch?.disableTracking(!enabled);
}

export function startBranchReferralAttribution(onReferral?: ReferralHandler): () => void {
  let disposed = false;
  let unsubscribe: (() => void) | null = null;

  void (async () => {
    const config = branchConfig();
    const disabled = await storage.get(ATTRIBUTION_DISABLED_KEY).catch(() => null);
    const trackingEnabled = config.enabled && disabled !== '1';
    const branch = await getBranchModule();
    if (!branch || disposed) return;

    branch.disableTracking(!trackingEnabled);
    if (!trackingEnabled || !config.configured) return;

    unsubscribe = branch.subscribe((event: BranchSubscriptionEvent) => {
      if (disposed || event.error) return;
      const code = referralCodeFromBranchParams(event.params);
      if (!code) return;
      void (async () => {
        const accepted = await onReferral?.(code);
        if (accepted === false) return;
        await rememberReferralCode(code);
      })();
    });
  })();

  return () => {
    disposed = true;
    unsubscribe?.();
    unsubscribe = null;
  };
}
