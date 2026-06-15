import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, mono, type ColorPalette } from '@/lib/design';

export type RouteAlertsPanelItem = {
  id: string;
  typeLabel: string;
  sourceLabel?: string | null;
  severityLabel?: string | null;
  severityTone?: string | null;
  critical?: boolean;
  description?: string | null;
  roadName?: string | null;
  timeLabel?: string | null;
};

type Props = {
  visible: boolean;
  count: number;
  alerts: RouteAlertsPanelItem[];
  onClose: () => void;
  onAlertPress?: (alertId: string) => void;
};

export default function RouteAlertsPanel({ visible, count, alerts, onClose, onAlertPress }: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);

  if (!visible || count === 0) return null;

  return (
    <View style={s.alertPanel}>
      <View style={s.alertHeader}>
        <Ionicons name="warning" size={14} color={C.red} />
        <Text style={s.alertTitle}>ROUTE ALERTS ({count})</Text>
        <TouchableOpacity onPress={onClose}>
          <Ionicons name="close" size={15} color={C.text3} />
        </TouchableOpacity>
      </View>
      <ScrollView style={s.alertScroll} showsVerticalScrollIndicator={false}>
        {alerts.map(alert => (
          <TouchableOpacity
            key={alert.id}
            activeOpacity={0.85}
            style={[s.alertItem, alert.critical && s.alertItemCritical]}
            onPress={() => onAlertPress?.(alert.id)}
          >
            <View style={s.alertMetaRow}>
              <Text style={s.alertBadge}>{alert.typeLabel}</Text>
              {!!alert.sourceLabel && <Text style={s.alertBadge}>{alert.sourceLabel}</Text>}
              {!!alert.severityLabel && (
                <Text style={[s.alertSev, alert.severityTone ? { color: alert.severityTone } : null]}>
                  {alert.severityLabel}
                </Text>
              )}
            </View>
            {!!alert.description && <Text style={s.alertDesc} numberOfLines={2}>{alert.description}</Text>}
            {!!alert.roadName && <Text style={s.alertDescMuted} numberOfLines={1}>{alert.roadName}</Text>}
            {!!alert.timeLabel && <Text style={s.alertTime}>{alert.timeLabel}</Text>}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  alertPanel: {
    position: 'absolute',
    top: 106,
    left: 16,
    right: 70,
    backgroundColor: C.glassStrong,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.red,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderColor: C.border,
  },
  alertTitle: { color: C.red, fontSize: 10, fontFamily: mono, fontWeight: '700', flex: 1 },
  alertScroll: { maxHeight: 160 },
  alertItem: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderColor: C.border },
  alertItemCritical: { borderLeftWidth: 3, borderLeftColor: C.red },
  alertMetaRow: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  alertBadge: { color: C.text, fontSize: 10, fontFamily: mono },
  alertSev: { fontSize: 9, fontFamily: mono, fontWeight: '700' },
  alertDesc: { color: C.text3, fontSize: 11 },
  alertDescMuted: { color: C.text3, fontSize: 11, opacity: 0.65 },
  alertTime: { color: C.text3, fontSize: 11, opacity: 0.45, marginTop: 1 },
});
