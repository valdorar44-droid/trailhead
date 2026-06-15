import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { api } from '@/lib/api';
import { ColorPalette, mono, useTheme } from '@/lib/design';

type AiReportKind = 'bug' | 'offensive';

interface AiReportMessage {
  role: 'user' | 'assistant';
  text: string;
}

interface AiReportModalProps {
  visible: boolean;
  onClose: () => void;
  initialKind: AiReportKind;
  surface: 'planner' | 'copilot';
  surfaceLabel: string;
  messages: AiReportMessage[];
  sessionId?: string | null;
  tripId?: string | null;
}

export default function AiReportModal({
  visible,
  onClose,
  initialKind,
  surface,
  surfaceLabel,
  messages,
  sessionId,
  tripId,
}: AiReportModalProps) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const [kind, setKind] = useState<AiReportKind>(initialKind);
  const [details, setDetails] = useState('');
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenshotMime, setScreenshotMime] = useState('image/jpeg');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setKind(initialKind);
    setDetails('');
    setScreenshot(null);
    setScreenshotMime('image/jpeg');
    setSent(false);
    setSubmitting(false);
  }, [visible, initialKind]);

  async function pickScreenshot() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to attach a screenshot.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.5,
      base64: true,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;
    const asset = result.assets[0];
    setScreenshot(asset.base64 ?? null);
    setScreenshotMime(asset.mimeType ?? 'image/jpeg');
  }

  async function submit() {
    if (!details.trim()) {
      Alert.alert('Add details', 'Describe what went wrong so it can be reviewed.');
      return;
    }
    setSubmitting(true);
    try {
      const recentMessages = messages
        .slice(-8)
        .map(msg => ({
          role: msg.role,
          text: String(msg.text || '').trim().slice(0, 600),
        }))
        .filter(msg => msg.text);
      const title = kind === 'offensive'
        ? `${surfaceLabel} offensive output`
        : `${surfaceLabel} bug report`;
      await api.submitBugReport({
        title,
        description: details.trim(),
        app_version: Platform.OS,
        category: kind,
        source_surface: surface,
        screenshot_data: screenshot ?? undefined,
        screenshot_content_type: screenshot ? screenshotMime : undefined,
        ai_context: {
          surface,
          session_id: sessionId || null,
          trip_id: tripId || null,
          recent_messages: recentMessages,
        },
      });
      setSent(true);
      setDetails('');
      setScreenshot(null);
      setTimeout(() => {
        setSent(false);
        onClose();
      }, 900);
    } catch (e: any) {
      Alert.alert('Submission failed', e?.message ?? 'Could not send this report.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={onClose} />
        <View style={s.sheet}>
          <View style={s.header}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.title}>Report {surfaceLabel}</Text>
              <Text style={s.sub}>Send the last exchange to admin with your notes.</Text>
            </View>
            <TouchableOpacity style={s.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={17} color={C.text2} />
            </TouchableOpacity>
          </View>

          <View style={s.kindRow}>
            <TouchableOpacity style={[s.kindBtn, kind === 'bug' && s.kindBtnActive]} onPress={() => setKind('bug')}>
              <Ionicons name="bug-outline" size={14} color={kind === 'bug' ? '#050505' : C.orange} />
              <Text style={[s.kindText, kind === 'bug' && s.kindTextActive]}>REPORT BUG</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.kindBtn, kind === 'offensive' && s.kindBtnActive]} onPress={() => setKind('offensive')}>
              <Ionicons name="warning-outline" size={14} color={kind === 'offensive' ? '#050505' : C.orange} />
              <Text style={[s.kindText, kind === 'offensive' && s.kindTextActive]}>REPORT OFFENSIVE</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={s.details}
            value={details}
            onChangeText={setDetails}
            placeholder={kind === 'offensive' ? 'Say what crossed the line or what the model said.' : 'Say what went wrong, what you expected, and what it actually did.'}
            placeholderTextColor={C.text3}
            multiline
            textAlignVertical="top"
            maxLength={1800}
          />

          <View style={s.attachRow}>
            <TouchableOpacity style={s.attachBtn} onPress={pickScreenshot}>
              <Ionicons name={screenshot ? 'checkmark-circle-outline' : 'image-outline'} size={15} color={screenshot ? C.green : C.text2} />
              <Text style={[s.attachText, screenshot && { color: C.green }]}>{screenshot ? 'SCREENSHOT ADDED' : 'ADD SCREENSHOT'}</Text>
            </TouchableOpacity>
            {screenshot ? (
              <TouchableOpacity style={s.removeBtn} onPress={() => setScreenshot(null)}>
                <Text style={s.removeText}>REMOVE</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {screenshot ? (
            <Image source={{ uri: `data:${screenshotMime};base64,${screenshot}` }} style={s.preview} resizeMode="cover" />
          ) : null}

          <View style={s.contextCard}>
            <Text style={s.contextTitle}>RECENT CONTEXT</Text>
            <ScrollView style={s.contextScroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
              {messages.slice(-4).map((msg, idx) => (
                <Text key={`${msg.role}-${idx}`} style={s.contextLine}>
                  <Text style={s.contextRole}>{msg.role === 'assistant' ? surfaceLabel : 'You'}: </Text>
                  {String(msg.text || '').trim() || '—'}
                </Text>
              ))}
            </ScrollView>
          </View>

          <TouchableOpacity style={[s.submitBtn, (!details.trim() || submitting) && s.submitBtnDisabled]} onPress={submit} disabled={!details.trim() || submitting}>
            <Text style={s.submitText}>{sent ? 'SENT' : submitting ? 'SENDING...' : 'SEND REPORT'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(C: ColorPalette) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.58)',
    },
    sheet: {
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      backgroundColor: C.bg,
      borderWidth: 1,
      borderColor: C.border,
      padding: 16,
      gap: 12,
      maxHeight: '84%',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    title: { color: C.text, fontSize: 19, fontWeight: '900' },
    sub: { color: C.text3, fontSize: 12, marginTop: 3, lineHeight: 18 },
    closeBtn: {
      width: 34,
      height: 34,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: C.s2,
      borderWidth: 1,
      borderColor: C.border,
    },
    kindRow: { flexDirection: 'row', gap: 8 },
    kindBtn: {
      flex: 1,
      minHeight: 42,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.orange + '44',
      backgroundColor: C.s2,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      paddingHorizontal: 10,
    },
    kindBtnActive: {
      backgroundColor: C.orange,
      borderColor: C.orange,
    },
    kindText: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '900' },
    kindTextActive: { color: '#050505' },
    details: {
      minHeight: 130,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.s2,
      paddingHorizontal: 12,
      paddingVertical: 12,
      color: C.text,
      fontSize: 14,
      lineHeight: 20,
    },
    attachRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    attachBtn: {
      minHeight: 38,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.s2,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    attachText: { color: C.text2, fontSize: 10, fontFamily: mono, fontWeight: '900' },
    removeBtn: {
      minHeight: 38,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.border,
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: C.bg,
    },
    removeText: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '900' },
    preview: {
      width: '100%',
      height: 160,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.s2,
    },
    contextCard: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.s1,
      padding: 12,
      gap: 8,
    },
    contextTitle: { color: C.text2, fontSize: 10, fontFamily: mono, fontWeight: '900' },
    contextScroll: { maxHeight: 120 },
    contextLine: { color: C.text2, fontSize: 12, lineHeight: 18, marginBottom: 6 },
    contextRole: { color: C.text, fontWeight: '800' },
    submitBtn: {
      minHeight: 46,
      borderRadius: 13,
      backgroundColor: C.orange,
      alignItems: 'center',
      justifyContent: 'center',
    },
    submitBtnDisabled: { opacity: 0.45 },
    submitText: { color: '#050505', fontSize: 11, fontFamily: mono, fontWeight: '900' },
  });
}
