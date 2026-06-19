import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/design';
import type { ExploreMode } from './exploreDisplay';

type Props = {
  value: ExploreMode;
  onChange: (mode: ExploreMode) => void;
};

export function ExploreModeTabs({ value, onChange }: Props) {
  const C = useTheme();
  const tabs: Array<{ key: ExploreMode; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
    { key: 'featured', label: 'Featured', icon: 'star-outline' },
    { key: 'nearby', label: 'Nearby', icon: 'location-outline' },
    { key: 'trip', label: 'Trips', icon: 'map-outline' },
  ];
  return (
    <View style={[styles.shell, { borderColor: C.border, backgroundColor: C.s1 }]}>
      {tabs.map(tab => {
        const active = value === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, active && styles.tabActive]}
            onPress={() => onChange(tab.key)}
            activeOpacity={0.86}
          >
            <Ionicons name={tab.icon} size={18} color={active ? '#fff' : C.text3} />
            <Text style={[styles.label, { color: active ? '#fff' : C.text3 }]} numberOfLines={1}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    marginHorizontal: 20,
    borderRadius: 24,
    borderWidth: 1,
    padding: 5,
    flexDirection: 'row',
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  tab: {
    flex: 1,
    minHeight: 52,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  tabActive: { backgroundColor: '#123f4f' },
  label: { fontSize: 14, fontWeight: '900', letterSpacing: 0 },
});
