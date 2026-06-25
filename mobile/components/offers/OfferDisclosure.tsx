import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/design';

type Props = {
  label?: string;
};

export default function OfferDisclosure({ label = 'Partner booking · Trailhead may earn.' }: Props) {
  const C = useTheme();
  return (
    <View style={[styles.row, { borderColor: C.border, backgroundColor: C.s2 }]}>
      <Ionicons name="information-circle-outline" size={14} color={C.text3} />
      <Text style={[styles.text, { color: C.text3 }]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 32,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  text: {
    flex: 1,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
  },
});
