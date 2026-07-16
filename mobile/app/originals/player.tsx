import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/design';
import { useOriginalsRuntime } from '@/lib/originals';
import { useStore } from '@/lib/store';
import { getOriginalDetail, manifestStories, originalSessionToUi } from '@/components/originals/originalsUiService';
import OriginalRouteMap from '@/components/originals/OriginalRouteMap';
import type { OriginalUiDetail, OriginalUiSession, OriginalUiStory } from '@/components/originals/types';

export default function OriginalPlayerScreen() {
  const C = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string | string[]; version?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id || '';
  const versionValue = Array.isArray(params.version) ? params.version[0] : params.version;
  const requestedVersion = Number.isFinite(Number(versionValue)) ? Number(versionValue) : undefined;
  const originalsRuntime = useOriginalsRuntime();
  const accountId = useStore(state => state.user?.id ?? null);
  const ownerScope = accountId == null ? 'guest' : `account:${String(accountId)}`;
  const [detail, setDetail] = useState<OriginalUiDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [transcriptVisible, setTranscriptVisible] = useState(true);
  const [storiesVisible, setStoriesVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getOriginalDetail(id, requestedVersion).then(nextDetail => {
      if (cancelled) return;
      setDetail(nextDetail);
    }).catch(() => {}).finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [id, requestedVersion]);

  const session = useMemo(() => {
    if (!originalsRuntime.session || !originalsRuntime.manifest) return null;
    if (originalsRuntime.session.owner_scope !== ownerScope) return null;
    if (originalsRuntime.session.pack_id !== id && originalsRuntime.manifest.pack_id !== id) return null;
    return originalSessionToUi(originalsRuntime.session, originalsRuntime.manifest, originalsRuntime.muted);
  }, [id, originalsRuntime.manifest, originalsRuntime.muted, originalsRuntime.session, ownerScope]);

  const playerDetail = useMemo(() => {
    if (
      !detail
      || !originalsRuntime.manifest
      || originalsRuntime.session?.owner_scope !== ownerScope
      || originalsRuntime.manifest.pack_id !== id
    ) return detail;
    const stories = manifestStories(originalsRuntime.manifest, originalsRuntime.session);
    return { ...detail, stories, storyCount: stories.length };
  }, [detail, id, originalsRuntime.manifest, originalsRuntime.session, ownerScope]);

  const togglePause = useCallback(async () => {
    if (!session) return;
    if (session.userPaused || originalsRuntime.state === 'paused') await originalsRuntime.resumeTour();
    else await originalsRuntime.pauseTour();
  }, [originalsRuntime, session]);

  const currentStory = session?.currentStory || session?.nextStory || playerDetail?.stories[0];
  const nextStop = useMemo(() => {
    if (!originalsRuntime.manifest || originalsRuntime.manifest.pack_id !== id) return null;
    const nextId = session?.nextStory?.id;
    return nextId ? originalsRuntime.manifest.stops.find(stop => stop.id === nextId) ?? null : null;
  }, [id, originalsRuntime.manifest, session?.nextStory?.id]);
  const isPaused = Boolean(session?.userPaused || session?.status === 'paused');
  const status = session?.status || 'ready';
  const completedStories = useMemo(() => {
    if (!playerDetail) return [];
    return playerDetail.stories.filter(story => story.replayable);
  }, [playerDetail]);

  const needsRedownload = Boolean(
    originalsRuntime.session?.owner_scope === ownerScope
    && originalsRuntime.session?.pack_id === id
    && originalsRuntime.session.download_state !== 'ready'
  );

  if (loading || !playerDetail || !session || needsRedownload) {
    const canResume = Boolean(
      originalsRuntime.state !== 'error'
      && originalsRuntime.manifest
      && originalsRuntime.session?.download_state === 'ready'
      && originalsRuntime.manifest.pack_id === id
      && (requestedVersion == null || originalsRuntime.manifest.version === requestedVersion)
    );
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: C.bg }] }>
        {loading ? <ActivityIndicator color={C.orange} /> : <Ionicons name="pause-circle-outline" size={32} color={C.text3} />}
        <Text style={[styles.centerText, { color: C.text2 }]}>{loading ? 'Restoring your Original' : needsRedownload ? 'This offline package needs to be downloaded again' : canResume ? 'Your drive is ready to resume' : 'No active Original for this account on this device'}</Text>
        {!loading ? (
          <TouchableOpacity accessibilityRole="button" onPress={() => canResume ? void originalsRuntime.resumeTour() : router.replace({ pathname: '/originals/[id]', params: { id, ...(requestedVersion == null ? {} : { version: String(requestedVersion) }) } } as any)} style={[styles.recoveryButton, { borderColor: C.border }] }>
            <Text style={[styles.recoveryText, { color: C.orange }]}>{canResume ? 'Resume tour' : 'Return to Original'}</Text>
          </TouchableOpacity>
        ) : null}
      </SafeAreaView>
    );
  }

  if (status === 'completed') {
    return (
      <>
        <CompletionState detail={playerDetail} session={session} onStories={() => setStoriesVisible(true)} />
        <StoriesModal visible={storiesVisible} detail={playerDetail} completed={completedStories} onClose={() => setStoriesVisible(false)} onReplay={storyId => void originalsRuntime.replayStory(storyId)} />
      </>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: C.bg }] }>
      <LinearGradient colors={[C.s2, '#0D0F10', C.bg]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFillObject} />
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
        <View style={styles.topBar}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Minimize tour player"
            onPress={() => router.replace('/(tabs)/map' as any)}
            style={styles.roundButton}
          >
            <Ionicons name="chevron-down" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.topCopy}>
            <Text style={styles.topKicker}>TRAILHEAD ORIGINAL</Text>
            <Text style={styles.topTitle} numberOfLines={1}>{playerDetail.title}</Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={session.muted ? 'Unmute narration' : 'Mute narration'}
            onPress={() => void originalsRuntime.setMuted(!session.muted)}
            style={styles.roundButton}
          >
            <Ionicons name={session.muted ? 'volume-mute' : 'volume-high'} size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <View style={styles.mapStage}>
          <OriginalRouteMap
            route={originalsRuntime.manifest!.route}
            projectedProgressM={originalsRuntime.session!.last_projected_route_progress_m}
            currentStoryTitle={session.currentStory?.title}
            nextStop={nextStop}
          />
          <View style={styles.mapStatusRow}>
            <View style={styles.offlineBadge}>
              <Ionicons name="cloud-offline-outline" size={13} color="#FFFFFF" />
              <Text style={styles.offlineText}>OFFLINE READY</Text>
            </View>
            <View style={styles.gpsBadge}>
              <View style={[styles.gpsDot, { backgroundColor: status === 'location_unavailable' ? C.red : C.silverBright }]} />
              <Text style={styles.offlineText}>{status === 'location_unavailable' ? 'GPS PAUSED' : 'GPS ACTIVE'}</Text>
            </View>
          </View>
        </View>

        <View style={[styles.playerSheet, { backgroundColor: C.s1, borderColor: C.border, paddingBottom: Math.max(insets.bottom, 14) }] }>
          <View style={[styles.handle, { backgroundColor: C.border2 }]} />
          {status === 'off_route' || status === 'location_unavailable' ? (
            <View style={[styles.alert, { borderColor: C.orange + '55', backgroundColor: C.orange + '10' }] }>
              <Ionicons name={status === 'off_route' ? 'git-compare-outline' : 'location-outline'} size={18} color={C.orange} />
              <View style={styles.alertCopy}>
                <Text style={[styles.alertTitle, { color: C.text }]}>{status === 'off_route' ? 'Auto-play paused off route' : 'Waiting for a reliable GPS fix'}</Text>
                <Text style={[styles.alertBody, { color: C.text2 }]}>{session.message || (status === 'off_route' ? 'Rejoin the published route and the next story will re-arm.' : 'Stories remain queued and will not be skipped.')}</Text>
              </View>
            </View>
          ) : null}

          <View style={styles.progressHeader}>
            <Text style={[styles.progressLabel, { color: C.text2 }]}>{session.playedCount} of {session.totalCount} stories heard</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Open all stories" onPress={() => setStoriesVisible(true)} style={styles.storiesAction}>
              <Text style={[styles.storiesActionText, { color: C.orange }]}>Stories</Text>
              <Ionicons name="list" size={15} color={C.orange} />
            </TouchableOpacity>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: C.s3 }] }>
            <View style={[styles.progressFill, { width: `${Math.max(1, Math.round(session.progress * 100))}%`, backgroundColor: C.orange }]} />
          </View>

          <View style={styles.nowPlaying}>
            <View style={[styles.storyIcon, { backgroundColor: C.orange + '18', borderColor: C.orange + '45' }] }>
              <Ionicons name={isPaused ? 'pause' : 'headset'} size={23} color={C.orange} />
            </View>
            <View style={styles.nowCopy}>
              <Text style={[styles.nowKicker, { color: C.orange }]}>{isPaused ? 'PAUSED BY YOU' : session.currentStory ? 'NOW PLAYING' : 'UP NEXT'}</Text>
              <Text style={[styles.nowTitle, { color: C.text }]} numberOfLines={2}>{currentStory?.title || 'Continue along the route'}</Text>
              <Text style={[styles.nowMeta, { color: C.text3 }]}>{currentStory?.durationLabel || 'Waiting for the next trigger'}</Text>
            </View>
          </View>

          {currentStory?.transcript && transcriptVisible ? (
            <ScrollView style={styles.transcript} contentContainerStyle={styles.transcriptContent} showsVerticalScrollIndicator={false}>
              <Text style={[styles.transcriptText, { color: C.text2 }]}>{currentStory.transcript}</Text>
            </ScrollView>
          ) : null}

          <View style={styles.controls}>
            <PlayerControl icon="play-back" label="Replay" disabled={!currentStory?.replayable} onPress={() => currentStory?.replayable && void originalsRuntime.replayStory(currentStory.id)} />
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={isPaused ? 'Resume narration' : 'Pause narration'}
              onPress={() => void togglePause()}
              style={[styles.playButton, { backgroundColor: C.orange }]}
            >
              <Ionicons name={isPaused ? 'play' : 'pause'} size={30} color="#FFFFFF" />
            </TouchableOpacity>
            <PlayerControl icon="play-forward" label="Skip" onPress={() => void originalsRuntime.skipCurrentStory()} />
          </View>

          <View style={styles.secondaryControls}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={transcriptVisible ? 'Hide transcript' : 'Show transcript'} onPress={() => setTranscriptVisible(value => !value)} style={[styles.secondaryButton, { borderColor: C.border }] }>
              <Ionicons name="text-outline" size={16} color={C.text2} />
              <Text style={[styles.secondaryLabel, { color: C.text2 }]}>{transcriptVisible ? 'Hide captions' : 'Show captions'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="End tour"
              onPress={() => Alert.alert('End this tour?', 'Your progress is saved and can be resumed later.', [
                { text: 'Keep touring', style: 'cancel' },
                { text: 'End for now', onPress: () => void originalsRuntime.pauseTour().then(() => router.replace({ pathname: '/originals/[id]', params: { id, version: String(session.version) } } as any)) },
              ])}
              style={[styles.secondaryButton, { borderColor: C.border }]}
            >
              <Ionicons name="flag-outline" size={16} color={C.text2} />
              <Text style={[styles.secondaryLabel, { color: C.text2 }]}>End tour</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>

      <StoriesModal visible={storiesVisible} detail={playerDetail} completed={completedStories} onClose={() => setStoriesVisible(false)} onReplay={storyId => void originalsRuntime.replayStory(storyId)} />
    </View>
  );
}

