import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/design';
import { useStore } from '@/lib/store';
import {
  originalBundleStore,
  originalVersionAccessIsExact,
  originalsApi,
  useOriginalsRuntime,
  type OriginalOwnerScope,
} from '@/lib/originals';
import { TrailheadButton, TrailheadMetricRow, TrailheadPrompt } from '@/components/TrailheadUI';
import OriginalArtwork from '@/components/originals/OriginalArtwork';
import OriginalRouteMap from '@/components/originals/OriginalRouteMap';
import { getOriginalBundleState, getOriginalDetail } from '@/components/originals/originalsUiService';
import type { OriginalUiBundleState, OriginalUiDetail } from '@/components/originals/types';

const EMPTY_BUNDLE: OriginalUiBundleState = {
  state: 'not_downloaded',
  progress: 0,
  downloadedBytes: 0,
  totalBytes: 0,
};

export default function OriginalDetailScreen() {
  const C = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string | string[]; version?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id || '';
  const versionValue = Array.isArray(params.version) ? params.version[0] : params.version;
  const requestedVersion = Number.isFinite(Number(versionValue)) ? Number(versionValue) : undefined;
  const user = useStore(state => state.user);
  const hasPlan = useStore(state => state.hasPlan);
  const originalsRuntime = useOriginalsRuntime();
  const [detail, setDetail] = useState<OriginalUiDetail | null>(null);
  const [bundle, setBundle] = useState<OriginalUiBundleState>(EMPTY_BUNDLE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [readinessVisible, setReadinessVisible] = useState(false);
  const [startVisible, setStartVisible] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const next = await getOriginalDetail(id, requestedVersion);
      setDetail(next);
      setBundle(await getOriginalBundleState(next.id, next.version));
    } catch (loadError: any) {
      setError(loadError?.message || 'This Original could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [id, requestedVersion]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const progress = originalsRuntime.downloadProgress;
    if (progress && detail) {
      setBundle({
        state: 'downloading',
        progress: progress.percentage / 100,
        downloadedBytes: progress.completed_bytes,
        totalBytes: progress.total_bytes,
      });
      return;
    }
    const activeScope = user?.id == null ? 'guest' : `account:${String(user.id)}`;
    if (
      detail
      && originalsRuntime.bundle?.pack_id === detail.id
      && originalsRuntime.bundle.owner_scope === activeScope
      && originalsRuntime.bundle.version === detail.version
    ) {
      setBundle({
        state: 'ready',
        progress: 1,
        downloadedBytes: originalsRuntime.bundle.total_bytes,
        totalBytes: originalsRuntime.bundle.total_bytes,
      });
    }
  }, [detail, originalsRuntime.bundle, originalsRuntime.downloadProgress, originalsRuntime.manifest?.pack_id, user?.id]);

  const price = useMemo(() => {
    if (!detail || detail.priceCredits === 0) return 0;
    return hasPlan ? detail.explorerPriceCredits || detail.priceCredits : detail.priceCredits;
  }, [detail, hasPlan]);
  const canClaimFeatured = Boolean(detail?.featured && detail.priceCredits > 0 && hasPlan && user);

  const acquire = useCallback(async () => {
    if (!detail) return;
    if (detail.priceCredits > 0 && !user) {
      router.push({ pathname: '/(tabs)/profile', params: { auth: 'login', returnTo: `/originals/${detail.id}` } } as any);
      return;
    }
    setBusy(true);
    try {
      const result = canClaimFeatured
        ? await originalsRuntime.claimFeaturedOriginal(`original-featured:${new Date().toISOString().slice(0, 7)}:${detail.id}:${detail.version}`)
        : await originalsRuntime.acquireOriginal(detail.id, detail.version, `original:${detail.id}:${detail.version}`);
      if (!originalVersionAccessIsExact(result.pack.version, detail.version)) {
        Alert.alert(
          `Version ${result.pack.version} is yours`,
          `This page is version ${detail.version}. Ownership is version-specific, so it has not been unlocked.`,
          [
            { text: 'Stay here', style: 'cancel' },
            {
              text: `Open version ${result.pack.version}`,
              onPress: () => router.replace({
                pathname: '/originals/[id]',
                params: { id: String(result.pack.id), version: String(result.pack.version) },
              } as any),
            },
          ],
        );
        return;
      }
      setDetail(current => current ? { ...current, access: 'owned' } : current);
      setReadinessVisible(true);
    } catch (acquireError: any) {
      Alert.alert('Original not unlocked', acquireError?.message || 'Check your connection and credit balance, then try again.');
    } finally {
      setBusy(false);
    }
  }, [canClaimFeatured, detail, originalsRuntime, router, user]);

  const startDownload = useCallback(async () => {
    if (!detail || bundle.state === 'downloading') return;
    setBundle(current => ({ ...current, state: 'downloading', error: undefined }));
    try {
      const manifest = await originalsApi.manifest(detail.id, detail.version);
      const record = await originalsRuntime.downloadOriginal(manifest);
      setBundle({
        state: 'ready',
        progress: 1,
        downloadedBytes: record.total_bytes,
        totalBytes: record.total_bytes,
      });
    } catch (downloadError: any) {
      setBundle(current => ({
        ...current,
        state: 'error',
        error: downloadError?.message || 'The offline package was not saved. Try again on a stable connection.',
      }));
    }
  }, [bundle.state, detail, originalsRuntime]);

  const beginStart = useCallback(async () => {
    if (!detail) return;
    try {
      const scope = (user?.id == null ? 'guest' : `account:${String(user.id)}`) as OriginalOwnerScope;
      const manifest = await originalBundleStore.loadManifest(scope, detail.id, detail.version);
      if (!manifest) throw new Error('Download and verify this Original before starting.');
      await originalsRuntime.startTour(manifest);
      setStartVisible(false);
      router.replace({ pathname: '/originals/player', params: { id: detail.id, version: String(detail.version) } } as any);
    } catch (startError: any) {
      throw startError;
    }
  }, [detail, originalsRuntime, router, user?.id]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: C.bg }] }>
        <ActivityIndicator color={C.orange} />
        <Text style={[styles.loadingText, { color: C.text2 }]}>Opening Trailhead Original</Text>
      </SafeAreaView>
    );
  }

  if (!detail || error) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: C.bg }] }>
        <Ionicons name="map-outline" size={30} color={C.text3} />
        <Text style={[styles.errorTitle, { color: C.text }]}>Original unavailable</Text>
        <Text style={[styles.errorBody, { color: C.text2 }]}>{error || 'This drive is not available.'}</Text>
        <View style={styles.errorActions}>
          <TrailheadButton label="Back" icon="chevron-back" onPress={() => router.back()} />
          <TrailheadButton label="Try again" icon="refresh" variant="primary" onPress={() => void load()} />
        </View>
      </SafeAreaView>
    );
  }

  const ready = bundle.state === 'ready';
  const owned = detail.access === 'owned';
  const primaryLabel = !owned
    ? canClaimFeatured
      ? 'Claim monthly Original'
      : detail.priceCredits === 0
      ? 'Get free Original'
      : user
        ? `Get for ${price} credits`
        : `Sign in to unlock · ${detail.priceCredits} credits`
    : !ready
      ? bundle.state === 'update_available'
        ? 'Update Original'
        : `Download · ${detail.offlineSizeLabel}`
      : detail.progress && detail.progress > 0
        ? 'Resume tour'
        : 'Start tour';
  const primaryAction = !owned
    ? acquire
    : !ready
      ? () => setReadinessVisible(true)
      : () => setStartVisible(true);

  return (
    <View style={[styles.screen, { backgroundColor: C.bg }] }>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 112, 132) }}>
        <OriginalArtwork imageUrl={detail.heroImageUrl} region={detail.region} />
        <SafeAreaView edges={['top']} style={styles.floatingTop}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.floatingButton}>
            <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Share this Original" onPress={() => Alert.alert('Share', 'Original sharing will use the published Trailhead link.')} style={styles.floatingButton}>
            <Ionicons name="share-outline" size={19} color="#FFFFFF" />
          </TouchableOpacity>
        </SafeAreaView>

        <View style={styles.content}>
          <View style={styles.titleBlock}>
            <View style={styles.creatorRow}>
              <Ionicons name="shield-checkmark" size={15} color={C.orange} />
              <Text style={[styles.creator, { color: C.orange }]}>A TRAILHEAD ORIGINAL</Text>
            </View>
            <Text style={[styles.title, { color: C.text }]}>{detail.title}</Text>
            <Text style={[styles.route, { color: C.text2 }]}>{detail.routeLabel}</Text>
          </View>

          <TrailheadMetricRow metrics={[
            { label: 'DRIVE', value: detail.durationLabel, icon: 'time-outline' },
            { label: 'DISTANCE', value: detail.distanceLabel, icon: 'navigate-outline' },
            { label: 'STORIES', value: String(detail.storyCount), icon: 'headset-outline' },
          ]} />

          <View style={styles.pillRow}>
            <InfoPill icon="car-sport-outline" label={detail.surfaceLabel} />
            <InfoPill icon="calendar-outline" label={detail.seasonLabel} />
            <InfoPill icon="cloud-download-outline" label={detail.offlineSizeLabel} />
          </View>

          <View style={styles.routePreviewSection}>
            <View style={styles.routePreviewHeading}>
              <Text style={[styles.sectionTitle, { color: C.text }]}>Published route</Text>
              <Text style={[styles.routePreviewMeta, { color: C.text3 }]}>{detail.distanceLabel} · fixed direction</Text>
            </View>
            <View style={[styles.routePreview, { borderColor: C.border }] }>
              <OriginalRouteMap route={detail.route} projectedProgressM={null} overview />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: C.text }]}>The drive</Text>
            <Text style={[styles.body, { color: C.text2 }]}>{detail.overview}</Text>
            <View style={styles.highlightList}>
              {detail.highlights.map(highlight => (
                <View key={highlight} style={styles.highlightRow}>
                  <View style={[styles.highlightDot, { backgroundColor: C.orange }]} />
                  <Text style={[styles.highlightText, { color: C.text2 }]}>{highlight}</Text>
                </View>
              ))}
            </View>
          </View>

          {detail.previewStory ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`${previewExpanded ? 'Collapse' : 'Read'} story preview: ${detail.previewStory.title}`}
              accessibilityState={{ expanded: previewExpanded }}
              activeOpacity={0.78}
              onPress={() => setPreviewExpanded(value => !value)}
              style={[styles.preview, { borderColor: C.border, backgroundColor: C.s1 }]}
            >
              <View style={styles.previewTop}>
                <View style={[styles.previewIcon, { backgroundColor: C.orange }] }>
                  <Ionicons name="reader-outline" size={18} color="#FFFFFF" />
                </View>
                <View style={styles.previewCopy}>
                  <Text style={[styles.previewKicker, { color: C.orange }]}>STORY PREVIEW · {detail.previewStory.durationLabel}</Text>
                  <Text style={[styles.previewTitle, { color: C.text }]}>{detail.previewStory.title}</Text>
                </View>
                <Ionicons name={previewExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={C.text3} />
              </View>
              <Text style={[styles.previewTranscript, { color: C.text2 }]} numberOfLines={previewExpanded ? undefined : 3}>{detail.previewStory.transcript}</Text>
            </TouchableOpacity>
          ) : null}

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: C.text }]}>Along the way</Text>
            <View style={[styles.storyList, { borderTopColor: C.border }] }>
              {detail.stories.slice(0, 12).map((story, index) => (
                <View key={story.id} style={[styles.storyRow, { borderBottomColor: C.border }] }>
                  <View style={[styles.storySequence, { backgroundColor: index === 0 ? C.orange : C.s2, borderColor: index === 0 ? C.orange : C.border }] }>
                    <Text style={[styles.storySequenceText, { color: index === 0 ? '#FFFFFF' : C.text2 }]}>{story.sequence}</Text>
                  </View>
                  <View style={styles.storyCopy}>
                    <Text style={[styles.storyTitle, { color: C.text }]}>{story.title}</Text>
                    <Text style={[styles.storyMeta, { color: C.text3 }]}>{story.durationLabel} · plays automatically on route</Text>
                  </View>
                  <Ionicons name="headset-outline" size={17} color={C.text3} />
                </View>
              ))}
            </View>
          </View>

          <TrailheadPrompt
            icon="shield-checkmark-outline"
            tone={C.orange}
            title="Drive first"
            body="Passenger use recommended. Audio pauses for navigation and calls."
          />

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: C.text }]}>Know before you go</Text>
            {[...detail.safetyNotes, ...detail.accessNotes].map(note => (
              <View key={note} style={styles.noteRow}>
                <Ionicons name="information-circle-outline" size={17} color={C.text3} />
                <Text style={[styles.noteText, { color: C.text2 }]}>{note}</Text>
              </View>
            ))}
          </View>

          {detail.sources.length ? (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: C.text }]}>Sources and review</Text>
              <Text style={[styles.sourceIntro, { color: C.text2 }]}>Scripts are human-written and fact-checked against the sources below. Access conditions can change.</Text>
              {detail.sources.map(source => (
                <TouchableOpacity
                  key={`${source.label}:${source.url || ''}`}
                  accessibilityRole={source.url ? 'link' : 'text'}
                  disabled={!source.url}
                  onPress={() => source.url && Linking.openURL(source.url)}
                  style={[styles.sourceRow, { borderBottomColor: C.border }]}
                >
                  <Ionicons name="document-text-outline" size={16} color={C.text3} />
                  <Text style={[styles.sourceLabel, { color: C.text2 }]}>{source.label}</Text>
                  {source.url ? <Ionicons name="open-outline" size={15} color={C.orange} /> : null}
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>

      <View style={[styles.dock, { backgroundColor: C.s1, borderTopColor: C.border, paddingBottom: Math.max(insets.bottom, 12) }] }>
        <View style={styles.dockCopy}>
          <Text style={[styles.dockPrice, { color: owned || canClaimFeatured ? C.orange : C.text }]}>{owned ? 'Yours permanently' : canClaimFeatured ? 'Included this month' : detail.priceCredits === 0 ? 'Free' : `${price} credits`}</Text>
          <Text style={[styles.dockMeta, { color: C.text3 }]}>{owned ? bundleLabel(bundle) : canClaimFeatured ? 'Explorer monthly claim' : detail.priceCredits === 0 ? 'No account required' : user ? `${user.credits} credits available` : 'Account required'}</Text>
        </View>
        <TrailheadButton label={primaryLabel} icon={ready ? 'play' : !owned ? detail.priceCredits === 0 ? 'gift-outline' : 'ticket-outline' : 'cloud-download'} variant="primary" loading={busy} onPress={() => void primaryAction()} style={styles.primary} />
      </View>

      <ReadinessModal
        visible={readinessVisible}
        detail={detail}
        bundle={bundle}
        onClose={() => bundle.state !== 'downloading' && setReadinessVisible(false)}
        onDownload={() => void startDownload()}
        onStart={() => { setReadinessVisible(false); setStartVisible(true); }}
      />
      <StartTourModal visible={startVisible} detail={detail} onClose={() => setStartVisible(false)} onStart={beginStart} />
    </View>
  );
}

function InfoPill({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const C = useTheme();
  return (
    <View style={[styles.pill, { backgroundColor: C.s2, borderColor: C.border }] }>
      <Ionicons name={icon} size={13} color={C.text3} />
      <Text style={[styles.pillText, { color: C.text2 }]}>{label}</Text>
    </View>
  );
}

function bundleLabel(bundle: OriginalUiBundleState) {
  if (bundle.state === 'ready') return 'Downloaded and ready offline';
  if (bundle.state === 'update_available') return `Version ${bundle.installedVersion ?? 'older'} saved · update required`;
  if (bundle.state === 'downloading') return `${Math.round(bundle.progress * 100)}% downloaded`;
  if (bundle.state === 'error') return 'Download needs attention';
  return 'Offline package required';
}

function ReadinessModal({
  visible,
  detail,
  bundle,
  onClose,
  onDownload,
  onStart,
}: {
  visible: boolean;
  detail: OriginalUiDetail;
  bundle: OriginalUiBundleState;
  onClose: () => void;
  onDownload: () => void;
  onStart: () => void;
}) {
  const C = useTheme();
  const ready = bundle.state === 'ready';
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.sheet, { backgroundColor: C.s1, borderColor: C.border }] }>
          <View style={[styles.handle, { backgroundColor: C.border2 }]} />
          <View style={styles.sheetTitleRow}>
            <View style={[styles.sheetIcon, { backgroundColor: C.orange + '18' }] }>
              <Ionicons name={ready ? 'checkmark-circle' : 'cloud-download-outline'} size={23} color={C.orange} />
            </View>
            <View style={styles.sheetCopy}>
              <Text style={[styles.sheetKicker, { color: C.orange }]}>{ready ? 'READY OFFLINE' : bundle.state === 'update_available' ? 'UPDATE REQUIRED' : 'OFFLINE PACKAGE'}</Text>
              <Text style={[styles.sheetTitle, { color: C.text }]}>{ready ? 'Everything is on this device' : bundle.state === 'update_available' ? `Download version ${detail.version}` : `Download ${detail.offlineSizeLabel}`}</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" disabled={bundle.state === 'downloading'} onPress={onClose} style={styles.sheetClose}>
              <Ionicons name="close" size={20} color={C.text2} />
            </TouchableOpacity>
          </View>

          <View style={styles.assetList}>
            <AssetRow icon="map-outline" label="Fixed route and offline map region" ready={ready} />
            <AssetRow icon="headset-outline" label={`${detail.storyCount} narrations and transcripts`} ready={ready} />
            <AssetRow icon="images-outline" label="Story artwork and source notes" ready={ready} />
          </View>

          {bundle.state === 'downloading' ? (
            <View style={styles.progressBlock}>
              <View style={[styles.progressTrack, { backgroundColor: C.s3 }] }>
                <View style={[styles.progressFill, { width: `${Math.max(2, Math.round(bundle.progress * 100))}%`, backgroundColor: C.orange }]} />
              </View>
              <Text accessibilityLiveRegion="polite" style={[styles.progressLabel, { color: C.text2 }]}>{Math.round(bundle.progress * 100)}% · Keep Trailhead open until verification finishes</Text>
            </View>
          ) : bundle.state === 'error' ? (
            <TrailheadPrompt icon="alert-circle-outline" tone={C.red} title="Download interrupted" body={bundle.error} />
          ) : null}

          <Text style={[styles.sheetFootnote, { color: C.text3 }]}>Files are verified before the drive begins.</Text>
          <TrailheadButton
            label={ready ? 'Continue to safety check' : bundle.state === 'update_available' ? 'Update Original' : bundle.state === 'error' ? 'Retry download' : bundle.state === 'downloading' ? 'Downloading' : `Download · ${detail.offlineSizeLabel}`}
            icon={ready ? 'arrow-forward' : 'cloud-download'}
            variant="primary"
            disabled={bundle.state === 'downloading'}
            loading={bundle.state === 'downloading'}
            onPress={ready ? onStart : onDownload}
          />
        </View>
      </View>
    </Modal>
  );
}

