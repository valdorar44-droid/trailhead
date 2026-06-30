import React, { useEffect } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Linking, Platform, useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSubscription, PRODUCT_IDS, priceLine } from '@/lib/useSubscription';
import { useTheme } from '@/lib/design';
import { TrailheadSheet } from '@/components/TrailheadUI';

const TERMS_URL   = 'https://api.gettrailhead.app/terms';
const PRIVACY_URL = 'https://api.gettrailhead.app/privacy';

interface Props {
  visible: boolean;
  code?: string;
  message?: string;
  onClose: () => void;
}

type Benefit = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  text: string;
};

const BENEFITS: Benefit[] = [
  { icon: 'trail-sign-outline', title: 'Unlimited trip planner', text: 'Build routes, days, stops, and packing lists without limits.' },
  { icon: 'chatbubble-ellipses-outline', title: 'Co-Pilot on the map', text: 'Ask for camps, route changes, and nearby stops while you move.' },
  { icon: 'bonfire-outline', title: 'Camp Briefs', text: 'Open deeper stay context before you commit to a night.' },
  { icon: 'pricetag-outline', title: 'Featured tour discounts', text: 'Exclusive deals on selected guided trips.' },
  { icon: 'car-sport-outline', title: 'Hands-free CarPlay', text: 'Voice Co-Pilot for drive-time scouting.' },
];

function contextLine(code?: string) {
  if (code === 'search_limit') return 'Keep searches, camp research, and route planning moving.';
  if (String(code || '').includes('camp')) return 'Open Camp Briefs and deeper stay context.';
  if (String(code || '').includes('category')) return 'Unlock more Explorer results and route-ready details.';
  return 'Upgrade when you want more planning, camp research, and voice help.';
}

