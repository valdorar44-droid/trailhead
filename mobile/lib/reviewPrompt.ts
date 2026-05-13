import { Linking, Platform } from 'react-native';
import { storage } from './storage';

export type ReviewPromptReason = 'trip_built' | 'camp_viewed';

const STATE_KEY = 'trailhead_review_prompt_state_v1';
const APP_STORE_ID = process.env.EXPO_PUBLIC_APP_STORE_ID ?? '6763677349';
const PLAY_STORE_PACKAGE = 'com.trailhead.app';
const PROMPT_COOLDOWN_MS = 1000 * 60 * 60 * 24 * 21;
const MAX_PROMPTS = 3;

type ReviewPromptState = {
  tripBuiltCount: number;
  campViewedCount: number;
  promptCount: number;
  lastPromptedAt: number;
  completedAt: number | null;
  snoozedAt: number | null;
};

const DEFAULT_STATE: ReviewPromptState = {
  tripBuiltCount: 0,
  campViewedCount: 0,
  promptCount: 0,
  lastPromptedAt: 0,
  completedAt: null,
  snoozedAt: null,
};

async function readState(): Promise<ReviewPromptState> {
  try {
    const raw = await storage.get(STATE_KEY);
    if (!raw) return DEFAULT_STATE;
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_STATE;
  }
}

function writeState(state: ReviewPromptState) {
  return storage.set(STATE_KEY, JSON.stringify(state)).catch(() => {});
}

function isEligible(state: ReviewPromptState, reason: ReviewPromptReason) {
  if (state.completedAt || state.promptCount >= MAX_PROMPTS) return false;
  if (state.lastPromptedAt && Date.now() - state.lastPromptedAt < PROMPT_COOLDOWN_MS) return false;
  if (reason === 'trip_built') return state.tripBuiltCount >= 1;
  return state.campViewedCount >= 2;
}

export async function recordReviewMoment(reason: ReviewPromptReason) {
  const state = await readState();
  const next: ReviewPromptState = {
    ...state,
    tripBuiltCount: state.tripBuiltCount + (reason === 'trip_built' ? 1 : 0),
    campViewedCount: state.campViewedCount + (reason === 'camp_viewed' ? 1 : 0),
  };
  await writeState(next);
  return isEligible(next, reason);
}

export async function markReviewPromptShown() {
  const state = await readState();
  await writeState({
    ...state,
    promptCount: state.promptCount + 1,
    lastPromptedAt: Date.now(),
  });
}

export async function snoozeReviewPrompt() {
  const state = await readState();
  await writeState({ ...state, snoozedAt: Date.now() });
}

export async function completeReviewPrompt() {
  const state = await readState();
  await writeState({ ...state, completedAt: Date.now() });
}

export async function openReviewDestination() {
  if (Platform.OS === 'ios') {
    await Linking.openURL(`itms-apps://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`);
    return;
  }

  if (Platform.OS === 'android') {
    const marketUrl = `market://details?id=${PLAY_STORE_PACKAGE}`;
    const webUrl = `https://play.google.com/store/apps/details?id=${PLAY_STORE_PACKAGE}`;
    const canOpenMarket = await Linking.canOpenURL(marketUrl).catch(() => false);
    await Linking.openURL(canOpenMarket ? marketUrl : webUrl);
    return;
  }

  await Linking.openURL('https://gettrailhead.app');
}
