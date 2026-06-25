import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { mono, useTheme, type ColorPalette } from '@/lib/design';
import type { OfflineReadinessRow } from '@/lib/offlineReadiness';

export type RouteReadinessCheck = {
  level: 'ok' | 'warn';
  label: string;
  text: string;
};

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
            {needsCheck ? 'CHECK' : 'READY'}
          </Text>
        </View>
      </View>

      <View style={s.checkGrid}>
        {visibleChecks.map(check => (
          <View key={`${check.label}-${check.text}`} style={s.checkRow}>
            <Ionicons
              name={check.level === 'ok' ? 'checkmark-circle-outline' : 'alert-circle-outline'}
              size={15}
              color={check.level === 'ok' ? C.green : C.yellow}
            />
            <View style={s.checkCopy}>
              <Text style={s.checkLabel}>{check.label.toUpperCase()}</Text>
              <Text style={s.checkText}>{check.text}</Text>
            </View>
          </View>
        ))}
      </View>

      {showOfflineRows ? (
        <View style={s.offlineGrid}>
          {offlineRows.map(row => (
            <View key={row.key} style={[s.offlinePill, row.ready ? s.offlinePillReady : row.needed ? s.offlinePillWarn : null]}>
              <Ionicons
                name={row.ready ? 'checkmark-circle-outline' : row.needed ? 'cloud-download-outline' : 'remove-circle-outline'}
                size={12}
                color={row.ready ? C.green : row.needed ? C.yellow : C.text3}
              />
              <Text style={[s.offlineText, row.ready ? { color: C.green } : row.needed ? { color: C.yellow } : null]}>{row.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
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
    letterSpacing: 0.7,
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
    letterSpacing: 0.6,
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
