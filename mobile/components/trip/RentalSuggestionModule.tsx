import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { OutdoorOffer } from '@/lib/api';
import type { RentalSuggestionFit } from '@/lib/outdoorRentals';
import { mono, useTheme } from '@/lib/design';
import OfferDisclosure from '@/components/offers/OfferDisclosure';
import OutdoorRentalCard from '@/components/offers/OutdoorRentalCard';

type Props = {
  fit: RentalSuggestionFit;
  offers: OutdoorOffer[];
  loading?: boolean;
  saved?: boolean;
  onViewRentals: (offer?: OutdoorOffer) => void;
  onSaveIdea: () => void;
  onDismiss: () => void;
};

export default function RentalSuggestionModule({
  fit,
  offers,
  loading = false,
  saved = false,
  onViewRentals,
  onSaveIdea,
  onDismiss,
}: Props) {
  const C = useTheme();
  if (!fit.shouldShow || (!loading && offers.length === 0)) return null;
  const firstOffer = offers[0];
  const disclosure = firstOffer?.disclosure_label || 'Partner booking · Trailhead may earn.';

  return (
    <View style={[styles.module, { borderColor: C.border, backgroundColor: C.s1 }]}>
      <View style={styles.topRow}>
        <View style={[styles.icon, { borderColor: C.orange + '44', backgroundColor: C.orange + '12' }]}>
          <Ionicons name="car-sport-outline" size={18} color={C.orange} />
        </View>
        <View style={styles.heading}>
          <Text style={[styles.kicker, { color: C.orange }]}>Rentals</Text>
          <Text style={[styles.title, { color: C.text }]} numberOfLines={2}>
            {fit.title}
          </Text>
        </View>
        <TouchableOpacity style={styles.dismiss} onPress={onDismiss} hitSlop={8} accessibilityLabel="Dismiss rental suggestion">
          <Ionicons name="close" size={16} color={C.text3} />
        </TouchableOpacity>
      </View>

      <View style={styles.copyBlock}>
        <Text style={[styles.subtitle, { color: C.text2 }]} numberOfLines={2}>
          {fit.subtitle}
        </Text>
        <Text style={[styles.reason, { color: C.text3 }]} numberOfLines={2}>
          {fit.reason}
        </Text>
      </View>

      {loading ? (
        <View style={[styles.loadingRow, { borderColor: C.border }]}>
          <ActivityIndicator size="small" color={C.orange} />
          <Text style={[styles.loadingText, { color: C.text3 }]}>Checking nearby rentals</Text>
        </View>
      ) : firstOffer ? (
        <OutdoorRentalCard offer={firstOffer} onPress={() => onViewRentals(firstOffer)} />
      ) : null}

      <OfferDisclosure label={disclosure} />

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.primary, { backgroundColor: C.orange }]}
          activeOpacity={0.86}
          onPress={() => onViewRentals(firstOffer)}
        >
          <Ionicons name="open-outline" size={14} color="#fff" />
          <Text style={styles.primaryText}>View rentals</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.secondary, { borderColor: saved ? C.green + '55' : C.border, backgroundColor: saved ? C.green + '10' : C.s2 }]}
          activeOpacity={0.86}
          onPress={onSaveIdea}
        >
          <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={14} color={saved ? C.green : C.text3} />
          <Text style={[styles.secondaryText, { color: saved ? C.green : C.text2 }]}>
            {saved ? 'Saved' : 'Save idea'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  module: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 13,
    gap: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: {
    flex: 1,
    minWidth: 0,
  },
  kicker: {
    fontSize: 8,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
    marginTop: 2,
  },
  dismiss: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyBlock: {
    gap: 4,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  reason: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  loadingRow: {
    minHeight: 58,
    borderTopWidth: 1,
    paddingTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  loadingText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
  },
  actions: {
    flexDirection: 'row',
    gap: 9,
  },
  primary: {
    flex: 1,
    minHeight: 42,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  primaryText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: mono,
    fontWeight: '900',
  },
  secondary: {
    minWidth: 112,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
  },
  secondaryText: {
    fontSize: 10,
    fontFamily: mono,
    fontWeight: '900',
  },
});
