export function screenIsActive(isFocused: boolean, appState: string) {
  return isFocused && appState === 'active';
}

/**
 * Android may restore a native ScrollView offset before asynchronously loaded
 * content reaches its previous height. Keep retained warm-state offsets when
 * they are valid, but never leave the viewport beyond the current content.
 */
export function boundedRetainedScrollOffset(
  offset: number,
  contentHeight: number,
  viewportHeight: number,
) {
  const safeOffset = Number.isFinite(offset) ? Math.max(0, offset) : 0;
  const safeContentHeight = Number.isFinite(contentHeight) ? Math.max(0, contentHeight) : 0;
  const safeViewportHeight = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  return Math.min(safeOffset, Math.max(0, safeContentHeight - safeViewportHeight));
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
