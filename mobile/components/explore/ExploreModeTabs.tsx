import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '@/lib/design';
import type { ExploreMode } from './exploreDisplay';

type Props = {
  value: ExploreMode;
  onChange: (mode: ExploreMode) => void;
};

export function ExploreModeTabs({ value, onChange }: Props) {
  const C = useTheme();
  const tabs: Array<{ key: ExploreMode; label: string }> = [
    { key: 'featured', label: 'FEATURED' },
    { key: 'nearby', label: 'NEAR ME' },
    { key: 'trip', label: 'TRIP' },
  ];
  return (
    <View style={[styles.shell, { borderColor: C.border, backgroundColor: C.s1 }]}>
      {tabs.map(tab => {
        const active = value === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, active && { backgroundColor: C.orangeGlow }]}
            onPress={() => onChange(tab.key)}
            activeOpacity={0.86}
          >
            <Text style={[styles.label, { color: active ? C.orange : C.text3 }]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    marginHorizontal: 20,
    borderRadius: 18,
    borderWidth: 1,
    padding: 6,
    flexDirection: 'row',
    gap: 6,
  },
  tab: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 12, fontWeight: '900', letterSpacing: 0 },
});

