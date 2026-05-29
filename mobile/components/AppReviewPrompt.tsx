import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { ColorPalette, mono, useTheme } from '@/lib/design';
import { completeReviewPrompt, openReviewDestination, snoozeReviewPrompt } from '@/lib/reviewPrompt';
import { TrailheadButton, TrailheadButtonDock, TrailheadSheet } from '@/components/TrailheadUI';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export default function AppReviewPrompt({ visible, onClose }: Props) {
  const C = useTheme();
  const s = styles(C);

  async function closeLater() {
    await snoozeReviewPrompt();
    onClose();
  }

  async function rateNow() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    await completeReviewPrompt();
    onClose();
    openReviewDestination().catch(() => {});
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={closeLater}>
      <Pressable style={s.overlay} onPress={closeLater}>
        <Pressable style={s.sheet}>
          <TrailheadSheet handle={false} contentStyle={s.panel}>
            <View style={s.topRow}>
              <View style={s.badge}>
                <Ionicons name="sparkles" size={18} color={C.orange} />
              </View>
              <TouchableOpacity style={s.closeBtn} onPress={closeLater}>
                <Ionicons name="close" size={18} color={C.text2} />
              </TouchableOpacity>
            </View>

            <View style={s.starRow}>
              {[0, 1, 2, 3, 4].map(i => (
                <View key={i} style={s.star}>
                  <Ionicons name="star" size={18} color={C.yellow} />
                </View>
              ))}
            </View>

            <Text style={s.kicker}>TRAILHEAD REVIEW</Text>
            <Text style={s.title}>Enjoying Route Builder?</Text>
            <Text style={s.body}>
              A quick App Store review helps more overlanders find better camps, safer routes, and cleaner trip plans.
            </Text>

            <TrailheadButtonDock style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <TrailheadButton label="Rate Trailhead" icon="logo-apple-appstore" variant="primary" onPress={rateNow} />
              <TrailheadButton label="Maybe Later" variant="ghost" onPress={closeLater} />
            </TrailheadButtonDock>
          </TrailheadSheet>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = (C: ColorPalette) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  sheet: {
    width: '100%',
  },
  panel: { padding: 18 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.orange + '55',
    backgroundColor: C.orange + '12',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.glass,
    borderWidth: 1,
    borderColor: C.border,
  },
  starRow: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 22,
    marginBottom: 14,
  },
  star: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.yellow + '14',
    borderWidth: 1,
    borderColor: C.yellow + '33',
  },
  kicker: {
    color: C.orange,
    fontSize: 9,
    fontFamily: mono,
    fontWeight: '900',
    marginBottom: 8,
  },
  title: {
    color: C.text,
    fontSize: 25,
    lineHeight: 30,
    fontWeight: '900',
  },
  body: {
    color: C.text2,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
    marginBottom: 18,
  },
});
