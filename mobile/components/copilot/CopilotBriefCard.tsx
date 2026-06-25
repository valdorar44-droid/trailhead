import React, { useMemo } from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { mono, useTheme, type ColorPalette } from '@/lib/design';
import CopilotActionCard, { type CopilotActionCardItem } from './CopilotActionCard';

type IconName = keyof typeof Ionicons.glyphMap;

type Props = {
  kicker: string;
  title: string;
  summary: string;
  icon?: IconName;
  tone?: 'ready' | 'review' | 'neutral';
  sourceLabel?: string;
  reason?: string;
  actions: readonly CopilotActionCardItem[];
  style?: StyleProp<ViewStyle>;
};

export default function CopilotBriefCard({
  kicker,
  title,
  summary,
  icon = 'map-outline',
  tone = 'neutral',
  sourceLabel,
  reason,
  actions,
  style,
}: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const toneColor = tone === 'ready' ? C.green : tone === 'review' ? C.orange : C.silverBright;
  return (
    <View style={[s.card, { borderColor: toneColor + '4d', backgroundColor: toneColor + '12' }, style]}>
      <View style={s.header}>
        <View style={[s.iconBadge, { borderColor: toneColor + '55', backgroundColor: toneColor + '16' }]}>
          <Ionicons name={icon} size={18} color={toneColor} />
        </View>
        <View style={s.titleBlock}>
          <Text style={[s.kicker, { color: toneColor }]} numberOfLines={1}>{kicker}</Text>
          <Text style={[s.title, { color: C.text }]} numberOfLines={2}>{title}</Text>
        </View>
      </View>

      <Text style={[s.summary, { color: C.text2 }]} numberOfLines={5}>{summary}</Text>

      {(reason || sourceLabel) ? (
        <View style={[s.metaBox, { borderColor: C.border, backgroundColor: C.s2 }]}>
          {reason ? (
            <View style={s.metaRow}>
              <Ionicons name="sparkles-outline" size={13} color={toneColor} />
              <Text style={[s.metaText, { color: C.text2 }]} numberOfLines={2}>{reason}</Text>
            </View>
          ) : null}
          {sourceLabel ? (
            <View style={s.metaRow}>
              <Ionicons name="shield-checkmark-outline" size={13} color={C.text3} />
              <Text style={[s.metaText, { color: C.text3 }]} numberOfLines={1}>{sourceLabel}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={s.actions}>
        {actions.map(action => (
          <CopilotActionCard
            key={action.label}
            action={action}
            style={actions.length === 1 ? s.actionFull : s.actionFlex}
          />
        ))}
      </View>
    </View>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 13,
    gap: 11,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  kicker: {
    fontSize: 9,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 1,
  },
  title: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '900',
    marginTop: 2,
  },
  summary: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  metaBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 7,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  metaText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionFlex: {
    flex: 1,
  },
  actionFull: {
    flex: 1,
  },
});