export default function PaywallModal({ visible, code, message, onClose }: Props) {
  const C  = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { monthlyProduct, annualProduct, purchasing, restoring, error, storeLoading, purchase, restore, openPaywall } = useSubscription();
  const storeName = Platform.OS === 'android' ? 'Google Play' : 'App Store';
  const accountSettings = Platform.OS === 'android' ? 'your Google Play subscriptions' : 'your Apple ID settings';

  useEffect(() => {
    if (visible) openPaywall();
  }, [openPaywall, visible]);

  const isSearchLimit = code === 'search_limit';
  const title = isSearchLimit ? 'Keep exploring' : 'Plan better trips';
  const subtitle = isSearchLimit
    ? 'Keep searches, Camp Briefs, and route planning moving.'
    : 'Unlimited planning, Camp Briefs, Co-Pilot, packing lists, tour deals, and hands-free voice.';

  async function handlePurchase(productId: string) {
    const started = await purchase(productId);
    if (!started) return;
    // The native store confirms asynchronously through purchaseUpdatedListener.
    // Do not mark Explorer active or close this sheet until that confirmation arrives.
  }

  const monthlyPrice = monthlyProduct?.localizedPrice ?? '$7.99';
  const annualPrice  = annualProduct?.localizedPrice  ?? '$49.99';
  const annualLine   = priceLine(annualProduct, annualPrice, 'year');
  const monthlyLine  = priceLine(monthlyProduct, monthlyPrice, 'month');
  const annualDisabled = purchasing || restoring || storeLoading;
  const monthlyDisabled = purchasing || restoring || storeLoading;
  const storeMessage = storeLoading
    ? `Loading ${storeName} plans...`
    : error;
  const sheetMaxHeight = Math.min(height - 8, Math.max(420, height - Math.max(insets.top + 16, 32)));
  const sheetBottomPad = Math.max(insets.bottom, Platform.OS === 'android' ? 16 : 18) + 16;

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={staticS.overlay}>
        <TrailheadSheet
          handle={false}
          style={[staticS.blurShell, { maxHeight: sheetMaxHeight }]}
          contentStyle={{ backgroundColor: C.bg + 'F2', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 22, paddingBottom: sheetBottomPad, paddingTop: 12, maxHeight: sheetMaxHeight }}
        >
          <View style={staticS.sheetTop}>
            <View style={[staticS.grip, { backgroundColor: C.border }]} />
            <TouchableOpacity
              style={[staticS.iconClose, { backgroundColor: C.s2, borderColor: C.border }]}
              onPress={onClose}
              hitSlop={10}
              accessibilityLabel="Close Explorer plans"
            >
              <Ionicons name="close" size={18} color={C.text2} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ maxHeight: sheetMaxHeight - 156 }} contentContainerStyle={staticS.sheetScroll}>
          <View style={staticS.heroBlock}>
            <View style={[staticS.heroMark, { backgroundColor: C.orange + '18', borderColor: C.orange + '3D' }]}>
              <Ionicons name="compass-outline" size={22} color={C.orange} />
            </View>
            <Text style={[staticS.heroEyebrow, { color: C.orange }]}>Trailhead Explorer</Text>
            <Text style={[staticS.heroTitle, { color: C.text }]}>{title}</Text>
            <Text style={[staticS.heroSubtitle, { color: C.text2 }]}>
              {message ? contextLine(code) : subtitle}
            </Text>
          </View>

          <View style={staticS.benefitList}>
            {BENEFITS.map(item => (
              <View key={item.title} style={staticS.benefitRow}>
                <View style={[staticS.benefitIcon, { backgroundColor: C.s2, borderColor: C.border }]}>
                  <Ionicons name={item.icon} size={16} color={C.orange} />
                </View>
                <View style={staticS.benefitCopy}>
                  <Text style={[staticS.benefitTitle, { color: C.text }]}>{item.title}</Text>
                  <Text style={[staticS.benefitText, { color: C.text2 }]}>{item.text}</Text>
                </View>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={[staticS.planButton, { backgroundColor: C.orange, borderColor: C.orange, opacity: annualDisabled ? 0.72 : 1 }]}
            onPress={() => handlePurchase(PRODUCT_IDS.annual)}
            disabled={annualDisabled}
            activeOpacity={0.85}
          >
            <View style={staticS.planBtnBody}>
              <Text style={staticS.planNamePrimary}>Annual</Text>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2 }}>{annualLine}</Text>
            </View>
            {purchasing || storeLoading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={{ color: '#fff', fontSize: 20, fontWeight: '600', marginLeft: 8 }}>→</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            style={[staticS.planButton, { backgroundColor: C.s2, borderColor: C.border, opacity: monthlyDisabled ? 0.72 : 1 }]}
            onPress={() => handlePurchase(PRODUCT_IDS.monthly)}
            disabled={monthlyDisabled}
            activeOpacity={0.85}
          >
            <View style={staticS.planBtnBody}>
              <Text style={[staticS.planName, { color: C.text }]}>Monthly</Text>
              <Text style={{ color: C.text2, fontSize: 12, marginTop: 2 }}>{monthlyLine}</Text>
            </View>
            {purchasing || storeLoading
              ? <ActivityIndicator color={C.orange} size="small" />
              : <Text style={{ color: C.text2, fontSize: 20, fontWeight: '600', marginLeft: 8 }}>→</Text>}
          </TouchableOpacity>

          {!!storeMessage && (
            <View style={staticS.storeStatus}>
              <Text style={{ color: C.text3, fontSize: 12, textAlign: 'center' }}>{storeMessage}</Text>
              {!!error && !storeLoading && (
                <TouchableOpacity onPress={openPaywall} style={staticS.retryStoreBtn} activeOpacity={0.7}>
                  <Text style={{ color: C.orange, fontSize: 12, fontWeight: '700' }}>Retry {storeName}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <Text style={[staticS.creditNote, { color: C.text3 }]}>
            Helpful reports can still earn credits.
          </Text>

          </ScrollView>

          <View style={[staticS.paywallFooter, { borderTopColor: C.border, backgroundColor: C.bg + 'FA' }]}>
            <View style={staticS.footerActions}>
              <TouchableOpacity
                style={[staticS.footerBtn, { borderColor: C.border, backgroundColor: C.s2 }]}
                onPress={restore}
                disabled={restoring || purchasing || storeLoading}
                activeOpacity={0.7}
              >
                {restoring
                  ? <ActivityIndicator color={C.text3} size="small" />
                  : <Text style={{ color: C.text2, fontSize: 13, fontWeight: '700' }}>Restore</Text>}
              </TouchableOpacity>

              <TouchableOpacity style={[staticS.footerBtn, { borderColor: C.border, backgroundColor: C.s2 }]} onPress={onClose} activeOpacity={0.7}>
                <Text style={{ color: C.text2, fontSize: 13, fontWeight: '700' }}>Maybe later</Text>
              </TouchableOpacity>
            </View>

            <Text style={{ color: C.text3, fontSize: 10, textAlign: 'center', lineHeight: 14, paddingHorizontal: 8 }}>
              Auto-renews unless cancelled 24 hours before renewal. Manage or cancel in {accountSettings}.
            </Text>
            <View style={staticS.legalLinks}>
              <TouchableOpacity onPress={() => Linking.openURL(TERMS_URL)} hitSlop={10}>
                <Text style={{ color: C.text3, fontSize: 11, textDecorationLine: 'underline' }}>Terms of Use</Text>
              </TouchableOpacity>
              <Text style={{ color: C.text3, fontSize: 11 }}> · </Text>
              <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_URL)} hitSlop={10}>
                <Text style={{ color: C.text3, fontSize: 11, textDecorationLine: 'underline' }}>Privacy Policy</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TrailheadSheet>
      </View>
    </Modal>
  );
}

const staticS = StyleSheet.create({
  overlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  blurShell:     { borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' },
  sheetTop:      { minHeight: 34, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  grip:          { width: 40, height: 4, borderRadius: 2 },
  iconClose:     { position: 'absolute', right: 0, top: 0, width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sheetScroll:   { paddingBottom: 14 },
  heroBlock:     { gap: 8, marginBottom: 18 },
  heroMark:      { width: 44, height: 44, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  heroEyebrow:   { fontSize: 13, lineHeight: 17, fontWeight: '800' },
  heroTitle:     { fontSize: 30, lineHeight: 34, fontWeight: '900' },
  heroSubtitle:  { fontSize: 14, lineHeight: 20 },
  benefitList:   { gap: 12, marginBottom: 18 },
  benefitRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  benefitIcon:   { width: 32, height: 32, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  benefitCopy:   { flex: 1, minWidth: 0, gap: 2 },
  benefitTitle:  { fontSize: 14, lineHeight: 18, fontWeight: '800' },
  benefitText:   { fontSize: 12.5, lineHeight: 17 },
  planButton:    { borderRadius: 16, paddingHorizontal: 18, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, borderWidth: 1 },
  planNamePrimary: { color: '#fff', fontSize: 16, lineHeight: 20, fontWeight: '800' },
  planName:      { fontSize: 16, lineHeight: 20, fontWeight: '800' },
  planBtnBody:   { flex: 1 },
  creditNote:    { fontSize: 12, lineHeight: 16, textAlign: 'center', marginTop: 4, marginBottom: 10 },
  storeStatus:   { alignItems: 'center', gap: 6, marginBottom: 8 },
  retryStoreBtn: { paddingHorizontal: 10, paddingVertical: 4 },
  paywallFooter: { borderTopWidth: 1, paddingTop: 12, gap: 8 },
  footerActions: { flexDirection: 'row', gap: 10 },
  footerBtn:     { flex: 1, minHeight: 42, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  legalLinks:    { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 4 },
});
