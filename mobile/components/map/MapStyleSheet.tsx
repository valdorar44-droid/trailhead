import React, { useMemo } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { mono, useTheme, type ColorPalette } from '@/lib/design';

export type MapStyleOption = {
  id: string;
  title: string;
  sub: string;
  colors: [string, string, string];
};

export type PremiumMapStyleOption = {
  id: string;
  label: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  active: boolean;
  onPress: () => void;
};

type Props = {
  visible: boolean;
  bottomInset: number;
  activeMapLayer: string;
  options: readonly MapStyleOption[];
  premiumMapVisible: boolean;
  premiumMapItems: readonly PremiumMapStyleOption[];
  extremeActive: boolean;
  extremeSelectable: boolean;
  extremeSub: string;
  onClose: () => void;
  onSelectMapLayer: (id: string) => void;
  onSelectExplorer: () => void;
};

export default function MapStyleSheet({
  visible,
  bottomInset,
  activeMapLayer,
  options,
  premiumMapVisible,
  premiumMapItems,
  extremeActive,
  extremeSelectable,
  extremeSub,
  onClose,
  onSelectMapLayer,
  onSelectExplorer,
}: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
      <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[s.sheet, { paddingBottom: bottomInset + 16 }]} onPress={() => {}}>
          <View style={s.header}>
            <View>
              <Text style={s.title}>Map style</Text>
              <Text style={s.sub}>Choose how the map looks.</Text>
            </View>
            <TouchableOpacity style={s.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={17} color={C.text2} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.grid}>
            {options.map(option => {
              const active = option.id === activeMapLayer;
              return (
                <TouchableOpacity
                  key={option.id}
                  style={[s.card, active && s.cardActive]}
                  activeOpacity={0.86}
                  onPress={() => {
                    onSelectMapLayer(option.id);
                    onClose();
                  }}
                >
                  <View style={[s.preview, { backgroundColor: option.colors[0] }]}>
                    <View style={[s.previewWater, { backgroundColor: option.colors[2] }]} />
                    <View style={[s.previewLand, { backgroundColor: option.colors[1] }]} />
                    <View style={s.previewRoad} />
                    <View style={[s.previewRoad, s.previewRoadAlt]} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.cardTitle} numberOfLines={1}>{option.title}</Text>
                    <Text style={s.cardSub} numberOfLines={1}>{option.sub}</Text>
                  </View>
                  {active ? <Ionicons name="checkmark-circle" size={18} color={C.green} /> : null}
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity
              style={[
                s.card,
                s.extremeCard,
                extremeActive && s.extremeCardActive,
                !extremeSelectable && s.extremeCardLocked,
              ]}
              activeOpacity={0.86}
              onPress={() => {
                onSelectExplorer();
                if (extremeSelectable) onClose();
              }}
            >
              <View style={s.extremePreview}>
                <Text style={s.extremeWord}>EXPLORER</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.extremeTitle} numberOfLines={1}>EXPLORER</Text>
                <Text style={s.cardSub} numberOfLines={1}>{extremeSub}</Text>
              </View>
              <Ionicons
                name={extremeActive ? 'checkmark-circle' : 'ellipse-outline'}
                size={18}
                color="#ef4444"
              />
            </TouchableOpacity>

            {premiumMapVisible ? premiumMapItems.map(option => (
              <TouchableOpacity
                key={`mapbox-${option.id}`}
                style={[s.card, s.premiumCard, extremeActive && option.active && { borderColor: option.color + '88', backgroundColor: option.color + '16' }]}
                activeOpacity={0.86}
                onPress={() => {
                  option.onPress();
                  onClose();
                }}
              >
                <View style={[s.premiumPreview, { borderColor: option.color + '55', backgroundColor: option.color + '14' }]}>
                  <Ionicons name={option.icon} size={22} color={option.color} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.cardTitle} numberOfLines={1}>{option.label}</Text>
                  <Text style={s.cardSub} numberOfLines={1}>{option.sub}</Text>
                </View>
                {extremeActive && option.active ? <Ionicons name="checkmark-circle" size={18} color={option.color} /> : null}
              </TouchableOpacity>
            )) : null}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.48)',
  },
  sheet: {
    maxHeight: '78%',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: 'rgba(8,11,15,0.98)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingTop: 16,
    paddingHorizontal: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 12,
  },
  title: {
    color: C.text,
    fontSize: 18,
    fontWeight: '900',
  },
  sub: {
    color: C.text3,
    fontSize: 11,
    marginTop: 3,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.s2,
    borderWidth: 1,
    borderColor: C.border,
  },
  grid: {
    gap: 8,
    paddingBottom: 8,
  },
  card: {
    minHeight: 68,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    backgroundColor: 'rgba(255,255,255,0.045)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
  },
  cardActive: {
    borderColor: C.green + '80',
    backgroundColor: C.green + '12',
  },
  extremeCard: {
    borderColor: '#7f1d1d88',
    backgroundColor: 'rgba(20,20,22,0.92)',
  },
  extremeCardActive: {
    borderColor: '#ef4444',
    backgroundColor: '#7f1d1d22',
  },
  extremeCardLocked: {
    borderColor: '#4b5563',
    backgroundColor: '#18181b',
  },
  premiumCard: {
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.055)',
  },
  preview: {
    width: 58,
    height: 44,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  previewWater: {
    position: 'absolute',
    right: -8,
    top: -10,
    width: 34,
    height: 64,
    borderRadius: 18,
    transform: [{ rotate: '16deg' }],
  },
  previewLand: {
    position: 'absolute',
    left: 5,
    bottom: 5,
    width: 25,
    height: 17,
    borderRadius: 9,
    opacity: 0.82,
  },
  previewRoad: {
    position: 'absolute',
    left: -5,
    top: 17,
    width: 70,
    height: 3,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.82)',
    transform: [{ rotate: '-17deg' }],
  },
  previewRoadAlt: {
    top: 28,
    height: 2,
    opacity: 0.7,
    transform: [{ rotate: '13deg' }],
  },
  cardTitle: {
    color: C.text,
    fontSize: 12.5,
    fontWeight: '900',
  },
  cardSub: {
    color: C.text3,
    fontSize: 10,
    marginTop: 2,
  },
  extremePreview: {
    width: 58,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ef444488',
    backgroundColor: '#111113',
    alignItems: 'center',
    justifyContent: 'center',
  },
  extremeWord: {
    color: '#ef4444',
    fontSize: 9,
    fontFamily: mono,
    fontWeight: '900',
  },
  extremeTitle: {
    color: '#ef4444',
    fontSize: 12.5,
    fontWeight: '900',
  },
  premiumPreview: {
    width: 58,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
