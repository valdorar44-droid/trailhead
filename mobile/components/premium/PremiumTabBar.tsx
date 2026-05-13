import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, radii, shadows } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { useTheme } from '@/lib/design';

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: 'compass-outline',
  map: 'map-outline',
  'route-builder': 'trail-sign-outline',
  report: 'warning-outline',
  guide: 'headset-outline',
  profile: 'person-outline',
};

export function PremiumTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const hidden = useStore(s => s.tabBarHidden);
  const themeMode = useStore(s => s.themeMode);
  const C = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, Platform.OS === 'android' ? 10 : 10);
  if (hidden) return null;

  return (
    <View pointerEvents="box-none" style={[s.wrap, { bottom }]}>
      <BlurView intensity={themeMode === 'light' ? 42 : 32} tint={themeMode === 'light' ? 'light' : 'dark'} style={[
        s.bar,
        {
          borderColor: C.border,
          backgroundColor: themeMode === 'light' ? 'rgba(255,255,255,0.72)' : 'rgba(5,5,5,0.58)',
        },
      ]}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const options = descriptors[route.key]?.options;
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
                  backgroundColor: themeMode === 'light' ? 'rgba(17,20,18,0.06)' : 'rgba(255,255,255,0.08)',
                  borderWidth: 1,
                  borderColor: C.border2,
                  shadowColor: themeMode === 'light' ? '#111412' : '#E5E7EB',
                  shadowOpacity: themeMode === 'light' ? 0.08 : 0.24,
                  shadowRadius: 12,
                },
              ]}>
                <Ionicons name={ICONS[route.name] ?? 'ellipse-outline'} size={20} color={color} />
              </View>
              <Text style={[s.label, { color }]} numberOfLines={1}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </BlurView>
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
    overflow: 'hidden',
    borderRadius: radii.xxl,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
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
