import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { mono, useTheme, type ColorPalette } from '@/lib/design';

type RouteBuilderActiveDayControlsProps = {
  activeDay: number;
  meta: string;
  restDay: boolean;
  maxHoursValue: string;
  maxHoursPlaceholder: string;
  maxHoursSummary: string;
  onToggleRestDay: () => void;
  onChangeMaxHours: (value: string) => void;
};

type RouteBuilderEmptyDayGuidanceProps = {
  title?: string;
  body?: string;
};

export default function RouteBuilderActiveDayControls({
  activeDay,
  meta,
  restDay,
  maxHoursValue,
  maxHoursPlaceholder,
  maxHoursSummary,
  onToggleRestDay,
  onChangeMaxHours,
}: RouteBuilderActiveDayControlsProps) {
  const C = useTheme();
  const s = styles(C);

  return (
    <>
      <View style={s.header}>
        <Text style={s.title}>DAY {activeDay} ITINERARY</Text>
        <Text style={s.meta}>{meta}</Text>
      </View>
      <View style={s.controls}>
        <TouchableOpacity
          style={[s.restToggle, restDay && { borderColor: C.green + '77', backgroundColor: C.green + '14' }]}
          onPress={onToggleRestDay}
          activeOpacity={0.84}
        >
          <Ionicons name="bed-outline" size={13} color={restDay ? C.green : C.text3} />
          <Text style={[s.restText, restDay && { color: C.green }]}>REST DAY</Text>
        </TouchableOpacity>
        <View style={s.hoursBox}>
          <Text style={s.inputLabel}>MAX HOURS</Text>
          <TextInput
            value={maxHoursValue}
            onChangeText={onChangeMaxHours}
            keyboardType="decimal-pad"
            style={s.hoursInput}
            placeholder={maxHoursPlaceholder}
            placeholderTextColor={C.text3}
          />
        </View>
        <Text style={s.summary}>{maxHoursSummary}</Text>
      </View>
    </>
  );
}

export function RouteBuilderEmptyDayGuidance({
  title = 'Build the day in order',
  body = 'Start with a destination, then add fuel, places, and a camp. Tap a stop later to insert new places after it.',
}: RouteBuilderEmptyDayGuidanceProps) {
  const C = useTheme();
  const s = styles(C);

  return (
    <View style={s.empty}>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyText}>{body}</Text>
    </View>
  );
}

const styles = (C: ColorPalette) => StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  title: {
    color: C.text,
    fontSize: 11,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  meta: {
    color: C.text3,
    fontSize: 10,
    fontFamily: mono,
    maxWidth: 190,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 9,
    backgroundColor: C.s2,
  },
  restToggle: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    backgroundColor: C.s1,
  },
  restText: {
    color: C.text3,
    fontSize: 9,
    fontFamily: mono,
    fontWeight: '900',
  },
  hoursBox: {
    width: 82,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    backgroundColor: C.s1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  inputLabel: {
    color: C.text3,
    fontSize: 7,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  hoursInput: {
    color: C.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
    height: 38,
    paddingTop: 0,
    paddingBottom: 0,
    textAlignVertical: 'center',
    includeFontPadding: false,
    overflow: 'hidden',
  },
  summary: {
    flex: 1,
    color: C.text3,
    fontSize: 10,
    fontFamily: mono,
    textAlign: 'right',
  },
  empty: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 14,
    backgroundColor: C.s2,
  },
  emptyTitle: {
    color: C.text,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 4,
  },
  emptyText: {
    color: C.text3,
    fontSize: 12,
    lineHeight: 18,
  },
});
