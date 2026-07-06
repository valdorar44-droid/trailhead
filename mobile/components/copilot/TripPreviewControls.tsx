import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  playing: boolean;
  paused: boolean;
  complete: boolean;
  onReplay: () => void;
  onPauseResume: () => void;
  onSkip: () => void;
};

export function TripPreviewControls({ playing, paused, complete, onReplay, onPauseResume, onSkip }: Props) {
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
});
