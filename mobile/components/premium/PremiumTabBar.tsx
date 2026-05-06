import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { font, radii, shadows } from '@/lib/theme';
import { useStore } from '@/lib/store';

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
  if (hidden) return null;

  return (
    <View pointerEvents="box-none" style={s.wrap}>
      <BlurView intensity={32} tint="dark" style={s.bar}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const options = descriptors[route.key]?.options;
          const label = String(options?.title ?? route.name);
          const color = focused ? '#F5F5F7' : 'rgba(245,245,247,0.45)';
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
              <View style={[s.iconShell, focused && s.iconShellActive]}>
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
    bottom: 10,
    height: 74,
  },
  bar: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: radii.xxl,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    backgroundColor: 'rgba(5,5,5,0.58)',
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
  iconShellActive: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.11)',
    shadowColor: '#E5E7EB',
    shadowOpacity: 0.24,
    shadowRadius: 12,
  },
  label: {
    fontFamily: font.mono,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.7,
  },
});
