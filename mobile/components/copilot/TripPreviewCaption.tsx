import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { MissionScene } from '@/lib/copilotStoryboard';
import { mono } from '@/lib/design';

type Props = {
  scene: MissionScene | null;
  sceneIndex: number;
  sceneCount: number;
};

export function TripPreviewCaption({ scene, sceneIndex, sceneCount }: Props) {
  if (!scene) return null;
  const warning = !!scene.layers?.warning;
  const accent = warning ? '#f59e0b' : '#fb923c';
  const caption = scene.narration || scene.subtitle;
  return (
    <View style={[styles.card, warning && styles.cardWarning]}>
      <View style={styles.topRow}>
        {warning ? (
          <Ionicons name="warning" size={13} color={accent} style={styles.topIcon} />
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
      {scene.subtitle && caption !== scene.subtitle ? (
        <Text style={styles.subtitle} numberOfLines={1}>{scene.subtitle}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(8,12,18,.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.16)',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 5,
  },
  cardWarning: {
    borderColor: 'rgba(245,158,11,.55)',
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  topIcon: { marginRight: -2 },
  kicker: {
    flex: 1,
    fontSize: 10,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  dayChip: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.2)',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  dayChipText: {
    color: '#cbd5e1',
    fontSize: 8,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  progress: {
    color: '#94a3b8',
    fontSize: 10,
    fontFamily: mono,
    fontWeight: '800',
  },
  caption: {
    color: '#f8fafc',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
});
