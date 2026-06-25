import type { ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { mono, useTheme, type ColorPalette } from '@/lib/design';

type RouteBuilderActiveDayStopProps = {
  index: number;
  name: string;
  meta: string;
  color: string;
  selected: boolean;
  preview: ReactNode;
  leg?: ReactNode;
  onSelect: () => void;
  onOpenCampDetail?: () => void;
  onReplaceCamp?: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
};

export default function RouteBuilderActiveDayStop({
  index,
  name,
  meta,
  color,
  selected,
  preview,
  leg,
  onSelect,
  onOpenCampDetail,
  onReplaceCamp,
  onMoveUp,
  onMoveDown,
  onRemove,
}: RouteBuilderActiveDayStopProps) {
  const C = useTheme();
  const s = styles(C);

  return (
    <View style={s.item}>
      <View style={[s.card, selected && s.cardSelected]}>
        <TouchableOpacity style={s.top} onPress={onSelect} activeOpacity={0.86}>
          <View style={[s.number, { backgroundColor: color }]}>
            <Text style={s.numberText}>{index + 1}</Text>
          </View>
          <View style={s.copy}>
            <Text style={s.name} numberOfLines={1}>{name}</Text>
            <Text style={s.meta}>{meta}</Text>
          </View>
          {onOpenCampDetail ? (
            <IconButton icon="image-outline" color={C.orange} onPress={onOpenCampDetail} />
          ) : null}
          {onReplaceCamp ? (
            <IconButton icon="swap-horizontal-outline" color={C.orange} onPress={onReplaceCamp} />
          ) : null}
          <IconButton icon="chevron-up" color={C.text3} onPress={onMoveUp} />
          <IconButton icon="chevron-down" color={C.text3} onPress={onMoveDown} />
          <IconButton icon="trash-outline" color={C.red} onPress={onRemove} />
        </TouchableOpacity>
        {preview}
      </View>
      {leg}
    </View>
  );
}

function IconButton({
  icon,
  color,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  onPress: () => void;
}) {
  const C = useTheme();
  const s = styles(C);

  return (
    <TouchableOpacity style={s.iconButton} onPress={onPress} activeOpacity={0.82}>
      <Ionicons name={icon} size={15} color={color} />
    </TouchableOpacity>
  );
}

const styles = (C: ColorPalette) => StyleSheet.create({
  item: {
    gap: 8,
  },
  card: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    backgroundColor: C.s1,
    padding: 9,
    gap: 9,
  },
  cardSelected: {
    borderColor: C.orange + '77',
    backgroundColor: C.orange + '10',
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  number: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberText: {
    color: '#fff',
    fontSize: 11,
    fontFamily: mono,
    fontWeight: '900',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: C.text,
    fontSize: 13,
    fontWeight: '800',
  },
  meta: {
    color: C.text3,
    fontSize: 10,
    fontFamily: mono,
    marginTop: 2,
  },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.s2,
  },
});
