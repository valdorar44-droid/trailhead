import React, { useMemo } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { mono, useTheme, type ColorPalette } from '@/lib/design';

export type MapWeatherHourRow = {
  id: string;
  hour: string;
  icon: keyof typeof Ionicons.glyphMap;
  temp: string;
  precip: string;
};

export type MapWeatherDayRow = {
  id: string;
  day: string;
  icon: keyof typeof Ionicons.glyphMap;
  temp: string;
  meta: string;
};

export type MapWeatherHealthRow = {
  label: string;
  value: string;
};

type Props = {
  visible: boolean;
  title: string;
  loadingMessage: string;
  currentIcon: keyof typeof Ionicons.glyphMap;
  currentTemp: string;
  currentMeta: string;
  currentWind: string;
  hourly: MapWeatherHourRow[];
  daily: MapWeatherDayRow[];
  health: MapWeatherHealthRow[];
  disclaimer: string;
  sourceLabel: string;
  hasData: boolean;
  onClose: () => void;
};

export default function MapWeatherSheet({
  visible,
  title,
  loadingMessage,
  currentIcon,
  currentTemp,
  currentMeta,
  currentWind,
  hourly,
  daily,
  health,
  disclaimer,
  sourceLabel,
  hasData,
  onClose,
}: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.modal}>
        <View style={s.header}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.kicker}>WEATHER AT MAP CENTER</Text>
            <Text style={s.title} numberOfLines={1}>{title}</Text>
          </View>
          <TouchableOpacity style={s.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={18} color={C.text2} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          {hasData ? (
            <>
              <View style={s.currentCard}>
                <Ionicons name={currentIcon} size={36} color="#38bdf8" />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.currentTemp}>{currentTemp}</Text>
                  <Text style={s.currentMeta}>{currentMeta}</Text>
                </View>
                <View style={s.metricStack}>
                  <Text style={s.metricValue}>{currentWind}</Text>
                  <Text style={s.metricSub}>wind</Text>
                </View>
              </View>

              <View style={s.section}>
                <Text style={s.sectionTitle}>NEXT HOURS</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.hourlyRail}>
                  {hourly.map(row => (
                    <View key={row.id} style={s.hourCard}>
                      <Text style={s.hourTime}>{row.hour}</Text>
                      <Ionicons name={row.icon} size={17} color="#38bdf8" />
                      <Text style={s.hourTemp}>{row.temp}</Text>
                      <Text style={s.hourRain}>{row.precip}</Text>
                    </View>
                  ))}
                </ScrollView>
              </View>

              <View style={s.section}>
                <Text style={s.sectionTitle}>7 DAY FORECAST</Text>
                {daily.map(row => (
                  <View key={row.id} style={s.dayRow}>
                    <Text style={s.dayName}>{row.day}</Text>
                    <Ionicons name={row.icon} size={17} color="#38bdf8" />
                    <Text style={s.dayTemp}>{row.temp}</Text>
                    <Text style={s.dayMeta}>{row.meta}</Text>
                  </View>
                ))}
              </View>

              <View style={s.section}>
                <Text style={s.sectionTitle}>AIR & HEALTH</Text>
                <View style={s.healthGrid}>
                  {health.map(item => (
                    <View key={item.label} style={s.healthCard}>
                      <Text style={s.healthLabel}>{item.label}</Text>
                      <Text style={s.healthValue}>{item.value}</Text>
                    </View>
                  ))}
                </View>
                <Text style={s.disclaimer}>{disclaimer}</Text>
              </View>

              <Text style={s.source}>{sourceLabel}</Text>
            </>
          ) : (
            <View style={s.loadingCard}>
              <ActivityIndicator size="small" color="#38bdf8" />
              <Text style={s.loadingText}>{loadingMessage}</Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  modal: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderColor: C.border,
  },
  kicker: {
    color: '#38bdf8',
    fontSize: 9,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 1,
  },
  title: {
    color: C.text,
    fontSize: 20,
    fontWeight: '900',
    marginTop: 3,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.s2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 16,
    paddingBottom: 100,
  },
  currentCard: {
    minHeight: 112,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: '#38bdf844',
    backgroundColor: '#38bdf810',
    borderRadius: 16,
    padding: 14,
    marginBottom: 18,
  },
  currentTemp: { color: C.text, fontSize: 34, fontWeight: '900' },
  currentMeta: { color: C.text3, fontSize: 12, marginTop: 3 },
  metricStack: { alignItems: 'flex-end' },
  metricValue: { color: '#38bdf8', fontSize: 13, fontFamily: mono, fontWeight: '900' },
  metricSub: { color: C.text3, fontSize: 9, fontFamily: mono, marginTop: 2 },
  section: {
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    borderRadius: 16,
    padding: 14,
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    color: C.text3,
    fontSize: 10,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  hourlyRail: { gap: 8, paddingRight: 4 },
  hourCard: {
    width: 70,
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    backgroundColor: C.s2,
  },
  hourTime: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '900' },
  hourTemp: { color: C.text, fontSize: 13, fontWeight: '900' },
  hourRain: { color: '#38bdf8', fontSize: 9, fontFamily: mono, fontWeight: '900' },
  dayRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderColor: C.border,
  },
  dayName: { width: 64, color: C.text, fontSize: 12, fontWeight: '900' },
  dayTemp: { flex: 1, color: C.text2, fontSize: 12, fontFamily: mono, fontWeight: '900' },
  dayMeta: { color: C.text3, fontSize: 10, fontFamily: mono },
  healthGrid: { flexDirection: 'row', gap: 8 },
  healthCard: {
    flex: 1,
    minHeight: 72,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    backgroundColor: C.s2,
    padding: 10,
    justifyContent: 'center',
  },
  healthLabel: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '900' },
  healthValue: { color: C.text, fontSize: 18, fontWeight: '900', marginTop: 4 },
  disclaimer: { color: C.text3, fontSize: 11, lineHeight: 16, marginTop: 10 },
  source: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '900', textAlign: 'center' },
  loadingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    borderRadius: 14,
    padding: 12,
  },
  loadingText: { color: C.text3, fontSize: 11, fontFamily: mono, fontWeight: '800' },
});
