import { storage } from '@/lib/storage';

export const WELCOME_GATE_SEEN_KEY = 'trailhead_welcome_gate_seen_v1';
export const WELCOME_WALKTHROUGH_SEEN_KEY = 'trailhead_first_run_onboarding_seen_v3';
export const WELCOME_PENDING_ATTR_KEY = 'trailhead_welcome_account_pending_v1';

export type WelcomeGateChoice = 'create_account' | 'sign_in' | 'continue';

export async function shouldShowWelcomeGate(isSignedIn: boolean) {
  if (isSignedIn) return false;
  const seen = await storage.get(WELCOME_GATE_SEEN_KEY).catch(() => null);
  return seen !== '1';
}

export async function markWelcomeGateSeen(choice: WelcomeGateChoice) {
  await storage.set(WELCOME_GATE_SEEN_KEY, '1');
  await storage.set(`${WELCOME_GATE_SEEN_KEY}:choice`, choice);
}
