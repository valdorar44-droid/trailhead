import React, { useEffect } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Linking, Platform, useWindowDimensions,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSubscription, PRODUCT_IDS, priceLine } from '@/lib/useSubscription';
import { useTheme, mono } from '@/lib/design';
import { CREDIT_REWARDS } from '@/lib/credits';

const TERMS_URL   = 'https://api.gettrailhead.app/terms';
const PRIVACY_URL = 'https://api.gettrailhead.app/privacy';
const TRAILHEAD_LOGO = require('@/assets/icon.png');
const EXPLORER_VEHICLE = require('@/assets/paywall-explorer-vehicle.png');

interface Props {
  visible: boolean;
  code?: string;
  message?: string;
  onClose: () => void;
}

const EARN_ITEMS = [
  { icon: 'trail-sign-outline', label: 'Submit a road condition report', credits: `+${CREDIT_REWARDS.communityReport} credits` },
  { icon: 'bonfire-outline', label: 'Add a camp field report', credits: `+${CREDIT_REWARDS.fieldReport} credits` },
  { icon: 'camera-outline', label: 'Add a report photo', credits: `+${CREDIT_REWARDS.reportPhotoBonus} bonus` },
  { icon: 'checkmark-circle-outline', label: "Confirm another user's report", credits: `+${CREDIT_REWARDS.confirmReport} credit` },
  { icon: 'link-outline', label: 'Refer a friend who signs up', credits: `+${CREDIT_REWARDS.referral} credits` },
] as const;

const BENEFITS = [
  ['sparkles-outline', 'Plan routes, refine days, and keep route briefs ready for the field.'],
  ['headset-outline', 'Audio guides and place stories are included with Explorer.'],
  ['bonfire-outline', 'Camp briefs, packing lists, and saved trip context stay with your route.'],
] as const;

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
  const title = isSearchLimit ? 'Free search used' : 'Explorer';
  const subtitle = message ?? (isSearchLimit
    ? "You've used your free camp search. Earn credits by contributing to the map, or get Explorer for unlimited access."
    : 'Plan routes, camp nights, route briefs, packing lists, and audio guides with one field-ready plan. Offline downloads are included for everyone.');

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
        <BlurView intensity={28} tint="dark" style={[staticS.blurShell, { maxHeight: sheetMaxHeight }]}>
        <View style={{ backgroundColor: C.bg + 'F2', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 22, paddingBottom: sheetBottomPad, paddingTop: 12, borderTopWidth: 1, borderColor: C.border, maxHeight: sheetMaxHeight }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 10 }} />

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ maxHeight: sheetMaxHeight - 156 }} contentContainerStyle={staticS.sheetScroll}>
          <View style={[staticS.heroVisual, { borderColor: C.border, backgroundColor: C.s2 }]}>
            <Image source={EXPLORER_VEHICLE} resizeMode="contain" style={staticS.heroImage} />
          </View>

          <View style={[staticS.copyCard, { backgroundColor: C.s1, borderColor: C.border }]}>
              <View style={staticS.heroBrandRow}>
                <Image source={TRAILHEAD_LOGO} style={staticS.heroLogo} />
                <View>
                  <Text style={[staticS.heroBrandText, { color: C.text }]}>Trail-Head</Text>
                  <View style={[staticS.heroBadge, { backgroundColor: C.orange }]}>
                    <Text style={staticS.heroBadgeText}>EXPLORER</Text>
                  </View>
                </View>
              </View>
              <Text style={[staticS.heroTitle, { color: C.text }]}>{title}</Text>
              <Text style={[staticS.heroSubtitle, { color: C.text2 }]}>{subtitle}</Text>
          </View>

          <View style={{ gap: 8, marginBottom: 16 }}>
            {BENEFITS.map(([icon, text]) => (
              <View key={text} style={[staticS.benefitRow, { backgroundColor: C.s2, borderColor: C.border }]}>
                <Ionicons name={icon as any} size={15} color={C.orange} />
                <Text style={{ color: C.text2, fontSize: 12.5, lineHeight: 17, flex: 1 }}>{text}</Text>
              </View>
            ))}
          </View>

          {/* Annual — featured */}
          <TouchableOpacity
            style={{ backgroundColor: C.orange, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingTop: 20, borderWidth: 1, borderColor: C.orange, opacity: annualDisabled ? 0.72 : 1 }}
            onPress={() => handlePurchase(PRODUCT_IDS.annual)}
            disabled={annualDisabled}
            activeOpacity={0.85}
          >
            <View style={[staticS.planBtnBadge, { backgroundColor: '#fff' }]}>
              <Text style={{ color: C.orange, fontSize: 9, fontWeight: '800', letterSpacing: 0.8, fontFamily: mono }}>BEST VALUE</Text>
            </View>
            <View style={staticS.planBtnBody}>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Explorer Annual</Text>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2 }}>{annualLine}</Text>
            </View>
            {purchasing || storeLoading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={{ color: '#fff', fontSize: 20, fontWeight: '600', marginLeft: 8 }}>→</Text>}
          </TouchableOpacity>

          {/* Monthly */}
          <TouchableOpacity
            style={{ backgroundColor: C.s2, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, borderWidth: 1, borderColor: C.border, opacity: monthlyDisabled ? 0.72 : 1 }}
            onPress={() => handlePurchase(PRODUCT_IDS.monthly)}
            disabled={monthlyDisabled}
            activeOpacity={0.85}
          >
            <View style={staticS.planBtnBody}>
              <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>Explorer Monthly</Text>
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

          <Text style={{ color: C.text3, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 8, marginBottom: 12, fontFamily: mono }}>Or earn free credits</Text>

          <ScrollView style={staticS.earnList} showsVerticalScrollIndicator={false}>
            {EARN_ITEMS.map((item) => (
              <View key={item.label} style={[staticS.earnRow, { borderBottomWidth: 1, borderBottomColor: C.border }]}>
                <View style={[staticS.earnIconCircle, { borderColor: C.orange + '45', backgroundColor: C.orange + '12' }]}>
                  <Ionicons name={item.icon} size={14} color={C.orange} />
                </View>
                <Text style={{ flex: 1, color: C.text2, fontSize: 13 }}>{item.label}</Text>
                <Text style={{ color: C.orange, fontSize: 13, fontWeight: '600' }}>{item.credits}</Text>
              </View>
            ))}
          </ScrollView>

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

            {/* Required store disclosure: subscription duration, price, renewal, and links */}
            <Text style={{ color: C.text3, fontSize: 10, textAlign: 'center', lineHeight: 14, paddingHorizontal: 8 }}>
            Subscriptions auto-renew unless cancelled 24 hours before the end of the period.
            Manage or cancel in {accountSettings}.{' '}
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
        </View>
        </BlurView>
      </View>
    </Modal>
  );
}

