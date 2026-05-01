import React, { useEffect } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Linking,
} from 'react-native';
import { useSubscription, PRODUCT_IDS, priceLine } from '@/lib/useSubscription';
import { useTheme, mono } from '@/lib/design';

const TERMS_URL   = 'https://trailhead-production-2049.up.railway.app/terms';
const PRIVACY_URL = 'https://trailhead-production-2049.up.railway.app/privacy';

interface Props {
  visible: boolean;
  code?: string;
  message?: string;
  onClose: () => void;
  onPlanActivated?: () => void;
}

const EARN_ITEMS = [
  { icon: '📍', label: 'Submit a road condition report', credits: '+10 credits' },
  { icon: '🏕️', label: 'Report a campsite condition',   credits: '+10 credits' },
  { icon: '✅', label: "Confirm another user's report",  credits: '+1 credit'   },
  { icon: '📸', label: 'Add a photo to your report',    credits: '+5 bonus'    },
  { icon: '🔗', label: 'Refer a friend who signs up',   credits: '+50 credits' },
];

export default function PaywallModal({ visible, code, message, onClose, onPlanActivated }: Props) {
  const C  = useTheme();
  const { monthlyProduct, annualProduct, purchasing, restoring, error, storeLoading, purchase, restore, openPaywall } = useSubscription();

  useEffect(() => {
    if (visible) openPaywall();
  }, [openPaywall, visible]);

  const isSearchLimit = code === 'search_limit';
  const title = isSearchLimit ? 'Free search used' : 'Credits needed';
  const subtitle = message ?? (isSearchLimit
    ? "You've used your free camp search. Earn credits by contributing to the map, or get the Explorer Plan for unlimited access."
    : 'Replaces Gaia, iOverlander & The Dyrt. Earn free credits by contributing, or get the Explorer Plan for unlimited AI routes, camp research, and offline access.');

  async function handlePurchase(productId: string) {
    const started = await purchase(productId);
    if (!started) return;
    // purchaseUpdatedListener fires asynchronously — close modal optimistically
    // and let the store update propagate
    onPlanActivated?.();
    onClose();
  }

  const monthlyPrice = monthlyProduct?.localizedPrice ?? '$7.99';
  const annualPrice  = annualProduct?.localizedPrice  ?? '$49.99';
  const annualLine   = priceLine(annualProduct, annualPrice, 'year');
  const monthlyLine  = priceLine(monthlyProduct, monthlyPrice, 'month');
  const annualDisabled = purchasing || restoring || storeLoading;
  const monthlyDisabled = purchasing || restoring || storeLoading;
  const storeMessage = storeLoading
    ? 'Loading App Store plans...'
    : error;

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={staticS.overlay}>
        <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingBottom: 40, paddingTop: 12, borderTopWidth: 1, borderColor: C.border }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 20 }} />

          <Text style={{ color: C.text, fontSize: 20, fontWeight: '700', marginBottom: 8 }}>{title}</Text>
          <Text style={{ color: C.text2, fontSize: 14, lineHeight: 20, marginBottom: 20 }}>{subtitle}</Text>

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
                  <Text style={{ color: C.orange, fontSize: 12, fontWeight: '700' }}>Retry App Store</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <Text style={{ color: C.text3, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 8, marginBottom: 12, fontFamily: mono }}>Or earn free credits</Text>

          <ScrollView style={staticS.earnList} showsVerticalScrollIndicator={false}>
            {EARN_ITEMS.map((item) => (
              <View key={item.label} style={[staticS.earnRow, { borderBottomWidth: 1, borderBottomColor: C.border }]}>
                <Text style={[staticS.earnIcon]}>{item.icon}</Text>
                <Text style={{ flex: 1, color: C.text2, fontSize: 13 }}>{item.label}</Text>
                <Text style={{ color: C.orange, fontSize: 13, fontWeight: '600' }}>{item.credits}</Text>
              </View>
            ))}
          </ScrollView>

          <TouchableOpacity
            style={staticS.restoreBtn}
            onPress={restore}
            disabled={restoring || purchasing || storeLoading}
            activeOpacity={0.7}
          >
            {restoring
              ? <ActivityIndicator color={C.text3} size="small" />
              : <Text style={{ color: C.text3, fontSize: 13 }}>Restore purchases</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={staticS.closeBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={{ color: C.text3, fontSize: 13 }}>Maybe later</Text>
          </TouchableOpacity>

          {/* Required by App Store: subscription duration, price, and links */}
          <Text style={{ color: C.text3, fontSize: 10, textAlign: 'center', lineHeight: 14, marginTop: 12, paddingHorizontal: 8 }}>
            Subscriptions auto-renew unless cancelled 24 hours before the end of the period.
            Manage or cancel in your Apple ID settings.{' '}
          </Text>
          <View style={staticS.legalLinks}>
            <TouchableOpacity onPress={() => Linking.openURL(TERMS_URL)}>
              <Text style={{ color: C.text3, fontSize: 10, textDecorationLine: 'underline' }}>Terms of Use</Text>
            </TouchableOpacity>
            <Text style={{ color: C.text3, fontSize: 10 }}> · </Text>
            <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_URL)}>
              <Text style={{ color: C.text3, fontSize: 10, textDecorationLine: 'underline' }}>Privacy Policy</Text>
            </TouchableOpacity>
          </View>
        </View>
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
  planBtnBadge:  { position: 'absolute', top: -1, left: 18, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  planBtnBody:   { flex: 1 },
  earnList:      { maxHeight: 180, marginBottom: 16 },
  earnRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  earnIcon:      { fontSize: 18, width: 30 },
  storeStatus:   { alignItems: 'center', gap: 6, marginBottom: 8 },
  retryStoreBtn: { paddingHorizontal: 10, paddingVertical: 4 },
  restoreBtn:    { alignItems: 'center', paddingVertical: 10 },
  closeBtn:      { alignItems: 'center', paddingVertical: 10 },
  legalLinks:    { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 4 },
});
