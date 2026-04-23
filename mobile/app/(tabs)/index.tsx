import { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, TripResult } from '@/lib/api';
import { useStore } from '@/lib/store';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://trailhead-production-2049.up.railway.app';

const EXAMPLES = [
  '14-day loop through southern Utah — dispersed camping, off-road, a couple paid showers',
  '7-day overlanding trip from Denver into the San Juans, high clearance, wild camping only',
  'Weekend run near Moab, BLM land, taking my Tacoma',
];

interface Message {
  role: 'user' | 'ai';
  text?: string;
  trip?: TripResult;
}

export default function PlanScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const setActiveTrip = useStore(s => s.setActiveTrip);
  const router = useRouter();

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setMessages(m => [...m, { role: 'user', text }]);
    setLoading(true);
    try {
      const result = await api.plan(text);
      setActiveTrip(result);
      setMessages(m => [...m, { role: 'ai', trip: result }]);
    } catch (e: any) {
      setMessages(m => [...m, { role: 'ai', text: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.logo}>⛺ Trailhead</Text>
        <Text style={s.sub}>AI ADVENTURE PLANNER</Text>
      </View>

      <ScrollView ref={scrollRef} style={s.messages} contentContainerStyle={s.messagesContent}>
        {messages.length === 0 && (
          <View style={s.welcome}>
            <Text style={s.welcomeText}>
              Tell me about your next adventure — I'll plan the route, find dispersed campsites, and map out fuel stops.
            </Text>
            {EXAMPLES.map((ex, i) => (
              <TouchableOpacity key={i} style={s.example} onPress={() => setInput(ex)}>
                <Text style={s.exampleText}>{ex}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {messages.map((msg, i) => (
          <View key={i} style={[s.msg, msg.role === 'user' ? s.msgUser : s.msgAi]}>
            {msg.role === 'ai' && <Text style={s.msgLabel}>TRAILHEAD AI</Text>}
            {msg.role === 'user' && <Text style={[s.msgLabel, { textAlign: 'right' }]}>YOU</Text>}

            {msg.trip ? (
              <TripCard trip={msg.trip} onViewMap={() => router.push('/map')} />
            ) : (
              <View style={[s.bubble, msg.role === 'user' ? s.bubbleUser : s.bubbleAi]}>
                <Text style={[s.bubbleText, msg.role === 'user' && { color: '#fff' }]}>{msg.text}</Text>
              </View>
            )}
          </View>
        ))}

        {loading && (
          <View style={s.msgAi}>
            <Text style={s.msgLabel}>TRAILHEAD AI</Text>
            <View style={s.bubbleAi}>
              <ActivityIndicator color="#e67e22" size="small" />
              <Text style={[s.bubbleText, { marginLeft: 10 }]}>Planning your adventure...</Text>
            </View>
          </View>
        )}
      </ScrollView>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.inputWrap}>
          <TextInput
            style={s.input}
            value={input}
            onChangeText={setInput}
            placeholder="Describe your adventure..."
            placeholderTextColor="#64748b"
            multiline
            maxLength={500}
            onSubmitEditing={send}
          />
          <TouchableOpacity style={[s.sendBtn, loading && s.sendBtnDisabled]} onPress={send} disabled={loading}>
            <Ionicons name="send" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function TripCard({ trip, onViewMap }: { trip: TripResult; onViewMap: () => void }) {
  const p = trip.plan;

  function shareTrip() {
    Share.share({
      title: p.trip_name,
      message: `🗺️ ${p.trip_name}\n${p.duration_days} days · ${p.total_est_miles ?? '?'} miles · ${(p.states ?? []).join(', ')}\n\n${p.overview}\n\nPlanned with Trailhead AI: ${BASE_URL}`,
    });
  }

  return (
    <View style={tc.card}>
      <View style={tc.header}>
        <Text style={tc.title} numberOfLines={1}>{p.trip_name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={tc.states}>{(p.states ?? []).join(' · ')}</Text>
          <TouchableOpacity onPress={shareTrip}>
            <Ionicons name="share-outline" size={18} color="#64748b" />
          </TouchableOpacity>
        </View>
      </View>
      <Text style={tc.overview} numberOfLines={3}>{p.overview}</Text>
      <View style={tc.stats}>
        {[
          ['Days', p.duration_days],
          ['Miles', p.total_est_miles ?? '?'],
          ['Stops', p.waypoints?.length ?? 0],
          ['Camps', trip.campsites?.length ?? 0],
        ].map(([label, val]) => (
          <View key={label} style={tc.stat}>
            <Text style={tc.statVal}>{val}</Text>
            <Text style={tc.statLabel}>{label}</Text>
          </View>
        ))}
      </View>
      <TouchableOpacity style={tc.btn} onPress={onViewMap}>
        <Text style={tc.btnText}>VIEW ON MAP →</Text>
      </TouchableOpacity>
    </View>
  );
}

const tc = StyleSheet.create({
  card: { backgroundColor: '#1a1f2a', borderRadius: 12, borderWidth: 1, borderColor: '#252b38', overflow: 'hidden' },
  header: { padding: 12, borderBottomWidth: 1, borderColor: '#252b38', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: '#e2e8f0', fontWeight: '600', fontSize: 14, flex: 1 },
  states: { color: '#64748b', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  overview: { padding: 12, color: '#94a3b8', fontSize: 12.5, lineHeight: 18 },
  stats: { flexDirection: 'row', paddingHorizontal: 12, paddingBottom: 12, gap: 16 },
  stat: { alignItems: 'center' },
  statVal: { color: '#e67e22', fontSize: 18, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  statLabel: { color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  btn: { backgroundColor: '#e67e22', margin: 12, marginTop: 0, borderRadius: 8, padding: 10, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
});

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0c0f14' },
  header: { paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderColor: '#252b38', flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { color: '#e2e8f0', fontSize: 18, fontWeight: '700' },
  sub: { color: '#64748b', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', marginTop: 2 },
  messages: { flex: 1 },
  messagesContent: { padding: 16, gap: 12, flexGrow: 1 },
  welcome: { gap: 10 },
  welcomeText: { color: '#94a3b8', fontSize: 13.5, lineHeight: 20 },
  example: { backgroundColor: '#1a1f2a', borderWidth: 1, borderColor: '#252b38', borderRadius: 10, padding: 12 },
  exampleText: { color: '#e2e8f0', fontSize: 12.5, lineHeight: 18 },
  msg: { gap: 4 },
  msgUser: { alignItems: 'flex-end' },
  msgAi: { alignItems: 'flex-start' },
  msgLabel: { color: '#64748b', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', paddingHorizontal: 4 },
  bubble: { borderRadius: 14, padding: 12, maxWidth: '90%', flexDirection: 'row', alignItems: 'center' },
  bubbleUser: { backgroundColor: '#e67e22', borderBottomRightRadius: 4 },
  bubbleAi: { backgroundColor: '#1a1f2a', borderWidth: 1, borderColor: '#252b38', borderBottomLeftRadius: 4 },
  bubbleText: { color: '#e2e8f0', fontSize: 13.5, lineHeight: 20, flex: 1 },
  inputWrap: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1, borderColor: '#252b38', alignItems: 'flex-end' },
  input: { flex: 1, backgroundColor: '#1a1f2a', borderWidth: 1, borderColor: '#252b38', borderRadius: 14, padding: 12, color: '#e2e8f0', fontSize: 14, maxHeight: 120 },
  sendBtn: { width: 46, height: 46, borderRadius: 14, backgroundColor: '#e67e22', alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: '#252b38' },
});
