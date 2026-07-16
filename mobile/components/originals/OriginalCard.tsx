import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/design';
import OriginalArtwork from './OriginalArtwork';
import type { OriginalUiSummary } from './types';

export default function OriginalCard({
  original,
  onPress,
  variant = 'rail',
}: {
  original: OriginalUiSummary;
  onPress: () => void;
  variant?: 'rail' | 'list' | 'context';
}) {
  const C = useTheme();
  const compact = variant !== 'list';
  const priceLabel = original.access === 'owned'
    ? original.progress && original.progress > 0
      ? `${Math.round(original.progress * 100)}% complete`
      : original.downloadState === 'ready'
        ? 'Ready offline'
        : 'Owned'
    : original.priceCredits === 0
      ? 'Free'
      : `${original.priceCredits} credits`;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`Open Trailhead Original ${original.title}. ${priceLabel}`}
      activeOpacity={0.88}
      onPress={onPress}
      style={[
        styles.card,
        variant === 'rail' && styles.railCard,
        variant === 'context' && styles.contextCard,
        { borderColor: C.border, backgroundColor: C.s2 },
      ]}
    >
      <OriginalArtwork imageUrl={original.heroImageUrl} region={original.region} compact={compact} />
      <View style={styles.body}>
        <Text style={[styles.title, { color: C.text }]} numberOfLines={2}>{original.title}</Text>
        <Text style={[styles.summary, { color: C.text2 }]} numberOfLines={variant === 'list' ? 3 : 2}>{original.summary}</Text>
        <View style={styles.metaRow}>
          <OriginalMeta icon="time-outline" label={original.durationLabel} />
          <OriginalMeta icon="navigate-outline" label={original.distanceLabel} />
          <OriginalMeta icon="headset-outline" label={`${original.storyCount} stories`} />
        </View>
        <View style={[styles.footer, { borderTopColor: C.border }] }>
          <View style={styles.priceRow}>
            <Ionicons
              name={original.access === 'owned' ? 'checkmark-circle' : original.priceCredits === 0 ? 'gift-outline' : 'ticket-outline'}
              size={15}
              color={C.orange}
            />
            <Text style={[styles.price, { color: C.orange }]}>{priceLabel}</Text>
          </View>
          <View style={[styles.open, { backgroundColor: C.orange }] }>
            <Text style={styles.openText}>{original.access === 'owned' ? 'OPEN' : 'VIEW'}</Text>
            <Ionicons name="arrow-forward" size={13} color="#FFFFFF" />
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function OriginalMeta({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const C = useTheme();
  return (
    <View style={styles.metaItem}>
      <Ionicons name={icon} size={12} color={C.text3} />
      <Text style={[styles.meta, { color: C.text3 }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  railCard: { width: 286 },
  contextCard: { width: '100%' },
  body: { padding: 13, gap: 7 },
  title: { fontSize: 17, lineHeight: 21, fontWeight: '900', letterSpacing: -0.2 },
  summary: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 11, rowGap: 5, marginTop: 2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { fontSize: 10.5, lineHeight: 14, fontWeight: '800' },
  footer: { minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 4, paddingTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  priceRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  price: { flexShrink: 1, fontSize: 11, lineHeight: 15, fontWeight: '900' },
  open: { minHeight: 36, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  openText: { color: '#FFFFFF', fontSize: 9.5, fontWeight: '900', letterSpacing: 0.6 },
});
