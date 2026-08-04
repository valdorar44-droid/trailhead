import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/design';
import { useStore } from '@/lib/store';
import {
  originalBundleStore,
  originalPackVersionAccessIsExact,
  useOriginalsAdminRuntime,
  useOriginalsRuntime,
  type OriginalOwnerScope,
} from '@/lib/originals';
import { TrailheadButton, TrailheadMetricRow, TrailheadPrompt } from '@/components/TrailheadUI';
import OriginalArtwork from '@/components/originals/OriginalArtwork';
import OriginalRouteMap from '@/components/originals/OriginalRouteMap';
import {
  downloadOriginalBundle,
  getOriginalBundleState,
  getOriginalDetail,
  originalPermanentUnlockOffer,
  selectOriginalUiChapter,
} from '@/components/originals/originalsUiService';
import type { OriginalUiBundleState, OriginalUiDetail } from '@/components/originals/types';
import { originalStartDestination } from '@/lib/originals/mainMapNavigation';
import { originalStartNeedsPermissionDisclosure } from '@/lib/originals/locationPolicy';
import { originalShareContent } from '@/lib/originals/shareOriginal';

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
  const accountScope = user?.id == null ? 'guest' : `account:${String(user.id)}`;
  const currentScopeRef = useRef(accountScope);
  currentScopeRef.current = accountScope;
  const loadRequestRef = useRef(0);
  const downloadRequestRef = useRef(0);
  const hasPlan = useStore(state => state.hasPlan);
  const originalsRuntime = useOriginalsRuntime();
  const originalsAdminRuntime = useOriginalsAdminRuntime();
  const [loadedDetail, setLoadedDetail] = useState<OriginalUiDetail | null>(null);
  const [detailScope, setDetailScope] = useState('');
  const baseDetail = detailScope === accountScope ? loadedDetail : null;
  const [selectedChapterId, setSelectedChapterId] = useState('');
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const detail = useMemo(() => (
    baseDetail && selectedChapterId && selectedVariantId
      ? selectOriginalUiChapter(baseDetail, selectedChapterId, selectedVariantId)
      : baseDetail
  ), [baseDetail, selectedChapterId, selectedVariantId]);
  const [bundle, setBundle] = useState<OriginalUiBundleState>(EMPTY_BUNDLE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [readinessVisible, setReadinessVisible] = useState(false);
  const [startVisible, setStartVisible] = useState(false);
  const [showPermissionDisclosure, setShowPermissionDisclosure] = useState(true);
  const [previewExpanded, setPreviewExpanded] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const request = ++loadRequestRef.current;
    const requestScope = accountScope;
    setLoading(true);
    setError('');
    try {
      const next = await getOriginalDetail(id, requestedVersion);
      const nextBundle = await getOriginalBundleState(next.id, next.version);
      if (request !== loadRequestRef.current || currentScopeRef.current !== requestScope) return;
      setLoadedDetail(next);
      setDetailScope(requestScope);
      setSelectedChapterId(next.defaultChapterId || '');
      setSelectedVariantId(next.defaultVariantId || '');
      setBundle(nextBundle);
    } catch (loadError: any) {
      if (request !== loadRequestRef.current || currentScopeRef.current !== requestScope) return;
      setError(loadError?.message || 'This Original could not be loaded.');
    } finally {
      if (request === loadRequestRef.current && currentScopeRef.current === requestScope) setLoading(false);
    }
  }, [accountScope, id, requestedVersion]);

  useEffect(() => {
    void load();
    return () => { loadRequestRef.current += 1; };
  }, [load]);

  useEffect(() => {
    downloadRequestRef.current += 1;
    setBundle(EMPTY_BUNDLE);
    setReadinessVisible(false);
    setStartVisible(false);
    setSelectedChapterId('');
    setSelectedVariantId('');
  }, [accountScope]);

  useEffect(() => {
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
  }, [detail, originalsRuntime.bundle, user?.id]);

  const price = useMemo(() => {
    if (!detail || detail.priceCredits === 0) return 0;
    return hasPlan ? detail.explorerPriceCredits || detail.priceCredits : detail.priceCredits;
  }, [detail, hasPlan]);
  const canClaimFeatured = Boolean(
    detail?.featured
    && !detail.explorerIncluded
    && detail.priceCredits > 0
    && hasPlan
    && user,
  );
  const explorerAccessIncluded = Boolean(detail?.explorerIncluded && hasPlan && user);
  const permanentUnlockOffer = originalPermanentUnlockOffer(detail);

  const acquire = useCallback(async () => {
    if (!detail) return;
    if (detail.priceCredits > 0 && !user) {
      router.push({ pathname: '/(tabs)/profile', params: { auth: 'login', returnTo: `/originals/${detail.id}` } } as any);
      return;
    }
    setBusy(true);
    try {
      const accessMode = explorerAccessIncluded ? 'explorer' : 'permanent';
      const result = canClaimFeatured
        ? await originalsRuntime.claimFeaturedOriginal(`original-featured:${new Date().toISOString().slice(0, 7)}:${detail.id}:${detail.version}`)
        : await originalsRuntime.acquireOriginal(
          detail.id,
          detail.version,
          `original:${detail.id}:${detail.version}:${accessMode}`,
          accessMode,
        );
      if (!originalPackVersionAccessIsExact(
        result.pack.id,
        result.pack.version,
        detail.id,
        detail.version,
      )) {
        Alert.alert(
          `${result.pack.title} is yours`,
          `You acquired version ${result.pack.version} of ${result.pack.title}. This page is ${detail.title} version ${detail.version}, so it has not been unlocked.`,
          [
            { text: 'Stay here', style: 'cancel' },
            {
              text: 'Open acquired Original',
              onPress: () => router.replace({
                pathname: '/originals/[id]',
                params: { id: String(result.pack.id), version: String(result.pack.version) },
              } as any),
            },
          ],
        );
        return;
      }
      const authenticatedResult = 'entitlement' in result ? result : null;
      const acquiredAccessKind = !authenticatedResult
        ? 'guest_free' as const
        : authenticatedResult.entitlement.access_type === 'explorer_subscription'
          ? 'explorer_subscription' as const
          : authenticatedResult.entitlement.permanent === true || accessMode === 'permanent'
            ? 'permanent' as const
            : 'entitled' as const;
      if (authenticatedResult && Number.isFinite(authenticatedResult.credit_balance)) {
        const currentUser = useStore.getState().user;
        if (currentUser && currentUser.id === user?.id) {
          useStore.setState({ user: { ...currentUser, credits: authenticatedResult.credit_balance } });
        }
      }
      setLoadedDetail(current => current ? {
        ...current,
        access: 'owned',
        accessKind: acquiredAccessKind,
      } : current);
      setReadinessVisible(true);
    } catch (acquireError: any) {
      Alert.alert('Original not unlocked', acquireError?.message || 'Check your connection and credit balance, then try again.');
    } finally {
      setBusy(false);
    }
  }, [canClaimFeatured, detail, explorerAccessIncluded, originalsRuntime, router, user]);

  const keepPermanently = useCallback(async () => {
    if (!detail || !permanentUnlockOffer || !user) return;
    setBusy(true);
    try {
      const result = await originalsRuntime.acquireOriginal(
        detail.id,
        detail.version,
        `original:${detail.id}:${detail.version}:permanent`,
        'permanent',
      );
      const authenticatedResult = 'entitlement' in result ? result : null;
      if (
        !authenticatedResult
        || !originalPackVersionAccessIsExact(
          result.pack.id,
          result.pack.version,
          detail.id,
          detail.version,
        )
      ) {
        throw new Error('The permanent access response did not match this Original.');
      }
      const currentUser = useStore.getState().user;
      if (currentUser?.id === user.id && Number.isFinite(authenticatedResult.credit_balance)) {
        useStore.setState({ user: { ...currentUser, credits: authenticatedResult.credit_balance } });
      }
      setLoadedDetail(current => current ? {
        ...current,
        access: 'owned',
        accessKind: 'permanent',
      } : current);
      Alert.alert('Kept permanently', `${detail.title} remains available even without Explorer.`);
    } catch (unlockError: any) {
      Alert.alert(
        'Couldn’t keep this Original',
        unlockError?.message || 'Check your connection and earned-credit balance, then try again.',
      );
    } finally {
      setBusy(false);
    }
  }, [detail, originalsRuntime, permanentUnlockOffer, user]);

  const confirmPermanentUnlock = useCallback(() => {
    if (!detail || !permanentUnlockOffer) return;
    Alert.alert(
      'Keep this Original permanently?',
      `Use ${permanentUnlockOffer.creditCost} earned credits. Your Explorer access remains unchanged.`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: `Use ${permanentUnlockOffer.creditCost} credits`,
          onPress: () => { void keepPermanently(); },
        },
      ],
    );
  }, [detail, keepPermanently, permanentUnlockOffer]);

  const startDownload = useCallback(async () => {
    if (!detail || bundle.state === 'downloading') return;
    const request = ++downloadRequestRef.current;
    const requestScope = accountScope;
    const requestPackId = detail.id;
    const requestVersion = detail.version;
    const requestIsCurrent = () => (
      request === downloadRequestRef.current
      && currentScopeRef.current === requestScope
      && detailScope === requestScope
      && loadedDetail?.id === requestPackId
      && loadedDetail.version === requestVersion
    );
    setBundle(current => ({ ...current, state: 'downloading', error: undefined }));
    try {
      const next = await downloadOriginalBundle(
        requestPackId,
        requestVersion,
        progress => {
          if (requestIsCurrent()) setBundle(progress);
        },
      );
      if (requestIsCurrent()) {
        setBundle(next);
        // Public V2 previews omit route geometry and story transcripts. Once
        // the union bundle is verified, rehydrate silently so the chosen drive
        // is usable immediately without closing and reopening this screen.
        const hydrated = await getOriginalDetail(requestPackId, requestVersion);
        if (requestIsCurrent()) setLoadedDetail(hydrated);
      }
    } catch (downloadError: any) {
      if (!requestIsCurrent()) return;
      setBundle(current => ({
        ...current,
        state: 'error',
        error: downloadError?.message || 'The offline package was not saved. Try again on a stable connection.',
      }));
    }
  }, [accountScope, bundle.state, detail, detailScope, loadedDetail]);

  const beginStart = useCallback(async () => {
    if (!detail) return;
    if (detail.adminPreview) throw new Error('Unpublished Studio drafts can run only in the no-driving trigger test.');
    try {
      if (Platform.OS === 'android') {
        const currentNotifications = await Notifications.getPermissionsAsync();
        const notifications = currentNotifications.status === 'granted'
          ? currentNotifications
          : await Notifications.requestPermissionsAsync();
        if (notifications.status !== 'granted') {
          throw new Error('Allow notifications so Android can show the active-tour location service.');
        }
      }
      const scope = (user?.id == null ? 'guest' : `account:${String(user.id)}`) as OriginalOwnerScope;
      const manifest = await originalBundleStore.loadManifest(scope, detail.id, detail.version);
      if (!manifest) throw new Error('Download and verify this Original before starting.');
      const selection = detail.manifestSchemaVersion === 2
        ? { chapter_id: selectedChapterId, variant_id: selectedVariantId }
        : undefined;
      await originalsRuntime.startTour(manifest, selection);
      setStartVisible(false);
      router.replace(originalStartDestination(detail.id, detail.version) as any);
    } catch (startError: any) {
      throw startError;
    }
  }, [detail, originalsRuntime, router, selectedChapterId, selectedVariantId, user?.id]);

  const beginSimulation = useCallback(async () => {
    if (!detail || !user?.is_admin) return;
    const scope = `account:${String(user.id)}` as OriginalOwnerScope;
    const manifest = await originalBundleStore.loadManifest(scope, detail.id, detail.version);
    if (!manifest) throw new Error('Download and verify this Original before opening the trigger test.');
    const selection = detail.manifestSchemaVersion === 2
      ? { chapter_id: selectedChapterId, variant_id: selectedVariantId }
      : undefined;
    await originalsAdminRuntime.startSimulation(manifest, selection);
    setStartVisible(false);
    router.replace({
      pathname: '/originals/player',
      params: {
        id: detail.id,
        version: String(detail.version),
        simulate: '1',
        chapter: selection?.chapter_id,
        variant: selection?.variant_id,
      },
    } as any);
  }, [detail, originalsAdminRuntime, router, selectedChapterId, selectedVariantId, user?.id, user?.is_admin]);

  const openStart = useCallback(async () => {
    let needsDisclosure = true;
    try {
      const foreground = await Location.getForegroundPermissionsAsync();
      const background = Platform.OS === 'ios'
        ? await Location.getBackgroundPermissionsAsync()
        : null;
      const notifications = Platform.OS === 'android'
        ? await Notifications.getPermissionsAsync()
        : null;
      needsDisclosure = originalStartNeedsPermissionDisclosure(Platform.OS, {
        foregroundGranted: foreground.status === 'granted',
        backgroundGranted: background?.status === 'granted',
        notificationsGranted: notifications?.status === 'granted',
      });
    } catch {
      // If the native permission adapter cannot be inspected, keep the disclosure
      // in front of the runtime request rather than surprising the user.
      needsDisclosure = true;
    }
    setShowPermissionDisclosure(needsDisclosure);
    setStartVisible(true);
  }, []);

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
  const adminPreview = Boolean(detail.adminPreview);
  const primaryLabel = adminPreview
    ? 'Open no-driving test'
    : !owned
    ? canClaimFeatured
      ? 'Claim monthly Original'
      : explorerAccessIncluded
      ? 'Included with Explorer'
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
  const primaryAction = adminPreview
    ? () => router.replace({
      pathname: '/originals/preview',
      params: {
        id: detail.id,
        chapter: detail.manifestSchemaVersion === 2 ? selectedChapterId : undefined,
        variant: detail.manifestSchemaVersion === 2 ? selectedVariantId : undefined,
      },
    } as any)
    : !owned
    ? acquire
    : !ready
      ? () => setReadinessVisible(true)
      : () => { void openStart(); };
  const shareOriginal = async () => {
    const content = originalShareContent(detail);
    try {
      await Share.share({
        title: content.title,
        message: content.message,
      });
    } catch {
      Alert.alert('Couldn’t share', 'Please try again.');
    }
  };

  const chapterSelections = detail.chapterSelections ?? [];
  const chapterOptions = chapterSelections.filter((selection, index, values) => (
    values.findIndex(candidate => candidate.chapterId === selection.chapterId) === index
  ));
  const activeVariants = chapterSelections.filter(selection => selection.chapterId === selectedChapterId);

  return (
    <View testID="original.detail.screen" style={[styles.screen, { backgroundColor: C.bg }] }>
      <ScrollView testID="original.detail.scroll" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 112, 132) }}>
        <OriginalArtwork imageUrl={detail.heroImageUrl} region={detail.region} />
        <SafeAreaView edges={['top']} style={styles.floatingTop}>
          <TouchableOpacity testID="original.detail.back" accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.floatingButton}>
            <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
          </TouchableOpacity>
          {!adminPreview ? (
            <TouchableOpacity testID="original.detail.share" accessibilityRole="button" accessibilityLabel="Share this Original" onPress={() => { void shareOriginal(); }} style={styles.floatingButton}>
              <Ionicons name="share-outline" size={19} color="#FFFFFF" />
            </TouchableOpacity>
          ) : <View style={styles.floatingButtonSpacer} />}
        </SafeAreaView>

        <View style={styles.content}>
          <View style={styles.titleBlock}>
            <View style={styles.creatorRow}>
              <Ionicons name="shield-checkmark" size={15} color={C.orange} />
              <Text style={[styles.creator, { color: C.orange }]}>{adminPreview ? 'UNPUBLISHED STUDIO DRAFT' : 'A TRAILHEAD ORIGINAL'}</Text>
            </View>
            <Text style={[styles.title, { color: C.text }]}>{detail.title}</Text>
            <Text style={[styles.route, { color: C.text2 }]}>{detail.routeLabel}</Text>
          </View>

          {chapterOptions.length ? (
            <View testID="original.chapter.selector" style={styles.chapterSection}>
              <Text style={[styles.sectionTitle, { color: C.text }]}>Choose a drive</Text>
              <View style={styles.chapterList}>
                {chapterOptions.map(chapter => {
                  const selected = chapter.chapterId === selectedChapterId;
                  return (
                    <TouchableOpacity
                      key={chapter.chapterId}
                      testID={`original.chapter.${chapter.chapterId}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      activeOpacity={0.78}
                      onPress={() => {
                        const defaultVariant = chapterSelections.find(selection => (
                          selection.chapterId === chapter.chapterId && selection.isDefault
                        )) ?? chapterSelections.find(selection => selection.chapterId === chapter.chapterId);
                        setSelectedChapterId(chapter.chapterId);
                        setSelectedVariantId(defaultVariant?.variantId || '');
                      }}
                      style={[
                        styles.chapterCard,
                        {
                          backgroundColor: selected ? C.orange + '10' : C.s1,
                          borderColor: selected ? C.orange : C.border,
                        },
                      ]}
                    >
                      <View style={styles.chapterCardCopy}>
                        <Text style={[styles.chapterTitle, { color: C.text }]}>{chapter.chapterTitle}</Text>
                        <Text style={[styles.chapterSummary, { color: C.text2 }]} numberOfLines={selected ? undefined : 2}>{chapter.chapterSummary}</Text>
                      </View>
                      <Ionicons name={selected ? 'checkmark-circle' : 'chevron-forward'} size={20} color={selected ? C.orange : C.text3} />
                    </TouchableOpacity>
                  );
                })}
              </View>
              {activeVariants.length > 1 ? (
                <View style={styles.variantList}>
                  <Text style={[styles.variantLabel, { color: C.text3 }]}>DIRECTION</Text>
                  {activeVariants.map(variant => {
                    const selected = variant.variantId === selectedVariantId;
                    return (
                      <TouchableOpacity
                        key={variant.variantId}
                        testID={`original.variant.${variant.variantId}`}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        onPress={() => setSelectedVariantId(variant.variantId)}
                        style={[styles.variantRow, { borderBottomColor: C.border }]}
                      >
                        <View style={styles.variantCopy}>
                          <Text style={[styles.variantTitle, { color: C.text }]}>{variant.variantTitle}</Text>
                          <Text style={[styles.variantMeta, { color: C.text3 }]}>{variant.distanceLabel} · {variant.durationLabel}</Text>
                        </View>
                        <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? C.orange : C.text3} />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}
            </View>
          ) : null}

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

          {detail.route ? <View style={styles.routePreviewSection}>
            <View style={styles.routePreviewHeading}>
              <Text style={[styles.sectionTitle, { color: C.text }]}>{adminPreview ? 'Draft route' : 'Published route'}</Text>
              <Text style={[styles.routePreviewMeta, { color: C.text3 }]}>{detail.distanceLabel} · fixed direction</Text>
            </View>
            <View style={[styles.routePreview, { borderColor: C.border }] }>
              <OriginalRouteMap route={detail.route} projectedProgressM={null} overview />
            </View>
          </View> : null}

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
                    <Text style={[styles.storyMeta, { color: C.text3 }]}>{story.durationLabel} · {adminPreview ? 'unpublished trigger cue' : 'plays automatically on route'}</Text>
                  </View>
                  <Ionicons name="headset-outline" size={17} color={C.text3} />
                </View>
              ))}
            </View>
          </View>

          <TrailheadPrompt
            icon="shield-checkmark-outline"
            tone={C.orange}
            title={adminPreview ? 'Synthetic test only' : 'Drive first'}
            body={adminPreview ? 'This draft is unpublished. Use the no-driving trigger test; physical location tracking is disabled.' : 'Passenger use recommended. Audio pauses for navigation and calls.'}
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
              <Text style={[styles.sourceIntro, { color: C.text2 }]}>{adminPreview ? 'Draft citations and review metadata appear below. Publication review is not complete.' : 'Scripts are human-written and fact-checked against the sources below. Access conditions can change.'}</Text>
              {detail.sources.map(source => (
                <TouchableOpacity
                  key={`${source.label}:${source.url || ''}`}
                  accessibilityRole={source.url ? 'link' : 'text'}
                  disabled={!source.url}
                  onPress={() => source.url && Linking.openURL(source.url)}
                  style={[styles.sourceRow, { borderBottomColor: C.border }]}
                >
                  <Ionicons name="document-text-outline" size={16} color={C.text3} />
                  <View style={styles.sourceCopy}>
                    <Text style={[styles.sourceLabel, { color: C.text2 }]}>{source.label}</Text>
                    <Text style={[styles.sourceMeta, { color: C.orange }]}>
                      {source.role === 'operational' ? 'OPERATIONS' : 'STORY'}
                      {source.authority ? ` · ${source.authority.toUpperCase()}` : ''}
                      {source.scope.length ? ` · ${source.scope.map(value => value.toUpperCase()).join(' / ')}` : ''}
                    </Text>
                  </View>
                  {source.url ? <Ionicons name="open-outline" size={15} color={C.orange} /> : null}
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          {permanentUnlockOffer ? (
            <View style={styles.section}>
              <TrailheadButton
                testID="original.detail.keep-permanently"
                label={permanentUnlockOffer.label}
                icon="lock-open-outline"
                variant="secondary"
                loading={busy}
                onPress={confirmPermanentUnlock}
              />
              <Text style={[styles.sourceIntro, { color: C.text2 }]}>Explorer includes this while your membership is active. Permanent access uses earned credits.</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>

      <View style={[styles.dock, { backgroundColor: C.s1, borderTopColor: C.border, paddingBottom: Math.max(insets.bottom, 12) }] }>
        <View style={styles.dockCopy}>
          <Text style={[styles.dockPrice, { color: owned || canClaimFeatured ? C.orange : C.text }]}>{adminPreview
            ? 'Admin device preview'
            : owned
              ? detail.accessKind === 'explorer_subscription'
                ? 'Included with Explorer'
                : 'Yours permanently'
              : canClaimFeatured
                ? 'Included this month'
                : detail.priceCredits === 0
                  ? 'Free'
                  : `${price} credits`}</Text>
          <Text style={[styles.dockMeta, { color: C.text3 }]}>{adminPreview ? 'Not published · synthetic GPS only' : owned ? bundleLabel(bundle) : canClaimFeatured ? 'Explorer monthly claim' : detail.priceCredits === 0 ? 'No account required' : user ? `${user.credits} credits available` : 'Account required'}</Text>
        </View>
        <TrailheadButton testID="original.detail.primary" label={primaryLabel} icon={ready ? 'play' : !owned ? detail.priceCredits === 0 ? 'gift-outline' : 'ticket-outline' : 'cloud-download'} variant="primary" loading={busy} onPress={() => void primaryAction()} style={styles.primary} />
      </View>

      <ReadinessModal
        visible={readinessVisible}
        detail={detail}
        bundle={bundle}
        onClose={() => bundle.state !== 'downloading' && setReadinessVisible(false)}
        onDownload={() => void startDownload()}
        onStart={() => { setReadinessVisible(false); void openStart(); }}
      />
      <StartTourModal
        visible={startVisible}
        detail={detail}
        showPermissionDisclosure={showPermissionDisclosure}
        onClose={() => setStartVisible(false)}
        onStart={beginStart}
        onSimulate={!adminPreview && user?.is_admin ? beginSimulation : undefined}
      />
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
      <View style={styles.modalOverlay} testID="original.download.overlay">
        <View
          style={[styles.sheet, { backgroundColor: C.s1, borderColor: C.border }]}
          testID="original.download.sheet"
        >
          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetContent}
            showsVerticalScrollIndicator={false}
          >
          <View style={[styles.handle, { backgroundColor: C.border2 }]} />
          <View style={styles.sheetTitleRow}>
            <View style={[styles.sheetIcon, { backgroundColor: C.orange + '18' }] }>
              <Ionicons name={ready ? 'checkmark-circle' : 'cloud-download-outline'} size={23} color={C.orange} />
            </View>
            <View style={styles.sheetCopy}>
              <Text style={[styles.sheetKicker, { color: C.orange }]}>{ready ? 'READY OFFLINE' : bundle.state === 'update_available' ? 'UPDATE REQUIRED' : 'OFFLINE PACKAGE'}</Text>
              <Text style={[styles.sheetTitle, { color: C.text }]}>{ready ? 'Everything is on this device' : bundle.state === 'update_available' ? `Download version ${detail.version}` : `Download ${detail.offlineSizeLabel}`}</Text>
            </View>
            <TouchableOpacity testID="original.download.close" accessibilityRole="button" accessibilityLabel="Close" disabled={bundle.state === 'downloading'} onPress={onClose} style={styles.sheetClose}>
              <Ionicons name="close" size={20} color={C.text2} />
            </TouchableOpacity>
          </View>

          <View style={styles.assetList}>
            <AssetRow icon="map-outline" label="Fixed route and offline map region" ready={ready} />
            <AssetRow
              icon="headset-outline"
              label={detail.manifestSchemaVersion === 2
                ? `${detail.storyCount} full stories · ${detail.cueCount ?? 0} shorter cues`
                : `${detail.storyCount} narrations and transcripts`}
              ready={ready}
            />
            <AssetRow icon="images-outline" label="Story artwork and source notes" ready={ready} />
          </View>

          {bundle.state === 'downloading' ? (
            <View style={styles.progressBlock}>
              <View testID="original.download.progress" style={[styles.progressTrack, { backgroundColor: C.s3 }] }>
                <View style={[styles.progressFill, { width: `${Math.max(2, Math.round(bundle.progress * 100))}%`, backgroundColor: C.orange }]} />
              </View>
              <Text accessibilityLiveRegion="polite" style={[styles.progressLabel, { color: C.text2 }]}>{Math.round(bundle.progress * 100)}% · Keep Trailhead open until verification finishes</Text>
            </View>
          ) : bundle.state === 'error' ? (
            <TrailheadPrompt icon="alert-circle-outline" tone={C.red} title="Download interrupted" body={bundle.error} />
          ) : null}

          <Text style={[styles.sheetFootnote, { color: C.text3 }]}>Files are verified before the drive begins.</Text>
          <TrailheadButton
            testID="original.download.action"
            label={ready ? 'Continue to safety check' : bundle.state === 'update_available' ? 'Update Original' : bundle.state === 'error' ? 'Retry download' : bundle.state === 'downloading' ? 'Downloading' : `Download · ${detail.offlineSizeLabel}`}
            icon={ready ? 'arrow-forward' : 'cloud-download'}
            variant="primary"
            disabled={bundle.state === 'downloading'}
            loading={bundle.state === 'downloading'}
            onPress={ready ? onStart : onDownload}
          />
          </ScrollView>
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
  showPermissionDisclosure,
  onClose,
  onStart,
  onSimulate,
}: {
  visible: boolean;
  detail: OriginalUiDetail;
  showPermissionDisclosure: boolean;
  onClose: () => void;
  onStart: () => Promise<void>;
  onSimulate?: () => Promise<void>;
}) {
  const C = useTheme();
  const [confirmed, setConfirmed] = useState(false);
  const [starting, setStarting] = useState<'tour' | 'simulation' | null>(null);
  const [permissionError, setPermissionError] = useState('');

  useEffect(() => {
    if (!visible) {
      setConfirmed(false);
      setStarting(null);
      setPermissionError('');
    }
  }, [visible]);

  const start = async (mode: 'tour' | 'simulation') => {
    setStarting(mode);
    setPermissionError('');
    try {
      if (mode === 'simulation' && onSimulate) await onSimulate();
      else await onStart();
    } catch (error: any) {
      setPermissionError(error?.message || 'Trailhead needs location access while this tour is active.');
      setStarting(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View testID="original.start.overlay" style={styles.modalOverlay}>
        <View testID="original.start.sheet" style={[styles.sheet, { backgroundColor: C.s1, borderColor: C.border }] }>
          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
          <View style={[styles.handle, { backgroundColor: C.border2 }]} />
          <View style={styles.sheetTitleRow}>
            <View style={[styles.sheetIcon, { backgroundColor: C.orange + '18' }] }>
              <Ionicons name="navigate" size={23} color={C.orange} />
            </View>
            <View style={styles.sheetCopy}>
              <Text style={[styles.sheetKicker, { color: C.orange }]}>{showPermissionDisclosure ? 'TRAILHEAD ORIGINAL' : 'BEFORE YOU DRIVE'}</Text>
              <Text style={[styles.sheetTitle, { color: C.text }]}>{showPermissionDisclosure ? 'Allow location for this tour' : `Start ${detail.title}`}</Text>
            </View>
            <TouchableOpacity testID="original.start.close" accessibilityRole="button" accessibilityLabel="Close" disabled={Boolean(starting)} onPress={onClose} style={styles.sheetClose}>
              <Ionicons name="close" size={20} color={C.text2} />
            </TouchableOpacity>
          </View>

          {showPermissionDisclosure ? (
            <>
              <Text
                style={[styles.disclosureBody, { color: C.text2 }]}
                testID="original.start.disclosure"
              >
                Trailhead uses location in the background so navigation and Original stories can continue after you lock your phone or switch apps. Location stops when you end navigation or the tour.
              </Text>
              <View style={styles.permissionList}>
                <PermissionRow icon="location-outline" title="Background location" body="Triggers stories along the route. Your traveled route is not uploaded." />
                <PermissionRow icon="volume-high-outline" title="Story audio" body="Calls and navigation prompts take priority." />
                <PermissionRow icon="cloud-download-outline" title="Offline route" body="Route, stories and map are ready before the tour starts." />
              </View>
            </>
          ) : null}

          <TouchableOpacity
            testID="original.start.confirm"
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
                title="Tour could not start"
                body={permissionError}
                action={<TouchableOpacity accessibilityRole="button" onPress={() => Linking.openSettings()} style={styles.settingsAction}><Text style={[styles.settingsText, { color: C.orange }]}>Settings</Text></TouchableOpacity>}
              />
            </View>
          ) : null}

          <TrailheadButton
            testID="original.start.continue"
            label={showPermissionDisclosure ? 'Agree & continue' : 'Start tour'}
            icon="play"
            variant="primary"
            disabled={!confirmed || Boolean(starting)}
            loading={starting === 'tour'}
            onPress={() => void start('tour')}
          />
          {showPermissionDisclosure ? (
            <TouchableOpacity
              testID="original.start.not-now"
              accessibilityRole="button"
              disabled={Boolean(starting)}
              onPress={onClose}
              style={styles.notNowAction}
            >
              <Text style={[styles.notNowText, { color: C.text2 }]}>Not now</Text>
            </TouchableOpacity>
          ) : null}
          {onSimulate ? (
            <View style={styles.simulationAction}>
              <TrailheadButton
                testID="original.start.simulate"
                label="Test without driving"
                icon="speedometer-outline"
                disabled={!confirmed || Boolean(starting)}
                loading={starting === 'simulation'}
                onPress={() => void start('simulation')}
              />
              <Text style={[styles.simulationNote, { color: C.text3 }]}>ADMIN TEST · SYNTHETIC GPS · SAVED DRIVE PROGRESS IS UNCHANGED</Text>
            </View>
          ) : null}
          </ScrollView>
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
  floatingButtonSpacer: { width: 44, height: 44 },
  content: { paddingHorizontal: 18, paddingTop: 20, gap: 22 },
  titleBlock: { gap: 5 },
  creatorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  creator: { fontSize: 8.5, lineHeight: 12, fontWeight: '900', letterSpacing: 0.8 },
  title: { fontSize: 30, lineHeight: 35, fontWeight: '900', letterSpacing: -0.8 },
  route: { fontSize: 13, lineHeight: 19, fontWeight: '700' },
  chapterSection: { gap: 10 },
  chapterList: { gap: 8 },
  chapterCard: { minHeight: 76, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 12 },
  chapterCardCopy: { flex: 1, minWidth: 0 },
  chapterTitle: { fontSize: 14, lineHeight: 19, fontWeight: '900' },
  chapterSummary: { marginTop: 3, fontSize: 11.5, lineHeight: 17, fontWeight: '600' },
  variantList: { marginTop: 3 },
  variantLabel: { marginBottom: 2, fontSize: 8.5, lineHeight: 12, fontWeight: '900', letterSpacing: 0.8 },
  variantRow: { minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12 },
  variantCopy: { flex: 1, minWidth: 0 },
  variantTitle: { fontSize: 12.5, lineHeight: 17, fontWeight: '800' },
  variantMeta: { marginTop: 2, fontSize: 10, lineHeight: 14, fontWeight: '600' },
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
  sourceCopy: { flex: 1, minWidth: 0, paddingVertical: 7 },
  sourceLabel: { fontSize: 11.5, lineHeight: 16, fontWeight: '700' },
  sourceMeta: { marginTop: 2, fontSize: 8.5, lineHeight: 12, fontWeight: '900', letterSpacing: 0.45 },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 88, borderTopWidth: 1, paddingHorizontal: 18, paddingTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  dockCopy: { flex: 1, minWidth: 0 },
  dockPrice: { fontSize: 13, lineHeight: 17, fontWeight: '900' },
  dockMeta: { marginTop: 2, fontSize: 9.5, lineHeight: 13, fontWeight: '700' },
  primary: { minWidth: 176 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.54)' },
  sheet: { maxHeight: '92%', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, overflow: 'hidden' },
  sheetScroll: { flexShrink: 1 },
  sheetContent: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 24, gap: 16 },
  handle: { width: 42, height: 4, borderRadius: 2, alignSelf: 'center' },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  sheetIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  sheetCopy: { flex: 1, minWidth: 0 },
  sheetKicker: { fontSize: 8.5, lineHeight: 12, fontWeight: '900', letterSpacing: 0.8 },
  sheetTitle: { marginTop: 2, fontSize: 18, lineHeight: 23, fontWeight: '900' },
  disclosureBody: { fontSize: 15, lineHeight: 21 },
  notNowAction: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  notNowText: { fontSize: 15, lineHeight: 20, fontWeight: '800' },
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
  simulationAction: { gap: 7 },
  simulationNote: { fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 0.55, textAlign: 'center' },
  settingsAction: { minWidth: 58, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  settingsText: { fontSize: 10.5, fontWeight: '900' },
});
