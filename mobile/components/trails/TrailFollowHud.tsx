import type { ReactNode } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/design';
import { trailheadFonts } from '@/lib/typography';
import type { TrailFollowMetrics } from '@/lib/trailFollowSession';
import type { TrailRecordingSessionV1 } from '@/lib/trailRecordingSession';

export type TrailFollowPresentation = Readonly<{
  phase: 'handoff' | 'follow' | 'recovery' | 'recording_only' | 'complete';
  trailName: string;
  trailheadName?: string | null;
  metrics?: TrailFollowMetrics | null;
}>;

type Props = Readonly<{
  presentation: TrailFollowPresentation;
  recording: TrailRecordingSessionV1 | null;
  elapsedMs: number;
  voiceEnabled: boolean;
  compass: ReactNode;
  onStartNearby: () => void;
  onToggleVoice: () => void;
  onStartRecording: () => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
  onOpenRoute: () => void;
  onReport: () => void;
  onEnd: () => void;
  endVisible: boolean;
  onDismissEnd: () => void;
  onEndAndSave: () => void;
  onEndFollowOnly: () => void;
}>;

function distanceLabel(distanceM?: number | null) {
  if (distanceM == null || !Number.isFinite(distanceM)) return null;
  if (distanceM < 1_000) return `${Math.max(0, Math.round(distanceM / 5) * 5)} m`;
  return `${(distanceM / 1_609.344).toFixed(distanceM < 16_093 ? 1 : 0)} mi`;
}

