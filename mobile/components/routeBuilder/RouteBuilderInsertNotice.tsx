import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { mono, useTheme, type ColorPalette } from '@/lib/design';

type RouteBuilderInsertNoticeProps = {
  selectedStopName?: string | null;
  targetDay?: number | null;
  fallbackDay?: number | null;
  onClearInsert: () => void;
};

export default function RouteBuilderInsertNotice({
  selectedStopName,
  targetDay,
  fallbackDay,
  onClearInsert,
}: RouteBuilderInsertNoticeProps) {
  const C = useTheme();
  const s = styles(C);
  const active = Boolean(selectedStopName);
  const dayLabel = targetDay ?? fallbackDay;
  const stopShortName = selectedStopName?.split(',')[0];

  return (
    <View style={[s.card, active && { borderColor: C.orange + '66', backgroundColor: C.orange + '10' }]}>
      <Ionicons name={active ? 'git-commit-outline' : 'add-circle-outline'} size={15} color={active ? C.orange : C.text3} />
      <View style={s.copy}>
        <Text style={s.title}>{active ? 'Insert after stop' : 'Add to active day'}</Text>
        <Text style={s.text} numberOfLines={3}>
          {active
            ? `New stops will land after ${stopShortName || 'this stop'}${dayLabel ? ` on Day ${dayLabel}` : ''}.`
            : 'Use a day action below to place fuel, camps, or POIs in the right leg.'}
        </Text>
      </View>
      {active ? (
        <TouchableOpacity style={s.clear} onPress={onClearInsert} activeOpacity={0.84}>
          <Text style={s.clearText}>END</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = (C: ColorPalette) => StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 10,
    backgroundColor: C.s2,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: C.text,
    fontSize: 12,
    fontWeight: '900',
  },
  text: {
    color: C.text3,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 1,
  },
  clear: {
    borderWidth: 1,
    borderColor: C.orange + '55',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: C.s1,
  },
  clearText: {
    color: C.orange,
    fontSize: 9,
    fontFamily: mono,
    fontWeight: '900',
  },
});
