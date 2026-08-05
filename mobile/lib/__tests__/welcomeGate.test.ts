import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  VISIBLE_WELCOME_TRAVEL_NEEDS,
  WELCOME_FIRST_RUN_COPY,
  WELCOME_PRIMARY_STEP_TOTAL,
  WELCOME_SETUP_OPTION_LABELS,
  WELCOME_SETUP_QUESTIONS,
  hasWelcomeRigEdits,
  shouldPreserveCompletedWelcomeSetup,
  visibleWelcomeTravelNeeds,
  welcomeCurrentStepSelectionCount,
  welcomePrimaryStepNumber,
  welcomeSetupSteps,
} from '../welcomeFirstRun';

assert.deepEqual(WELCOME_FIRST_RUN_COPY, {
  wordmark: 'TRAILHEAD',
  kicker: 'Plan routes. Find camps. Explore further.',
  headline: 'Create unforgettable overlanding trips with maps, camps, and routes in one place.',
  getStarted: 'Get started',
  exploreFirst: 'Explore first',
  signIn: 'Sign in',
});

assert.equal(WELCOME_PRIMARY_STEP_TOTAL, 4);
assert.deepEqual(WELCOME_SETUP_QUESTIONS, {
  camp: 'Where do you camp?',
  party: 'Who travels with you?',
  vehicle: 'How do you travel?',
  rig: 'Vehicle details',
  needs: 'Plan around',
});
assert.deepEqual(WELCOME_SETUP_OPTION_LABELS, {
  camp: ['Dispersed camping', 'Developed campgrounds', 'Private campgrounds', 'RV parks', 'No preference'],
  party: ['Solo', 'Two people', 'Family', 'Group'],
  vehicle: ['My own vehicle', 'Rental vehicle', 'Sometimes rent', 'Not sure yet'],
  needs: ['Pets', 'Kids', 'Towing'],
});
assert.deepEqual(welcomeSetupSteps(null), ['camp', 'party', 'vehicle', 'needs']);
assert.deepEqual(welcomeSetupSteps('need_rental'), ['camp', 'party', 'vehicle', 'needs']);
assert.deepEqual(welcomeSetupSteps('own_vehicle'), ['camp', 'party', 'vehicle', 'rig', 'needs']);
assert.deepEqual(
  welcomeSetupSteps('own_vehicle').map(welcomePrimaryStepNumber),
  [1, 2, 3, 3, 4],
);

assert.deepEqual(VISIBLE_WELCOME_TRAVEL_NEEDS, ['pets', 'kids', 'towing']);
const legacyNeeds = ['pets', 'downloads', 'towing'];
assert.deepEqual(visibleWelcomeTravelNeeds(legacyNeeds), ['pets', 'towing']);
assert.deepEqual(legacyNeeds, ['pets', 'downloads', 'towing']);
assert.equal(welcomeCurrentStepSelectionCount('camp', { campTypes: ['dispersed', 'private'] }), 2);
assert.equal(welcomeCurrentStepSelectionCount('party', { party: 'solo', campTypes: ['dispersed'] }), 1);
assert.equal(welcomeCurrentStepSelectionCount('vehicle', { vehicle: null, party: 'solo' }), 0);
assert.equal(welcomeCurrentStepSelectionCount('needs', { needs: ['pets', 'downloads'] }), 1);
assert.equal(welcomeCurrentStepSelectionCount('rig', { rigHasData: true }), 1);
assert.equal(hasWelcomeRigEdits({ nickname: '', drive: '4x4 PT' }, { nickname: '', drive: '4x4 PT' }), false);
assert.equal(hasWelcomeRigEdits({ nickname: 'Island rig', drive: '4x4 PT' }, { nickname: '', drive: '4x4 PT' }), true);
assert.equal(hasWelcomeRigEdits({ nickname: '', drive: 'AWD' }, { nickname: '', drive: '4x4 PT' }), true);
assert.equal(shouldPreserveCompletedWelcomeSetup('profile', 1_700_000_000_000), true);
assert.equal(shouldPreserveCompletedWelcomeSetup('profile', undefined), false);
assert.equal(shouldPreserveCompletedWelcomeSetup('profile', 0), false);
assert.equal(shouldPreserveCompletedWelcomeSetup('first_open', 1_700_000_000_000), false);

const gateSource = fs.readFileSync(path.resolve('components/WelcomeGate.tsx'), 'utf8');
const walkthroughSource = fs.readFileSync(path.resolve('components/WelcomeOnboardingModal.tsx'), 'utf8');
const storageSource = fs.readFileSync(path.resolve('lib/welcomeGate.ts'), 'utf8');

