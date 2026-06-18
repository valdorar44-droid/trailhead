import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { MissionControlBrief, MissionControlRecommendation, MissionProviderEvidence, MissionReadiness, MissionStatusItem } from '@/lib/api';
import { mono, useTheme } from '@/lib/design';

type Props = {
  brief: MissionControlBrief | null;
  loading?: boolean;
  onRefresh: () => void;
  onRecommendation: (item: MissionControlRecommendation) => void;
};

const READINESS: Record<MissionReadiness, { label: string; icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  ready: { label: 'READY', icon: 'checkmark-circle', color: '#22c55e' },
  needs_review: { label: 'REVIEW', icon: 'alert-circle', color: '#f97316' },
  blocked: { label: 'BLOCKED', icon: 'close-circle', color: '#ef4444' },
};

export function MissionControlPanel({ brief, loading, onRefresh, onRecommendation }: Props) {
  const C = useTheme();
  const [expanded, setExpanded] = useState(false);
  const status = READINESS[brief?.readiness || 'needs_review'];
  const risks = brief?.risks?.slice(0, expanded ? 5 : 2) ?? [];
  const scores = brief?.scores?.slice(0, expanded ? 8 : 4) ?? [];
  const actions = (brief?.next_actions?.length ? brief.next_actions : brief?.recommendations)?.slice(0, 4) ?? [];
  const statusRows = missionStatusRows(brief?.status_summary, expanded);
  const evidenceRows = missionEvidenceRows(brief, expanded);
  return (
    <View style={[styles.panel, { borderColor: C.border, backgroundColor: C.s1 }]}>
      <View style={styles.header}>
        <View style={[styles.statusIcon, { backgroundColor: status.color }]}>
          <Ionicons name={status.icon as any} size={18} color="#fff" />
        </View>
        <View style={styles.titleBlock}>
          <Text style={[styles.kicker, { color: status.color }]}>MISSION CONTROL</Text>
          <Text style={[styles.title, { color: C.text }]} numberOfLines={1}>
            {loading ? 'Checking route' : brief?.headline || 'Trip needs review'}
          </Text>
        </View>
        <TouchableOpacity style={[styles.iconBtn, { borderColor: C.border }]} onPress={onRefresh} disabled={loading}>
          <Ionicons name={loading ? 'hourglass-outline' : 'refresh'} size={17} color={C.text2} />
        </TouchableOpacity>
      </View>

      <Text style={[styles.summary, { color: C.text2 }]} numberOfLines={expanded ? 4 : 2}>
        {brief?.summary || 'Route readiness will appear after the trip context loads.'}
      </Text>

      {statusRows.length > 0 && (
        <View style={styles.statusList}>
          {statusRows.map(row => (
            <View key={row.key} style={[styles.statusRow, { borderColor: C.border }]}>
              <View style={[styles.statusDot, { backgroundColor: colorForStatus(row.item) }]} />
              <Text style={[styles.statusName, { color: C.text2 }]} numberOfLines={1}>{row.item.label}</Text>
              <Text style={[styles.statusValue, { color: C.text }]} numberOfLines={1}>{formatStatusValue(row.item.value)}</Text>
            </View>
          ))}
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scoreRow}>
        <View style={[styles.statusPill, { backgroundColor: status.color }]}>
          <Text style={styles.statusPillText}>{status.label}</Text>
        </View>
        {scores.map(score => (
          <View key={score.id} style={[styles.scorePill, { borderColor: C.border, backgroundColor: C.s2 }]}>
            <Text style={[styles.scoreLabel, { color: C.text2 }]} numberOfLines={1}>{score.label}</Text>
            <Text style={[styles.scoreState, { color: score.status === 'ready' ? '#22c55e' : score.status === 'blocked' ? '#ef4444' : '#f97316' }]}>
              {score.status === 'needs_review' ? 'review' : score.status}
            </Text>
          </View>
        ))}
      </ScrollView>

      {risks.length > 0 && (
        <View style={styles.riskList}>
          {risks.map(risk => (
            <View key={risk.id} style={styles.riskRow}>
              <Ionicons
                name={risk.severity === 'block' ? 'close-circle' : risk.severity === 'warning' ? 'alert-circle' : 'information-circle'}
                size={15}
                color={risk.severity === 'block' ? '#ef4444' : '#f97316'}
              />
              <Text style={[styles.riskText, { color: C.text2 }]} numberOfLines={2}>
                <Text style={{ color: C.text, fontWeight: '900' }}>{risk.title}: </Text>{risk.summary}
              </Text>
            </View>
          ))}
        </View>
      )}

      {expanded && evidenceRows.length > 0 && (
        <View style={styles.evidenceList}>
          {evidenceRows.map(row => (
            <View key={row.provider_id} style={styles.evidenceRow}>
              <Ionicons name="shield-checkmark-outline" size={15} color={colorForEvidence(row.confidence)} />
              <Text style={[styles.evidenceText, { color: C.text2 }]} numberOfLines={2}>
                <Text style={{ color: C.text, fontWeight: '900' }}>{row.name}: </Text>{formatStatusValue(row.confidence)} confidence
              </Text>
            </View>
          ))}
        </View>
      )}

      {actions.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionRow}>
          {actions.map(action => (
            <TouchableOpacity key={`${action.action_type}-${action.priority}`} style={[styles.action, { borderColor: C.border }]} onPress={() => onRecommendation(action)}>
              <Ionicons name={iconForAction(action.action_type)} size={16} color={C.orange} />
              <Text style={[styles.actionText, { color: C.text }]} numberOfLines={1}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <TouchableOpacity style={styles.expandBtn} onPress={() => setExpanded(value => !value)}>
        <Text style={[styles.expandText, { color: C.text3 }]}>{expanded ? 'Less' : 'Why'}</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={15} color={C.text3} />
      </TouchableOpacity>
    </View>
  );
}

function missionStatusRows(statusSummary: MissionControlBrief['status_summary'] | undefined, expanded: boolean): Array<{ key: string; item: MissionStatusItem }> {
  if (!statusSummary) return [];
  const keys = ['route_status', 'overnights', 'rig_fit', 'legal_stay', 'fuel_risk', 'conditions', 'offline_readiness', 'reports'];
  return keys
    .map(key => ({ key, item: statusSummary[key] }))
    .filter((row): row is { key: string; item: MissionStatusItem } => !!row.item)
    .slice(0, expanded ? 8 : 4);
}

function missionEvidenceRows(brief: MissionControlBrief | null, expanded: boolean): MissionProviderEvidence[] {
  if (!expanded || !brief) return [];
  if (brief.provider_evidence?.length) return brief.provider_evidence.slice(0, 4);
  return (brief.source_summary || []).slice(0, 4).map(source => ({
    provider_id: source.provider_ids?.[0] || source.source,
    name: source.source,
    count: source.count,
    confidence: source.confidence,
    score: source.score,
    factors: source.factors,
    freshness_label: source.freshness_label,
    attribution: source.attribution,
  }));
}

function formatStatusValue(value: string | undefined): string {
  return String(value || 'unknown').replace(/_/g, ' ');
}

function colorForStatus(item: MissionStatusItem): string {
  if (item.readiness === 'ready' || ['safe', 'high', 'clear', 'complete', 'current', 'confirmed'].includes(item.value)) return '#22c55e';
  if (item.readiness === 'blocked' || ['warning', 'not_recommended', 'blocked'].includes(item.value)) return '#ef4444';
  return '#f97316';
}

function colorForEvidence(confidence: string | undefined): string {
  if (confidence === 'high') return '#22c55e';
  if (confidence === 'low' || confidence === 'review') return '#f97316';
  return '#94a3b8';
}

function iconForAction(actionType: string): keyof typeof Ionicons.glyphMap {
  if (actionType.includes('Fuel') || actionType === 'searchPlaces') return 'search';
  if (actionType.includes('Offline')) return 'download-outline';
  if (actionType.includes('Layer') || actionType.includes('Filter')) return 'layers-outline';
  if (actionType.includes('Route')) return 'map-outline';
  return 'flash-outline';
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
    gap: 9,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  titleBlock: { flex: 1, minWidth: 0 },
  kicker: { fontFamily: mono, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  title: { fontSize: 15, lineHeight: 19, fontWeight: '900', letterSpacing: 0 },
  iconBtn: { width: 34, height: 34, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  summary: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  statusList: { gap: 5 },
  statusRow: { minHeight: 24, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 7, paddingTop: 5 },
  statusDot: { width: 7, height: 7, borderRadius: 999 },
  statusName: { flex: 1, minWidth: 0, fontSize: 10, fontWeight: '800' },
  statusValue: { maxWidth: 118, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  scoreRow: { gap: 7, paddingRight: 6 },
  statusPill: { minHeight: 30, borderRadius: 999, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  statusPillText: { color: '#fff', fontFamily: mono, fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  scorePill: { minHeight: 30, minWidth: 92, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, justifyContent: 'center' },
  scoreLabel: { fontSize: 10, fontWeight: '800' },
  scoreState: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  riskList: { gap: 6 },
  riskRow: { flexDirection: 'row', gap: 7, alignItems: 'flex-start' },
  riskText: { flex: 1, fontSize: 11, lineHeight: 15, fontWeight: '700' },
  evidenceList: { gap: 6 },
  evidenceRow: { flexDirection: 'row', gap: 7, alignItems: 'flex-start' },
  evidenceText: { flex: 1, fontSize: 11, lineHeight: 15, fontWeight: '700' },
  actionRow: { gap: 8, paddingRight: 6 },
  action: { minHeight: 38, borderRadius: 13, borderWidth: 1, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionText: { maxWidth: 110, fontSize: 12, fontWeight: '900' },
  expandBtn: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 26 },
  expandText: { fontFamily: mono, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
});
