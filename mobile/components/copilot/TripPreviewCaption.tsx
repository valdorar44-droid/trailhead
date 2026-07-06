import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { MissionScene } from '@/lib/copilotStoryboard';
import { mono } from '@/lib/design';

type Props = {
  scene: MissionScene | null;
  sceneIndex: number;
  sceneCount: number;
  /** Runtime beat line (live scout) — overrides scene.narration when set. */
  captionText?: string | null;
};

export function TripPreviewCaption({ scene, sceneIndex, sceneCount, captionText }: Props) {
  if (!scene) return null;
  const warning = !!scene.layers?.warning;
  const accent = warning ? '#f59e0b' : '#fb923c';
  const caption = (captionText || scene.narration || scene.subtitle || '').trim();
  return (
    <View style={[styles.card, warning && styles.cardWarning]}>
      <View style={styles.topRow}>
        {warning ? (
          <Ionicons name="warning" size={12} color={accent} style={styles.topIcon} />
        ) : null}
        <Text style={[styles.kicker, { color: accent }]} numberOfLines={1}>
          {scene.title.toUpperCase()}
        </Text>
        {typeof scene.day === 'number' && scene.day > 0 ? (
          <View style={styles.dayChip}>
            <Text style={styles.dayChipText}>DAY {scene.day}</Text>
          </View>
        ) : null}
        <Text style={styles.progress}>
          {Math.min(sceneIndex + 1, sceneCount)}/{sceneCount}
        </Text>
      </View>
      {caption ? (
        <Text style={styles.caption} numberOfLines={2}>{caption}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(8,12,18,.84)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.14)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
    maxWidth: '100%',
  },
  cardWarning: {
    borderColor: 'rgba(245,158,11,.55)',
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  topIcon: { marginRight: -2 },
  kicker: {
    flex: 1,
    fontSize: 9,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 0.9,
  },
  dayChip: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.2)',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  dayChipText: {
    color: '#cbd5e1',
    fontSize: 7,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  progress: {
    color: '#94a3b8',
    fontSize: 9,
    fontFamily: mono,
    fontWeight: '800',
  },
  caption: {
    color: '#f8fafc',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
});
