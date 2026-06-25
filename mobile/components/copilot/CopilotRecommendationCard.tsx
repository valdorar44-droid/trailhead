import React, { useMemo } from 'react';
import { StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { mono, useTheme, type ColorPalette } from '@/lib/design';
import CopilotActionCard, { type CopilotActionCardItem } from './CopilotActionCard';

type IconName = keyof typeof Ionicons.glyphMap;

type Props = {
  title: string;
  summary: string;
  reason: string;
  icon?: IconName;
  tags?: readonly string[];
  sourceLabel?: string;
  action: CopilotActionCardItem;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

export default function CopilotRecommendationCard({
  title,
  summary,
  reason,
  icon = 'sparkles-outline',
  tags = [],
  sourceLabel,
  action,
  onPress,
  style,
}: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const body = (
    <View style={[s.card, style]}>
      <View style={s.header}>
        <View style={s.iconBadge}>
          <Ionicons name={icon} size={18} color={C.orange} />
        </View>
        <View style={s.titleBlock}>
          <Text style={s.kicker} numberOfLines={1}>TRIP IDEA</Text>
          <Text style={s.title} numberOfLines={1}>{title}</Text>
        </View>
      </View>

      <Text style={s.summary} numberOfLines={3}>{summary}</Text>

      <View style={s.reasonRow}>
        <Ionicons name="trail-sign-outline" size={13} color={C.green} />
        <Text style={s.reasonText} numberOfLines={2}>{reason}</Text>
      </View>

      {(tags.length > 0 || sourceLabel) ? (
        <View style={s.tagRow}>
          {tags.slice(0, 3).map(tag => (
            <View key={tag} style={s.tag}>
              <Text style={s.tagText} numberOfLines={1}>{tag}</Text>
            </View>
          ))}
          {sourceLabel ? <Text style={s.sourceText} numberOfLines={1}>{sourceLabel}</Text> : null}
        </View>
      ) : null}

      <CopilotActionCard action={action} />
    </View>
  );

  if (!onPress) return body;
  return <TouchableOpacity activeOpacity={0.86} onPress={onPress}>{body}</TouchableOpacity>;
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    padding: 12,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.orange + '44',
    backgroundColor: C.orange + '14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  kicker: {
    color: C.orange,
    fontSize: 8.5,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 0.9,
  },
  title: {
    color: C.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
    marginTop: 2,
  },
  summary: {
    color: C.text2,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '600',
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  reasonText: {
    flex: 1,
    color: C.text2,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  tag: {
    minHeight: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s2,
    paddingHorizontal: 7,
    justifyContent: 'center',
  },
  tagText: {
    color: C.text3,
    fontSize: 8.5,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  sourceText: {
    color: C.text3,
    fontSize: 9.5,
    fontFamily: mono,
    fontWeight: '800',
    marginLeft: 2,
  },
});
