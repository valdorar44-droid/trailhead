import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { CampgroundPlanningBriefV1 } from '@/lib/api';
import { mono, useTheme, type ColorPalette } from '@/lib/design';

type Props = {
  brief: CampgroundPlanningBriefV1 | null;
  loading: boolean;
  onShow: () => void;
};

function generatedLabel(value?: number | null) {
  if (!value) return '';
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return '';
  return `Sources checked ${date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })}`;
}

function BriefText({ title, text, s }: {
  title: string;
  text?: string | null;
  s: ReturnType<typeof makeStyles>;
}) {
  if (!text) return null;
  return (
    <View style={s.block}>
      <Text style={s.blockTitle}>{title}</Text>
      <Text style={s.body}>{text}</Text>
    </View>
  );
}

function BriefList({ title, items, s }: {
  title: string;
  items?: string[] | null;
  s: ReturnType<typeof makeStyles>;
}) {
  if (!items?.length) return null;
  return (
    <View style={s.block}>
      <Text style={s.blockTitle}>{title}</Text>
      {items.map((item, index) => (
        <View key={`${title}-${index}`} style={s.bulletRow}>
          <View style={s.bullet} />
          <Text style={s.bulletText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

export default function CampgroundBriefSection({ brief, loading, onShow }: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);

  if (!brief) {
    return (
      <TouchableOpacity
        style={[s.showButton, loading && s.showButtonDisabled]}
        onPress={onShow}
        disabled={loading}
        activeOpacity={0.78}
        testID="campground-show-brief"
        accessibilityRole="button"
        accessibilityLabel="Show campground brief"
        accessibilityHint="Costs 5 credits or is included with Explorer"
      >
        <View style={s.showIcon}>
          <Ionicons name="reader-outline" size={20} color={C.orange} />
        </View>
        <View style={s.showBody}>
          <Text style={s.showTitle}>{loading ? 'Preparing brief' : 'Show brief'}</Text>
          <Text style={s.showMeta}>5 credits · Included with Explorer</Text>
        </View>
        {loading
          ? <ActivityIndicator size="small" color={C.orange} />
          : <Ionicons name="chevron-forward" size={19} color={C.text3} />}
      </TouchableOpacity>
    );
  }

  return (
    <View style={s.section} testID="campground-planning-brief">
      <View style={s.header}>
        <View style={s.headerText}>
          <Text style={s.kicker}>TRIP PLANNING</Text>
          <Text style={s.title}>Campground brief</Text>
          {generatedLabel(brief.generated_at) ? (
            <Text style={s.freshness}>{generatedLabel(brief.generated_at)}</Text>
          ) : null}
        </View>
        <Ionicons name="reader-outline" size={21} color={C.orange} />
      </View>

      {brief.summary ? <Text style={s.summary}>{brief.summary}</Text> : null}
      <BriefText title="Best time" text={brief.best_time} s={s} />
      <BriefText title="Access and rig" text={brief.access_and_rig} s={s} />
      <BriefText title="Service and signal" text={brief.service_and_signal} s={s} />
      <BriefList title="What to look out for" items={brief.look_out_for} s={s} />
      <BriefList title="Before you go" items={brief.preparation} s={s} />
      <BriefList title="Nearby" items={brief.nearby_context} s={s} />

      {brief.sources?.length ? (
        <View style={s.sources}>
          <Text style={s.sourcesTitle}>Sources</Text>
          {brief.sources.map(source => (
            <TouchableOpacity
              key={source.url}
              style={s.sourceRow}
              onPress={() => Linking.openURL(source.url)}
              activeOpacity={0.72}
              accessibilityRole="link"
            >
              <Text style={s.sourceLabel} numberOfLines={2}>{source.label}</Text>
              <Ionicons name="open-outline" size={14} color={C.orange} />
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  showButton: {
    minHeight: 72,
    marginTop: 18,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    backgroundColor: C.s1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  showButtonDisabled: {
    opacity: 0.72,
  },
  showIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.orange + '14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  showBody: {
    flex: 1,
  },
  showTitle: {
    color: C.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
  },
  showMeta: {
    color: C.text2,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  section: {
    marginTop: 18,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    backgroundColor: C.s1,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 13,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerText: {
    flex: 1,
  },
  kicker: {
    color: C.orange,
    fontFamily: mono,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  title: {
    color: C.text,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '900',
    marginTop: 3,
  },
  freshness: {
    color: C.text3,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  summary: {
    color: C.text,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    marginTop: 14,
  },
  block: {
    marginTop: 15,
  },
  blockTitle: {
    color: C.text2,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: mono,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  body: {
    color: C.text,
    fontSize: 14,
    lineHeight: 21,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    marginTop: 6,
  },
  bullet: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: C.orange,
    marginTop: 8,
  },
  bulletText: {
    flex: 1,
    color: C.text,
    fontSize: 14,
    lineHeight: 21,
  },
  sources: {
    marginTop: 17,
    paddingTop: 13,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  sourcesTitle: {
    color: C.text2,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: mono,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  sourceRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  sourceLabel: {
    flex: 1,
    color: C.text2,
    fontSize: 12,
    lineHeight: 17,
  },
});
