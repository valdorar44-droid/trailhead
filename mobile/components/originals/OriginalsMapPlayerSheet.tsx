import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/design';
import { useOriginalsRuntime, type OriginalRouteV1 } from '@/lib/originals';
import { useStore } from '@/lib/store';
import { manifestStories, originalSessionToUi } from './originalsUiService';
import OriginalFeedbackSheet from './OriginalFeedbackSheet';
import type { OriginalUiStory } from './types';

export type OriginalsMapPlayerSheetProps = {
  onFitRoute: (route: OriginalRouteV1) => void;
  bottomOffset?: number;
};

type AsyncAction = () => Promise<unknown>;

function formatClock(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function sessionStatusCopy(status: ReturnType<typeof originalSessionToUi>['status'], hasCurrentStory: boolean) {
  if (status === 'completed') return 'Drive complete';
  if (status === 'off_route') return 'Off route · auto-play paused';
  if (status === 'location_unavailable') return 'Waiting for a reliable GPS fix';
  if (status === 'paused') return 'Paused · progress saved';
  if (status === 'ready') return 'Ready to resume';
  return hasCurrentStory ? 'Now playing' : 'Listening for the next story';
}

function storyStateLabel(story: OriginalUiStory, currentStopId: string | null, nextStopId: string | null) {
  if (story.id === currentStopId) return 'Playing';
  if (story.completed) return 'Heard';
  if (story.skipped) return 'Skipped';
  if (story.missed) return 'Missed';
  if (story.id === nextStopId) return 'Up next';
  return 'Ahead';
}

export default function OriginalsMapPlayerSheet({
  onFitRoute,
  bottomOffset,
}: OriginalsMapPlayerSheetProps) {
  const C = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const runtime = useOriginalsRuntime();
  const accountId = useStore(state => state.user?.id ?? null);
  const ownerScope = accountId == null ? 'guest' : `account:${String(accountId)}`;
  const session = runtime.session;
  const manifest = runtime.manifest;
  const sessionKey = session ? `${session.owner_scope}:${session.session_id}` : '';
  const [uiSessionKey, setUiSessionKey] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [captionsVisible, setCaptionsVisible] = useState(true);
  const [storiesVisible, setStoriesVisible] = useState(false);
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [actionError, setActionError] = useState('');
  const previousStatusRef = useRef(session?.status);

  const scopeMatches = Boolean(
    session
    && manifest
    && session.owner_scope === ownerScope
    && session.pack_id === manifest.pack_id
    && session.version === manifest.version
    && session.manifest_id === manifest.manifest_id
    && session.download_state === 'ready'
    && session.status !== 'stopped'
  );

  useEffect(() => {
    if (!sessionKey || !session) return;
    if (sessionKey !== uiSessionKey) {
      setUiSessionKey(sessionKey);
      setExpanded(session.status !== 'paused');
      setCaptionsVisible(true);
      setStoriesVisible(false);
      setFeedbackVisible(false);
      setActionError('');
      previousStatusRef.current = session.status;
      return;
    }
    if (session.status === 'completed' && previousStatusRef.current !== 'completed') {
      setExpanded(true);
    }
    previousStatusRef.current = session.status;
  }, [session, sessionKey, uiSessionKey]);

  const uiSession = useMemo(() => {
    if (!scopeMatches || !session || !manifest) return null;
    return originalSessionToUi(session, manifest, runtime.muted);
  }, [manifest, runtime.muted, scopeMatches, session]);

  const stories = useMemo(() => {
    if (!scopeMatches || !session || !manifest) return [];
    return manifestStories(manifest, session);
  }, [manifest, scopeMatches, session]);

  const runAction = useCallback(async (name: string, action: AsyncAction, onSuccess?: () => void) => {
    if (busyAction) return;
    setBusyAction(name);
    setActionError('');
    try {
      await action();
      onSuccess?.();
    } catch (error: any) {
      setActionError(error?.message || 'That control is temporarily unavailable.');
    } finally {
      setBusyAction('');
    }
  }, [busyAction]);

  if (!scopeMatches || !session || !manifest || !uiSession || runtime.simulation) return null;

  const isCompleted = session.status === 'completed';
  const isPaused = session.status === 'paused' || uiSession.userPaused || runtime.state === 'paused';
  const shouldResume = isPaused || session.status === 'ready';
  const currentStory = uiSession.currentStory;
  const nextStory = uiSession.nextStory;
  const displayStory = currentStory || nextStory;
  const completedCount = session.completed_stop_ids.length;
  const skippedCount = session.skipped_stop_ids.length;
  const missedCount = session.missed_stop_ids.length;
  const terminalCount = new Set([
    ...session.completed_stop_ids,
    ...session.skipped_stop_ids,
    ...session.missed_stop_ids,
  ]).size;
  const audioPositionMs = runtime.audioPlaybackState?.position_ms ?? session.current_audio_position_ms;
  const audioDurationMs = runtime.audioPlaybackState?.duration_ms
    ?? (manifest.stops.find(stop => stop.id === session.current_stop_id)?.audio_duration_s ?? 0) * 1_000;
  const panelExpanded = sessionKey === uiSessionKey ? expanded : session.status !== 'paused';
  const panelBottom = bottomOffset == null ? Math.max(insets.bottom, 10) : Math.max(0, bottomOffset);

  const resumeFromPill = () => {
    if (isCompleted) {
      setExpanded(true);
      return;
    }
    if (!shouldResume && session.status === 'active') {
      setExpanded(true);
      return;
    }
    void runAction('resume', runtime.resumeTour, () => setExpanded(true));
  };

  const togglePause = () => {
    const action = shouldResume ? runtime.resumeTour : runtime.pauseTour;
    void runAction(shouldResume ? 'resume' : 'pause', action);
  };

  const endTour = () => {
    if (isCompleted) {
      void runAction('close', runtime.stopTour);
      return;
    }
    Alert.alert(
      'End this tour?',
      'GPS and narration will stop. Your download and story progress will stay saved.',
      [
        { text: 'Keep touring', style: 'cancel' },
        {
          text: 'End tour',
          style: 'destructive',
          onPress: () => void runAction('end', runtime.stopTour),
        },
      ],
    );
  };

  if (!panelExpanded) {
    return (
      <View pointerEvents="box-none" style={[styles.overlayRoot, { bottom: panelBottom }] }>
        <TouchableOpacity
          testID="originals.player.resume-pill"
          accessibilityRole="button"
          accessibilityLabel={isCompleted ? 'View Original completion recap' : shouldResume ? 'Resume Original' : 'Open Original player'}
          disabled={Boolean(busyAction)}
          onPress={resumeFromPill}
          style={[
            styles.resumePill,
            {
              backgroundColor: C.s1,
              borderColor: C.border,
              opacity: busyAction ? 0.72 : 1,
            },
          ]}
        >
          <View style={[styles.pillIcon, { backgroundColor: C.orange }] }>
            {busyAction === 'resume'
              ? <ActivityIndicator size="small" color="#FFFFFF" />
              : <Ionicons name={isCompleted ? 'checkmark' : 'play'} size={20} color="#FFFFFF" />}
          </View>
          <View style={styles.pillCopy}>
            <Text style={[styles.pillKicker, { color: C.orange }]}>TRAILHEAD ORIGINAL</Text>
            <Text style={[styles.pillTitle, { color: C.text }]} numberOfLines={1}>
              {isCompleted ? 'View drive recap' : shouldResume ? 'Resume Original' : 'Open Original player'}
            </Text>
            <Text style={[styles.pillMeta, { color: C.text3 }]} numberOfLines={1}>
              {manifest.title} · {terminalCount}/{manifest.stops.length} stories
            </Text>
          </View>
          <Ionicons name="chevron-up" size={20} color={C.text2} />
        </TouchableOpacity>
        {actionError ? <Text accessibilityLiveRegion="polite" style={[styles.pillError, { color: C.orange, backgroundColor: C.s1 }]}>{actionError}</Text> : null}
      </View>
    );
  }

  return (
    <>
      <View pointerEvents="box-none" style={[styles.overlayRoot, { bottom: panelBottom }] }>
        <View
          testID="originals.player.sheet"
          accessibilityLabel={`${manifest.title} Original player`}
          style={[
            styles.sheet,
            {
              backgroundColor: C.s1,
              borderColor: C.border,
              maxHeight: Math.min(570, Math.max(360, windowHeight * 0.7)),
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: C.border2 }]} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={[styles.kicker, { color: C.orange }]}>TRAILHEAD ORIGINAL</Text>
              <Text style={[styles.title, { color: C.text }]} numberOfLines={1}>{manifest.title}</Text>
            </View>
            <TouchableOpacity
              testID="originals.player.minimize"
              accessibilityRole="button"
              accessibilityLabel="Minimize Original player"
              onPress={() => setExpanded(false)}
              style={[styles.headerButton, { borderColor: C.border }]}
            >
              <Ionicons name="chevron-down" size={20} color={C.text} />
            </TouchableOpacity>
            <TouchableOpacity
              testID="originals.player.fit-route"
              accessibilityRole="button"
              accessibilityLabel="Fit the Original route on the map"
              onPress={() => onFitRoute(manifest.route)}
              style={[styles.headerButton, { borderColor: C.border }]}
            >
              <Ionicons name="map-outline" size={20} color={C.text} />
            </TouchableOpacity>
            <TouchableOpacity
              testID="originals.player.mute"
              accessibilityRole="button"
              accessibilityLabel={runtime.muted ? 'Unmute Original narration' : 'Mute Original narration'}
              accessibilityState={{ selected: runtime.muted }}
              disabled={Boolean(busyAction)}
              onPress={() => void runAction('mute', () => runtime.setMuted(!runtime.muted))}
              style={[styles.headerButton, { borderColor: C.border }]}
            >
              <Ionicons name={runtime.muted ? 'volume-mute' : 'volume-high'} size={20} color={runtime.muted ? C.orange : C.text} />
            </TouchableOpacity>
          </View>

          <ScrollView
            testID="originals.player.scroll"
            showsVerticalScrollIndicator={false}
            bounces={false}
            contentContainerStyle={styles.sheetContent}
          >
            {isCompleted ? (
              <View style={styles.completion}>
                <View style={[styles.completionIcon, { backgroundColor: C.orange + '18', borderColor: C.orange + '55' }] }>
                  <Ionicons name="checkmark" size={28} color={C.orange} />
                </View>
                <Text style={[styles.completionKicker, { color: C.orange }]}>DRIVE COMPLETE</Text>
                <Text style={[styles.completionTitle, { color: C.text }]}>You reached the end of this Original.</Text>
                <Text style={[styles.completionBody, { color: C.text2 }]}>Replay any story now or keep the recap saved with this version.</Text>
                <View style={[styles.recapRow, { borderColor: C.border }] }>
                  <RecapStat value={completedCount} label="HEARD" />
                  <View style={[styles.recapDivider, { backgroundColor: C.border }]} />
                  <RecapStat value={missedCount} label="MISSED" />
                  <View style={[styles.recapDivider, { backgroundColor: C.border }]} />
                  <RecapStat value={skippedCount} label="SKIPPED" />
                </View>
              </View>
            ) : (
              <>
                <View style={styles.statusRow}>
                  <View style={[styles.statusDot, { backgroundColor: C.orange }]} />
                  <Text accessibilityLiveRegion="polite" style={[styles.statusText, { color: C.text2 }]}>
                    {sessionStatusCopy(uiSession.status, Boolean(currentStory))}
                  </Text>
                  <Text style={[styles.progressText, { color: C.text3 }]}>{terminalCount}/{manifest.stops.length}</Text>
                </View>
                <View style={[styles.progressTrack, { backgroundColor: C.s3 }] }>
                  <View
                    testID="originals.player.progress"
                    accessibilityRole="progressbar"
                    accessibilityValue={{ min: 0, max: manifest.stops.length, now: terminalCount }}
                    style={[
                      styles.progressFill,
                      {
                        backgroundColor: C.orange,
                        width: `${Math.max(0, Math.min(100, Math.round(uiSession.progress * 100)))}%`,
                      },
                    ]}
                  />
                </View>

                {uiSession.message ? (
                  <View style={[styles.notice, { backgroundColor: C.orange + '10', borderColor: C.orange + '44' }] }>
                    <Ionicons name="navigate-outline" size={18} color={C.orange} />
                    <Text style={[styles.noticeText, { color: C.text2 }]}>{uiSession.message}</Text>
                  </View>
                ) : null}

                <View style={styles.storyHeader}>
                  <View style={[styles.storyNumber, { backgroundColor: C.orange + '18', borderColor: C.orange + '45' }] }>
                    <Text style={[styles.storyNumberText, { color: C.orange }]}>{String(displayStory?.sequence ?? '—').padStart(2, '0')}</Text>
                  </View>
                  <View style={styles.storyCopy}>
                    <Text style={[styles.storyKicker, { color: C.orange }]}>{currentStory ? 'CURRENT STORY' : 'NEXT STORY'}</Text>
                    <Text style={[styles.storyTitle, { color: C.text }]} numberOfLines={2}>{displayStory?.title || 'Continue along the route'}</Text>
                    <Text style={[styles.storyMeta, { color: C.text3 }]}>
                      {currentStory && audioDurationMs > 0
                        ? `${formatClock(audioPositionMs)} / ${formatClock(audioDurationMs)}`
                        : displayStory?.durationLabel || 'Waiting for the next authored cue'}
                    </Text>
                  </View>
                </View>

                {captionsVisible && displayStory?.transcript ? (
                  <View style={[styles.caption, { backgroundColor: C.s2, borderColor: C.border }] }>
                    <Text style={[styles.captionLabel, { color: C.text3 }]}>{currentStory ? 'CAPTIONS' : 'STORY PREVIEW'}</Text>
                    <Text style={[styles.captionText, { color: C.text2 }]}>{displayStory.transcript}</Text>
                  </View>
                ) : null}

                <View style={styles.transportRow}>
                  <TransportButton
                    testID="originals.player.replay"
                    icon="play-back"
                    label="Replay"
                    disabled={!currentStory || Boolean(busyAction)}
                    onPress={() => currentStory && void runAction('replay-current', () => runtime.seekStory(0))}
                  />
                  <TouchableOpacity
                    testID="originals.player.pause-resume"
                    accessibilityRole="button"
                    accessibilityLabel={shouldResume ? 'Resume Original' : 'Pause Original'}
                    disabled={Boolean(busyAction)}
                    onPress={togglePause}
                    style={[styles.primaryControl, { backgroundColor: C.orange, opacity: busyAction ? 0.64 : 1 }]}
                  >
                    {busyAction === 'pause' || busyAction === 'resume'
                      ? <ActivityIndicator size="small" color="#FFFFFF" />
                      : <Ionicons name={shouldResume ? 'play' : 'pause'} size={29} color="#FFFFFF" />}
                  </TouchableOpacity>
                  <TransportButton
                    testID="originals.player.skip"
                    icon="play-forward"
                    label="Skip"
                    disabled={!currentStory || Boolean(busyAction)}
                    onPress={() => void runAction('skip', runtime.skipCurrentStory)}
                  />
                </View>
              </>
            )}

            {actionError ? (
              <Text accessibilityLiveRegion="assertive" style={[styles.actionError, { color: C.orange }]}>{actionError}</Text>
            ) : null}

            <View style={styles.actionGrid}>
              {!isCompleted ? (
                <SheetAction
                  testID="originals.player.captions"
                  icon="text-outline"
                  label={captionsVisible ? 'Hide captions' : 'Show captions'}
                  onPress={() => setCaptionsVisible(value => !value)}
                />
              ) : null}
              <SheetAction testID="originals.player.stories" icon="list" label="Stories" onPress={() => setStoriesVisible(true)} />
              <SheetAction testID="originals.player.feedback" icon="chatbubble-ellipses-outline" label="Feedback" onPress={() => setFeedbackVisible(true)} />
              <SheetAction testID="originals.player.end" icon="flag-outline" label={isCompleted ? 'Close recap' : 'End tour'} onPress={endTour} disabled={Boolean(busyAction)} />
            </View>
          </ScrollView>
        </View>
      </View>

      <StoryListModal
        visible={storiesVisible}
        title={manifest.title}
        stories={stories}
        currentStopId={session.current_stop_id}
        nextStopId={nextStory?.id ?? null}
        busy={Boolean(busyAction)}
        onClose={() => setStoriesVisible(false)}
        onReplay={storyId => void runAction(`story:${storyId}`, () => runtime.replayStory(storyId), () => setStoriesVisible(false))}
      />
      <OriginalFeedbackSheet
        visible={feedbackVisible}
        packId={manifest.pack_id}
        version={manifest.version}
        stopId={currentStory?.id || nextStory?.id}
        onClose={() => setFeedbackVisible(false)}
      />
    </>
  );
}

function TransportButton({
  testID,
  icon,
  label,
  disabled,
  onPress,
}: {
  testID: string;
  icon: 'play-back' | 'play-forward';
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const C = useTheme();
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.transportButton, { opacity: disabled ? 0.35 : 1 }]}
    >
      <Ionicons name={icon} size={22} color={C.text} />
      <Text style={[styles.transportLabel, { color: C.text2 }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function SheetAction({
  testID,
  icon,
  label,
  disabled = false,
  onPress,
}: {
  testID: string;
  icon: 'text-outline' | 'list' | 'chatbubble-ellipses-outline' | 'flag-outline';
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const C = useTheme();
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.sheetAction, { borderColor: C.border, opacity: disabled ? 0.45 : 1 }]}
    >
      <Ionicons name={icon} size={17} color={icon === 'flag-outline' ? C.text2 : C.orange} />
      <Text style={[styles.sheetActionText, { color: C.text2 }]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

function RecapStat({ value, label }: { value: number; label: string }) {
  const C = useTheme();
  return (
    <View style={styles.recapStat}>
      <Text style={[styles.recapValue, { color: C.text }]}>{value}</Text>
      <Text style={[styles.recapLabel, { color: C.text3 }]}>{label}</Text>
    </View>
  );
}

function StoryListModal({
  visible,
  title,
  stories,
  currentStopId,
  nextStopId,
  busy,
  onClose,
  onReplay,
}: {
  visible: boolean;
  title: string;
  stories: OriginalUiStory[];
  currentStopId: string | null;
  nextStopId: string | null;
  busy: boolean;
  onClose: () => void;
  onReplay: (storyId: string) => void;
}) {
  const C = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay} testID="originals.player.story-list">
        <View style={[styles.storySheet, { backgroundColor: C.s1, borderColor: C.border, paddingBottom: Math.max(insets.bottom, 18) }] }>
          <View style={styles.storyModalHeader}>
            <View style={styles.storyModalCopy}>
              <Text style={[styles.kicker, { color: C.orange }]}>STORY LIST</Text>
              <Text style={[styles.storyModalTitle, { color: C.text }]} numberOfLines={1}>{title}</Text>
            </View>
            <TouchableOpacity testID="originals.player.story-list.close" accessibilityRole="button" accessibilityLabel="Close story list" onPress={onClose} style={styles.modalClose}>
              <Ionicons name="close" size={22} color={C.text} />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.storyList}>
            {stories.map(story => {
              const status = storyStateLabel(story, currentStopId, nextStopId);
              const replayable = Boolean(story.replayable && story.id !== currentStopId);
              return (
                <View key={story.id} style={[styles.storyRow, { borderColor: C.border }] }>
                  <View style={[styles.storyRowNumber, { borderColor: C.orange + '55' }] }>
                    <Text style={[styles.storyRowNumberText, { color: C.orange }]}>{String(story.sequence).padStart(2, '0')}</Text>
                  </View>
                  <View style={styles.storyRowCopy}>
                    <Text style={[styles.storyRowTitle, { color: C.text }]}>{story.title}</Text>
                    <Text style={[styles.storyRowMeta, { color: status === 'Playing' || status === 'Up next' ? C.orange : C.text3 }]}>{status} · {story.durationLabel}</Text>
                  </View>
                  {replayable ? (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={`Replay ${story.title}`}
                      accessibilityState={{ disabled: busy }}
                      disabled={busy}
                      onPress={() => onReplay(story.id)}
                      style={[styles.storyReplay, { borderColor: C.border, opacity: busy ? 0.45 : 1 }]}
                    >
                      <Ionicons name="play" size={17} color={C.orange} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 50,
  },
  sheet: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.24,
    shadowRadius: 18,
    elevation: 14,
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    marginTop: 9,
  },
  header: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 10,
    paddingTop: 7,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  kicker: { fontSize: 10, fontWeight: '900', letterSpacing: 1.35 },
  title: { fontSize: 17, fontWeight: '800', marginTop: 2 },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetContent: { paddingHorizontal: 16, paddingBottom: 16 },
  statusRow: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { flex: 1, fontSize: 12, fontWeight: '700' },
  progressText: { fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden', marginBottom: 14 },
  progressFill: { height: 4, borderRadius: 2 },
  notice: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 12,
  },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  storyHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  storyNumber: {
    width: 50,
    height: 50,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyNumberText: { fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  storyCopy: { flex: 1, minWidth: 0 },
  storyKicker: { fontSize: 10, fontWeight: '900', letterSpacing: 1.15 },
  storyTitle: { fontSize: 20, lineHeight: 24, fontWeight: '800', marginTop: 2 },
  storyMeta: { fontSize: 12, fontWeight: '600', marginTop: 3, fontVariant: ['tabular-nums'] },
  caption: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 12,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  captionLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1.15, marginBottom: 5 },
  captionText: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  transportRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    marginTop: 10,
  },
  primaryControl: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transportButton: { minWidth: 56, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 2 },
  transportLabel: { fontSize: 10, fontWeight: '700' },
  actionError: { fontSize: 12, lineHeight: 17, fontWeight: '700', textAlign: 'center', marginBottom: 7 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 3 },
  sheetAction: {
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 44,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 10,
  },
  sheetActionText: { fontSize: 12, fontWeight: '700' },
  completion: { alignItems: 'center', paddingTop: 2, paddingBottom: 12 },
  completionIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completionKicker: { fontSize: 10, fontWeight: '900', letterSpacing: 1.3, marginTop: 11 },
  completionTitle: { fontSize: 21, lineHeight: 26, fontWeight: '800', textAlign: 'center', marginTop: 4 },
  completionBody: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 5, maxWidth: 320 },
  recapRow: {
    alignSelf: 'stretch',
    minHeight: 72,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
  },
  recapStat: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  recapValue: { fontSize: 21, fontWeight: '900', fontVariant: ['tabular-nums'] },
  recapLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.1, marginTop: 2 },
  recapDivider: { width: StyleSheet.hairlineWidth, height: 34 },
  resumePill: {
    minHeight: 68,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 12,
    paddingVertical: 9,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 12,
  },
  pillIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  pillCopy: { flex: 1, minWidth: 0 },
  pillKicker: { fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  pillTitle: { fontSize: 16, fontWeight: '800', marginTop: 1 },
  pillMeta: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  pillError: { fontSize: 11, lineHeight: 15, fontWeight: '700', marginTop: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.46)' },
  storySheet: {
    maxHeight: '82%',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  storyModalHeader: { minHeight: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, gap: 12 },
  storyModalCopy: { flex: 1, minWidth: 0 },
  storyModalTitle: { fontSize: 19, fontWeight: '800', marginTop: 2 },
  modalClose: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  storyList: { paddingHorizontal: 16, paddingBottom: 10 },
  storyRow: {
    minHeight: 76,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 10,
  },
  storyRowNumber: { width: 42, height: 42, borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  storyRowNumberText: { fontSize: 12, fontWeight: '900', fontVariant: ['tabular-nums'] },
  storyRowCopy: { flex: 1, minWidth: 0 },
  storyRowTitle: { fontSize: 14, lineHeight: 18, fontWeight: '800' },
  storyRowMeta: { fontSize: 11, fontWeight: '700', marginTop: 3 },
  storyReplay: { width: 44, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
});
