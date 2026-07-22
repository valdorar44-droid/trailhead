import { useEffect } from 'react';
import { useStore } from './store';

/** Owns one tab-bar visibility reason without clearing another screen's reason. */
export function useTabBarVisibility(reason: string, hidden: boolean, isFocused: boolean) {
  const setTabBarHidden = useStore(state => state.setTabBarHidden);

  useEffect(() => {
    setTabBarHidden(isFocused && hidden, reason);
  }, [hidden, isFocused, reason, setTabBarHidden]);

  useEffect(() => () => {
    useStore.getState().setTabBarHidden(false, reason);
  }, [reason]);
}
