import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, radii, shadows } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { useTheme } from '@/lib/design';
import { TrailheadSheet } from '@/components/TrailheadUI';

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: 'compass-outline',
  plan: 'compass-outline',
  map: 'map-outline',
  'route-builder': 'trail-sign-outline',
  report: 'warning-outline',
  guide: 'compass-outline',
  profile: 'person-outline',
};

export function PremiumTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const hidden = useStore(s => s.tabBarHidden);
  const C = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, Platform.OS === 'android' ? 10 : 10);
  if (hidden) return null;

  return (
    <View pointerEvents="box-none" style={[s.wrap, { bottom }]}>
      <TrailheadSheet handle={false} style={s.bar} contentStyle={s.barInner}>
        {state.routes.map((route) => {
          const options = descriptors[route.key]?.options as { title?: string; href?: unknown };
          if (options?.href === null) return null;
          const focused = state.routes[state.index]?.key === route.key;
          const label = String(options?.title ?? route.name);
          const color = focused ? C.text : C.text3;
          return (
            <TouchableOpacity
              key={route.key}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              activeOpacity={0.82}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
              style={s.item}
            >
              <View style={[
                s.iconShell,
                focused && {
                  backgroundColor: C.glassStrong,
                  borderWidth: 1,
                  borderColor: C.border2,
                  shadowColor: C.silverBright,
                  shadowOpacity: 0.18,
                  shadowRadius: 12,
                },
              ]}>
                <Ionicons name={ICONS[route.name] ?? 'ellipse-outline'} size={20} color={color} />
              </View>
              <Text style={[s.label, { color }]} numberOfLines={1}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </TrailheadSheet>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 14,
    right: 14,
    height: 74,
  },
  bar: {
    flex: 1,
    borderRadius: radii.xxl,
  },
  barInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 7,
    ...shadows.glass,
  },
  item: {
    flex: 1,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  iconShell: {
    width: 34,
    height: 30,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: font.mono,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.7,
  },
});
