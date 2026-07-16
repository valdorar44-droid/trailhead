import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/lib/design';
import OriginalCard from './OriginalCard';
import { listOriginals } from './originalsUiService';
import type { OriginalUiSummary } from './types';

function significantTerms(value: string) {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(term => term.length >= 4 && !['park', 'area', 'near', 'national'].includes(term));
}

export default function OriginalsContextCard({ context }: { context: string }) {
  const C = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<OriginalUiSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    void listOriginals().then(result => !cancelled && setItems(result)).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const match = useMemo(() => {
    const terms = significantTerms(context);
    if (!terms.length) return null;
    return items.find(item => {
      const haystack = `${item.title} ${item.region} ${item.summary}`.toLowerCase();
      return terms.some(term => haystack.includes(term));
    }) || null;
  }, [context, items]);
  if (!match) return null;
  return (
    <View style={[styles.shell, { borderColor: C.border, backgroundColor: C.s1 }] }>
      <View style={styles.heading}>
        <Ionicons name="navigate-outline" size={15} color={C.orange} />
        <Text style={[styles.kicker, { color: C.orange }]}>TRAILHEAD ORIGINAL NEARBY</Text>
      </View>
      <OriginalCard original={match} variant="context" onPress={() => router.push({ pathname: '/originals/[id]', params: { id: match.id, version: String(match.version) } } as any)} />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { marginHorizontal: 20, marginVertical: 8, borderWidth: 1, borderRadius: 18, padding: 12, gap: 10 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kicker: { fontSize: 8.5, lineHeight: 12, fontWeight: '900', letterSpacing: 0.8 },
});