assert.match(gateSource, /testID="welcome-get-started"/);
assert.match(gateSource, /testID="welcome-explore-first"/);
assert.match(gateSource, /testID="welcome-sign-in"/);
assert.match(gateSource, /onPress=\{onContinue\}/);
assert.match(gateSource, /onPress=\{onSignIn\}/);
assert.match(gateSource, /loadWelcomeSetupPreferences\(\)/);
assert.match(gateSource, /setNeeds\(saved\.needs\)/);
assert.match(gateSource, /welcomeSetupSteps\(vehicle\)/);
assert.match(gateSource, /WELCOME_PRIMARY_STEP_TOTAL/);
assert.match(gateSource, /testID="welcome-setup-loading"/);
assert.match(gateSource, /testID=\{`welcome-rig-section-\$\{section\}`\}/);
assert.match(gateSource, /'dimensions', 'Dimensions'/);
assert.match(gateSource, /'suspension', 'Suspension'/);
assert.match(gateSource, /const SUSPENSION_TYPES = \['Stock', 'Leveling Kit', 'Lift Kit', 'Coilovers', 'Long Travel'\]/);
assert.match(gateSource, />Skip for now</);
const skipRigBody = gateSource.match(/function skipRigDetails\(\) \{([\s\S]*?)\n  \}/)?.[1] ?? '';
assert.ok(skipRigBody, 'Skip for now handler must remain present');
assert.doesNotMatch(skipRigBody, /setRigDraft/);
assert.doesNotMatch(gateSource, /id: 'downloads'/);
assert.doesNotMatch(gateSource, /SETUP_BLUE|TRAILHEAD<\/Text>|onboarding-hero-overland/);
assert.match(gateSource, /ImageBackground/);
assert.doesNotMatch(gateSource, /LinearGradient/);
assert.match(gateSource, /trailhead-mark\.png/);
assert.match(gateSource, /fontFamily: trailheadFonts\.displayBold/);
assert.match(gateSource, /name="arrow-forward" size=\{18\} color="#111412"/);
assert.match(gateSource, /onboarding-welcome-production-phone\.jpg/);
assert.match(gateSource, /onboarding-welcome-production-tablet\.jpg/);
assert.doesNotMatch(gateSource, /onboarding-welcome-phone-dark\.jpg|onboarding-welcome-tablet-dark\.jpg/);
assert.match(gateSource, /signInButton:\s*\{\s*minHeight: 48,/);
assert.match(gateSource, /setSetupCompletedAt\(saved\.completedAt\)/);
assert.match(gateSource, /completedAt: setupCompletedAt/);
assert.match(gateSource, /useWindowDimensions/);
assert.ok(fs.statSync(path.resolve('assets/onboarding-welcome-production-phone.jpg')).size > 0);
assert.ok(fs.statSync(path.resolve('assets/onboarding-welcome-production-tablet.jpg')).size > 0);
assert.match(storageSource, /WelcomeTravelNeed = 'pets' \| 'kids' \| 'towing' \| 'downloads'/);
assert.match(storageSource, /needs: Array\.isArray\(preferences\.needs\) \? preferences\.needs : \[\]/);

assert.match(walkthroughSource, /Plan holds trips, saved places, downloads, and owned Originals\./);
assert.match(walkthroughSource, /Manage your rig, preferences, membership, support, privacy, and account\./);
assert.doesNotMatch(walkthroughSource, /Manage your rig, saved areas, trips/);
assert.match(walkthroughSource, /accessible=\{false\} importantForAccessibility="no"/);
assert.match(walkthroughSource, /closeButton:\s*\{\s*width: 48,\s*height: 48,/);
assert.match(walkthroughSource, /accessibilityViewIsModal/);
assert.match(walkthroughSource, /AccessibilityInfo\.announceForAccessibility/);
assert.match(walkthroughSource, /accessibilityLabel="Walkthrough progress"/);

const layoutSource = fs.readFileSync(path.resolve('app/_layout.tsx'), 'utf8');
assert.match(layoutSource, /if \(welcomeSetupRunId <= 0\) return;[\s\S]*?setWelcomeGateMode\('setup'\)/);
assert.match(layoutSource, /shouldPreserveCompletedWelcomeSetup\([\s\S]*?welcomeGateSource,[\s\S]*?preferences\.completedAt/);
assert.match(layoutSource, /preserveCompletedSetup[\s\S]*?saveWelcomeSetupPreferences\(preferences\)[\s\S]*?markWelcomeSetupSkipped\(preferences\)/);

console.log('Welcome and first-run contract tests passed.');
