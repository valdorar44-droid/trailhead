import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/design';
import {
  originalAdminDraftPreviewRouteParams,
  originalsApi,
  type OriginalAdminDraftSummary,
} from '@/lib/originals';
import { useStore } from '@/lib/store';
import OriginalCard from '@/components/originals/OriginalCard';
import { listOriginals } from '@/components/originals/originalsUiService';
import type { OriginalUiSummary } from '@/components/originals/types';

export default function OriginalsCatalogScreen() {
  const C = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useStore(state => state.user);
  const [items, setItems] = useState<OriginalUiSummary[]>([]);
  const [drafts, setDrafts] = useState<OriginalAdminDraftSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftLoading, setDraftLoading] = useState(Boolean(user?.is_admin));
  const [draftLoadedIdentity, setDraftLoadedIdentity] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [draftError, setDraftError] = useState('');

  const draftRequestIdentity = user?.is_admin ? `admin:${String(user.id ?? 'unknown')}` : '';

  const loadPublished = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await listOriginals({ includeOwnedState: true }));
    } catch (publishedError: any) {
      setItems([]);
      setError(publishedError?.message || 'Originals could not be loaded right now.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDrafts = useCallback(async () => {
    if (!user?.is_admin) {
      setDrafts([]);
      setDraftError('');
      setDraftLoading(false);
      setDraftLoadedIdentity('');
      return;
    }

    setDraftLoading(true);
    setDraftError('');
    try {
      const adminDrafts = await originalsApi.adminDrafts();
      setDrafts(adminDrafts.items);
    } catch (adminDraftError: any) {
      setDrafts([]);
      setDraftError(adminDraftError?.message || 'Studio drafts could not be loaded.');
    } finally {
      setDraftLoading(false);
      setDraftLoadedIdentity(draftRequestIdentity);
    }
  }, [draftRequestIdentity, user?.is_admin]);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    try {
      await Promise.allSettled([loadPublished(), loadDrafts()]);
    } finally {
      setRefreshing(false);
    }
  }, [loadDrafts, loadPublished]);

  useEffect(() => { void load(); }, [load]);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: C.bg }] }>
      <View style={[styles.topBar, { borderBottomColor: C.border }] }>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back to Explore"
          hitSlop={8}
          activeOpacity={0.72}
          onPress={() => router.back()}
          style={[styles.back, { borderColor: C.border, backgroundColor: C.s1 }]}
        >
          <Ionicons name="chevron-back" size={19} color={C.text} />
        </TouchableOpacity>
        <View style={styles.topCopy}>
          <Text style={[styles.kicker, { color: C.orange }]}>TRAILHEAD ORIGINALS</Text>
          <Text style={[styles.topTitle, { color: C.text }]}>Drive into the story</Text>
        </View>
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={C.orange} colors={[C.orange]} />}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 24, 40) }]}
      >
        <View style={[styles.intro, { borderColor: C.border, backgroundColor: C.s1 }] }>
          <View style={[styles.introIcon, { backgroundColor: C.orange + '18' }] }>
            <Ionicons name="navigate-outline" size={22} color={C.orange} />
          </View>
          <View style={styles.introCopy}>
            <Text style={[styles.introTitle, { color: C.text }]}>Self-guided scenic drives</Text>
            <Text style={[styles.introBody, { color: C.text2 }]}>Download the route and stories, then listen hands-free.</Text>
          </View>
        </View>

        {user?.is_admin ? (
          <View style={[styles.draftSection, { borderColor: C.orange + '45', backgroundColor: C.s1 }] }>
            <View style={styles.draftHeader}>
              <View>
                <Text style={[styles.draftKicker, { color: C.orange }]}>ADMIN · STUDIO DRAFTS</Text>
                <Text style={[styles.draftHeading, { color: C.text }]}>Test before publishing</Text>
              </View>
              <Ionicons name="speedometer-outline" size={21} color={C.orange} />
            </View>
            <Text style={[styles.draftBody, { color: C.text2 }]}>Choose the no-driving synthetic lab or the admin-only foreground GPS field test. Both keep the draft unpublished and leave saved progress, analytics, and car state unchanged.</Text>
            {draftLoading || draftLoadedIdentity !== draftRequestIdentity ? (
              <View style={[styles.draftState, styles.draftLoadingState, { borderTopColor: C.border }] }>
                <ActivityIndicator color={C.orange} />
                <Text accessibilityLiveRegion="polite" style={[styles.draftBody, styles.draftLoadingText, { color: C.text2 }]}>Loading saved Studio drafts</Text>
              </View>
            ) : draftError ? (
              <View style={[styles.draftState, { borderTopColor: C.border }] }>
                <Text style={[styles.draftBody, { color: C.text2 }]}>{draftError}</Text>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry loading Studio drafts" onPress={() => void loadDrafts()} style={[styles.draftRetry, { borderColor: C.border }] }>
                  <Ionicons name="refresh" size={15} color={C.orange} />
                  <Text style={[styles.retryText, { color: C.orange }]}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : drafts.length === 0 ? (
              <View style={[styles.draftState, { borderTopColor: C.border }] }>
                <Text style={[styles.draftBody, { color: C.text2 }]}>No saved Studio drafts are available for device testing yet.</Text>
              </View>
            ) : drafts.map(draft => (
              <View key={draft.id} style={[styles.draftRow, { borderTopColor: C.border }]}>
                <View style={styles.draftCopy}>
                  <Text style={[styles.draftTitle, { color: C.text }]}>{draft.title}</Text>
                  <Text style={[styles.draftMeta, { color: C.text3 }]}>REVISION {draft.draft_revision} · UNPUBLISHED DEVICE TEST</Text>
                  {draft.preview_selections.length ? (
                    <View style={styles.draftSelections}>
                      <Text style={[styles.draftSelectionPrompt, { color: C.text2 }]}>Choose a chapter and direction</Text>
                      {draft.preview_selections.map(selection => (
                        <View
                          key={`${selection.chapter_id}:${selection.variant_id}`}
                          style={[styles.draftSelectionGroup, { borderColor: C.border, backgroundColor: C.s2 }]}
                        >
                          <View style={styles.draftSelectionCopy}>
                            <Text style={[styles.draftSelectionChapter, { color: C.text3 }]}>{selection.chapter_title}</Text>
                            <Text style={[styles.draftSelectionTitle, { color: C.text }]}>{selection.variant_title}</Text>
                          </View>
                          <TouchableOpacity
                          accessibilityRole="button"
                          accessibilityLabel={`Run no-driving trigger test for ${draft.title}, ${selection.chapter_title}, ${selection.variant_title}`}
                          onPress={() => router.push({
                            pathname: '/originals/preview',
                            params: originalAdminDraftPreviewRouteParams(
                              draft.id,
                              draft.schema_version,
                              selection,
                            ),
                          } as any)}
                          style={[styles.draftModeAction, { borderColor: C.border }]}
                        >
                            <Ionicons name="speedometer-outline" size={15} color={C.orange} />
                            <Text style={[styles.draftModeText, { color: C.text2 }]}>No-driving trigger test</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel={`Run private GPS field test for ${draft.title}, ${selection.chapter_title}, ${selection.variant_title}`}
                            onPress={() => router.push({
                              pathname: '/originals/preview',
                              params: {
                                ...originalAdminDraftPreviewRouteParams(
                                  draft.id,
                                  draft.schema_version,
                                  selection,
                                ),
                                mode: 'field',
                              },
                            } as any)}
                            style={[styles.draftModeAction, styles.draftFieldAction, { borderColor: C.orange + '70', backgroundColor: C.orange + '10' }]}
                          >
                            <Ionicons name="navigate-outline" size={15} color={C.orange} />
                            <View style={styles.draftModeCopy}>
                              <Text style={[styles.draftModeText, { color: C.orange }]}>Private GPS field test</Text>
                              <Text style={[styles.draftModeNote, { color: C.text3 }]}>FOREGROUND ONLY · PARKED OR PASSENGER</Text>
                            </View>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
                {draft.schema_version === 1 ? (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Test Studio draft ${draft.title}`}
                    onPress={() => router.push({
                      pathname: '/originals/preview',
                      params: originalAdminDraftPreviewRouteParams(draft.id, draft.schema_version),
                    } as any)}
                    style={[styles.draftAction, { backgroundColor: C.orange }]}
                  >
                    <Text style={styles.draftActionText}>Test</Text>
                    <Ionicons name="arrow-forward" size={14} color="#FFFFFF" />
                  </TouchableOpacity>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={C.orange} />
            <Text style={[styles.loadingText, { color: C.text2 }]}>Finding Trailhead Originals</Text>
          </View>
        ) : error ? (
          <View style={[styles.state, { borderColor: C.border, backgroundColor: C.s1 }] }>
            <Ionicons name="cloud-offline-outline" size={25} color={C.text3} />
            <Text style={[styles.stateTitle, { color: C.text }]}>Couldn’t load Originals</Text>
            <Text style={[styles.stateBody, { color: C.text2 }]}>{error}</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => void loadPublished()} style={[styles.retry, { borderColor: C.border }] }>
              <Ionicons name="refresh" size={15} color={C.orange} />
              <Text style={[styles.retryText, { color: C.orange }]}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : items.length === 0 ? (
          <View style={[styles.state, { borderColor: C.border, backgroundColor: C.s1 }] }>
            <Ionicons name="map-outline" size={28} color={C.text3} />
            <Text style={[styles.stateTitle, { color: C.text }]}>No published drives yet</Text>
            <Text style={[styles.stateBody, { color: C.text2 }]}>Published Trailhead Originals will appear here when they are available for this release.</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {items.map(item => (
              <OriginalCard
                key={`${item.id}:${item.version}`}
                original={item}
                variant="list"
                onPress={() => router.push({ pathname: '/originals/[id]', params: { id: item.id, version: String(item.version) } } as any)}
              />
            ))}
          </View>
        )}

        <View style={[styles.partnerBoundary, { borderTopColor: C.border }] }>
          <Ionicons name="ticket-outline" size={17} color={C.text3} />
          <View style={styles.partnerCopy}>
            <Text style={[styles.partnerTitle, { color: C.text }]}>Looking for a live guide?</Text>
            <Text style={[styles.partnerBody, { color: C.text2 }]}>Guided trips are listed separately in Explore.</Text>
          </View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Open guided trips in Explore" onPress={() => router.push('/(tabs)/guide?category=guided' as any)} style={styles.partnerAction}>
            <Text style={[styles.partnerActionText, { color: C.orange }]}>Explore</Text>
            <Ionicons name="arrow-forward" size={14} color={C.orange} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: { minHeight: 70, paddingHorizontal: 18, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  topCopy: { flex: 1, minWidth: 0 },
  kicker: { fontSize: 8.5, lineHeight: 12, fontWeight: '900', letterSpacing: 1 },
  topTitle: { marginTop: 2, fontSize: 20, lineHeight: 24, fontWeight: '900', letterSpacing: -0.3 },
  content: { paddingHorizontal: 18, paddingTop: 18, gap: 18 },
  intro: { borderWidth: 1, borderRadius: 18, padding: 15, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  introIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  introCopy: { flex: 1, minWidth: 0 },
  introTitle: { fontSize: 17, lineHeight: 21, fontWeight: '900' },
  introBody: { marginTop: 4, fontSize: 12, lineHeight: 18, fontWeight: '600' },
  draftSection: { borderWidth: 1, borderRadius: 18, padding: 15 },
  draftHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  draftKicker: { fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 0.75 },
  draftHeading: { marginTop: 2, fontSize: 17, lineHeight: 21, fontWeight: '900' },
  draftBody: { marginTop: 7, fontSize: 10.5, lineHeight: 16, fontWeight: '600' },
  draftState: { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  draftLoadingState: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10 },
  draftLoadingText: { marginTop: 0 },
  draftRetry: { alignSelf: 'flex-start', minHeight: 44, marginTop: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  draftRow: { minHeight: 64, marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  draftCopy: { flex: 1, minWidth: 0 },
  draftTitle: { fontSize: 12.5, lineHeight: 17, fontWeight: '900' },
  draftMeta: { marginTop: 3, fontSize: 8, lineHeight: 11, fontWeight: '800', letterSpacing: 0.35 },
  draftAction: { minWidth: 72, minHeight: 44, borderRadius: 12, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  draftActionText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  draftSelections: { marginTop: 12, gap: 8 },
  draftSelectionPrompt: { fontSize: 10, lineHeight: 15, fontWeight: '800' },
  draftSelectionGroup: { borderWidth: 1, borderRadius: 12, padding: 11, gap: 8 },
  draftSelectionCopy: { flex: 1, minWidth: 0 },
  draftSelectionChapter: { fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 0.35, textTransform: 'uppercase' },
  draftSelectionTitle: { marginTop: 2, fontSize: 11, lineHeight: 15, fontWeight: '900' },
  draftModeAction: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 7 },
  draftFieldAction: { minHeight: 52 },
  draftModeCopy: { flex: 1, minWidth: 0 },
  draftModeText: { fontSize: 10.5, lineHeight: 14, fontWeight: '900' },
  draftModeNote: { marginTop: 1, fontSize: 7.5, lineHeight: 10, fontWeight: '900', letterSpacing: 0.25 },
  loading: { minHeight: 210, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { fontSize: 12, fontWeight: '700' },
  list: { gap: 15 },
  state: { minHeight: 210, borderWidth: 1, borderRadius: 18, padding: 22, alignItems: 'center', justifyContent: 'center' },
  stateTitle: { marginTop: 10, fontSize: 17, lineHeight: 22, fontWeight: '900', textAlign: 'center' },
  stateBody: { marginTop: 5, fontSize: 12, lineHeight: 18, fontWeight: '600', textAlign: 'center' },
  retry: { minHeight: 44, marginTop: 14, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  retryText: { fontSize: 11, fontWeight: '900' },
  partnerBoundary: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  partnerCopy: { flex: 1, minWidth: 0 },
  partnerTitle: { fontSize: 13, lineHeight: 17, fontWeight: '900' },
  partnerBody: { marginTop: 2, fontSize: 10.5, lineHeight: 15, fontWeight: '600' },
  partnerAction: { minHeight: 44, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4 },
  partnerActionText: { fontSize: 11, fontWeight: '900' },
});
