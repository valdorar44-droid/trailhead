import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { mono, useTheme, type ColorPalette } from '@/lib/design';

type Props = {
  title?: string;
  lat: number;
  lng: number;
  dms?: string | null;
  onCopy: () => void;
};

export default function CampCoordinatesSection({
  title = 'COORDINATES',
  lat,
  lng,
  dms,
  onCopy,
}: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) <= 0.0001 || Math.abs(lng) <= 0.0001) return null;

  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={s.row}>
        <Text style={s.text}>{lat.toFixed(6)}, {lng.toFixed(6)}</Text>
        <TouchableOpacity style={s.copyBtn} onPress={onCopy}>
          <Ionicons name="copy-outline" size={14} color={C.orange} />
          <Text style={s.copyText}>COPY</Text>
        </TouchableOpacity>
      </View>
      {dms ? <Text style={s.dms}>{dms}</Text> : null}
    </View>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  section: {
    paddingTop: 22,
    marginTop: 18,
    borderTopWidth: 1,
    borderColor: C.border,
  },
  sectionTitle: {
    color: C.text2,
    fontSize: 10,
    fontFamily: mono,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  text: {
    color: C.text2,
    fontSize: 13,
    fontFamily: mono,
    flex: 1,
  },
  dms: {
    color: C.text2,
    fontSize: 11,
    fontFamily: mono,
    marginTop: 4,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.orange,
  },
  copyText: {
    color: C.orange,
    fontSize: 9,
    fontFamily: mono,
    fontWeight: '700',
  },
});