function AssetRow({ icon, label, ready }: { icon: keyof typeof Ionicons.glyphMap; label: string; ready: boolean }) {
  const C = useTheme();
  return (
    <View style={[styles.assetRow, { borderBottomColor: C.border }] }>
      <Ionicons name={icon} size={18} color={C.text2} />
      <Text style={[styles.assetLabel, { color: C.text }]}>{label}</Text>
      <Ionicons name={ready ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={ready ? C.orange : C.text3} />
    </View>
  );
}

function StartTourModal({
  visible,
  detail,
  onClose,
  onStart,
}: {
  visible: boolean;
  detail: OriginalUiDetail;
  onClose: () => void;
  onStart: () => Promise<void>;
}) {
  const C = useTheme();
  const [confirmed, setConfirmed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [permissionError, setPermissionError] = useState('');

  useEffect(() => {
    if (!visible) {
      setConfirmed(false);
      setStarting(false);
      setPermissionError('');
    }
  }, [visible]);

  const start = async () => {
    setStarting(true);
    setPermissionError('');
    try {
      await onStart();
    } catch (error: any) {
      setPermissionError(error?.message || `Trailhead needs ${Platform.OS === 'ios' ? 'background' : 'precise'} location while this tour is active.`);
      setStarting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.sheet, { backgroundColor: C.s1, borderColor: C.border }] }>
          <View style={[styles.handle, { backgroundColor: C.border2 }]} />
          <View style={styles.sheetTitleRow}>
            <View style={[styles.sheetIcon, { backgroundColor: C.orange + '18' }] }>
              <Ionicons name="navigate" size={23} color={C.orange} />
            </View>
            <View style={styles.sheetCopy}>
              <Text style={[styles.sheetKicker, { color: C.orange }]}>BEFORE YOU DRIVE</Text>
              <Text style={[styles.sheetTitle, { color: C.text }]}>Start {detail.title}</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" disabled={starting} onPress={onClose} style={styles.sheetClose}>
              <Ionicons name="close" size={20} color={C.text2} />
            </TouchableOpacity>
          </View>

          <View style={styles.permissionList}>
            <PermissionRow icon="location-outline" title="Location while touring" body="Used on-device to trigger the next story. Trailhead does not upload your route." />
            <PermissionRow icon="notifications-outline" title="Screen-off indicator" body={Platform.OS === 'android' ? 'Android shows a persistent notification while the tour is active.' : 'iOS shows the standard location indicator while the tour is active.'} />
            <PermissionRow icon="volume-high-outline" title="Audio check" body="Connect Bluetooth before departing. Navigation and calls take priority over stories." />
          </View>

          <TouchableOpacity
            accessibilityRole="checkbox"
            accessibilityState={{ checked: confirmed }}
            accessibilityLabel="I am parked or a passenger will manage the phone"
            activeOpacity={0.78}
            onPress={() => setConfirmed(value => !value)}
            style={[styles.confirmRow, { borderColor: confirmed ? C.orange + '70' : C.border, backgroundColor: confirmed ? C.orange + '0D' : C.s2 }]}
          >
            <Ionicons name={confirmed ? 'checkbox' : 'square-outline'} size={22} color={confirmed ? C.orange : C.text3} />
            <Text style={[styles.confirmText, { color: C.text }]}>I’m parked, or a passenger will manage the phone.</Text>
          </TouchableOpacity>

          {permissionError ? (
            <View style={styles.permissionError}>
              <TrailheadPrompt
                icon="location-outline"
                tone={C.red}
                title="Location permission is off"
                body={permissionError}
                action={<TouchableOpacity accessibilityRole="button" onPress={() => Linking.openSettings()} style={styles.settingsAction}><Text style={[styles.settingsText, { color: C.orange }]}>Settings</Text></TouchableOpacity>}
              />
            </View>
          ) : null}

          <TrailheadButton label="Start hands-free tour" icon="play" variant="primary" disabled={!confirmed} loading={starting} onPress={() => void start()} />
        </View>
      </View>
    </Modal>
  );
}

function PermissionRow({ icon, title, body }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }) {
  const C = useTheme();
  return (
    <View style={styles.permissionRow}>
      <View style={[styles.permissionIcon, { backgroundColor: C.s2, borderColor: C.border }] }>
        <Ionicons name={icon} size={18} color={C.text2} />
      </View>
      <View style={styles.permissionCopy}>
        <Text style={[styles.permissionTitle, { color: C.text }]}>{title}</Text>
        <Text style={[styles.permissionBody, { color: C.text2 }]}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 10, fontSize: 12, fontWeight: '700' },
  errorTitle: { marginTop: 11, fontSize: 20, lineHeight: 25, fontWeight: '900' },
  errorBody: { marginTop: 5, fontSize: 12, lineHeight: 18, fontWeight: '600', textAlign: 'center' },
  errorActions: { marginTop: 18, flexDirection: 'row', gap: 10 },
  floatingTop: { position: 'absolute', top: 0, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  floatingButton: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(8,8,8,0.68)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  content: { paddingHorizontal: 18, paddingTop: 20, gap: 22 },
  titleBlock: { gap: 5 },
  creatorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  creator: { fontSize: 8.5, lineHeight: 12, fontWeight: '900', letterSpacing: 0.8 },
  title: { fontSize: 30, lineHeight: 35, fontWeight: '900', letterSpacing: -0.8 },
  route: { fontSize: 13, lineHeight: 19, fontWeight: '700' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  pill: { minHeight: 34, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5 },
  pillText: { fontSize: 10.5, lineHeight: 14, fontWeight: '800' },
  routePreviewSection: { gap: 10 },
  routePreviewHeading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  routePreviewMeta: { flexShrink: 1, fontSize: 9.5, lineHeight: 13, fontWeight: '800', textAlign: 'right' },
  routePreview: { height: 218, borderWidth: 1, borderRadius: 18, overflow: 'hidden', backgroundColor: '#050505' },
  section: { gap: 10 },
  sectionTitle: { fontSize: 19, lineHeight: 24, fontWeight: '900', letterSpacing: -0.25 },
  body: { fontSize: 13, lineHeight: 20, fontWeight: '600' },
  highlightList: { gap: 8 },
  highlightRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  highlightDot: { width: 6, height: 6, marginTop: 7, borderRadius: 3 },
  highlightText: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 19, fontWeight: '700' },
  preview: { borderWidth: 1, borderRadius: 18, padding: 15, gap: 12 },
  previewTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  previewIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  previewCopy: { flex: 1, minWidth: 0 },
  previewKicker: { fontSize: 8.5, lineHeight: 12, fontWeight: '900', letterSpacing: 0.7 },
  previewTitle: { marginTop: 2, fontSize: 15, lineHeight: 20, fontWeight: '900' },
  previewTranscript: { fontSize: 12, lineHeight: 19, fontWeight: '600' },
  storyList: { borderTopWidth: StyleSheet.hairlineWidth },
  storyRow: { minHeight: 65, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 10 },
  storySequence: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  storySequenceText: { fontSize: 11, fontWeight: '900' },
  storyCopy: { flex: 1, minWidth: 0 },
  storyTitle: { fontSize: 13, lineHeight: 17, fontWeight: '800' },
  storyMeta: { marginTop: 2, fontSize: 10.5, lineHeight: 14, fontWeight: '600' },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  noteText: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 18, fontWeight: '600' },
  sourceIntro: { fontSize: 11.5, lineHeight: 17, fontWeight: '600' },
  sourceRow: { minHeight: 50, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 9 },
  sourceLabel: { flex: 1, minWidth: 0, fontSize: 11.5, lineHeight: 16, fontWeight: '700' },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 88, borderTopWidth: 1, paddingHorizontal: 18, paddingTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  dockCopy: { flex: 1, minWidth: 0 },
  dockPrice: { fontSize: 13, lineHeight: 17, fontWeight: '900' },
  dockMeta: { marginTop: 2, fontSize: 9.5, lineHeight: 13, fontWeight: '700' },
  primary: { minWidth: 176 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.54)' },
  sheet: { maxHeight: '92%', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 24, gap: 16 },
  handle: { width: 42, height: 4, borderRadius: 2, alignSelf: 'center' },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  sheetIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  sheetCopy: { flex: 1, minWidth: 0 },
  sheetKicker: { fontSize: 8.5, lineHeight: 12, fontWeight: '900', letterSpacing: 0.8 },
  sheetTitle: { marginTop: 2, fontSize: 18, lineHeight: 23, fontWeight: '900' },
  sheetClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  assetList: { gap: 0 },
  assetRow: { minHeight: 51, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 10 },
  assetLabel: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  progressBlock: { gap: 7 },
  progressTrack: { height: 7, borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999 },
  progressLabel: { fontSize: 10.5, lineHeight: 15, fontWeight: '700' },
  sheetFootnote: { fontSize: 10.5, lineHeight: 16, fontWeight: '600' },
  permissionList: { gap: 13 },
  permissionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  permissionIcon: { width: 38, height: 38, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  permissionCopy: { flex: 1, minWidth: 0 },
  permissionTitle: { fontSize: 12.5, lineHeight: 17, fontWeight: '900' },
  permissionBody: { marginTop: 2, fontSize: 10.5, lineHeight: 16, fontWeight: '600' },
  confirmRow: { minHeight: 58, borderRadius: 14, borderWidth: 1, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10 },
  confirmText: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  permissionError: { gap: 8 },
  settingsAction: { minWidth: 58, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  settingsText: { fontSize: 10.5, fontWeight: '900' },
});
