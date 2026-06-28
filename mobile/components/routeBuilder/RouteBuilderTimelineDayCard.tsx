import type { ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { mono, useTheme, type ColorPalette } from '@/lib/design';

type RouteBuilderTimelineDayCardProps = {
  active: boolean;
  title: string;
  meta: string;
  statusText: string;
  statusColor: string;
  complete: boolean;
  placesLabel: string;
  campPreview?: ReactNode;
  needsOvernight: boolean;
  travelText: string;
  onSelect: () => void;
  onChooseOvernight: () => void;
  onFindCamp: () => void;
  onFindFuel: () => void;
  onFindPlaces: () => void;
  onFindSideTrips: () => void;
  onFindTours: () => void;
};

export default function RouteBuilderTimelineDayCard({
  active,
  title,
  meta,
  statusText,
  statusColor,
  complete,
  placesLabel,
  campPreview,
  needsOvernight,
  travelText,
  onSelect,
  onChooseOvernight,
  onFindCamp,
  onFindFuel,
  onFindPlaces,
  onFindSideTrips,
  onFindTours,
}: RouteBuilderTimelineDayCardProps) {
  const C = useTheme();
  const s = styles(C);

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      style={[s.section, active && s.sectionActive]}
      onPress={onSelect}
    >
      <View style={s.rail}>
        <View style={[s.dot, { borderColor: statusColor }, complete && { backgroundColor: C.green, borderColor: C.green }]} />
        <View style={s.stem} />
      </View>
      <View style={s.content}>
        <View style={s.header}>
          <View style={s.heading}>
            <Text style={s.title} numberOfLines={2}>{title}</Text>
            <Text style={s.meta} numberOfLines={2}>{meta}</Text>
          </View>
          <View style={[s.statusPill, { borderColor: statusColor + '66', backgroundColor: statusColor + '12' }]}>
            <Text style={[s.statusText, { color: statusColor }]} numberOfLines={1}>{statusText}</Text>
          </View>
        </View>

        {campPreview ? (
          campPreview
        ) : needsOvernight ? (
          <TouchableOpacity style={s.emptyCamp} onPress={onChooseOvernight} activeOpacity={0.84}>
            <Ionicons name="add-circle-outline" size={18} color={C.orange} />
            <Text style={s.emptyCampText}>Choose overnight</Text>
          </TouchableOpacity>
        ) : (
          <View style={s.travelCard}>
            <Ionicons name="arrow-forward-circle-outline" size={18} color={C.text3} />
            <Text style={s.travelText}>{travelText}</Text>
          </View>
        )}

        <Text style={s.groupLabel}>{placesLabel}</Text>
        <View style={s.actionRail}>
          <DayAction icon="bonfire-outline" label="CAMP" onPress={onFindCamp} />
          <DayAction icon="flash-outline" label="FUEL" onPress={onFindFuel} />
          <DayAction icon="trail-sign-outline" label="PLACES" onPress={onFindPlaces} />
          <DayAction icon="compass-outline" label="SIDE TRIPS" onPress={onFindSideTrips} />
          <DayAction icon="ticket-outline" label="TOURS" onPress={onFindTours} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

function DayAction({
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
    <TouchableOpacity style={s.actionButton} onPress={onPress} activeOpacity={0.84}>
      <Ionicons name={icon} size={13} color={C.orange} />
      <Text style={s.actionText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = (C: ColorPalette) => StyleSheet.create({
  section: {
    minHeight: 520,
    flexDirection: 'row',
    gap: 12,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    backgroundColor: C.s1,
    padding: 14,
  },
  sectionActive: {
    borderColor: C.orange + '66',
    backgroundColor: C.orange + '08',
  },
  rail: {
    width: 28,
    alignItems: 'center',
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: C.orange,
    backgroundColor: C.s1,
    marginTop: 10,
  },
  stem: {
    flex: 1,
    width: 3,
    backgroundColor: C.border,
    marginTop: 8,
    borderRadius: 2,
  },
  content: {
    flex: 1,
    gap: 16,
    minWidth: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  heading: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    flex: 1,
    color: C.text,
    fontSize: 24,
    fontWeight: '900',
  },
  meta: {
    color: C.text3,
    fontSize: 13,
    fontFamily: mono,
    marginTop: 4,
    lineHeight: 18,
  },
  statusPill: {
    maxWidth: 118,
    minHeight: 28,
    borderWidth: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  statusText: {
    fontSize: 8,
    fontFamily: mono,
    fontWeight: '900',
  },
  emptyCamp: {
    minHeight: 148,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderWidth: 1,
    borderColor: C.orange + '38',
    borderRadius: 16,
    backgroundColor: C.orange + '0f',
    paddingHorizontal: 16,
  },
  emptyCampText: {
    color: C.orange,
    fontSize: 15,
    fontFamily: mono,
    fontWeight: '900',
    flexShrink: 1,
  },
  travelCard: {
    minHeight: 104,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    backgroundColor: C.s2,
    paddingHorizontal: 16,
  },
  travelText: {
    color: C.text3,
    fontSize: 13,
    fontFamily: mono,
    fontWeight: '800',
    flexShrink: 1,
    textAlign: 'center',
  },
  groupLabel: {
    color: C.text3,
    fontSize: 8,
    fontFamily: mono,
    fontWeight: '900',
    marginTop: 2,
  },
  actionRail: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
    marginTop: 'auto',
  },
  actionButton: {
    flexGrow: 1,
    flexBasis: '30%',
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: C.orange + '38',
    borderRadius: 14,
    backgroundColor: C.orange + '10',
  },
  actionText: {
    color: C.orange,
    fontSize: 9,
    fontFamily: mono,
    fontWeight: '900',
  },
});