// Styles use the C theme tokens passed from the component via closure-style factory
// The 's' variable is recreated whenever theme changes via useMemo in the component.
// Since PaywallModal doesn't use useMemo, we use inline styles for theme-dependent values
// and only use StyleSheet.create for layout-only (theme-independent) properties.
const staticS = StyleSheet.create({
  overlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  blurShell:     { borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' },
  sheetScroll:   { paddingBottom: 12 },
  heroVisual:    { width: '100%', aspectRatio: 1200 / 720, marginTop: 0, overflow: 'hidden', borderWidth: 1, borderRadius: 18, marginBottom: 12 },
  heroImage:     { width: '100%', height: '100%' },
  copyCard:      { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12, gap: 10 },
  heroBrandRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroLogo:      { width: 42, height: 42, borderRadius: 10 },
  heroBrandText: { fontSize: 20, lineHeight: 23, fontWeight: '900' },
  heroBadge:     { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginTop: 2 },
  heroBadgeText: { color: '#fff', fontSize: 9, fontFamily: mono, fontWeight: '900' },
  heroTitle:     { fontSize: 26, lineHeight: 31, fontWeight: '900' },
  heroSubtitle:  { fontSize: 13, lineHeight: 19 },
  benefitRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderWidth: 1, borderRadius: 12, padding: 10 },
  planBtnBadge:  { position: 'absolute', top: -1, left: 18, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  planBtnBody:   { flex: 1 },
  earnList:      { maxHeight: 180, marginBottom: 16 },
  earnRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  earnIconCircle: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  storeStatus:   { alignItems: 'center', gap: 6, marginBottom: 8 },
  retryStoreBtn: { paddingHorizontal: 10, paddingVertical: 4 },
  paywallFooter: { borderTopWidth: 1, paddingTop: 12, gap: 8 },
  footerActions: { flexDirection: 'row', gap: 10 },
  footerBtn:     { flex: 1, minHeight: 42, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  restoreBtn:    { alignItems: 'center', paddingVertical: 10 },
  closeBtn:      { alignItems: 'center', paddingVertical: 10 },
  legalLinks:    { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 4 },
});
