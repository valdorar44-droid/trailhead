import { useCallback, useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useFocusEffect, useNavigation } from 'expo-router';
import { screenIsActive } from './screenActivityState';

export type ScreenActivity = {
  isFocused: boolean;
  isAppActive: boolean;
  isActive: boolean;
};

/**
 * Keeps a screen mounted while exposing whether it should perform foreground work.
 * Use isFocused for screen-owned chrome and isActive for polling, sensors, and refreshes.
 */
export function useScreenActivity(): ScreenActivity {
  const navigation = useNavigation();
  const [isFocused, setIsFocused] = useState(() => navigation.isFocused());
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);

  useFocusEffect(useCallback(() => {
    setIsFocused(true);
    return () => setIsFocused(false);
  }, []));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  const isAppActive = appState === 'active';
  return {
    isFocused,
    isAppActive,
    isActive: screenIsActive(isFocused, appState),
  };
}
