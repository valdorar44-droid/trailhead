import React from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator,
} from 'react-native';
import { useSubscription, PRODUCT_IDS } from '@/lib/useSubscription';

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
  { icon: '✅', label: 'Confirm another user\'s report', credits: '+2 credits'  },
  { icon: '📸', label: 'Add a photo to your report',    credits: '+5 bonus'    },
  { icon: '🔗', label: 'Refer a friend who signs up',   credits: '+50 credits' },
];

export default function PaywallModal({ visible, code, message, onClose, onPlanActivated }: Props) {
  const { monthlyProduct, annualProduct, purchasing, restoring, error, purchase, restore } = useSubscription();

  const isSearchLimit = code === 'search_limit';
  const title = isSearchLimit ? 'Free search used' : 'Credits needed';
  const subtitle = message ?? (isSearchLimit
    ? "You've used your free camp search. Earn credits by contributing, or get the Explorer Plan for unlimited access."
    : 'Earn credits through community contributions, or get the Explorer Plan for unlimited trip planning and camp briefs.');

  async function handlePurchase(productId: string) {
    await purchase(productId);
    // purchaseUpdatedListener fires asynchronously — close modal optimistically
    // and let the store update propagate
    onPlanActivated?.();
    onClose();
  }

  const monthlyPrice = monthlyProduct?.localizedPrice ?? '$7.99';
  const annualPrice  = annualProduct?.localizedPrice  ?? '$49.99';

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.handle} />

          <Text style={s.title}>{title}</Text>
          <Text style={s.subtitle}>{subtitle}</Text>

          {/* Annual — featured */}
          <TouchableOpacity
            style={[s.planBtn, s.planBtnFeatured]}
            onPress={() => handlePurchase(PRODUCT_IDS.annual)}
            disabled={purchasing || restoring}
            activeOpacity={0.85}
          >
            <View style={s.planBtnBadge}>
              <Text style={s.planBtnBadgeText}>BEST VALUE</Text>
            </View>
            <View style={s.planBtnBody}>
              <Text style={s.planBtnLabel}>Explorer Annual</Text>
              <Text style={s.planBtnSub}>7-day free trial, then {annualPrice}/year</Text>
            </View>
            {purchasing
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.planBtnArrow}>→</Text>}
          </TouchableOpacity>

          {/* Monthly */}
          <TouchableOpacity
            style={s.planBtn}
            onPress={() => handlePurchase(PRODUCT_IDS.monthly)}
            disabled={purchasing || restoring}
            activeOpacity={0.85}
          >
            <View style={s.planBtnBody}>
              <Text style={s.planBtnLabel}>Explorer Monthly</Text>
              <Text style={s.planBtnSub}>7-day free trial, then {monthlyPrice}/month</Text>
            </View>
            {purchasing
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.planBtnArrow}>→</Text>}
          </TouchableOpacity>

          {!!error && <Text style={s.errorText}>{error}</Text>}

          <Text style={s.sectionLabel}>Or earn credits free</Text>

          <ScrollView style={s.earnList} showsVerticalScrollIndicator={false}>
            {EARN_ITEMS.map((item) => (
              <View key={item.label} style={s.earnRow}>
                <Text style={s.earnIcon}>{item.icon}</Text>
                <Text style={s.earnLabel}>{item.label}</Text>
                <Text style={s.earnCredits}>{item.credits}</Text>
              </View>
            ))}
          </ScrollView>

          <TouchableOpacity
            style={s.restoreBtn}
            onPress={restore}
            disabled={restoring || purchasing}
            activeOpacity={0.7}
          >
            {restoring
              ? <ActivityIndicator color="#64748b" size="small" />
              : <Text style={s.restoreBtnText}>Restore purchases</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={s.closeBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={s.closeBtnText}>Maybe later</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: '#1e293b',
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#334155',
    alignSelf: 'center', marginBottom: 20,
  },
  title: {
    color: '#f1f5f9', fontSize: 20, fontWeight: '700', marginBottom: 8,
  },
  subtitle: {
    color: '#94a3b8', fontSize: 14, lineHeight: 20, marginBottom: 20,
  },
  planBtn: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  planBtnFeatured: {
    backgroundColor: '#f97316',
    borderColor: '#f97316',
    position: 'relative',
    paddingTop: 20,
  },
  planBtnBadge: {
    position: 'absolute',
    top: -1,
    left: 18,
    backgroundColor: '#fff',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  planBtnBadgeText: {
    color: '#f97316', fontSize: 9, fontWeight: '800', letterSpacing: 0.8,
  },
  planBtnBody: { flex: 1 },
  planBtnLabel: {
    color: '#fff', fontSize: 15, fontWeight: '700',
  },
  planBtnSub: {
    color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 2,
  },
  planBtnArrow: {
    color: '#fff', fontSize: 20, fontWeight: '600', marginLeft: 8,
  },
  errorText: {
    color: '#f87171', fontSize: 13, marginBottom: 8, textAlign: 'center',
  },
  sectionLabel: {
    color: '#64748b', fontSize: 12, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginTop: 8, marginBottom: 12,
  },
  earnList: { maxHeight: 180, marginBottom: 16 },
  earnRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e293b',
  },
  earnIcon:    { fontSize: 18, width: 30 },
  earnLabel:   { flex: 1, color: '#cbd5e1', fontSize: 13 },
  earnCredits: { color: '#f97316', fontSize: 13, fontWeight: '600' },
  restoreBtn:  { alignItems: 'center', paddingVertical: 10 },
  restoreBtnText: { color: '#475569', fontSize: 13 },
  closeBtn:    { alignItems: 'center', paddingVertical: 10 },
  closeBtnText: { color: '#334155', fontSize: 13 },
});
