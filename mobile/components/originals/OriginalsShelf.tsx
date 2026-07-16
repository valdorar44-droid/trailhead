import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/lib/design';
import { TrailheadRailSkeleton } from '@/components/TrailheadUI';
import OriginalCard from './OriginalCard';
import { listOriginals } from './originalsUiService';
import type { OriginalUiSummary } from './types';

export default function OriginalsShelf({ query = '' }: { query?: string }) {
  const C = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<OriginalUiSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setItems(await listOriginals());
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const normalizedQuery = query.trim().toLowerCase();
  const contextual = normalizedQuery
    ? items.filter(item => `${item.title} ${item.region} ${item.summary}`.toLowerCase().includes(normalizedQuery))
    : items;
  const visible = (contextual.length ? contextual : normalizedQuery ? [] : items).slice(0, 5);
  if (!loading && visible.length === 0) return null;

  return (
    <View
      accessibilityRole="summary"
      style={[styles.shell, { borderColor: C.border, backgroundColor: C.s1 }]}
    >
      <View style={styles.headingRow}>
        <View style={[styles.icon, { backgroundColor: C.orange + '18', borderColor: C.orange + '4A' }] }>
          <Ionicons name="navigate-outline" size={17} color={C.orange} />
        </View>
        <View style={styles.headingCopy}>
          <Text style={[styles.kicker, { color: C.orange }]}>TRAILHEAD ORIGINALS</Text>
          <Text style={[styles.heading, { color: C.text }]}>Self-guided drives</Text>
          <Text style={[styles.subheading, { color: C.text2 }]}>GPS stories · Offline audio</Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="See all Trailhead Originals"
          hitSlop={8}
          activeOpacity={0.72}
          onPress={() => router.push('/originals' as any)}
          style={styles.seeAll}
        >
          <Text style={[styles.seeAllText, { color: C.orange }]}>All</Text>
          <Ionicons name="arrow-forward" size={14} color={C.orange} />
        </TouchableOpacity>
      </View>
      {loading ? (
        <TrailheadRailSkeleton count={2} cardWidth={286} />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
          {visible.map(original => (
            <OriginalCard
              key={`${original.id}:${original.version}`}
              original={original}
              onPress={() => router.push({ pathname: '/originals/[id]', params: { id: original.id, version: String(original.version) } } as any)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { marginHorizontal: 20, marginBottom: 16, borderWidth: 1, borderRadius: 18, padding: 14, gap: 12 },
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  icon: { width: 36, height: 36, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headingCopy: { flex: 1, minWidth: 0 },
  kicker: { fontSize: 8.5, lineHeight: 12, fontWeight: '900', letterSpacing: 0.9 },
  heading: { marginTop: 2, fontSize: 17, lineHeight: 21, fontWeight: '900', letterSpacing: -0.2 },
  subheading: { marginTop: 3, fontSize: 11.5, lineHeight: 16, fontWeight: '600' },
  seeAll: { minWidth: 44, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3 },
  seeAllText: { fontSize: 11.5, fontWeight: '900' },
  rail: { gap: 11, paddingRight: 4 },
});
