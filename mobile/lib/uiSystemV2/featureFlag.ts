export function parseBooleanFeatureFlag(value: string | undefined, fallback = false): boolean {
  if (value == null || value.trim() === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  return fallback;
}

/**
 * Public, build-time switch for incremental UI V2 adoption. It intentionally
 * defaults off until individual surfaces are accepted in preview builds.
 */
export const UI_SYSTEM_V2_ENABLED = parseBooleanFeatureFlag(
  process.env.EXPO_PUBLIC_UI_SYSTEM_V2_ENABLED,
  false,
);

export function isUiSystemV2Enabled(override?: boolean): boolean {
  return override ?? UI_SYSTEM_V2_ENABLED;
}
