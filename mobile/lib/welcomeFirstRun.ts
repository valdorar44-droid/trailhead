export type WelcomeFirstRunStep = 'camp' | 'party' | 'vehicle' | 'rig' | 'needs';

export const WELCOME_PRIMARY_STEP_TOTAL = 4;

export const WELCOME_FIRST_RUN_COPY = {
  wordmark: 'TRAILHEAD',
  kicker: 'Plan routes. Find camps. Explore further.',
  headline: 'Create unforgettable overlanding trips with maps, camps, and routes in one place.',
  getStarted: 'Get started',
  exploreFirst: 'Explore first',
  signIn: 'Sign in',
} as const;

export const WELCOME_SETUP_QUESTIONS = {
  camp: 'Where do you camp?',
  party: 'Who travels with you?',
  vehicle: 'How do you travel?',
  rig: 'Vehicle details',
  needs: 'Plan around',
} as const;

export const WELCOME_SETUP_OPTION_LABELS = {
  camp: ['Dispersed camping', 'Developed campgrounds', 'Private campgrounds', 'RV parks', 'No preference'],
  party: ['Solo', 'Two people', 'Family', 'Group'],
  vehicle: ['My own vehicle', 'Rental vehicle', 'Sometimes rent', 'Not sure yet'],
  needs: ['Pets', 'Kids', 'Towing'],
} as const;

export const VISIBLE_WELCOME_TRAVEL_NEEDS = ['pets', 'kids', 'towing'] as const;

export function welcomeSetupSteps(vehicle: string | null | undefined): WelcomeFirstRunStep[] {
  return vehicle === 'own_vehicle'
    ? ['camp', 'party', 'vehicle', 'rig', 'needs']
    : ['camp', 'party', 'vehicle', 'needs'];
}

export function welcomePrimaryStepNumber(step: WelcomeFirstRunStep) {
  if (step === 'camp') return 1;
  if (step === 'party') return 2;
  if (step === 'vehicle' || step === 'rig') return 3;
  return WELCOME_PRIMARY_STEP_TOTAL;
}

export function visibleWelcomeTravelNeeds(needs: readonly string[] | null | undefined) {
  return (needs ?? []).filter(need => (
    VISIBLE_WELCOME_TRAVEL_NEEDS.includes(need as (typeof VISIBLE_WELCOME_TRAVEL_NEEDS)[number])
  ));
}

export function welcomeCurrentStepSelectionCount(
  step: WelcomeFirstRunStep,
  values: {
    campTypes?: readonly string[];
    party?: string | null;
    vehicle?: string | null;
    needs?: readonly string[];
    rigHasData?: boolean;
  },
) {
  if (step === 'camp') return values.campTypes?.length ?? 0;
  if (step === 'party') return values.party ? 1 : 0;
  if (step === 'vehicle') return values.vehicle ? 1 : 0;
  if (step === 'needs') return visibleWelcomeTravelNeeds(values.needs).length;
  return values.rigHasData ? 1 : 0;
}

export function hasWelcomeRigEdits<T extends Record<string, unknown>>(rig: T, defaults: T) {
  return Object.keys(defaults).some(key => rig[key] !== defaults[key]);
}

export function shouldPreserveCompletedWelcomeSetup(
  source: 'first_open' | 'profile',
  completedAt: number | null | undefined,
) {
  return source === 'profile'
    && typeof completedAt === 'number'
    && Number.isFinite(completedAt)
    && completedAt > 0;
}
