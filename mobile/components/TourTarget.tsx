import { ReactNode, useCallback, useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useStore } from '@/lib/store';

export default function TourTarget({ id, children }: { id: string; children: ReactNode }) {
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
    const timers = [120, 350, 800].map(ms => setTimeout(measure, ms));
    return () => {
      timers.forEach(clearTimeout);
      setTourTarget(id, null);
    };
  }, [id, measure, setTourTarget]);

  return (
    <View ref={ref} collapsable={false} onLayout={measure}>
      {children}
    </View>
  );
}
