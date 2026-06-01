import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  trailConfidenceLabel,
  trailSourceLabel,
  trailVehicleFitLabel,
  type TrailFeature,
} from '@/lib/trailEngine';
import { mono } from '@/lib/design';

type TrailDetailFactsProps = {
  trail: TrailFeature;
  textColor: string;
  mutedColor: string;
  borderColor: string;
  surfaceColor: string;
};

export function TrailDetailFacts({ trail, textColor, mutedColor, borderColor, surfaceColor }: TrailDetailFactsProps) {
  const rows = [
    { icon: 'shield-checkmark-outline', label: trailConfidenceLabel(trail) },
    { icon: 'car-outline', label: trailVehicleFitLabel(trail) },
    { icon: 'map-outline', label: trailSourceLabel(trail) },
  ] as const;
  return (
    <View style={styles.wrap}>
      {rows.map(row => (
        <View key={`${row.icon}-${row.label}`} style={[styles.pill, { borderColor, backgroundColor: surfaceColor }]}>
          <Ionicons name={row.icon} size={12} color={mutedColor} />
          <Text style={[styles.text, { color: textColor }]} numberOfLines={1}>{row.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  pill: {
    maxWidth: '100%',
    minHeight: 27,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
  },
  text: { maxWidth: 170, fontSize: 9.5, fontFamily: mono, fontWeight: '800' },
});
