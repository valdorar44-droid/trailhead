import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { mono, useTheme, type ColorPalette } from '@/lib/design';

type Props = {
  visible: boolean;
  bottomInset: number;
  loading: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  highLow: string;
  precip: string;
  wind: string;
  aqi: string;
  onOpenDetails: () => void;
  onClose: () => void;
};

export default function MapWeatherPeek({
  visible,
  bottomInset,
  loading,
  icon,
  title,
  subtitle,
  highLow,
  precip,
  wind,
  aqi,
  onOpenDetails,
  onClose,
}: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);

  if (!visible) return null;

  return (
    <>
      <View style={s.overlay} pointerEvents="box-none">
        <View style={s.crosshair} pointerEvents="none">
          <View style={s.crosshairLineH} />
          <View style={s.crosshairLineV} />
          <View style={s.crosshairDot} />
        </View>
      </View>
      <View style={[s.sheet, { bottom: Math.max(bottomInset + 8, 14) }]} pointerEvents="box-none">
        <TouchableOpacity style={s.card} activeOpacity={0.9} onPress={onOpenDetails}>
          <View style={s.handleRow}>
            <View style={s.grabber} />
            <View style={s.actions}>
              <TouchableOpacity
                style={s.iconBtn}
                onPress={event => {
                  event.stopPropagation();
                  onOpenDetails();
                }}
              >
                <Ionicons name="chevron-up" size={15} color={C.text2} />
              </TouchableOpacity>
              <TouchableOpacity
                style={s.iconBtn}
                onPress={event => {
                  event.stopPropagation();
                  onClose();
                }}
              >
                <Ionicons name="close" size={14} color={C.text2} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={s.main}>
            <View style={s.iconWrap}>
              {loading ? (
                <ActivityIndicator size="small" color="#38bdf8" />
              ) : (
                <Ionicons name={icon} size={24} color="#38bdf8" />
              )}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.kicker}>WEATHER AT MAP CENTER</Text>
              <Text style={s.title} numberOfLines={1}>{title}</Text>
              <Text style={s.sub} numberOfLines={1}>{subtitle}</Text>
            </View>
          </View>

          <View style={s.metrics}>
            <MetricCard label="high / low" value={highLow} styles={s} />
            <MetricCard label="precip" value={precip} styles={s} />
            <MetricCard label="wind" value={wind} styles={s} />
            <MetricCard label="AQI" value={aqi} styles={s} />
          </View>
        </TouchableOpacity>
      </View>
    </>
  );
}

function MetricCard({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (C: ColorPalette) => {
  const light = String(C.bg || '').toLowerCase() === '#f7f8f6';
  const weatherSurface = light ? '#f8faf7' : 'rgba(17,24,39,0.98)';
  const weatherSurfaceSoft = light ? '#eef2ec' : 'rgba(255,255,255,0.06)';
  const weatherBorder = light ? 'rgba(148,163,184,0.34)' : 'rgba(56,189,248,0.30)';
  const weatherText = light ? '#101820' : '#f8fafc';
  const weatherText2 = light ? '#52606d' : '#cbd5e1';
  const weatherText3 = light ? '#6b7280' : '#94a3b8';
  const weatherButton = light ? '#edf1ec' : 'rgba(255,255,255,0.08)';

  return StyleSheet.create({
    overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 66 },
    crosshair: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
    crosshairLineH: { position: 'absolute', width: 46, height: 2, borderRadius: 1, backgroundColor: '#38bdf8' },
    crosshairLineV: { position: 'absolute', width: 2, height: 46, borderRadius: 1, backgroundColor: '#38bdf8' },
    crosshairDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: C.bg, borderWidth: 2, borderColor: '#38bdf8' },
    sheet: { position: 'absolute', left: 12, right: 12, zIndex: 130, elevation: 130, alignItems: 'stretch' },
    card: {
      minHeight: 204,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: weatherBorder,
      backgroundColor: weatherSurface,
      paddingHorizontal: 14,
      paddingTop: 8,
      paddingBottom: 16,
      shadowColor: '#000',
      shadowOpacity: light ? 0.22 : 0.34,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 12 },
      elevation: 28,
    },
    handleRow: { minHeight: 30, alignItems: 'center', justifyContent: 'center' },
    grabber: { width: 48, height: 5, borderRadius: 3, backgroundColor: light ? 'rgba(15,23,42,0.18)' : 'rgba(255,255,255,0.22)' },
    actions: { position: 'absolute', right: 0, top: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
    iconBtn: { width: 34, height: 34, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: weatherButton, borderWidth: 1, borderColor: weatherBorder },
    main: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    iconWrap: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#38bdf866', backgroundColor: '#e8f7fb' },
    kicker: { color: light ? '#117ea2' : '#38bdf8', fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8 },
    title: { color: weatherText, fontSize: 19, fontWeight: '900', marginTop: 3 },
    sub: { color: weatherText2, fontSize: 10.5, fontFamily: mono, marginTop: 3 },
    metrics: { flexDirection: 'row', gap: 8, marginTop: 14 },
    metric: { flex: 1, minHeight: 58, borderWidth: 1, borderColor: weatherBorder, backgroundColor: weatherSurfaceSoft, borderRadius: 14, paddingHorizontal: 7, paddingVertical: 8, justifyContent: 'center' },
    metricValue: { color: weatherText, fontSize: 11, fontFamily: mono, fontWeight: '900', textAlign: 'center' },
    metricLabel: { color: weatherText3, fontSize: 8, fontFamily: mono, fontWeight: '800', textAlign: 'center', marginTop: 3 },
  });
};