function PlayerControl({ icon, label, disabled = false, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; disabled?: boolean; onPress: () => void }) {
  const C = useTheme();
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={styles.smallControl}>
      <Ionicons name={icon} size={23} color={disabled ? C.text3 : C.text2} />
      <Text style={[styles.smallControlLabel, { color: disabled ? C.text3 : C.text2 }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function StoriesModal({
  visible,
  detail,
  completed,
  onClose,
  onReplay,
}: {
  visible: boolean;
  detail: OriginalUiDetail;
  completed: OriginalUiStory[];
  onClose: () => void;
  onReplay: (storyId: string) => void;
}) {
  const C = useTheme();
  const completedIds = new Set(completed.map(story => story.id));
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.storySheet, { backgroundColor: C.s1, borderColor: C.border }] }>
          <View style={styles.storySheetHeader}>
            <View style={styles.storySheetCopy}>
              <Text style={[styles.storySheetKicker, { color: C.orange }]}>DRIVE STORIES</Text>
              <Text style={[styles.storySheetTitle, { color: C.text }]}>{detail.title}</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close stories" onPress={onClose} style={styles.storySheetClose}>
              <Ionicons name="close" size={21} color={C.text2} />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {detail.stories.map(story => {
              const heard = completedIds.has(story.id) || Boolean(story.completed || story.skipped);
              const replayable = Boolean(story.replayable || heard || story.missed);
              return (
                <TouchableOpacity
                  key={story.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${replayable ? 'Replay' : 'Unavailable'} story ${story.sequence}, ${story.title}`}
                  accessibilityState={{ disabled: !replayable }}
                  disabled={!replayable}
                  onPress={() => replayable && onReplay(story.id)}
                  style={[styles.storyModalRow, { borderBottomColor: C.border }]}
                >
                  <View style={[styles.storyModalSequence, { backgroundColor: heard ? C.orange + '18' : C.s2, borderColor: heard ? C.orange + '50' : C.border }] }>
                    <Ionicons name={heard ? 'checkmark' : story.missed ? 'play-skip-forward' : 'headset-outline'} size={16} color={heard ? C.orange : C.text3} />
                  </View>
                  <View style={styles.storyModalCopy}>
                    <Text style={[styles.storyModalTitle, { color: C.text }]}>{story.sequence}. {story.title}</Text>
                    <Text style={[styles.storyModalMeta, { color: C.text3 }]}>{story.missed ? 'Missed · tap to play safely' : story.skipped ? 'Skipped · tap to replay' : heard ? 'Heard · tap to replay' : `${story.durationLabel} · ahead`}</Text>
                  </View>
                  <Ionicons name="play-circle-outline" size={21} color={heard || story.missed ? C.orange : C.text3} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function CompletionState({ detail, session, onStories }: { detail: OriginalUiDetail; session: OriginalUiSession; onStories: () => void }) {
  const C = useTheme();
  const router = useRouter();
  return (
    <SafeAreaView style={[styles.completion, { backgroundColor: C.bg }] }>
      <LinearGradient colors={[C.s1, C.bg]} style={StyleSheet.absoluteFillObject} />
      <View style={[styles.completionMark, { backgroundColor: C.orange + '18', borderColor: C.orange + '55' }] }>
        <Ionicons name="checkmark" size={39} color={C.orange} />
      </View>
      <Text style={[styles.completionKicker, { color: C.orange }]}>ORIGINAL COMPLETE</Text>
      <Text style={[styles.completionTitle, { color: C.text }]}>{detail.title}</Text>
      <Text style={[styles.completionBody, { color: C.text2 }]}>Progress is saved. Replay missed stories when parked.</Text>
      <View style={styles.completionMetrics}>
        <View style={[styles.completionMetric, { backgroundColor: C.s1, borderColor: C.border }] }>
          <Text style={[styles.completionValue, { color: C.text }]}>{session.playedCount}</Text>
          <Text style={[styles.completionLabel, { color: C.text3 }]}>HEARD</Text>
        </View>
        <View style={[styles.completionMetric, { backgroundColor: C.s1, borderColor: C.border }] }>
          <Text style={[styles.completionValue, { color: C.text }]}>{session.missedCount}</Text>
          <Text style={[styles.completionLabel, { color: C.text3 }]}>MISSED</Text>
        </View>
        <View style={[styles.completionMetric, { backgroundColor: C.s1, borderColor: C.border }] }>
          <Text style={[styles.completionValue, { color: C.text }]}>{detail.distanceLabel}</Text>
          <Text style={[styles.completionLabel, { color: C.text3 }]}>ROUTE</Text>
        </View>
      </View>
      <TouchableOpacity accessibilityRole="button" onPress={onStories} style={[styles.completionPrimary, { backgroundColor: C.orange }] }>
        <Ionicons name="headset-outline" size={18} color="#FFFFFF" />
        <Text style={styles.completionPrimaryText}>Review stories</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" onPress={() => router.replace('/(tabs)/trips' as any)} style={[styles.completionSecondary, { borderColor: C.border }] }>
        <Text style={[styles.completionSecondaryText, { color: C.text2 }]}>Back to Trips</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  centerText: { marginTop: 10, fontSize: 12, fontWeight: '700' },
  recoveryButton: { minHeight: 44, marginTop: 18, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  recoveryText: { fontSize: 11, fontWeight: '900' },
  topBar: { minHeight: 64, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  roundButton: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,5,5,0.48)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  topCopy: { flex: 1, minWidth: 0, alignItems: 'center' },
  topKicker: { color: '#F2A47C', fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 0.9 },
  topTitle: { color: '#FFFFFF', marginTop: 2, fontSize: 15, lineHeight: 19, fontWeight: '900' },
  mapStage: { flex: 1, minHeight: 230, overflow: 'hidden' },
  mapStatusRow: { position: 'absolute', left: 16, right: 16, bottom: 12, flexDirection: 'row', gap: 7 },
  offlineBadge: { minHeight: 28, borderRadius: 999, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(8,8,8,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  gpsBadge: { minHeight: 28, borderRadius: 999, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(8,8,8,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  gpsDot: { width: 7, height: 7, borderRadius: 4 },
  offlineText: { color: '#FFFFFF', fontSize: 8, fontWeight: '900', letterSpacing: 0.6 },
  playerSheet: { maxHeight: '60%', borderTopLeftRadius: 25, borderTopRightRadius: 25, borderWidth: 1, paddingHorizontal: 18, paddingTop: 9, gap: 10 },
  handle: { width: 42, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 1 },
  alert: { borderWidth: 1, borderRadius: 13, padding: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  alertCopy: { flex: 1, minWidth: 0 },
  alertTitle: { fontSize: 11.5, lineHeight: 15, fontWeight: '900' },
  alertBody: { marginTop: 2, fontSize: 10, lineHeight: 14, fontWeight: '600' },
  progressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  progressLabel: { fontSize: 10.5, lineHeight: 14, fontWeight: '800' },
  storiesAction: { minHeight: 44, minWidth: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  storiesActionText: { fontSize: 10.5, fontWeight: '900' },
  progressTrack: { height: 6, borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999 },
  nowPlaying: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  storyIcon: { width: 46, height: 46, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  nowCopy: { flex: 1, minWidth: 0 },
  nowKicker: { fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 0.8 },
  nowTitle: { marginTop: 2, fontSize: 17, lineHeight: 21, fontWeight: '900' },
  nowMeta: { marginTop: 2, fontSize: 10, lineHeight: 14, fontWeight: '700' },
  transcript: { maxHeight: 88 },
  transcriptContent: { paddingVertical: 3 },
  transcriptText: { fontSize: 11.5, lineHeight: 18, fontWeight: '600' },
  controls: { minHeight: 69, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 30 },
  smallControl: { minWidth: 54, minHeight: 54, alignItems: 'center', justifyContent: 'center', gap: 3 },
  smallControlLabel: { fontSize: 9, fontWeight: '800' },
  playButton: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center' },
  secondaryControls: { flexDirection: 'row', gap: 8 },
  secondaryButton: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  secondaryLabel: { fontSize: 10, fontWeight: '800' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.56)' },
  storySheet: { maxHeight: '82%', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24 },
  storySheetHeader: { minHeight: 56, flexDirection: 'row', alignItems: 'center' },
  storySheetCopy: { flex: 1, minWidth: 0 },
  storySheetKicker: { fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 0.8 },
  storySheetTitle: { marginTop: 2, fontSize: 18, lineHeight: 22, fontWeight: '900' },
  storySheetClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  storyModalRow: { minHeight: 66, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 10 },
  storyModalSequence: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  storyModalCopy: { flex: 1, minWidth: 0 },
  storyModalTitle: { fontSize: 12.5, lineHeight: 17, fontWeight: '800' },
  storyModalMeta: { marginTop: 2, fontSize: 10, lineHeight: 14, fontWeight: '600' },
  completion: { flex: 1, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  completionMark: { width: 78, height: 78, borderRadius: 39, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  completionKicker: { marginTop: 20, fontSize: 9, lineHeight: 12, fontWeight: '900', letterSpacing: 1 },
  completionTitle: { marginTop: 6, fontSize: 28, lineHeight: 34, fontWeight: '900', textAlign: 'center', letterSpacing: -0.6 },
  completionBody: { marginTop: 8, maxWidth: 340, fontSize: 12, lineHeight: 19, fontWeight: '600', textAlign: 'center' },
  completionMetrics: { width: '100%', marginTop: 24, flexDirection: 'row', gap: 8 },
  completionMetric: { flex: 1, minHeight: 72, borderWidth: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  completionValue: { fontSize: 17, lineHeight: 21, fontWeight: '900' },
  completionLabel: { marginTop: 3, fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 0.7 },
  completionPrimary: { width: '100%', minHeight: 50, marginTop: 22, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  completionPrimaryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  completionSecondary: { width: '100%', minHeight: 48, marginTop: 9, borderWidth: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  completionSecondaryText: { fontSize: 11.5, fontWeight: '900' },
});
