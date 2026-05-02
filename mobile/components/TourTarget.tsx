import { ReactNode, useCallback, useEffect, useRef } from 'react';
import { InteractionManager, StyleProp, View, ViewStyle } from 'react-native';
import { useStore } from '@/lib/store';

export default function TourTarget({
  id,
  children,
  style,
  pointerEvents,
}: {
  id: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  pointerEvents?: 'box-none' | 'none' | 'box-only' | 'auto';
}) {
  const setTourTarget = useStore(st => st.setTourTarget);
  const ref = useRef<View>(null);
  const measure = useCallback(() => {
    ref.current?.measureInWindow((left, top, width, height) => {
      if (Number.isFinite(left) && Number.isFinite(top) && width > 0 && height > 0) {
        setTourTarget(id, { left, top, width, height });
      }
    });
  }, [id, setTourTarget]);

  useEffect(() => {
    measure();
    const interaction = InteractionManager.runAfterInteractions(measure);
    const timers = [80, 180, 350, 700, 1200, 2000].map(ms => setTimeout(measure, ms));
    return () => {
      interaction.cancel();
      timers.forEach(clearTimeout);
      setTourTarget(id, null);
    };
  }, [id, measure, setTourTarget]);

  return (
    <View ref={ref} collapsable={false} onLayout={measure} style={style} pointerEvents={pointerEvents}>
      {children}
    </View>
  );
}
