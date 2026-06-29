import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { CampFieldReport, FieldReportAccess, FieldReportCrowd, FieldReportSentiment, FieldReportSummary } from '@/lib/api';
import { mono, useTheme, type ColorPalette } from '@/lib/design';

type Props = {
  reports: CampFieldReport[];
  summary?: FieldReportSummary | null;
  limit: number;
  showSummary: boolean;
  canAddReport: boolean;
  onAddReport: () => void;
};

export default function CampFieldReportsSection({
  reports,
  summary,
  limit,
  showSummary,
  canAddReport,
  onAddReport,
}: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);

  return (
    <View style={s.section}>
      <View style={s.header}>
        <Text style={s.sectionTitle}>FIELD REPORTS</Text>
        {summary?.count ? (
          <Text style={s.count}>
            {summary.count} {summary.count === 1 ? 'report' : 'reports'}
          </Text>
        ) : null}
      </View>

      {showSummary && summary?.count ? <SentimentSummary summary={summary} /> : null}

      {reports.slice(0, limit).map(report => {
        const sentiment = fieldSentimentLabel(report.sentiment);
        const access = fieldAccessLabel(report.access_condition);
        const crowd = fieldCrowdLabel(report.crowd_level);
        return (
          <View key={report.id} style={s.card}>
            <View style={s.cardTop}>
              <View style={[s.iconBubble, { backgroundColor: sentiment.color + '18' }]}>
                <Ionicons name={sentiment.icon} size={15} color={sentiment.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.cardMeta}>{sentiment.label} · {report.username}</Text>
                <Text style={s.cardDate}>{report.visited_date}</Text>
                {report.rig_label ? <Text style={s.cardRig}>{report.rig_label}</Text> : null}
              </View>
              {report.has_photo ? <Ionicons name="camera-outline" size={13} color={C.text3} /> : null}
            </View>
            <View style={s.cardBadges}>
              <View style={s.miniBadge}>
                <Ionicons name={access.icon} size={10} color={access.color} />
                <Text style={s.cardBadge}>{access.label}</Text>
              </View>
              <View style={s.miniBadge}>
                <Ionicons name={crowd.icon} size={11} color={crowd.color} />
                <Text style={s.cardBadge}>{crowd.label}</Text>
              </View>
            </View>
            {report.tags.length > 0 ? (
              <View style={s.cardTags}>
                {report.tags.slice(0, 5).map(tag => (
                  <View key={tag} style={s.inlineTag}>
                    <Text style={s.inlineTagText}>{tag}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {report.note ? <Text style={s.cardNote} numberOfLines={3}>{report.note}</Text> : null}
          </View>
        );
      })}

      {reports.length === 0 ? <Text style={s.emptyText}>Share recent access, crowding, or road notes.</Text> : null}

      {canAddReport ? (
        <TouchableOpacity style={s.addBtn} onPress={onAddReport}>
          <Ionicons name="add-circle-outline" size={15} color={C.orange} />
          <Text style={s.addBtnText}>ADD FIELD REPORT</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function SentimentSummary({ summary }: { summary: FieldReportSummary }) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const total = Math.max(summary.count, 1);
  const loved = (summary.sentiment_counts.loved_it ?? 0) / total;
  const ok = (summary.sentiment_counts.its_ok ?? 0) / total;
  const skip = (summary.sentiment_counts.would_skip ?? 0) / total;

  return (
    <View style={{ marginBottom: 10 }}>
      <View style={s.sentimentBar}>
        {loved > 0 ? <View style={[s.sentimentSeg, { flex: loved, backgroundColor: '#22c55e' }]} /> : null}
        {ok > 0 ? <View style={[s.sentimentSeg, { flex: ok, backgroundColor: '#f59e0b' }]} /> : null}
        {skip > 0 ? <View style={[s.sentimentSeg, { flex: skip, backgroundColor: '#ef4444' }]} /> : null}
      </View>
      <View style={s.sentimentLegend}>
        {loved > 0 ? <LegendPill icon="heart" color="#22c55e" value={`${Math.round(loved * 100)}%`} /> : null}
        {ok > 0 ? <LegendPill icon="thumbs-up" color="#f59e0b" value={`${Math.round(ok * 100)}%`} /> : null}
        {skip > 0 ? <LegendPill icon="thumbs-down" color="#ef4444" value={`${Math.round(skip * 100)}%`} /> : null}
        {summary.last_visited ? <Text style={s.lastVisited}>Last visited {summary.last_visited}</Text> : null}
      </View>
      {summary.top_tags.length > 0 ? (
        <View style={s.tagCloud}>
          {summary.top_tags.map(({ tag, count }) => (
            <View key={tag} style={s.tagCloudItem}>
              <Text style={s.tagCloudText}>{tag}</Text>
              {count > 1 ? <Text style={s.tagCloudCount}>{count}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function LegendPill({ icon, color, value }: { icon: keyof typeof Ionicons.glyphMap; color: string; value: string }) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  return (
    <View style={s.legendPill}>
      <Ionicons name={icon} size={12} color={color} />
      <Text style={[s.legendItem, { color }]}>{value}</Text>
    </View>
  );
}

function fieldSentimentLabel(sentiment: FieldReportSentiment) {
  if (sentiment === 'loved_it') return { label: 'Loved it', icon: 'heart' as const, color: '#22c55e' };
  if (sentiment === 'would_skip') return { label: 'Would skip', icon: 'thumbs-down' as const, color: '#ef4444' };
  return { label: "It's ok", icon: 'thumbs-up' as const, color: '#f59e0b' };
}

function fieldAccessLabel(access: FieldReportAccess) {
  if (access === 'four_wd_required') return { label: '4WD required', icon: 'trail-sign-outline' as const, color: '#ef4444' };
  if (access === 'rough') return { label: 'Rough road', icon: 'warning-outline' as const, color: '#f59e0b' };
  return { label: 'Easy access', icon: 'checkmark-circle-outline' as const, color: '#22c55e' };
}

function fieldCrowdLabel(crowd: FieldReportCrowd) {
  if (crowd === 'packed') return { label: 'Packed', icon: 'people-outline' as const, color: '#ef4444' };
  if (crowd === 'few_rigs') return { label: 'A few rigs', icon: 'car-outline' as const, color: '#f59e0b' };
  return { label: 'Empty', icon: 'moon-outline' as const, color: '#22c55e' };
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
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: {
    color: C.text2,
    fontSize: 10,
    fontFamily: mono,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  count: {
    color: C.text3,
    fontSize: 11,
    fontFamily: mono,
  },
  sentimentBar: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: C.s2,
    marginBottom: 6,
  },
  sentimentSeg: {
    height: 6,
  },
  sentimentLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  legendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendItem: {
    fontSize: 12,
    fontWeight: '600',
  },
  lastVisited: {
    color: C.text3,
    fontSize: 11,
    marginLeft: 'auto',
  },
  tagCloud: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 2,
  },
  tagCloudItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: C.s2,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagCloudText: {
    color: C.text2,
    fontSize: 11,
  },
  tagCloudCount: {
    color: C.orange,
    fontSize: 10,
    fontWeight: '700',
  },
  card: {
    backgroundColor: C.s2,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6,
  },
  iconBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardMeta: {
    color: C.text2,
    fontSize: 12,
  },
  cardDate: {
    color: C.text3,
    fontSize: 10,
    fontFamily: mono,
    marginTop: 1,
  },
  cardRig: {
    color: C.text3,
    fontSize: 11,
    fontFamily: mono,
    marginTop: 1,
  },
  cardBadges: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 5,
    flexWrap: 'wrap',
  },
  miniBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.s1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  cardBadge: {
    color: C.text2,
    fontSize: 11,
  },
  cardTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 5,
  },
  inlineTag: {
    backgroundColor: C.s1,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  inlineTagText: {
    color: C.text3,
    fontSize: 10,
  },
  cardNote: {
    color: C.text2,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  emptyText: {
    color: C.text3,
    fontSize: 12,
    fontStyle: 'italic',
    marginBottom: 10,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  addBtnText: {
    color: C.orange,
    fontSize: 12,
    fontFamily: mono,
    fontWeight: '700',
  },
});
