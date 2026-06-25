import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { OutdoorOffer } from '@/lib/api';
import { mono, useTheme } from '@/lib/design';

type Props = {
  offer: OutdoorOffer;
  onPress?: () => void;
};

function rentalMeta(offer: OutdoorOffer) {
  return [
    offer.pickup_area,
    offer.vehicle_class || offer.type?.replace(/_/g, ' '),
    offer.sleeps ? `Sleeps ${offer.sleeps}` : '',
  ].filter(Boolean).join(' · ');
}

export default function OutdoorRentalCard({ offer, onPress }: Props) {
  const C = useTheme();
  const imageUrl = offer.images?.[0]?.url;
  const body = (
    <View style={[styles.row, { borderColor: C.border }]}>
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={styles.image} />
      ) : (
        <View style={[styles.placeholder, { borderColor: C.orange + '44', backgroundColor: C.orange + '12' }]}>
          <Ionicons name="car-sport-outline" size={20} color={C.orange} />
        </View>
      )}
      <View style={styles.copy}>
        <Text style={[styles.title, { color: C.text }]} numberOfLines={1}>
          {offer.title}
        </Text>
        <Text style={[styles.meta, { color: C.text3 }]} numberOfLines={2}>
          {rentalMeta(offer) || 'Rental option near your starting area'}
        </Text>
      </View>
      <View style={[styles.open, { borderColor: C.orange + '55', backgroundColor: C.orange + '10' }]}>
        <Text style={[styles.openText, { color: C.orange }]}>VIEW</Text>
      </View>
    </View>
  );
  if (!onPress) return body;
  return (
    <TouchableOpacity activeOpacity={0.86} onPress={onPress}>
      {body}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    paddingTop: 12,
  },
  image: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#111827',
  },
  placeholder: {
    width: 56,
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  title: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
  },
  meta: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  open: {
    minWidth: 46,
    minHeight: 32,
    borderWidth: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 9,
  },
  openText: {
    fontSize: 8,
    fontFamily: mono,
    fontWeight: '900',
  },
});
