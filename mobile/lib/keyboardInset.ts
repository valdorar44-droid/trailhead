import { useEffect, useState } from 'react';
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';

export type KeyboardInsetState = {
  visible: boolean;
  height: number;
};

const HIDDEN_KEYBOARD: KeyboardInsetState = { visible: false, height: 0 };

/** Shared keyboard contract for mounted map/planning surfaces. */
export function useKeyboardInset(): KeyboardInsetState {
  const [state, setState] = useState<KeyboardInsetState>(HIDDEN_KEYBOARD);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (event: KeyboardEvent) => setState({
      visible: true,
      height: Math.max(0, Math.round(event.endCoordinates?.height ?? 0)),
    });
    const show = Keyboard.addListener(showEvent, onShow);
    const hide = Keyboard.addListener(hideEvent, () => setState(HIDDEN_KEYBOARD));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return state;
}
