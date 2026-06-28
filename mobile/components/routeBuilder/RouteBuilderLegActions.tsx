import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { mono, useTheme, type ColorPalette } from '@/lib/design';

type RouteBuilderLegActionsProps = {
  distanceLabel: string;
  durationLabel: string;
  fuelLabel: string;
  nextStopName: string;
  onFindFuel: () => void;
  onFindCamp: () => void;
  onFindPlaces: () => void;
  onFindTours: () => void;
};

export default function RouteBuilderLegActions({
  distanceLabel,
  durationLabel,
  fuelLabel,
  nextStopName,
  onFindFuel,
  onFindCamp,
  onFindPlaces,
  onFindTours,
}: RouteBuilderLegActionsProps) {
  const C = useTheme();
  const s = styles(C);

  return (
    <View style={s.card}>
      <View style={s.lineDot} />
      <View style={s.copy}>
        <Text style={s.meta}>{distanceLabel} · {durationLabel}</Text>
        <Text style={s.fuel}>{fuelLabel}</Text>
        <Text style={s.to} numberOfLines={1}>to {nextStopName}</Text>
      </View>
      <LegButton icon="flash-outline" label="FUEL" onPress={onFindFuel} />
      <LegButton icon="bonfire-outline" label="CAMP" onPress={onFindCamp} />
      <LegButton icon="trail-sign-outline" label="PLACE" onPress={onFindPlaces} />
      <LegButton icon="ticket-outline" label="TOUR" onPress={onFindTours} />
    </View>
  );
}

function LegButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const C = useTheme();
  const s = styles(C);

  return (
    <TouchableOpacity style={s.action} onPress={onPress} activeOpacity={0.84}>
      <Ionicons name={icon} size={14} color={C.orange} />
      <Text style={s.actionText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = (C: ColorPalette) => StyleSheet.create({
  card: {
    marginLeft: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderLeftWidth: 2,
    borderLeftColor: C.orange + '55',
    paddingLeft: 14,
    paddingVertical: 6,
  },
  lineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: C.orange,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  meta: {
    color: C.text,
    fontSize: 11,
    fontFamily: mono,
    fontWeight: '900',
  },
  fuel: {
    color: C.green,
    fontSize: 10,
    fontFamily: mono,
    fontWeight: '900',
    marginTop: 2,
  },
  to: {
    color: C.text3,
    fontSize: 10,
    marginTop: 1,
  },
  action: {
    minWidth: 42,
    minHeight: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.orange + '12',
    borderWidth: 1,
    borderColor: C.orange + '35',
    paddingHorizontal: 6,
  },
  actionText: {
    color: C.orange,
    fontSize: 7,
    fontFamily: mono,
    fontWeight: '900',
    marginTop: 1,
  },
});
