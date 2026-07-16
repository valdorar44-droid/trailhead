import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/design';
import OriginalCard from '@/components/originals/OriginalCard';
import { listOriginals } from '@/components/originals/originalsUiService';
import type { OriginalUiSummary } from '@/components/originals/types';

export default function OriginalsCatalogScreen() {
  const C = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<OriginalUiSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      setItems(await listOriginals({ includeOwnedState: true }));
    } catch (loadError: any) {
      setError(loadError?.message || 'Originals could not be loaded right now.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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
            <TouchableOpacity accessibilityRole="button" onPress={() => void load()} style={[styles.retry, { borderColor: C.border }] }>
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
