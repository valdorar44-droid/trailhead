import { parseBooleanFeatureFlag } from '@/lib/uiSystemV2/featureFlag';

/**
 * Build-time preview gate. Production defaults to the existing planner until
 * the new research flow is explicitly enabled for a compatible preview build.
 */
export const PLANNER_RESEARCH_PREVIEW_ENABLED = parseBooleanFeatureFlag(
  process.env.EXPO_PUBLIC_PLANNER_V2_ENABLED,
  false,
);

