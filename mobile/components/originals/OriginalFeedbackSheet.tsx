import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/design';
import {
  ORIGINAL_FEEDBACK_CATEGORIES,
  originalFeedbackStore,
  originalsApi,
  retryOriginalFeedback,
  submitOriginalFeedback,
  type OriginalFeedbackCategory,
  type OriginalFeedbackPlatform,
} from '@/lib/originals';
import { useStore } from '@/lib/store';

const CATEGORY_LABELS: Record<OriginalFeedbackCategory, string> = {
  general: 'General',
  trigger_timing: 'Trigger timing',
  audio: 'Audio',
  map: 'Map',
  offline: 'Offline',
  access_info: 'Access info',
  safety: 'Safety',
  other: 'Other',
};

function feedbackPlatform(): OriginalFeedbackPlatform {
  if (Platform.OS === 'ios' || Platform.OS === 'android') return Platform.OS;
  return 'web';
}

export default function OriginalFeedbackSheet({
  visible,
  packId,
  version,
  stopId,
  onClose,
}: {
  visible: boolean;
  packId: string;
  version: number;
  stopId?: string;
  onClose: () => void;
}) {
  const C = useTheme();
  const insets = useSafeAreaInsets();
  const token = useStore(state => state.token);
  const [category, setCategory] = useState<OriginalFeedbackCategory>('general');
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const refreshPending = useCallback(async () => {
    const pending = await originalFeedbackStore.listPending(packId, version);
    setPendingCount(pending.length);
  }, [packId, version]);

  useEffect(() => {
    if (!visible) return;
    setStatus('');
    void refreshPending();
  }, [refreshPending, visible]);

  const submit = useCallback(async () => {
    const cleanMessage = message.trim();
    if (cleanMessage.length < 3 || busy) {
      if (cleanMessage.length < 3) setStatus('Add at least three characters so the field team has enough context.');
      return;
    }
    setBusy(true);
    setStatus('');
    const result = await submitOriginalFeedback({
      packId,
      authentication: token ? 'signed_in' : 'guest',
      payload: {
        version,
        ...(stopId ? { stop_id: stopId } : {}),
        category,
        ...(rating == null ? {} : { rating }),
        message: cleanMessage,
        platform: feedbackPlatform(),
        app_version: Constants.expoConfig?.version,
        runtime_version: typeof Constants.expoConfig?.runtimeVersion === 'string'
          ? Constants.expoConfig.runtimeVersion
          : undefined,
      },
    }, { store: originalFeedbackStore, api: originalsApi, authToken: token });
    if (result.sent) {
      setMessage('');
      setRating(null);
      setStatus('Feedback sent. Thank you for helping improve this Original.');
    } else {
      setStatus('Saved on this device. Use Retry queued when Trailhead is online.');
    }
    await refreshPending();
    setBusy(false);
  }, [busy, category, message, packId, rating, refreshPending, stopId, token, version]);

  const retry = useCallback(async () => {
    if (busy || pendingCount === 0) return;
    setBusy(true);
    const results = await retryOriginalFeedback(
      { store: originalFeedbackStore, api: originalsApi, authToken: token },
      packId,
      version,
    );
    const remaining = results.filter(result => !result.sent).length;
    setStatus(remaining ? `${remaining} report${remaining === 1 ? '' : 's'} remain queued.` : 'Queued feedback sent.');
    await refreshPending();
    setBusy(false);
  }, [busy, packId, pendingCount, refreshPending, token, version]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: C.s1, borderColor: C.border, paddingBottom: Math.max(insets.bottom, 18) }] }>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={[styles.kicker, { color: C.orange }]}>TRAILHEAD ORIGINALS</Text>
              <Text style={[styles.title, { color: C.text }]}>Share drive feedback</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close feedback" onPress={onClose} style={styles.close}>
              <Ionicons name="close" size={22} color={C.text2} />
            </TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <Text style={[styles.label, { color: C.text3 }]}>WHAT SHOULD WE REVIEW?</Text>
            <View style={styles.categories}>
              {ORIGINAL_FEEDBACK_CATEGORIES.map(value => {
                const selected = category === value;
                return (
                  <TouchableOpacity
                    key={value}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setCategory(value)}
                    style={[styles.category, { borderColor: selected ? C.orange : C.border, backgroundColor: selected ? C.orange + '14' : C.s2 }]}
                  >
                    <Text style={[styles.categoryText, { color: selected ? C.orange : C.text2 }]}>{CATEGORY_LABELS[value]}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.label, { color: C.text3 }]}>RATING · OPTIONAL</Text>
            <View style={styles.rating}>
              {[1, 2, 3, 4, 5].map(value => (
                <TouchableOpacity key={value} accessibilityRole="button" accessibilityLabel={`${value} star rating`} onPress={() => setRating(rating === value ? null : value)} style={styles.ratingButton}>
                  <Ionicons name={rating != null && value <= rating ? 'star' : 'star-outline'} size={25} color={C.orange} />
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.label, { color: C.text3 }]}>DETAILS</Text>
            <TextInput
              accessibilityLabel="Feedback details"
              multiline
              maxLength={2_000}
              value={message}
              onChangeText={setMessage}
              placeholder="What happened, and what did you expect?"
              placeholderTextColor={C.text3}
              style={[styles.input, { color: C.text, borderColor: C.border, backgroundColor: C.s2 }]}
            />
            <Text style={[styles.privacy, { color: C.text3 }]}>Trailhead sends the Original, version, selected story, app version, and your note. Raw coordinates and traveled routes are never included.</Text>
            {status ? <Text accessibilityLiveRegion="polite" style={[styles.status, { color: C.orange }]}>{status}</Text> : null}
            {pendingCount ? (
              <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => void retry()} style={[styles.retry, { borderColor: C.border }] }>
                <Ionicons name="cloud-upload-outline" size={17} color={C.orange} />
                <Text style={[styles.retryText, { color: C.orange }]}>Retry queued · {pendingCount}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity accessibilityRole="button" disabled={busy || message.trim().length < 3} onPress={() => void submit()} style={[styles.submit, { backgroundColor: C.orange, opacity: busy || message.trim().length < 3 ? 0.5 : 1 }] }>
              {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="send" size={16} color="#FFFFFF" />}
              <Text style={styles.submitText}>{busy ? 'Saving' : 'Send feedback'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.58)' },
  sheet: { maxHeight: '92%', borderTopLeftRadius: 25, borderTopRightRadius: 25, borderWidth: 1, paddingHorizontal: 18, paddingTop: 12 },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center' },
  headerCopy: { flex: 1, minWidth: 0 },
  kicker: { fontSize: 8.5, lineHeight: 12, fontWeight: '900', letterSpacing: 0.8 },
  title: { marginTop: 2, fontSize: 20, lineHeight: 24, fontWeight: '900' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { paddingTop: 8, gap: 10 },
  label: { marginTop: 3, fontSize: 9, lineHeight: 12, fontWeight: '900', letterSpacing: 0.7 },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  category: { minHeight: 40, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  categoryText: { fontSize: 10.5, lineHeight: 14, fontWeight: '900' },
  rating: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 3 },
  ratingButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 116, maxHeight: 190, borderWidth: 1, borderRadius: 14, padding: 12, textAlignVertical: 'top', fontSize: 13, lineHeight: 19, fontWeight: '600' },
  privacy: { fontSize: 10.5, lineHeight: 15, fontWeight: '600' },
  status: { fontSize: 11, lineHeight: 16, fontWeight: '800' },
  retry: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  retryText: { fontSize: 11, fontWeight: '900' },
  submit: { minHeight: 50, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  submitText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
});
