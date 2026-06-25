import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ColorPalette, useTheme } from '@/lib/design';

interface PlannerStarterRowProps {
  title: string;
  body: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}

export default function PlannerStarterRow({ title, body, icon, onPress }: PlannerStarterRowProps) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);

  return (
    <TouchableOpacity activeOpacity={0.82} style={s.card} onPress={onPress}>
      <View style={s.iconBox}>
        <Ionicons name={icon} size={16} color={C.orange} />
      </View>
      <View style={s.copy}>
        <Text style={s.title} numberOfLines={1}>{title}</Text>
        <Text style={s.body} numberOfLines={2}>{body}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={C.text3} />
    </TouchableOpacity>
  );
}

function makeStyles(C: ColorPalette) {
  return StyleSheet.create({
    card: {
      minHeight: 74,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.s2,
      paddingHorizontal: 12,
      paddingVertical: 11,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    iconBox: {
      width: 36,
      height: 36,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.s1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    copy: {
      flex: 1,
      minWidth: 0,
      gap: 3,
    },
    title: {
      color: C.text,
      fontSize: 13.5,
      fontWeight: '800',
      letterSpacing: 0,
    },
    body: {
      color: C.text2,
      fontSize: 11.5,
      lineHeight: 16,
    },
  });
}
