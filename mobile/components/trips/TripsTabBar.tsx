import { useEffect, useState } from 'react';
import { Keyboard, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/design';
import { useStore } from '@/lib/store';

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  guide: 'compass-outline',
  plan: 'trail-sign-outline',
  map: 'map-outline',
  trips: 'calendar-outline',
  profile: 'person-outline',
};

type TripsTabBarProps = BottomTabBarProps & { tripsEnabled: boolean };

export default function TripsTabBar({ state, descriptors, navigation, tripsEnabled }: TripsTabBarProps) {
  const C = useTheme();
  const hidden = useStore(store => store.tabBarHidden);
  const insets = useSafeAreaInsets();
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, () => setKeyboardOpen(true));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  if (hidden || keyboardOpen) return null;
  const visibleRouteNames = new Set(['guide', 'plan', 'map', 'profile', ...(tripsEnabled ? ['trips'] : [])]);
  const visibleRoutes = state.routes.filter(route => visibleRouteNames.has(route.name));

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          paddingBottom: Math.max(insets.bottom, Platform.OS === 'android' ? 8 : 10),
          backgroundColor: C.s1,
          borderTopColor: C.border,
          boxShadow: C.bg === '#F7F8F6'
            ? '0 -5px 22px rgba(17,20,18,0.08)'
            : '0 -5px 22px rgba(0,0,0,0.28)',
        },
      ]}
    >
      <View style={styles.inner}>
        {visibleRoutes.map(route => {
          const options = descriptors[route.key]?.options as { title?: string };
          const focused = state.routes[state.index]?.key === route.key;
          const label = options?.title || route.name;
          const color = focused ? C.orange : C.text2;
          return (
            <TouchableOpacity
              key={route.key}
              accessibilityRole="tab"
              accessibilityLabel={`${label} tab`}
              accessibilityState={{ selected: focused }}
              activeOpacity={0.78}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              style={styles.item}
            >
              <View style={styles.iconShell}>
                <Ionicons name={ICONS[route.name] ?? 'ellipse-outline'} size={20} color={color} />
              </View>
              <Text style={[styles.label, { color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>{label}</Text>
              {focused ? <View style={[styles.activeMark, { backgroundColor: C.orange }]} /> : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inner: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingTop: 7,
  },
  item: {
    flex: 1,
    minWidth: 0,
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
