import { accountStorage, storage } from '@/lib/storage';

export const WELCOME_GATE_SEEN_KEY = 'trailhead_welcome_gate_seen_v1';
export const WELCOME_WALKTHROUGH_SEEN_KEY = 'trailhead_first_run_onboarding_seen_v3';
export const WELCOME_PENDING_ATTR_KEY = 'trailhead_welcome_account_pending_v1';
export const WELCOME_SETUP_PREFS_KEY = 'trailhead_welcome_setup_prefs_v1';
export const WELCOME_SETUP_STATUS_KEY = 'trailhead_welcome_setup_status_v1';

export type WelcomeGateChoice = 'create_account' | 'sign_in' | 'continue';
export type WelcomeSetupStatus = 'completed' | 'skipped';
export type WelcomeVehicleChoice = 'own_vehicle' | 'rent_sometimes' | 'need_rental' | 'not_sure';
export type WelcomeCampingStyle = 'campgrounds' | 'dispersed' | 'rv_parks' | 'mixed';
export type WelcomeCampType = 'dispersed' | 'developed' | 'private' | 'rv_parks' | 'any';
export type WelcomeTravelParty = 'solo' | 'two_people' | 'family' | 'group';
export type WelcomeTravelNeed = 'pets' | 'kids' | 'towing' | 'downloads';

export type WelcomeSetupPreferences = {
  vehicle: WelcomeVehicleChoice | null;
  camping: WelcomeCampingStyle | null;
  campingStyles?: WelcomeCampType[];
  party: WelcomeTravelParty | null;
  needs: WelcomeTravelNeed[];
  completedAt?: number;
  skippedAt?: number;
};

function normalizeCampingStyles(preferences: Partial<WelcomeSetupPreferences>): WelcomeCampType[] {
  if (Array.isArray(preferences.campingStyles) && preferences.campingStyles.length) {
    return Array.from(new Set(preferences.campingStyles.filter(Boolean)));
  }
  if (preferences.camping === 'campgrounds') return ['developed'];
  if (preferences.camping === 'dispersed') return ['dispersed'];
  if (preferences.camping === 'rv_parks') return ['rv_parks'];
  if (preferences.camping === 'mixed') return ['any'];
  return [];
}

function normalizeWelcomeSetupPreferences(preferences: Partial<WelcomeSetupPreferences>): WelcomeSetupPreferences {
  return {
    vehicle: preferences.vehicle ?? null,
    camping: preferences.camping ?? null,
    campingStyles: normalizeCampingStyles(preferences),
    party: preferences.party ?? null,
    needs: Array.isArray(preferences.needs) ? preferences.needs : [],
    completedAt: preferences.completedAt,
    skippedAt: preferences.skippedAt,
  };
}

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
    ...normalizeWelcomeSetupPreferences(preferences),
    completedAt: preferences.completedAt ?? Date.now(),
    skippedAt: undefined,
  };
  await accountStorage.set(WELCOME_SETUP_PREFS_KEY, JSON.stringify(saved));
  await accountStorage.set(WELCOME_SETUP_STATUS_KEY, 'completed');
}

export async function markWelcomeSetupSkipped(preferences?: Partial<WelcomeSetupPreferences>) {
  if (preferences) {
    const saved: WelcomeSetupPreferences = {
      ...normalizeWelcomeSetupPreferences(preferences),
      skippedAt: Date.now(),
    };
    await accountStorage.set(WELCOME_SETUP_PREFS_KEY, JSON.stringify(saved));
  }
  await accountStorage.set(WELCOME_SETUP_STATUS_KEY, 'skipped');
}

export async function loadWelcomeSetupPreferences() {
  const raw = await accountStorage.get(WELCOME_SETUP_PREFS_KEY).catch(() => null);
  if (!raw) return null;
  try {
    return normalizeWelcomeSetupPreferences(JSON.parse(raw) as WelcomeSetupPreferences);
  } catch {
    return null;
  }
}
