import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { CampsiteInsight } from '@/lib/api';
import { mono, useTheme, type ColorPalette } from '@/lib/design';

type Props = {
  title?: string;
  nearbyTitle?: string;
  insight: CampsiteInsight | null;
  loading: boolean;
  showLoadingSpinner?: boolean;
};

export default function CampInsightSection({
  title = 'CAMP INSIGHT',
  nearbyTitle = 'NEARBY',
  insight,
  loading,
  showLoadingSpinner = true,
}: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);

  if (!insight && !loading) return null;

  return (
    <View style={s.section}>
      <View style={s.header}>
        <Text style={s.sectionTitle}>{title}</Text>
        {showLoadingSpinner && loading ? <ActivityIndicator size="small" color={C.orange} /> : null}
        {insight?.star_rating ? <Text style={s.stars}>{insight.star_rating}/5</Text> : null}
      </View>
      {insight?.insider_tip ? (
        <View style={s.tipCard}>
          <Text style={s.tipLabel}>INSIDER TIP</Text>
          <Text style={s.tipText}>{insight.insider_tip}</Text>
        </View>
      ) : null}
      {insight?.best_for ? <Text style={s.meta}>Best for: {insight.best_for}</Text> : null}
      {insight?.best_season ? <Text style={s.meta}>Best season: {insight.best_season}</Text> : null}
      {insight?.hazards ? (
        <View style={s.hazardRow}>
          <Ionicons name="warning-outline" size={13} color={C.yellow} />
          <Text style={s.hazardText}>{insight.hazards}</Text>
        </View>
      ) : null}
      {insight?.nearby_highlights?.length ? (
        <View style={s.nearbyWrap}>
          <Text style={s.nearbyTitle}>{nearbyTitle}</Text>
          {insight.nearby_highlights.map((item, idx) => (
            <Text key={`${item}-${idx}`} style={s.nearbyItem}>• {item}</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  section: {
    paddingTop: 22,
    marginTop: 18,
    borderTopWidth: 1,
    borderColor: C.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  sectionTitle: {
    color: C.text2,
    fontSize: 10,
    fontFamily: mono,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  stars: {
    color: C.yellow,
    fontSize: 14,
  },
  tipCard: {
    backgroundColor: C.orange + '14',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.orange + '44',
    padding: 12,
    marginBottom: 8,
  },
  tipLabel: {
    color: C.orange,
    fontSize: 9,
    fontFamily: mono,
    fontWeight: '800',
    marginBottom: 4,
  },
  tipText: {
    color: C.text,
    fontSize: 13,
    lineHeight: 19,
  },
  meta: {
    color: C.text2,
    fontSize: 12,
    marginBottom: 3,
  },
  hazardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 6,
    backgroundColor: C.yellow + '14',
    borderRadius: 8,
    padding: 8,
  },
  hazardText: {
    color: C.yellow,
    fontSize: 12,
    flex: 1,
    lineHeight: 17,
  },
  nearbyWrap: {
    marginTop: 8,
  },
  nearbyTitle: {
    color: C.text2,
    fontSize: 10,
    fontFamily: mono,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  nearbyItem: {
    color: C.text2,
    fontSize: 12,
    marginBottom: 3,
  },
});
