import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { PlaceReview } from '@/lib/api';
import { mono, useTheme, type ColorPalette } from '@/lib/design';

type Props = {
  reviews: PlaceReview[];
  limit: number;
  showUpsell?: boolean;
  upsellText?: string;
  onPressUpsell?: () => void;
};

export default function CampReviewsSection({
  reviews,
  limit,
  showUpsell = false,
  upsellText = 'More review detail is included with Explorer.',
  onPressUpsell,
}: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);

  if (!reviews.length) return null;

  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>REVIEWS</Text>
      {reviews.slice(0, limit).map((review, idx) => (
        <View key={`${review.authorName || 'review'}-${idx}`} style={s.reviewCard}>
          <View style={s.reviewTop}>
            <Text style={s.reviewAuthor} numberOfLines={1}>{review.authorName || 'Review'}</Text>
            <Text style={s.reviewRating}>{review.rating ? `${review.rating}/5` : review.source || 'Provider'}</Text>
          </View>
          {!!review.relativeTime && <Text style={s.reviewMeta}>{review.relativeTime}</Text>}
          {!!review.text && <Text style={s.reviewText} numberOfLines={limit > 1 ? 4 : 2}>{review.text}</Text>}
        </View>
      ))}
      {showUpsell && onPressUpsell ? (
        <TouchableOpacity style={s.upsellCard} onPress={onPressUpsell}>
          <Ionicons name="lock-closed-outline" size={15} color={C.orange} />
          <Text style={s.upsellText}>{upsellText}</Text>
        </TouchableOpacity>
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
  sectionTitle: {
    color: C.text2,
    fontSize: 10,
    fontFamily: mono,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  reviewCard: {
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    borderRadius: 12,
    padding: 11,
    gap: 5,
    marginBottom: 8,
  },
  reviewTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  reviewAuthor: {
    flex: 1,
    color: C.text,
    fontSize: 12,
    fontWeight: '800',
  },
  reviewRating: {
    color: C.gold,
    fontSize: 10,
    fontFamily: mono,
    fontWeight: '900',
  },
  reviewMeta: {
    color: C.text3,
    fontSize: 10,
    fontFamily: mono,
  },
  reviewText: {
    color: C.text2,
    fontSize: 12,
    lineHeight: 17,
  },
  upsellCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: C.orange + '44',
    backgroundColor: C.orange + '12',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  upsellText: {
    flex: 1,
    color: C.text2,
    fontSize: 12,
    lineHeight: 17,
  },
});