function durationLabel(elapsedMs: number) {
  const totalMinutes = Math.max(0, Math.floor(elapsedMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}` : `${minutes} min`;
}

export default function TrailFollowHud({
  presentation,
  recording,
  elapsedMs,
  voiceEnabled,
  compass,
  onStartNearby,
  onToggleVoice,
  onStartRecording,
  onPauseRecording,
  onResumeRecording,
  onOpenRoute,
  onReport,
  onEnd,
  endVisible,
  onDismissEnd,
  onEndAndSave,
  onEndFollowOnly,
}: Props) {
  const C = useTheme();
  const insets = useSafeAreaInsets();
  const metrics = presentation.metrics;
  const weakGps = metrics?.gps === 'weak';
  const recordingActive = recording?.status === 'recording';
  const recordingPaused = recording?.status === 'paused';

  if (presentation.phase === 'handoff') {
    return (
      <View style={[styles.topWrap, { top: insets.top + 10 }]} pointerEvents="box-none">
        <View style={[styles.cueCard, { backgroundColor: C.s1, borderColor: C.border2 }]} testID="trail.follow.handoff">
          <View style={[styles.iconBox, { backgroundColor: `${C.orange}1A` }]}>
            <Ionicons name="trail-sign-outline" size={24} color={C.orange} />
          </View>
          <View style={styles.flex}>
            <Text style={[styles.kicker, { color: C.orange }]}>DRIVE TO TRAILHEAD</Text>
            <Text style={[styles.cueTitle, { color: C.text }]} numberOfLines={2}>
              {presentation.trailheadName || 'Sourced trailhead'}
            </Text>
            <Text style={[styles.support, { color: C.text2 }]} numberOfLines={1}>{presentation.trailName}</Text>
          </View>
          <TouchableOpacity
            style={[styles.nearbyButton, { borderColor: C.border2 }]}
            onPress={onStartNearby}
            testID="trail.follow.nearby"
            accessibilityRole="button"
            accessibilityLabel="Start Trail Follow nearby"
          >
            <Text style={[styles.nearbyText, { color: C.text }]}>Nearby</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <>
      <View style={[styles.topWrap, { top: insets.top + 10 }]} pointerEvents="box-none">
        <View style={[styles.cueCard, { backgroundColor: C.s1, borderColor: weakGps ? C.yellow : C.border2 }]} testID="trail.follow.hud">
          <View style={[styles.iconBox, { backgroundColor: `${weakGps ? C.yellow : C.orange}18` }]}>
            <Ionicons name={weakGps ? 'locate-outline' : 'walk-outline'} size={24} color={weakGps ? C.yellow : C.orange} />
          </View>
          <View style={styles.flex}>
            <Text style={[styles.kicker, { color: weakGps ? C.yellow : C.orange }]}>
              {presentation.phase === 'recording_only' ? 'RECORDING TRAIL' : presentation.phase === 'recovery' ? 'FOLLOW RECOVERED' : weakGps ? 'GPS SIGNAL WEAK' : 'TRAIL FOLLOW'}
            </Text>
            <Text style={[styles.cueTitle, { color: C.text }]} numberOfLines={2}>
              {presentation.phase === 'recording_only' ? 'Follow ended' : metrics?.nextCue || 'Route ready'}
            </Text>
            <Text style={[styles.support, { color: C.text2 }]} numberOfLines={1}>
              {[distanceLabel(metrics?.nextCueDistanceM), presentation.trailName].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {compass}
        </View>
      </View>

      <View style={[styles.bottomWrap, { bottom: insets.bottom + 8 }]} pointerEvents="box-none">
        <View style={[styles.bottomCard, { backgroundColor: C.s1, borderColor: C.border2 }]}>
          <View style={styles.metricsRow}>
            <View style={styles.metric}>
              <Text style={[styles.metricValue, { color: C.text }]}>{distanceLabel(metrics?.remainingM) || '--'}</Text>
              <Text style={[styles.metricLabel, { color: C.text3 }]}>REMAINING</Text>
            </View>
            <View style={[styles.metricDivider, { backgroundColor: C.border }]} />
            <View style={styles.metric}>
              <Text style={[styles.metricValue, { color: recording ? C.red : C.text }]}>
                {recording ? durationLabel(elapsedMs) : 'Off'}
              </Text>
              <Text style={[styles.metricLabel, { color: C.text3 }]}>RECORDING</Text>
            </View>
            <View style={[styles.metricDivider, { backgroundColor: C.border }]} />
            <View style={styles.metric}>
              <Text style={[styles.metricValue, { color: C.text }]}>{metrics?.gps === 'good' ? 'Good' : 'Weak'}</Text>
              <Text style={[styles.metricLabel, { color: C.text3 }]}>GPS</Text>
            </View>
          </View>

          <View style={styles.primaryRow}>
            <TouchableOpacity
              style={[styles.endButton, { backgroundColor: C.text }]}
              onPress={onEnd}
              testID="trail.follow.end"
              accessibilityRole="button"
              accessibilityLabel="End trail session"
            >
              <Ionicons name="stop" size={16} color={C.bg} />
              <Text style={[styles.endText, { color: C.bg }]}>End</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.recordButton, { borderColor: recording ? C.red : C.orange, backgroundColor: recording ? `${C.red}12` : `${C.orange}12` }]}
              onPress={recordingActive ? onPauseRecording : recordingPaused ? onResumeRecording : onStartRecording}
              testID="trail.recording.toggle"
              accessibilityRole="button"
              accessibilityLabel={recordingActive ? 'Pause trail recording' : recordingPaused ? 'Resume trail recording' : 'Record trail'}
            >
              <Ionicons name={recordingActive ? 'pause' : recordingPaused ? 'play' : 'radio-button-on'} size={17} color={recording ? C.red : C.orange} />
              <Text style={[styles.recordText, { color: recording ? C.red : C.orange }]}>
                {recordingActive ? 'Pause' : recordingPaused ? 'Resume' : 'Record'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.secondaryRow}>
            {[
              { id: 'sound', label: voiceEnabled ? 'Sound on' : 'Sound off', icon: voiceEnabled ? 'volume-high-outline' : 'volume-mute-outline', press: onToggleVoice },
              { id: 'route', label: 'Route', icon: 'map-outline', press: onOpenRoute },
              { id: 'report', label: 'Report', icon: 'alert-circle-outline', press: onReport },
            ].map(action => (
              <TouchableOpacity
                key={action.id}
                style={styles.secondaryAction}
                onPress={action.press}
                testID={`trail.follow.${action.id}`}
                accessibilityRole="button"
                accessibilityLabel={action.label}
              >
                <Ionicons name={action.icon as any} size={18} color={C.text2} />
                <Text style={[styles.secondaryText, { color: C.text2 }]}>{action.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
      <Modal visible={endVisible} transparent animationType="fade" onRequestClose={onDismissEnd}>
        <View style={styles.endOverlay} testID="trail.follow.end-sheet">
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onDismissEnd} accessibilityLabel="Keep trail session active" />
          <View style={[styles.endSheet, { backgroundColor: C.s1, borderColor: C.border2, paddingBottom: Math.max(insets.bottom, 14) }]}>
            <View style={[styles.endHandle, { backgroundColor: C.border2 }]} />
            <Text style={[styles.endTitle, { color: C.text }]}>End trail session?</Text>
            <Text style={[styles.endSupport, { color: C.text2 }]}>Your saved recording stays on this device.</Text>
            <TouchableOpacity style={[styles.endChoicePrimary, { backgroundColor: C.text }]} onPress={onEndAndSave} testID="trail.follow.end-save">
              <Text style={[styles.endChoicePrimaryText, { color: C.bg }]}>End & save</Text>
            </TouchableOpacity>
            {recording && presentation.phase !== 'recording_only' ? (
              <TouchableOpacity style={[styles.endChoice, { borderColor: C.border2 }]} onPress={onEndFollowOnly} testID="trail.follow.end-only">
                <Text style={[styles.endChoiceText, { color: C.text }]}>End Follow only</Text>
                <Text style={[styles.endChoiceMeta, { color: C.text3 }]}>Keep recording this track</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.keepGoing} onPress={onDismissEnd} testID="trail.follow.keep-going">
              <Text style={[styles.keepGoingText, { color: C.orange }]}>Keep going</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  topWrap: { position: 'absolute', left: 14, right: 14, zIndex: 42 },
  cueCard: { minHeight: 92, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 8 },
  iconBox: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, minWidth: 0 },
  kicker: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  cueTitle: { fontFamily: trailheadFonts.displayBold, fontSize: 25, lineHeight: 27 },
  support: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  nearbyButton: { minWidth: 70, minHeight: 44, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  nearbyText: { fontSize: 14, fontWeight: '800' },
  bottomWrap: { position: 'absolute', left: 12, right: 12, zIndex: 43 },
  bottomCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, padding: 12, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  metricsRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  metric: { flex: 1, alignItems: 'center' },
  metricValue: { fontSize: 17, fontWeight: '800' },
  metricLabel: { marginTop: 2, fontSize: 10, fontWeight: '800', letterSpacing: 0.65 },
  metricDivider: { width: StyleSheet.hairlineWidth, height: 34 },
  primaryRow: { flexDirection: 'row', gap: 9, marginTop: 9 },
  endButton: { flex: 1, minHeight: 48, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  endText: { fontSize: 16, fontWeight: '900' },
  recordButton: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  recordText: { fontSize: 15, fontWeight: '900' },
  secondaryRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 9 },
  secondaryAction: { minWidth: 76, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 3 },
  secondaryText: { fontSize: 11, fontWeight: '700' },
  endOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.48)' },
  endSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 18, paddingTop: 10 },
  endHandle: { width: 42, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  endTitle: { fontFamily: trailheadFonts.displayBold, fontSize: 30, lineHeight: 33 },
  endSupport: { fontSize: 14, marginTop: 4, marginBottom: 16 },
  endChoicePrimary: { minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  endChoicePrimaryText: { fontSize: 16, fontWeight: '900' },
  endChoice: { minHeight: 58, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  endChoiceText: { fontSize: 15, fontWeight: '900' },
  endChoiceMeta: { fontSize: 12, marginTop: 2 },
  keepGoing: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  keepGoingText: { fontSize: 15, fontWeight: '900' },
});
