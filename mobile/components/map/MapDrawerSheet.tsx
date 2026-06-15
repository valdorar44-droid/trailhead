import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, type ColorPalette } from '@/lib/design';

export type MapDrawerItem = {
  label: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: string;
  onPress: () => void;
};

type Props = {
  visible: boolean;
  topInset: number;
  bottomInset: number;
  items: MapDrawerItem[];
  onClose: () => void;
};

export default function MapDrawerSheet({ visible, topInset, bottomInset, items, onClose }: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);

  if (!visible) return null;

  return (
    <View style={s.mapDrawerOverlay} pointerEvents="auto">
      <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={onClose} />
      <View style={[s.mapDrawer, { paddingTop: topInset + 18, paddingBottom: bottomInset + 16 }]}>
        <View style={s.mapDrawerHeader}>
          <View>
            <Text style={s.mapDrawerTitle}>Map tools</Text>
          </View>
          <TouchableOpacity style={s.mapDrawerClose} onPress={onClose}>
            <Ionicons name="close" size={17} color={C.text2} />
          </TouchableOpacity>
        </View>
        <View style={s.mapDrawerSection}>
          {items.map(item => (
            <TouchableOpacity key={item.label} style={s.mapDrawerRow} onPress={item.onPress} activeOpacity={0.84}>
              <View style={[s.mapDrawerRowIcon, { borderColor: item.tone + '55', backgroundColor: item.tone + '14' }]}>
                <Ionicons name={item.icon as any} size={16} color={item.tone} />
              </View>
              <View style={s.mapDrawerRowTextWrap}>
                <Text style={s.mapDrawerRowTitle} numberOfLines={1}>{item.label}</Text>
                <Text style={s.mapDrawerRowSub} numberOfLines={1}>{item.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={15} color={C.text3} />
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  mapDrawerOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    zIndex: 260,
    elevation: 260,
  },
  mapDrawer: {
    width: 302,
    maxWidth: '88%',
    minHeight: 260,
    borderTopRightRadius: 22,
    borderBottomRightRadius: 22,
    backgroundColor: C.s1,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
  },
  mapDrawerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  mapDrawerTitle: { color: C.text, fontSize: 20, fontWeight: '900' },
  mapDrawerClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.s2,
    borderWidth: 1,
    borderColor: C.border,
  },
  mapDrawerSection: { gap: 8 },
  mapDrawerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s2,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  mapDrawerRowIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapDrawerRowTextWrap: { flex: 1, minWidth: 0 },
  mapDrawerRowTitle: { color: C.text, fontSize: 14, fontWeight: '800' },
  mapDrawerRowSub: { color: C.text3, fontSize: 11, lineHeight: 15, marginTop: 2 },
});
