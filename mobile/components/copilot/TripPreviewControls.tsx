import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/** Cinematic playback speeds. Effective scene duration = baseDuration / speed. */
export const PREVIEW_SPEEDS = [0.5, 1, 2] as const;
export type PreviewSpeed = (typeof PREVIEW_SPEEDS)[number];
/** Default to a slow, cinematic pace. */
export const DEFAULT_PREVIEW_SPEED: PreviewSpeed = 0.5;

const SPEED_LABEL: Record<PreviewSpeed, string> = {
  0.5: 'SLOW',
  1: '1×',
  2: 'FAST',
};

export function nextPreviewSpeed(speed: number): PreviewSpeed {
  const idx = PREVIEW_SPEEDS.findIndex(s => s === speed);
  return PREVIEW_SPEEDS[(idx + 1) % PREVIEW_SPEEDS.length];
}

type Props = {
  playing: boolean;
  paused: boolean;
  complete: boolean;
  /** Current playback speed. Speed control is only shown when onCycleSpeed is provided. */
  speed?: number;
  onReplay: () => void;
  onPauseResume: () => void;
  onSkip: () => void;
  onCycleSpeed?: () => void;
};

export function TripPreviewControls({
  playing, paused, complete, speed = DEFAULT_PREVIEW_SPEED, onReplay, onPauseResume, onSkip, onCycleSpeed,
}: Props) {
  const speedLabel = SPEED_LABEL[(speed as PreviewSpeed)] ?? `${speed}×`;
  return (
    <View style={styles.row}>
      <TouchableOpacity style={styles.btn} onPress={onReplay} accessibilityLabel="Replay briefing">
        <Ionicons name="refresh" size={15} color="#f8fafc" />
        {complete ? <Text style={styles.btnText}>Replay</Text> : null}
      </TouchableOpacity>
      {playing && !complete ? (
        <TouchableOpacity
          style={styles.btn}
          onPress={onPauseResume}
          accessibilityLabel={paused ? 'Resume briefing' : 'Pause briefing'}
        >
          <Ionicons name={paused ? 'play' : 'pause'} size={15} color="#f8fafc" />
        </TouchableOpacity>
      ) : null}
      {playing && !complete ? (
        <TouchableOpacity style={styles.btn} onPress={onSkip} accessibilityLabel="Skip scene">
          <Ionicons name="play-skip-forward" size={15} color="#f8fafc" />
        </TouchableOpacity>
      ) : null}
      {onCycleSpeed ? (
        <TouchableOpacity
          style={[styles.btn, styles.speedBtn]}
          onPress={onCycleSpeed}
          accessibilityLabel={`Playback speed ${speedLabel}. Tap to change.`}
        >
          <Ionicons name="speedometer-outline" size={14} color="#fdba74" />
          <Text style={styles.speedText}>{speedLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 38,
    height: 38,
    paddingHorizontal: 11,
    borderRadius: 13,
    justifyContent: 'center',
    backgroundColor: 'rgba(8,12,18,.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.16)',
  },
  btnText: { color: '#f8fafc', fontSize: 12, fontWeight: '800' },
  speedBtn: {
    gap: 5,
    borderColor: 'rgba(251,146,60,.45)',
  },
  speedText: { color: '#fdba74', fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
});
