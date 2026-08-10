export const BACKGROUND_LOCATION_PROMINENT_DISCLOSURE =
  'Trailhead collects precise location data to keep navigation, Trailhead Original stories, and trail recording working in the background, including when the app is closed or not in use. Location access begins only after you start one of these features and stops when you end it. Trailhead does not use location for advertising.';

export type NavigationBackgroundStartStep =
  | 'unsupported'
  | 'foreground_denied'
  | 'already_active'
  | 'request_background'
  | 'start_background';

export function navigationBackgroundStartStep(input: Readonly<{
  platform: string;
  foregroundGranted: boolean;
  backgroundGranted: boolean;
  alreadyActive: boolean;
}>): NavigationBackgroundStartStep {
  if (input.platform === 'web' || input.platform === 'android') return 'unsupported';
  if (!input.foregroundGranted) return 'foreground_denied';
  if (input.alreadyActive) return 'already_active';
  if (!input.backgroundGranted) return 'request_background';
  return 'start_background';
}
