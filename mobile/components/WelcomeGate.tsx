import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mono, useTheme } from '@/lib/design';
import type { ColorPalette } from '@/lib/design';

type WelcomeGateProps = {
  visible: boolean;
  onCreateAccount: () => void;
  onSignIn: () => void;
  onContinue: () => void;
};

type Feature = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  tone: string;
};

const FEATURES: Feature[] = [
  {
    icon: 'map-outline',
    title: 'Plan around real stops',
    body: 'Find trails, camps, fuel, weather, and places worth saving before you drive.',
    tone: '#f97316',
  },
  {
    icon: 'cloud-download-outline',
    title: 'Keep trips ready offline',
    body: 'Save routes, places, and map details so the plan stays close when service drops.',
    tone: '#22c55e',
  },
  {
    icon: 'bookmark-outline',
    title: 'Pick up where you left off',
    body: 'Create a free account to sync saved places, downloads, and trip history.',
    tone: '#38bdf8',
  },
];

export default function WelcomeGate({ visible, onCreateAccount, onSignIn, onContinue }: WelcomeGateProps) {
  const C = useTheme();
  const s = styles(C);
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onContinue}>
      <View style={s.overlay}>
        <View style={s.mapBackdrop}>
          <View style={[s.contour, s.contourOne]} />
          <View style={[s.contour, s.contourTwo]} />
          <View style={[s.contour, s.contourThree]} />
          <View style={[s.routeLine, s.routeLineOne]} />
          <View style={[s.routeLine, s.routeLineTwo]} />
          <View style={[s.pin, s.pinStart]} />
          <View style={[s.pin, s.pinEnd]} />
        </View>

        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 16 }]}>
          <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
            <View style={s.brandRow}>
              <View style={s.brandMark}>
                <Ionicons name="trail-sign-outline" size={22} color={C.orange} />
              </View>
              <View style={s.brandCopy}>
                <Text style={s.brand}>TRAILHEAD</Text>
                <Text style={s.kicker}>OVERLAND PLANNER</Text>
              </View>
            </View>

            <View style={s.heroCopy}>
              <Text style={s.title}>Plan the route. Keep the drive ready.</Text>
              <Text style={s.body}>
                Start free, save what matters, and bring your trip details with you from scouting to departure.
              </Text>
            </View>

            <View style={s.featureStack}>
              {FEATURES.map(feature => (
                <View key={feature.title} style={s.featureRow}>
                  <View style={[s.featureIcon, { backgroundColor: feature.tone + '18', borderColor: feature.tone + '44' }]}>
                    <Ionicons name={feature.icon} size={18} color={feature.tone} />
                  </View>
                  <View style={s.featureCopy}>
                    <Text style={s.featureTitle}>{feature.title}</Text>
                    <Text style={s.featureBody}>{feature.body}</Text>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>

          <View style={s.actions}>
            <TouchableOpacity style={s.primaryButton} onPress={onCreateAccount} activeOpacity={0.86}>
              <Text style={s.primaryText}>CREATE FREE ACCOUNT</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.secondaryButton} onPress={onSignIn} activeOpacity={0.84}>
              <Text style={s.secondaryText}>SIGN IN</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.linkButton} onPress={onContinue} activeOpacity={0.72}>
              <Text style={s.linkText}>Continue for now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = (C: ColorPalette) => StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(3,5,8,0.94)',
  },
  mapBackdrop: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  contour: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'transparent',
  },
  contourOne: {
    width: 420,
    height: 154,
    left: -120,
    top: 74,
    borderRadius: 120,
    transform: [{ rotate: '-14deg' }],
  },
  contourTwo: {
    width: 520,
    height: 202,
    right: -180,
    top: 190,
    borderRadius: 145,
    borderColor: 'rgba(20,184,166,0.13)',
    transform: [{ rotate: '17deg' }],
  },
  contourThree: {
    width: 580,
    height: 210,
    left: -190,
    bottom: 168,
    borderRadius: 150,
    borderColor: 'rgba(249,115,22,0.14)',
    transform: [{ rotate: '19deg' }],
  },
  routeLine: {
    position: 'absolute',
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(249,115,22,0.84)',
  },
  routeLineOne: {
    left: '18%',
    top: '35%',
    width: '30%',
    transform: [{ rotate: '16deg' }],
  },
  routeLineTwo: {
    left: '45%',
    top: '32%',
    width: '36%',
    backgroundColor: 'rgba(20,184,166,0.78)',
    transform: [{ rotate: '-18deg' }],
  },
  pin: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: '#f8fafc',
    backgroundColor: C.orange,
  },
  pinStart: {
    left: '17%',
    top: '34%',
  },
  pinEnd: {
    right: '19%',
    top: '29%',
    backgroundColor: '#14b8a6',
  },
  sheet: {
    maxHeight: '86%',
    margin: 12,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bg,
  },
  scroll: {
    padding: 20,
    gap: 18,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  brandMark: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.orange + '44',
    backgroundColor: C.orangeGlow,
  },
  brandCopy: {
    flex: 1,
  },
  brand: {
    color: C.text,
    fontFamily: mono,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0,
  },
  kicker: {
    marginTop: 2,
    color: C.text3,
    fontFamily: mono,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0,
  },
  heroCopy: {
    gap: 9,
  },
  title: {
    color: C.text,
    fontSize: 31,
    lineHeight: 36,
    fontWeight: '900',
    letterSpacing: 0,
  },
  body: {
    color: C.text2,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: 0,
  },
  featureStack: {
    gap: 10,
  },
  featureRow: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s2,
  },
  featureIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureCopy: {
    flex: 1,
    gap: 3,
  },
  featureTitle: {
    color: C.text,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0,
  },
  featureBody: {
    color: C.text3,
    fontSize: 12.5,
    lineHeight: 18,
    letterSpacing: 0,
  },
  actions: {
    paddingHorizontal: 20,
    gap: 10,
  },
  primaryButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: C.orange,
  },
  primaryText: {
    color: '#fff',
    fontFamily: mono,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
  },
  secondaryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s2,
  },
  secondaryText: {
    color: C.text,
    fontFamily: mono,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
  },
  linkButton: {
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: {
    color: C.text3,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0,
  },
});
