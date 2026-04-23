import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Speech from 'expo-speech';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '@/lib/store';
import { api } from '@/lib/api';

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
  const locationSub = useRef<Location.LocationSubscription | null>(null);
  const [autoPlay, setAutoPlay] = useState(false);

  useEffect(() => {
    if (!activeTrip) return;
    if (activeTrip.audio_guide) {
      setGuide(activeTrip.audio_guide);
    } else {
      setGuideLoading(true);
      api.getAudioGuide(activeTrip.trip_id)
        .then(g => setGuide(g))
        .catch(() => {})
        .finally(() => setGuideLoading(false));
    }

    const firstWp = activeTrip.plan.waypoints.find(w => w.lat && w.lng);
    if (firstWp?.lat && firstWp?.lng) {
      setWeatherLoading(true);
      api.getWeather(firstWp.lat, firstWp.lng, activeTrip.plan.duration_days)
        .then(w => setWeather(w))
        .catch(() => {})
        .finally(() => setWeatherLoading(false));
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
          const wps = activeTrip.plan.waypoints.filter(w => w.lat && w.lng);
          for (const wp of wps) {
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
        <View style={s.header}><Text style={s.headerTitle}>AUDIO GUIDE</Text></View>
        <View style={s.empty}>
          <Ionicons name="headset-outline" size={56} color="#252b38" />
          <Text style={s.emptyTitle}>No Active Trip</Text>
          <Text style={s.emptySub}>Plan a trip on the PLAN tab to unlock your personal audio guide</Text>
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
          <Ionicons name={autoPlay ? 'radio' : 'radio-outline'} size={15} color={autoPlay ? '#e67e22' : '#64748b'} />
          <Text style={[s.autoBtnText, autoPlay && { color: '#e67e22' }]}>AUTO</Text>
        </TouchableOpacity>
      </View>

      {/* Tab switcher */}
      <View style={s.tabs}>
        {(['narrations', 'weather'] as const).map(t => (
          <TouchableOpacity key={t} style={[s.tabBtn, tab === t && s.tabBtnActive]} onPress={() => setTab(t)}>
            <Text style={[s.tabBtnText, tab === t && s.tabBtnTextActive]}>
              {t === 'narrations' ? '🎙 NARRATIONS' : '🌤 WEATHER'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        {tab === 'narrations' && (
          <>
            {guideLoading && (
              <View style={s.loadRow}>
                <ActivityIndicator color="#e67e22" />
                <Text style={s.loadText}>Generating your audio guide with AI...</Text>
              </View>
            )}

            {waypoints.map((wp, i) => {
              const narration = guide[wp.name] ?? '';
              const isPlaying = playing === wp.name;
              return (
                <View key={i} style={s.card}>
                  <View style={s.cardTop}>
                    <View style={s.dayBadge}><Text style={s.dayBadgeText}>{wp.day}</Text></View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={s.wpName} numberOfLines={1}>{wp.name}</Text>
                      <Text style={s.wpMeta}>{wp.type} · {wp.land_type}</Text>
                    </View>
                    <TouchableOpacity
                      style={[s.playBtn, isPlaying && s.playBtnActive, !narration && s.playBtnDisabled]}
                      onPress={() => narration && playNarration(wp.name, narration)}
                      disabled={!narration}
                    >
                      <Ionicons
                        name={isPlaying ? 'stop' : 'play'}
                        size={16}
                        color={narration ? (isPlaying ? '#fff' : '#e67e22') : '#374151'}
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

            {/* What's here? */}
            <View style={s.nearbyCard}>
              <Text style={s.nearbyLabel}>WHAT'S AROUND ME?</Text>
              <Text style={s.nearbySub}>Instant AI narration for your current location</Text>
              {!!nearbyNarration && <Text style={s.nearbyText}>{nearbyNarration}</Text>}
              <TouchableOpacity style={s.nearbyBtn} onPress={whatIsHere} disabled={nearbyLoading}>
                {nearbyLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <>
                      <Ionicons name="location" size={15} color="#fff" />
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
                <ActivityIndicator color="#e67e22" />
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
                  const matchDay = i + 1;
                  const wp = activeTrip.plan.daily_itinerary.find(day => day.day === matchDay);
                  return (
                    <View key={date} style={s.weatherDay}>
                      <Text style={s.weatherIcon}>{wmoIcon(code)}</Text>
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={s.weatherDate}>{label}</Text>
                        {wp && <Text style={s.weatherDayTitle} numberOfLines={1}>{wp.title}</Text>}
                      </View>
                      <View style={s.weatherRight}>
                        <Text style={s.weatherHiLo}>{hi}° / {lo}°</Text>
                        <Text style={s.weatherMeta}>
                          {rain > 0 ? `${rain.toFixed(1)}" ` : ''}💨 {wind}mph
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
            {!weatherLoading && !weather && (
              <View style={s.empty}>
                <Ionicons name="cloud-offline-outline" size={40} color="#252b38" />
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
  container: { flex: 1, backgroundColor: '#0c0f14' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderColor: '#252b38',
  },
  headerTitle: {
    color: '#e2e8f0', fontSize: 13, fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  headerSub: { color: '#64748b', fontSize: 11, marginTop: 2 },
  autoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 12, borderWidth: 1, borderColor: '#252b38',
  },
  autoBtnOn: { borderColor: '#e67e22', backgroundColor: 'rgba(230,126,34,0.1)' },
  autoBtnText: { color: '#64748b', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#252b38' },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: '#e67e22' },
  tabBtnText: { color: '#64748b', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  tabBtnTextActive: { color: '#e67e22' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 12, paddingBottom: 32 },
  loadRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 16, backgroundColor: '#1a1f2a', borderRadius: 12,
    borderWidth: 1, borderColor: '#252b38',
  },
  loadText: { color: '#94a3b8', fontSize: 13 },
  card: { backgroundColor: '#1a1f2a', borderRadius: 12, borderWidth: 1, borderColor: '#252b38', padding: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  dayBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#e67e22', alignItems: 'center', justifyContent: 'center' },
  dayBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  wpName: { color: '#e2e8f0', fontSize: 13, fontWeight: '600' },
  wpMeta: { color: '#64748b', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', marginTop: 1 },
  playBtn: {
    width: 38, height: 38, borderRadius: 19,
    borderWidth: 1.5, borderColor: '#e67e22',
    alignItems: 'center', justifyContent: 'center',
  },
  playBtnActive: { backgroundColor: '#e67e22', borderColor: '#e67e22' },
  playBtnDisabled: { borderColor: '#252b38' },
  narration: { color: '#94a3b8', fontSize: 13, lineHeight: 20 },
  narrationMissing: { color: '#374151', fontSize: 12 },
  nearbyCard: {
    backgroundColor: '#1a1f2a', borderRadius: 12,
    borderWidth: 1, borderColor: '#252b38',
    padding: 16, gap: 10,
  },
  nearbyLabel: {
    color: '#e67e22', fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', fontWeight: '700',
  },
  nearbySub: { color: '#64748b', fontSize: 12 },
  nearbyText: { color: '#94a3b8', fontSize: 13, lineHeight: 20 },
  nearbyBtn: {
    backgroundColor: '#e67e22', borderRadius: 8, padding: 11,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  nearbyBtnText: { color: '#fff', fontWeight: '700', fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  weatherWrap: { gap: 8 },
  weatherRegion: {
    color: '#64748b', fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    marginBottom: 4,
  },
  weatherDay: {
    backgroundColor: '#1a1f2a', borderRadius: 10,
    borderWidth: 1, borderColor: '#252b38',
    padding: 12, flexDirection: 'row', alignItems: 'center',
  },
  weatherIcon: { fontSize: 24 },
  weatherDate: { color: '#e2e8f0', fontSize: 12, fontWeight: '600' },
  weatherDayTitle: { color: '#64748b', fontSize: 10, marginTop: 1 },
  weatherRight: { alignItems: 'flex-end' },
  weatherHiLo: { color: '#e2e8f0', fontSize: 14, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  weatherMeta: { color: '#64748b', fontSize: 10, marginTop: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyTitle: { color: '#e2e8f0', fontSize: 16, fontWeight: '600' },
  emptySub: { color: '#64748b', fontSize: 13, textAlign: 'center', maxWidth: 260, lineHeight: 20 },
});
