import { useStore } from '../store';
import { resolveUiV2Colors, type UiV2ColorMode } from './uiV2';

/** Returns the V2 semantic palette while preserving Trailhead's existing theme setting. */
export function useUiV2Theme() {
  const themeMode = useStore(state => state.themeMode);
  return resolveUiV2Colors(themeMode as UiV2ColorMode);
}
