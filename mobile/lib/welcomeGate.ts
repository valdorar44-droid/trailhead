import { storage } from '@/lib/storage';

export const WELCOME_GATE_SEEN_KEY = 'trailhead_welcome_gate_seen_v1';
export const WELCOME_WALKTHROUGH_SEEN_KEY = 'trailhead_first_run_onboarding_seen_v3';
export const WELCOME_PENDING_ATTR_KEY = 'trailhead_welcome_account_pending_v1';
export const WELCOME_SETUP_PREFS_KEY = 'trailhead_welcome_setup_prefs_v1';
export const WELCOME_SETUP_STATUS_KEY = 'trailhead_welcome_setup_status_v1';

export type WelcomeGateChoice = 'create_account' | 'sign_in' | 'continue';
export type WelcomeSetupStatus = 'completed' | 'skipped';
export type WelcomeVehicleChoice = 'own_vehicle' | 'rent_sometimes' | 'need_rental' | 'not_sure';
export type WelcomeCampingStyle = 'campgrounds' | 'dispersed' | 'rv_parks' | 'mixed';
export type WelcomeTravelParty = 'solo' | 'two_people' | 'family' | 'group';
export type WelcomeTravelNeed = 'pets' | 'kids' | 'towing' | 'downloads';

export type WelcomeSetupPreferences = {
  vehicle: WelcomeVehicleChoice | null;
  camping: WelcomeCampingStyle | null;
  party: WelcomeTravelParty | null;
  needs: WelcomeTravelNeed[];
  completedAt?: number;
  skippedAt?: number;
};

export async function shouldShowWelcomeGate(isSignedIn: boolean) {
  if (isSignedIn) return false;
  const seen = await storage.get(WELCOME_GATE_SEEN_KEY).catch(() => null);
  return seen !== '1';
}

export async function markWelcomeGateSeen(choice: WelcomeGateChoice) {
  await storage.set(WELCOME_GATE_SEEN_KEY, '1');
  await storage.set(`${WELCOME_GATE_SEEN_KEY}:choice`, choice);
}

export async function saveWelcomeSetupPreferences(preferences: WelcomeSetupPreferences) {
  const saved: WelcomeSetupPreferences = {
    ...preferences,
    completedAt: preferences.completedAt ?? Date.now(),
    skippedAt: undefined,
  };
  await storage.set(WELCOME_SETUP_PREFS_KEY, JSON.stringify(saved));
  await storage.set(WELCOME_SETUP_STATUS_KEY, 'completed');
}

export async function markWelcomeSetupSkipped(preferences?: Partial<WelcomeSetupPreferences>) {
  if (preferences) {
    const saved: WelcomeSetupPreferences = {
      vehicle: preferences.vehicle ?? null,
      camping: preferences.camping ?? null,
      party: preferences.party ?? null,
      needs: preferences.needs ?? [],
      skippedAt: Date.now(),
    };
    await storage.set(WELCOME_SETUP_PREFS_KEY, JSON.stringify(saved));
  }
  await storage.set(WELCOME_SETUP_STATUS_KEY, 'skipped');
}

export async function loadWelcomeSetupPreferences() {
  const raw = await storage.get(WELCOME_SETUP_PREFS_KEY).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WelcomeSetupPreferences;
  } catch {
    return null;
  }
}
