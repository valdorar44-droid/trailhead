import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Speech from 'expo-speech';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '@/lib/store';
import { api } from '@/lib/api';
import { C, mono } from '@/lib/design';

const WMO_ICON: Record<number, string> = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
  45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌧️',
  61: '🌧️', 63: '🌧️', 65: '🌧️',
  71: '❄️', 73: '❄️', 75: '❄️',
  80: '🌦️', 81: '🌦️', 82: '🌧️',
  85: '🌨️', 86: '🌨️',
  95: '⛈️', 96: '⛈️', 99: '⛈️',
};

function wmoIcon(code: number) {
  const keys = Object.keys(WMO_ICON).map(Number).sort((a, b) => b - a);
  for (const k of keys) { if (code >= k) return WMO_ICON[k]; }
  return '🌡️';
}

export default function GuideScreen() {
  const activeTrip = useStore(s => s.activeTrip);
  const [guide, setGuide] = useState<Record<string, string>>({});
  const [guideLoading, setGuideLoading] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [nearbyNarration, setNearbyNarration] = useState('');
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [weather, setWeather] = useState<any>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [tab, setTab] = useState<'narrations' | 'weather'>('narrations');
  const [autoPlay, setAutoPlay] = useState(false);
  const locationSub = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    if (!activeTrip) return;
    if (activeTrip.audio_guide) {
      setGuide(activeTrip.audio_guide);
    } else {
      setGuideLoading(true);
      api.getAudioGuide(activeTrip.trip_id)
        .then(setGuide).catch(() => {}).finally(() => setGuideLoading(false));
    }
    const firstWp = activeTrip.plan.waypoints.find(w => w.lat && w.lng);
    if (firstWp?.lat && firstWp?.lng) {
      setWeatherLoading(true);
      api.getWeather(firstWp.lat, firstWp.lng, activeTrip.plan.duration_days)
        .then(setWeather).catch(() => {}).finally(() => setWeatherLoading(false));
    }
  }, [activeTrip?.trip_id]);

  useEffect(() => {
    if (!autoPlay || !activeTrip) {
      locationSub.current?.remove();
      locationSub.current = null;
      return;
    }
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') return;
      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 200 },
        loc => {
          const { latitude, longitude } = loc.coords;
          for (const wp of activeTrip.plan.waypoints.filter(w => w.lat && w.lng)) {
            const dist = Math.sqrt(
              Math.pow((wp.lat! - latitude) * 111, 2) +
              Math.pow((wp.lng! - longitude) * 111 * Math.cos(latitude * Math.PI / 180), 2)
            );
            if (dist < 1.0 && guide[wp.name] && playing !== wp.name) {
              playNarration(wp.name, guide[wp.name]);
              break;
            }
          }
        }
      ).then(sub => { locationSub.current = sub; });
    });
    return () => { locationSub.current?.remove(); locationSub.current = null; };
  }, [autoPlay, activeTrip?.trip_id, guide]);

  function playNarration(name: string, text: string) {
    Speech.stop();
    if (playing === name) { setPlaying(null); return; }
    setPlaying(name);
    Speech.speak(text, {
      language: 'en-US', rate: 0.92,
      onDone: () => setPlaying(null),
      onStopped: () => setPlaying(null),
      onError: () => setPlaying(null),
    });
  }

  async function whatIsHere() {
    setNearbyLoading(true);
    setNearbyNarration('');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({});
      const res = await api.nearbyAudio(loc.coords.latitude, loc.coords.longitude);
      setNearbyNarration(res.narration);
      Speech.speak(res.narration, { language: 'en-US', rate: 0.92 });
    } catch {
      setNearbyNarration('Could not generate narration for this location.');
    } finally {
      setNearbyLoading(false);
    }
  }

  if (!activeTrip) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <Text style={s.headerTitle}>AUDIO GUIDE</Text>
        </View>
        <View style={s.emptyState}>
          <Text style={s.emptyIcon}>🎙</Text>
          <Text style={s.emptyTitle}>No Active Trip</Text>
          <Text style={s.emptySub}>Plan a trip on the PLAN tab to unlock your personal audio guide.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const waypoints = activeTrip.plan.waypoints.filter(w => w.lat && w.lng);

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>AUDIO GUIDE</Text>
          <Text style={s.headerSub} numberOfLines={1}>{activeTrip.plan.trip_name}</Text>
        </View>
        <TouchableOpacity
          style={[s.autoBtn, autoPlay && s.autoBtnOn]}
          onPress={() => setAutoPlay(p => !p)}
        >
          <Ionicons name={autoPlay ? 'radio' : 'radio-outline'} size={14}
            color={autoPlay ? C.orange : C.text3} />
          <Text style={[s.autoBtnText, autoPlay && { color: C.orange }]}>AUTO</Text>
        </TouchableOpacity>
      </View>

      <View style={s.tabs}>
        {(['narrations', 'weather'] as const).map(t => (
          <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabActive]} onPress={() => setTab(t)}>
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>
              {t === 'narrations' ? '🎙  NARRATIONS' : '🌤  WEATHER'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        {tab === 'narrations' && (
          <>
            {guideLoading && (
              <View style={s.loadRow}>
                <ActivityIndicator color={C.orange} />
                <Text style={s.loadText}>Generating audio guide with AI...</Text>
              </View>
            )}

            {waypoints.map((wp, i) => {
              const narration = guide[wp.name] ?? '';
              const isPlaying = playing === wp.name;
              return (
                <View key={i} style={s.card}>
                  <View style={s.cardTop}>
                    <View style={s.dayBadge}>
                      <Text style={s.dayBadgeText}>{wp.day}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={s.wpName} numberOfLines={1}>{wp.name}</Text>
                      <Text style={s.wpMeta}>{wp.type} · {wp.land_type}</Text>
                    </View>
                    <TouchableOpacity
                      style={[s.playBtn, isPlaying && s.playBtnActive, !narration && s.playBtnDisabled]}
                      onPress={() => narration && playNarration(wp.name, narration)}
                      disabled={!narration}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons
                        name={isPlaying ? 'stop' : 'play'}
                        size={18}
                        color={narration ? (isPlaying ? '#fff' : C.orange) : C.border}
                      />
                    </TouchableOpacity>
                  </View>
                  {narration
                    ? <Text style={s.narration}>{narration}</Text>
                    : !guideLoading && <Text style={s.narrationMissing}>Narration unavailable</Text>
                  }
                </View>
              );
            })}

            <View style={s.nearbyCard}>
              <Text style={s.nearbyLabel}>WHAT'S AROUND ME?</Text>
              <Text style={s.nearbySub}>Instant AI narration for your current GPS location</Text>
              {!!nearbyNarration && <Text style={s.nearbyText}>{nearbyNarration}</Text>}
              <TouchableOpacity style={s.nearbyBtn} onPress={whatIsHere} disabled={nearbyLoading}>
                {nearbyLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <>
                      <Ionicons name="location" size={16} color="#fff" />
                      <Text style={s.nearbyBtnText}>TELL ME ABOUT HERE</Text>
                    </>
                }
              </TouchableOpacity>
            </View>
          </>
        )}

        {tab === 'weather' && (
          <>
            {weatherLoading && (
              <View style={s.loadRow}>
                <ActivityIndicator color={C.orange} />
                <Text style={s.loadText}>Loading forecast...</Text>
              </View>
            )}
            {weather?.daily && (
              <View style={s.weatherWrap}>
                <Text style={s.weatherRegion}>
                  Forecast · {activeTrip.plan.states.join(', ')} region
                </Text>
                {weather.daily.time.map((date: string, i: number) => {
                  const hi = Math.round(weather.daily.temperature_2m_max[i]);
                  const lo = Math.round(weather.daily.temperature_2m_min[i]);
                  const rain = weather.daily.precipitation_sum[i];
                  const wind = Math.round(weather.daily.windspeed_10m_max[i]);
                  const code = weather.daily.weathercode[i];
                  const d = new Date(date);
                  const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                  const wp = activeTrip.plan.daily_itinerary.find(day => day.day === i + 1);
                  return (
                    <View key={date} style={s.weatherDay}>
                      <Text style={s.weatherIcon}>{wmoIcon(code)}</Text>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={s.weatherDate}>{label}</Text>
                        {wp && <Text style={s.weatherDayTitle} numberOfLines={1}>{wp.title}</Text>}
                      </View>
                      <View style={s.weatherRight}>
                        <Text style={s.weatherHiLo}>{hi}° / {lo}°</Text>
                        <Text style={s.weatherMeta}>
                          {rain > 0 ? `${rain.toFixed(1)}" ` : ''}💨{wind}mph
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
            {!weatherLoading && !weather && (
              <View style={s.emptyState}>
                <Text style={s.emptyIcon}>🌐</Text>
                <Text style={s.emptySub}>Weather unavailable for this trip area</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderColor: C.border, backgroundColor: C.s1,
  },
  headerTitle: { color: C.text, fontSize: 14, fontWeight: '800', fontFamily: mono, letterSpacing: 0.5 },
  headerSub: { color: C.text3, fontSize: 11, marginTop: 2 },
  autoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.s2,
  },
  autoBtnOn: { borderColor: C.orange, backgroundColor: C.orangeGlow },
  autoBtnText: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '700' },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: C.border, backgroundColor: C.s1 },
  tab: { flex: 1, paddingVertical: 11, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: C.orange },
  tabText: { color: C.text3, fontSize: 11, fontFamily: mono },
  tabTextActive: { color: C.orange },
  scroll: { flex: 1 },
  scrollContent: { padding: 14, gap: 12, paddingBottom: 32 },
  loadRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 16, backgroundColor: C.s2, borderRadius: 12, borderWidth: 1, borderColor: C.border,
  },
  loadText: { color: C.text2, fontSize: 13 },
  card: { backgroundColor: C.s2, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  dayBadge: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center',
  },
  dayBadgeText: { color: '#fff', fontSize: 12, fontWeight: '800', fontFamily: mono },
  wpName: { color: C.text, fontSize: 13, fontWeight: '700' },
  wpMeta: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 2 },
  playBtn: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 2, borderColor: C.orange,
    alignItems: 'center', justifyContent: 'center',
  },
  playBtnActive: { backgroundColor: C.orange, borderColor: C.orange },
  playBtnDisabled: { borderColor: C.border },
  narration: { color: C.text2, fontSize: 13, lineHeight: 20 },
  narrationMissing: { color: C.text3, fontSize: 12 },
  nearbyCard: {
    backgroundColor: C.s2, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 16, gap: 10,
  },
  nearbyLabel: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '700', letterSpacing: 0.5 },
  nearbySub: { color: C.text3, fontSize: 12 },
  nearbyText: { color: C.text2, fontSize: 13, lineHeight: 20 },
  nearbyBtn: {
    backgroundColor: C.orange, borderRadius: 10, padding: 13,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: C.orange, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 8,
  },
  nearbyBtnText: { color: '#fff', fontWeight: '700', fontSize: 12, fontFamily: mono, letterSpacing: 0.3 },
  weatherWrap: { gap: 8 },
  weatherRegion: { color: C.text3, fontSize: 10, fontFamily: mono, letterSpacing: 0.5, marginBottom: 4 },
  weatherDay: {
    backgroundColor: C.s2, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    padding: 12, flexDirection: 'row', alignItems: 'center',
  },
  weatherIcon: { fontSize: 26 },
  weatherDate: { color: C.text, fontSize: 12, fontWeight: '700' },
  weatherDayTitle: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 1 },
  weatherRight: { alignItems: 'flex-end' },
  weatherHiLo: { color: C.text, fontSize: 15, fontWeight: '800', fontFamily: mono },
  weatherMeta: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 2 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 80 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { color: C.text, fontSize: 17, fontWeight: '700' },
  emptySub: { color: C.text3, fontSize: 13, textAlign: 'center', maxWidth: 260, lineHeight: 20 },
});
