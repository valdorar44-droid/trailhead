export function screenIsActive(isFocused: boolean, appState: string) {
  return isFocused && appState === 'active';
}

/**
 * Idle Map sensing belongs to the focused foreground screen. Once navigation
 * starts, its existing native/background adapters and mounted turn runtime must
 * retain the location watch across tab blur and screen lock.
 */
export function mapLocationWatchShouldRun(screenActive: boolean, navigationActive: boolean) {
  return screenActive || navigationActive;
}

/**
 * Expensive visual sources follow the visible Map screen. Navigation may keep
 * the mounted renderer warm during an in-app focus transition; background
 * location and audio continue through their independent runtimes.
 */
export function mapVisualWorkShouldRun(
  screenActive: boolean,
  appActive: boolean,
  navigationActive: boolean,
) {
  return screenActive || (appActive && navigationActive);
}
