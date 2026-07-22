import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { api, type RatingSummaryV1 } from '@/lib/api';
import type { CommunityRatingTarget } from '@/lib/communityRatingEligibility';
import { useTheme, type ColorPalette } from '@/lib/design';

export default function FirstPartyRatingSection({
  target,
  testID = 'first-party-rating',
}: {
  target: CommunityRatingTarget | null;
  testID?: string;
}) {
  const C = useTheme();
  const s = makeStyles(C);
  const [summary, setSummary] = useState<RatingSummaryV1 | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const generationRef = useRef(0);
  const targetKey = target ? `${target.kind}:${target.entityId}` : '';

  useEffect(() => {
    const generation = ++generationRef.current;
    setSummary(null);
    setError('');
    setSaving(false);
    if (!target) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api.getCommunityRating(target.kind, target.entityId)
      .then(next => {
        if (generationRef.current === generation) setSummary(next);
      })
      .catch(() => {
        if (generationRef.current === generation) setError('Ratings are unavailable right now.');
      })
      .finally(() => {
        if (generationRef.current === generation) setLoading(false);
      });
  }, [targetKey]);

  if (!target) return null;

  const setRating = async (rating: 1 | 2 | 3 | 4 | 5) => {
    if (saving) return;
    const generation = generationRef.current;
    setSaving(true);
    setError('');
    try {
      const next = await api.setCommunityRating(target.kind, target.entityId, rating);
      if (generationRef.current === generation) setSummary(next);
    } catch {
      if (generationRef.current === generation) setError('Could not save your rating.');
    } finally {
      if (generationRef.current === generation) setSaving(false);
    }
  };

  const removeRating = async () => {
    if (saving) return;
    const generation = generationRef.current;
    setSaving(true);
    setError('');
    try {
      const next = await api.deleteCommunityRating(target.kind, target.entityId);
      if (generationRef.current === generation) setSummary(next);
    } catch {
      if (generationRef.current === generation) setError('Could not remove your rating.');
    } finally {
      if (generationRef.current === generation) setSaving(false);
    }
  };

  const viewerRating = summary?.viewer_rating ?? null;
  const count = summary?.count ?? 0;
  const summaryLabel = loading && !summary
    ? 'Loading ratings…'
    : count > 0 && summary?.average != null
      ? `${summary.average.toFixed(1)} · ${count} ${count === 1 ? 'rating' : 'ratings'}`
      : 'Be the first to rate this';

  return (
    <View testID={testID} style={s.section}>
      <View style={s.headingRow}>
        <View style={s.headingCopy}>
          <Text style={s.heading}>Trailhead ratings</Text>
          <Text testID={`${testID}-summary`} style={s.summary}>{summaryLabel}</Text>
        </View>
        {loading || saving ? <ActivityIndicator color={C.orange} size="small" /> : null}
      </View>
      <View style={s.stars} accessibilityRole="radiogroup">
        {([1, 2, 3, 4, 5] as const).map(rating => {
          const selected = viewerRating != null && rating <= viewerRating;
          return (
            <TouchableOpacity
              key={rating}
              testID={`${testID}-star-${rating}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: viewerRating === rating, disabled: saving }}
              accessibilityLabel={`${rating} ${rating === 1 ? 'star' : 'stars'}`}
              style={[s.starButton, viewerRating === rating && s.starButtonSelected]}
              disabled={saving}
              onPress={() => setRating(rating)}
            >
              <Ionicons name={selected ? 'star' : 'star-outline'} size={22} color={selected ? C.orange : C.text3} />
            </TouchableOpacity>
          );
        })}
      </View>
      {viewerRating != null ? (
        <TouchableOpacity
          testID={`${testID}-remove`}
          accessibilityRole="button"
          disabled={saving}
          style={s.removeButton}
          onPress={removeRating}
        >
          <Text style={s.remove}>Remove my rating</Text>
        </TouchableOpacity>
      ) : null}
      {error ? <Text testID={`${testID}-error`} style={s.error}>{error}</Text> : null}
    </View>
  );
}

function makeStyles(C: ColorPalette) {
  return StyleSheet.create({
    section: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: C.border,
      paddingTop: 12,
      gap: 10,
    },
    headingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    headingCopy: { flex: 1, minWidth: 0 },
    heading: { color: C.text, fontSize: 15, lineHeight: 19, fontWeight: '900' },
    summary: { color: C.text3, fontSize: 12, lineHeight: 16, marginTop: 2 },
    stars: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    starButton: {
      width: 48,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.glass,
    },
    starButtonSelected: { borderColor: C.orange + '88', backgroundColor: C.orange + '12' },
    removeButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
    remove: { color: C.text3, fontSize: 12, lineHeight: 16, fontWeight: '700' },
    error: { color: C.red, fontSize: 12, lineHeight: 16 },
  });
}
