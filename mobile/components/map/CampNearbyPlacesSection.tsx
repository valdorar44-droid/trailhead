import React, { useMemo, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { mono, useTheme, type ColorPalette } from '@/lib/design';

type CampNearbyPlacesRail = {
  title: string;
  cards: ReactNode[];
};

type Props = {
  title?: string;
  loading: boolean;
  sourceLabel?: string | null;
  emptyMessage: string;
  emptyActionLabel: string;
  rails: CampNearbyPlacesRail[];
  onRetry: () => void;
};

export default function CampNearbyPlacesSection({
  title = 'NEARBY PLACES',
  loading,
  sourceLabel,
  emptyMessage,
  emptyActionLabel,
  rails,
  onRetry,
}: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const hasContent = rails.some(rail => rail.cards.length > 0);

  return (
    <View style={s.block}>
      <View style={s.header}>
        <Text style={s.title}>{title}</Text>
        {loading ? <ActivityIndicator size="small" color={C.orange} /> : null}
      </View>
      {sourceLabel ? <Text style={s.meta}>{sourceLabel}</Text> : null}
      {!loading && !hasContent ? (
        <View style={s.emptyCard}>
          <Text style={s.emptyText}>{emptyMessage}</Text>
          <View style={s.actions}>
            <TouchableOpacity style={s.retryBtn} onPress={onRetry}>
              <Ionicons name="scan-outline" size={14} color={C.text2} />
              <Text style={s.retryText}>{emptyActionLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        rails.map(rail => (
          rail.cards.length > 0 ? (
            <View key={rail.title}>
              <Text style={s.title}>{rail.title}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rail}>
                {rail.cards}
              </ScrollView>
            </View>
          ) : null
        ))
      )}
    </View>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  block: {
    gap: 8,
    marginTop: 4,
    marginBottom: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: C.text3,
    fontSize: 9,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  meta: {
    color: C.text3,
    fontSize: 10,
    lineHeight: 14,
    marginTop: 6,
    marginBottom: 8,
  },
  emptyCard: {
    gap: 10,
  },
  emptyText: {
    color: C.text3,
    fontSize: 11,
    lineHeight: 15,
  },
  rail: {
    gap: 10,
    paddingRight: 6,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s2,
  },
  retryText: {
    color: C.text2,
    fontSize: 11,
    fontFamily: mono,
    fontWeight: '700',
  },
});
