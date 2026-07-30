import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { TrailDiscoveryItemV2 } from '@/lib/api';
import { useTheme } from '@/lib/design';
import { TrailDiscoveryCard } from './TrailDiscoveryCard';

export type ExploreDestinationTrailState = {
  status: 'loading' | 'ready' | 'error';
  trails: TrailDiscoveryItemV2[];
  mapCandidates: TrailDiscoveryItemV2[];
  error?: string;
};

type Props = {
  state: ExploreDestinationTrailState;
  fallback?: React.ReactNode;
  onSelectTrail: (trail: TrailDiscoveryItemV2) => void;
  onRetry: () => void;
};

export function ExploreDestinationTrailList({ state, fallback, onSelectTrail, onRetry }: Props) {
  const C = useTheme();

  if (state.status === 'loading') {
    return (
      <View style={styles.loading} testID="explore.destination-trails.loading">
        <ActivityIndicator color={C.orange} />
        {[0, 1, 2].map(index => (
          <View key={index} style={[styles.skeleton, { backgroundColor: C.s2, borderColor: C.border }]} />
        ))}
      </View>
    );
  }

  if (!state.trails.length && fallback) return <>{fallback}</>;

  if (state.status === 'error') {
    return (
      <View style={[styles.state, { backgroundColor: C.s1, borderColor: C.border }]} testID="explore.destination-trails.error">
        <Ionicons name="cloud-offline-outline" size={25} color={C.orange} />
        <Text style={[styles.stateTitle, { color: C.text }]}>Trails unavailable</Text>
        <TouchableOpacity style={[styles.retry, { borderColor: C.border }]} onPress={onRetry} testID="explore.destination-trails.retry">
          <Text style={[styles.retryText, { color: C.text }]}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!state.trails.length) {
    return (
      <View style={[styles.state, { backgroundColor: C.s1, borderColor: C.border }]} testID="explore.destination-trails.empty">
        <Ionicons name="trail-sign-outline" size={25} color={C.orange} />
        <Text style={[styles.stateTitle, { color: C.text }]}>No mapped trails listed</Text>
        {state.mapCandidates.length > 0 ? (
          <Text style={[styles.stateDetail, { color: C.text2 }]}>Additional trailheads appear on the map.</Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.list} testID="explore.destination-trails.list">
      <View style={styles.header}>
        <Text style={[styles.count, { color: C.text2 }]}>{state.trails.length} {state.trails.length === 1 ? 'trail' : 'trails'}</Text>
        <Text style={[styles.catalog, { color: C.text3 }]}>Verified routes</Text>
      </View>
      {state.trails.map(trail => (
        <TrailDiscoveryCard
          key={trail.id}
          item={trail}
          onPress={() => onSelectTrail(trail)}
          testID={`explore.destination-trails.result.${trail.id}`}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 2 },
  header: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  count: { fontSize: 13, fontWeight: '800' },
  catalog: { fontSize: 12 },
  loading: { gap: 12 },
  skeleton: { height: 196, borderRadius: 20, borderWidth: 1 },
  state: { minHeight: 150, borderWidth: 1, borderRadius: 20, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 },
  stateTitle: { fontSize: 16, fontWeight: '800', textAlign: 'center' },
  stateDetail: { fontSize: 13, textAlign: 'center' },
  retry: { minHeight: 48, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  retryText: { fontSize: 14, fontWeight: '800' },
});
