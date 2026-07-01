import React, { useEffect, useState } from 'react';
import { Keyboard, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '@/lib/store';
import { useTheme } from '@/lib/design';

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
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardOpen(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardOpen(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  if (hidden || keyboardOpen) return null;
  const bottomPad = Math.max(insets.bottom, Platform.OS === 'android' ? 8 : 10);

  return (
    <View
      pointerEvents="box-none"
      style={[
        s.wrap,
        {
          paddingBottom: bottomPad,
          backgroundColor: C.s1,
          borderTopColor: C.border,
        },
      ]}
    >
      <View style={s.barInner}>
        {state.routes.map((route) => {
          const options = descriptors[route.key]?.options as { title?: string; href?: unknown };
          if (route.name === 'index' || options?.href === null) return null;
          const focused = state.routes[state.index]?.key === route.key;
          const label = tabLabel(String(options?.title ?? route.name));
          const color = focused ? C.orange : C.text3;
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
              <View style={s.iconShell}>
                <Ionicons name={ICONS[route.name] ?? 'ellipse-outline'} size={20} color={color} />
              </View>
              <Text style={[s.label, { color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>{label}</Text>
              {focused ? <View style={[s.activeMark, { backgroundColor: C.orange }]} /> : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function tabLabel(value: string) {
  const normalized = value
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  if (!normalized) return '';
  return normalized.replace(/\b\w/g, char => char.toUpperCase());
}

const s = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  barInner: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingHorizontal: 8,
    paddingTop: 7,
  },
  item: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  iconShell: {
    width: 32,
    height: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0,
  },
  activeMark: {
    position: 'absolute',
    bottom: 0,
    width: 18,
    height: 3,
    borderRadius: 2,
  },
});
