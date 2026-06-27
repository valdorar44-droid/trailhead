import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { mono, useTheme, type ColorPalette } from '@/lib/design';
import type { OfflineReadinessRow } from '@/lib/offlineReadiness';
import type { RouteFitCard } from '@/lib/routeBuilder';

export type RouteReadinessCheck = RouteFitCard;

type RouteBuilderReadinessCardProps = {
  checks: RouteReadinessCheck[];
  offlineRows: OfflineReadinessRow[];
  showOfflineRows: boolean;
};

const FALLBACK_CHECKS: RouteReadinessCheck[] = [
  { level: 'warn', label: 'Start', text: 'Add your first route stop.' },
];

export default function RouteBuilderReadinessCard({
  checks,
  offlineRows,
  showOfflineRows,
}: RouteBuilderReadinessCardProps) {
  const C = useTheme();
  const s = styles(C);
  const visibleChecks = checks.length ? checks : FALLBACK_CHECKS;
  const needsCheck = visibleChecks.some(check => check.level === 'warn');

  return (
    <View style={s.card}>
      <View style={s.top}>
        <View style={s.copy}>
          <Text style={s.title}>Trip readiness</Text>
          <Text style={s.sub}>Camps, fuel, route, and downloads to check before leaving signal.</Text>
        </View>
        <View style={[s.badge, needsCheck ? s.badgeWarn : s.badgeOk]}>
          <Text style={[s.badgeText, { color: needsCheck ? C.yellow : C.green }]}>
            {needsCheck ? 'CHECK' : 'DONE'}
          </Text>
        </View>
      </View>

      <View style={s.checkGrid}>
        {visibleChecks.map(check => (
          <RouteBuilderRouteFitRow key={`${check.label}-${check.text}`} check={check} />
        ))}
      </View>

      {showOfflineRows ? (
        <View style={s.offlineGrid}>
          {offlineRows.map(row => (
            <OfflineReadinessPill key={row.key} row={row} />
          ))}
        </View>
      ) : null}
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

function OfflineReadinessPill({ row }: { row: OfflineReadinessRow }) {
  const C = useTheme();
  const s = styles(C);
  const color = row.ready ? C.green : row.needed ? C.yellow : C.text3;

  return (
    <View style={[s.offlinePill, row.ready ? s.offlinePillReady : row.needed ? s.offlinePillWarn : null]}>
      <Ionicons
        name={row.ready ? 'checkmark-circle-outline' : row.needed ? 'cloud-download-outline' : 'remove-circle-outline'}
        size={12}
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
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: C.text,
    fontSize: 13,
    fontWeight: '900',
  },
  sub: {
    color: C.text3,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
    maxWidth: 235,
  },
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  badgeWarn: {
    borderColor: C.yellow + '66',
    backgroundColor: C.yellow + '14',
  },
  badgeOk: {
    borderColor: C.green + '66',
    backgroundColor: C.green + '14',
  },
  badgeText: {
    fontSize: 9,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 0,
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingTop: 2,
  },
  offlinePill: {
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 999,
    paddingHorizontal: 8,
    backgroundColor: C.s2,
  },
  offlinePillReady: {
    borderColor: C.green + '55',
    backgroundColor: C.green + '10',
  },
  offlinePillWarn: {
    borderColor: C.yellow + '55',
    backgroundColor: C.yellow + '10',
  },
  offlineText: {
    color: C.text3,
    fontSize: 8.5,
    fontFamily: mono,
    fontWeight: '900',
  },
});
