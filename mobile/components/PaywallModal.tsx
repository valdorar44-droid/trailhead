import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking } from 'react-native';

interface Props {
  visible: boolean;
  code?: string;
  message?: string;
  onClose: () => void;
  onGetPlan?: () => void;
}

const EARN_ITEMS = [
  { icon: '📍', label: 'Submit a road report', credits: '+10 credits' },
  { icon: '🏕️', label: 'Report a campsite condition', credits: '+10 credits' },
  { icon: '✅', label: 'Confirm another report', credits: '+2 credits' },
  { icon: '🔗', label: 'Refer a friend who signs up', credits: '+50 credits' },
  { icon: '📸', label: 'Add a photo to your report', credits: '+5 bonus' },
];

export default function PaywallModal({ visible, code, message, onClose, onGetPlan }: Props) {
  const isSearchLimit = code === 'search_limit';
  const title = isSearchLimit ? 'Free search used' : 'Credits needed';
  const subtitle = message ?? (isSearchLimit
    ? "You've used your 1 free camp search. Earn credits by contributing to the community — or grab a plan for unlimited access."
    : 'Earn credits through community contributions, or get the Explorer Plan for unlimited trip planning.');

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.handle} />

          <Text style={s.title}>{title}</Text>
          <Text style={s.subtitle}>{subtitle}</Text>

          <TouchableOpacity style={s.planBtn} onPress={onGetPlan ?? onClose} activeOpacity={0.85}>
            <View>
              <Text style={s.planBtnLabel}>Explorer Plan</Text>
              <Text style={s.planBtnSub}>$7.99/mo · $44.99/yr — unlimited everything</Text>
            </View>
            <Text style={s.planBtnArrow}>→</Text>
          </TouchableOpacity>

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
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#334155',
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    color: '#f1f5f9',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  planBtn: {
    backgroundColor: '#f97316',
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  planBtnLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  planBtnSub: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    marginTop: 2,
  },
  planBtnArrow: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
  },
  sectionLabel: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  earnList: {
    maxHeight: 200,
    marginBottom: 20,
  },
  earnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  earnIcon: {
    fontSize: 18,
    width: 30,
  },
  earnLabel: {
    flex: 1,
    color: '#cbd5e1',
    fontSize: 14,
  },
  earnCredits: {
    color: '#f97316',
    fontSize: 13,
    fontWeight: '600',
  },
  closeBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  closeBtnText: {
    color: '#475569',
    fontSize: 14,
  },
});
