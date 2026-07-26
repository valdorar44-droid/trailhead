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

import type {
  CampgroundBriefFactV3,
  CampgroundBriefNearbyV3,
  CampgroundBriefV3,
  CampsiteInsight,
  WeatherForecast,
} from '@/lib/api';
import { mono, useTheme, type ColorPalette } from '@/lib/design';
import CampInsightSection from '@/components/map/CampInsightSection';

type Props = {
  brief: CampgroundBriefV3 | null;
  loading: boolean;
  weather?: WeatherForecast | null;
  insight: CampsiteInsight | null;
  loadingInsight: boolean;
  onPersonalize: () => void;
};

function timestampLabel(value?: number | string | null) {
  if (!value) return '';
  const date = new Date(typeof value === 'number' ? value * 1000 : value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function weatherLine(weather?: WeatherForecast | null) {
  if (!weather?.daily?.time?.length) return null;
  const high = weather.daily.temperature_2m_max?.[0];
  const low = weather.daily.temperature_2m_min?.[0];
  const temperature = weather.trailhead_units?.temperature_label || '°';
  const parts = [
    Number.isFinite(high) ? `High ${Math.round(high)}${temperature}` : '',
    Number.isFinite(low) ? `Low ${Math.round(low)}${temperature}` : '',
  ].filter(Boolean);
  if (!parts.length) return null;
  return {
    value: parts.join(' · '),
    updated: timestampLabel(weather.current?.time || weather.daily.time[0]),
    source: weather.source_label || 'Weather forecast',
  };
}

function FactRows({ rows, C, s }: {
  rows: CampgroundBriefFactV3[];
  C: ColorPalette;
  s: ReturnType<typeof makeStyles>;
}) {
  if (!rows.length) return null;
  return (
    <View style={s.rows}>
      {rows.map((row, index) => (
        <TouchableOpacity
          key={row.id}
          style={[s.row, index > 0 && s.rowBorder]}
          disabled={!row.url}
          onPress={() => row.url && Linking.openURL(row.url)}
          activeOpacity={row.url ? 0.72 : 1}
        >
          <Text style={s.rowLabel}>{row.label}</Text>
          <View style={s.rowValueWrap}>
            <Text style={s.rowValue}>{row.value}</Text>
            {row.url ? <Ionicons name="open-outline" size={13} color={C.orange} /> : null}
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function NearbyRows({ rows, s }: {
  rows: CampgroundBriefNearbyV3[];
  s: ReturnType<typeof makeStyles>;
}) {
  if (!rows.length) return null;
  return (
    <View style={s.nearbyList}>
      {rows.slice(0, 10).map(row => (
        <View key={`${row.kind}:${row.id}`} style={s.nearbyRow}>
          <View style={s.nearbyBody}>
            <Text style={s.nearbyName} numberOfLines={1}>{row.name}</Text>
            <Text style={s.nearbyMeta} numberOfLines={1}>
              {[row.label, row.source_label].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {row.distance_mi != null ? <Text style={s.nearbyDistance}>{row.distance_mi.toFixed(1)} mi</Text> : null}
        </View>
      ))}
    </View>
  );
}

export default function CampgroundBriefSection({
  brief,
  loading,
  weather,
  insight,
  loadingInsight,
  onPersonalize,
}: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const forecast = weatherLine(weather);

  if (!brief && !loading) return null;

  return (
    <View style={s.section} testID="campground-brief-v3">
      <View style={s.header}>
        <View>
          <Text style={s.kicker}>CAMP DETAILS</Text>
          <Text style={s.title}>Campground brief</Text>
        </View>
        {loading ? <ActivityIndicator size="small" color={C.orange} /> : null}
      </View>

      {!brief ? (
        <View style={s.skeleton} testID="campground-brief-loading">
          <View style={[s.skeletonLine, { width: '58%' }]} />
          <View style={[s.skeletonLine, { width: '86%' }]} />
          <View style={[s.skeletonLine, { width: '72%' }]} />
        </View>
      ) : (
        <>
          <FactRows rows={brief.facts} C={C} s={s} />

          {brief.site_types.length ? (
            <View style={s.block}>
              <Text style={s.blockTitle}>Sites</Text>
              <Text style={s.bodyText}>{brief.site_types.join(' · ')}</Text>
            </View>
          ) : null}

          {brief.access.length ? (
            <View style={s.block}>
              <Text style={s.blockTitle}>Access and setup</Text>
              <FactRows rows={brief.access} C={C} s={s} />
            </View>
          ) : null}

          {brief.amenities.length ? (
            <View style={s.block}>
              <Text style={s.blockTitle}>Amenities</Text>
              <Text style={s.bodyText}>{brief.amenities.join(' · ')}</Text>
            </View>
          ) : null}

          {forecast ? (
            <View style={s.block}>
              <Text style={s.blockTitle}>Weather</Text>
              <Text style={s.bodyText}>{forecast.value}</Text>
              <Text style={s.sourceText}>
                {[forecast.source, forecast.updated && `Updated ${forecast.updated}`].filter(Boolean).join(' · ')}
              </Text>
            </View>
          ) : null}

          {brief.conditions.length ? (
            <View style={s.block}>
              <Text style={s.blockTitle}>Current notes</Text>
              <FactRows rows={brief.conditions} C={C} s={s} />
            </View>
          ) : null}

          {brief.mobile_coverage ? (
            <View style={s.block}>
              <Text style={s.blockTitle}>Mobile coverage</Text>
              {brief.mobile_coverage.records.length ? brief.mobile_coverage.records.map((record, index) => (
                <Text key={`${record.provider}:${record.technology}:${index}`} style={s.bodyText}>
                  {record.provider} · {record.technology} · {record.availability}
                </Text>
              )) : <Text style={s.bodyText}>No location-specific records listed</Text>}
              <Text style={s.sourceText}>
                {[
                  brief.mobile_coverage.source_label,
                  brief.mobile_coverage.last_checked && `Checked ${timestampLabel(brief.mobile_coverage.last_checked)}`,
                ].filter(Boolean).join(' · ')}
              </Text>
              <Text style={s.noticeText}>{brief.mobile_coverage.notice}</Text>
            </View>
          ) : null}

          {brief.booking_contact.length ? (
            <View style={s.block}>
              <Text style={s.blockTitle}>Booking and contact</Text>
              <FactRows rows={brief.booking_contact} C={C} s={s} />
            </View>
          ) : null}

          {brief.nearby_services.length ? (
            <View style={s.block}>
              <Text style={s.blockTitle}>Useful nearby</Text>
              <NearbyRows rows={brief.nearby_services} s={s} />
            </View>
          ) : null}

          {brief.nearby_places.length ? (
            <View style={s.block}>
              <Text style={s.blockTitle}>Places nearby</Text>
              <NearbyRows rows={brief.nearby_places} s={s} />
            </View>
          ) : null}

          {brief.unavailable.length ? (
            <Text style={s.unavailable}>Not listed: {brief.unavailable.join(', ')}</Text>
          ) : null}

          <View style={s.sources}>
            <Text style={s.blockTitle}>Sources</Text>
            {brief.sources.map(source => (
              <TouchableOpacity
                key={source.id}
                disabled={!source.url}
                onPress={() => source.url && Linking.openURL(source.url)}
                style={s.sourceRow}
              >
                <Text style={s.sourceName}>{source.label}</Text>
                <Text style={s.sourceText}>
                  {[
                    source.role,
                    source.updated_at && `Checked ${timestampLabel(source.updated_at)}`,
                  ].filter(Boolean).join(' · ')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {insight || loadingInsight ? (
            <CampInsightSection
              title="Personalized planning"
              nearbyTitle="Nearby highlights"
              insight={insight}
              loading={loadingInsight}
              showLoadingSpinner
            />
          ) : brief.personalized_planning.available ? (
            <TouchableOpacity
              style={s.personalize}
              onPress={onPersonalize}
              testID="campground-brief-personalize"
            >
              <View style={s.personalizeCopy}>
                <Text style={s.personalizeTitle}>Personalize this stay</Text>
                <Text style={s.personalizeMeta}>Explorer or credits</Text>
              </View>
              <Ionicons name="arrow-forward" size={17} color={C.orange} />
            </TouchableOpacity>
          ) : null}
        </>
      )}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  kicker: {
    color: C.orange,
    fontSize: 9,
    fontFamily: mono,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginBottom: 2,
  },
  title: {
    color: C.text,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '800',
  },
  skeleton: {
    gap: 8,
    paddingVertical: 4,
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
    backgroundColor: C.s2,
  },
  rows: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    paddingVertical: 10,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  rowLabel: {
    color: C.text2,
    fontSize: 13,
    flexShrink: 0,
  },
  rowValueWrap: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 5,
  },
  rowValue: {
    color: C.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    textAlign: 'right',
  },
  block: {
    marginTop: 18,
  },
  blockTitle: {
    color: C.text2,
    fontSize: 10,
    lineHeight: 14,
    fontFamily: mono,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 7,
  },
  bodyText: {
    color: C.text,
    fontSize: 13,
    lineHeight: 19,
  },
  noticeText: {
    color: C.text3,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 5,
  },
  sourceText: {
    color: C.text3,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 3,
  },
  nearbyList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  nearbyRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    paddingVertical: 8,
  },
  nearbyBody: {
    flex: 1,
  },
  nearbyName: {
    color: C.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  nearbyMeta: {
    color: C.text3,
    fontSize: 10,
    lineHeight: 14,
  },
  nearbyDistance: {
    color: C.text2,
    fontSize: 11,
  },
  unavailable: {
    color: C.text3,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 18,
  },
  sources: {
    marginTop: 18,
  },
  sourceRow: {
    minHeight: 44,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    paddingVertical: 7,
  },
  sourceName: {
    color: C.text,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  personalize: {
    minHeight: 52,
    marginTop: 18,
    borderWidth: 1,
    borderColor: C.orange + '66',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  personalizeCopy: {
    flex: 1,
  },
  personalizeTitle: {
    color: C.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  personalizeMeta: {
    color: C.text3,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 1,
  },
});
