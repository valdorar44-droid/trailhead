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
