import { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ColorPalette, mono, useTheme } from '@/lib/design';
import { useStore } from '@/lib/store';

type TourItem = {
  title: string;
  body: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const TOUR_ITEMS: TourItem[] = [
  {
    title: 'Find trails in the current map view',
    body: 'Use the area search on Map, switch it to Trail, then search where you are looking.',
    icon: 'trail-sign-outline',
  },
  {
    title: 'Tap map pins for full cards',
    body: 'Camp, trail, and community pins open cards with context, reports, navigation, and save actions.',
    icon: 'albums-outline',
  },
  {
    title: 'Plan from the AI tab',
    body: 'Ask Trailhead for routes, rig fit, fuel, camps, weather, and trip adjustments.',
    icon: 'compass-outline',
  },
  {
    title: 'Check offline before you go',
    body: 'Offline readiness tells you what maps, trails, reports, and routing data are loaded.',
    icon: 'cloud-done-outline',
  },
];

export default function PreviewRunOnboarding() {
  const C = useTheme();
  const s = useMemo(() => styles(C), [C]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const runId = useStore(st => st.guidedTourRunId);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (runId > 0) setVisible(true);
  }, [runId]);

  function close(action?: 'map' | 'plan') {
    setVisible(false);
    if (action === 'map') router.push('/(tabs)/map' as any);
    if (action === 'plan') router.push('/(tabs)' as any);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => close()}>
      <View style={s.root}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => close()} />
        <BlurView
          intensity={Platform.OS === 'android' ? 74 : 54}
          tint={C.bg === '#050505' ? 'dark' : 'light'}
          style={[s.sheet, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'android' ? 18 : 10) + 14 }]}
        >
          <View style={s.header}>
            <View style={s.badge}>
              <Ionicons name="help-buoy-outline" size={18} color={C.orange} />
            </View>
            <TouchableOpacity style={s.closeBtn} onPress={() => close()}>
              <Ionicons name="close" size={16} color={C.text2} />
            </TouchableOpacity>
          </View>
          <Text style={s.eyebrow}>APP TOUR</Text>
          <Text style={s.title}>Find the next good stop</Text>
          <Text style={s.body}>Use the map to scout trails, camps, fuel, water, and road notes. Open any card to save it, navigate, report conditions, or build it into a trip.</Text>

          <View style={s.list}>
            {TOUR_ITEMS.map(item => (
              <View key={item.title} style={s.item}>
                <View style={s.itemIcon}>
                  <Ionicons name={item.icon} size={16} color={C.orange} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.itemTitle}>{item.title}</Text>
                  <Text style={s.itemBody}>{item.body}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={s.actions}>
            <TouchableOpacity style={s.secondaryBtn} onPress={() => close('map')}>
              <Ionicons name="map-outline" size={15} color={C.text2} />
              <Text style={s.secondaryText}>OPEN MAP</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.primaryBtn} onPress={() => close('plan')}>
              <Text style={s.primaryText}>ASK TRAILHEAD</Text>
              <Ionicons name="arrow-forward" size={15} color="#fff" />
            </TouchableOpacity>
          </View>
        </BlurView>
      </View>
    </Modal>
  );
}

const styles = (C: ColorPalette) => StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', backgroundColor: C.bg === '#050505' ? 'rgba(0,0,0,0.36)' : 'rgba(15,23,42,0.16)' },
  sheet: {
    margin: 12,
    borderRadius: 18,
    overflow: 'hidden',
    paddingHorizontal: 18,
    paddingTop: 16,
    borderWidth: 1,
    borderColor: C.bg === '#050505' ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.12)',
    backgroundColor: C.bg === '#050505' ? 'rgba(9,10,12,0.72)' : 'rgba(255,255,255,0.72)',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.orange + '1F',
    borderWidth: 1,
    borderColor: C.orange + '55',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.s1,
    borderWidth: 1,
    borderColor: C.border,
  },
  eyebrow: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '900', marginTop: 14 },
  title: { color: C.text, fontSize: 24, lineHeight: 29, fontWeight: '900', marginTop: 5 },
  body: { color: C.text2, fontSize: 13, lineHeight: 19, marginTop: 8 },
  list: { gap: 10, marginTop: 16 },
  item: {
    flexDirection: 'row',
    gap: 10,
    padding: 11,
    borderRadius: 12,
    backgroundColor: C.s1,
    borderWidth: 1,
    borderColor: C.border,
  },
  itemIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.orange + '18',
  },
  itemTitle: { color: C.text, fontSize: 13, fontWeight: '900' },
  itemBody: { color: C.text3, fontSize: 11.5, lineHeight: 16, marginTop: 3 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  primaryBtn: {
    flex: 1.1,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: C.orange,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  primaryText: { color: '#fff', fontSize: 11, fontFamily: mono, fontWeight: '900' },
  secondaryBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  secondaryText: { color: C.text2, fontSize: 11, fontFamily: mono, fontWeight: '900' },
});
