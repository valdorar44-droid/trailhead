import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { mono, useTheme, type ColorPalette } from '@/lib/design';
import type { OfflineReadinessRow } from '@/lib/offlineReadiness';
import type { RouteFitCard } from '@/lib/routeBuilder';

export type RouteReadinessCheck = RouteFitCard;

type RouteBuilderReadinessCardProps = {
  checks: RouteReadinessCheck[];
  offlineRows: OfflineReadinessRow[];
  showOfflineRows: boolean;
  onOpenOffline: () => void;
};

const FALLBACK_CHECKS: RouteReadinessCheck[] = [
  { level: 'warn', label: 'Start', text: 'Add your first route stop.' },
];

export default function RouteBuilderReadinessCard({
  checks,
  offlineRows,
  showOfflineRows,
  onOpenOffline,
}: RouteBuilderReadinessCardProps) {
  const C = useTheme();
  const s = styles(C);
  const visibleChecks = checks.length ? checks : FALLBACK_CHECKS;

  return (
    <View style={s.card}>
      <Text style={s.title}>Trip readiness</Text>

      <View style={s.checkGrid}>
        {visibleChecks.map(check => (
          <RouteBuilderRouteFitRow key={`${check.label}-${check.text}`} check={check} />
        ))}
      </View>

      {showOfflineRows ? (
        <View style={s.offlineGrid}>
          {offlineRows.map(row => (
            <OfflineReadinessItem key={row.key} row={row} />
          ))}
        </View>
      ) : null}

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Open Offline"
        activeOpacity={0.76}
        onPress={onOpenOffline}
        style={s.offlineAction}
      >
        <Ionicons name="cloud-download-outline" size={18} color={C.orange} />
        <Text style={s.offlineActionLabel}>Offline</Text>
        <Ionicons name="chevron-forward" size={16} color={C.text3} />
      </TouchableOpacity>
    </View>
  );
}

function RouteBuilderRouteFitRow({ check }: { check: RouteReadinessCheck }) {
  const C = useTheme();
  const s = styles(C);
  const ready = check.level === 'ok';

  return (
    <View style={s.checkRow}>
      <Ionicons
        name={ready ? 'checkmark-circle-outline' : 'alert-circle-outline'}
        size={15}
        color={ready ? C.green : C.yellow}
      />
      <View style={s.checkCopy}>
        <Text style={s.checkLabel}>{check.label.toUpperCase()}</Text>
        <Text style={s.checkText}>{check.text}</Text>
      </View>
    </View>
  );
}

function OfflineReadinessItem({ row }: { row: OfflineReadinessRow }) {
  const C = useTheme();
  const s = styles(C);
  const color = row.ready ? C.green : row.needed ? C.yellow : C.text3;

  return (
    <View style={s.offlineRow}>
      <Ionicons
        name={row.ready ? 'checkmark-circle-outline' : row.needed ? 'cloud-download-outline' : 'remove-circle-outline'}
        size={14}
        color={color}
      />
      <Text style={[s.offlineText, row.ready || row.needed ? { color } : null]}>{row.label}</Text>
    </View>
  );
}

const styles = (C: ColorPalette) => StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
    backgroundColor: C.s1,
    gap: 10,
  },
  title: {
    color: C.text,
    fontSize: 13,
    fontWeight: '900',
  },
  checkGrid: {
    gap: 8,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  checkCopy: {
    flex: 1,
    minWidth: 0,
  },
  checkLabel: {
    color: C.text3,
    fontSize: 8,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 0,
  },
  checkText: {
    color: C.text2,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 1,
  },
  offlineGrid: {
    gap: 7,
  },
  offlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  offlineText: {
    color: C.text3,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  offlineAction: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
    paddingTop: 9,
  },
  offlineActionLabel: {
    flex: 1,
    color: C.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
});
