import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { mono, useTheme, type ColorPalette } from '@/lib/design';
import type { TripShapeMode } from '@/lib/api';

type RouteBuilderTimelineActionsProps = {
  tripShapeMode: TripShapeMode;
  tripLoop: boolean;
  onAddDay: () => void;
  onToggleTripShape: () => void;
};

function shapeIcon(mode: TripShapeMode) {
  if (mode === 'loop') return 'sync-outline';
  if (mode === 'there_and_back') return 'repeat-outline';
  return 'arrow-forward-outline';
}

function shapeLabel(mode: TripShapeMode) {
  if (mode === 'loop') return 'LOOP';
  if (mode === 'there_and_back') return 'RETURN';
  return 'ONE WAY';
}

export default function RouteBuilderTimelineActions({
  tripShapeMode,
  tripLoop,
  onAddDay,
  onToggleTripShape,
}: RouteBuilderTimelineActionsProps) {
  const C = useTheme();
  const s = styles(C);
  const activeShape = tripLoop || tripShapeMode !== 'one_way';

  return (
    <View style={s.actions}>
      <TouchableOpacity style={s.addDay} onPress={onAddDay} activeOpacity={0.84}>
        <Ionicons name="add" size={13} color={C.orange} />
        <Text style={s.addText}>DAY</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.shape} onPress={onToggleTripShape} activeOpacity={0.84}>
        <Ionicons name={shapeIcon(tripShapeMode)} size={13} color={activeShape ? C.green : C.text3} />
        <Text style={[s.shapeText, activeShape && { color: C.green }]}>{shapeLabel(tripShapeMode)}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = (C: ColorPalette) => StyleSheet.create({
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    paddingHorizontal: 2,
    paddingBottom: 2,
  },
  addDay: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: C.orange + '55',
    borderRadius: 10,
    paddingHorizontal: 9,
    backgroundColor: C.orange + '10',
  },
  addText: {
    color: C.orange,
    fontSize: 8,
    fontFamily: mono,
    fontWeight: '900',
  },
  shape: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 9,
    backgroundColor: C.s1,
  },
  shapeText: {
    color: C.text3,
    fontSize: 8,
    fontFamily: mono,
    fontWeight: '900',
  },
});
