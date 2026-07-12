import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/design';
import { StaticMapboxPreview } from './StaticMapboxPreview';

export type GuidedDestination = {
  id: string;
  name: string;
  region: string;
  group: 'Mountain' | 'Desert' | 'Water' | 'Worldwide';
  lat: number;
  lng: number;
  terms: string[];
  searchQuery?: string;
  imageUrl?: string;
  imageAlt?: string;
  imageCredit?: string;
  imageLicense?: string;
  imageLicenseUrl?: string;
  imageSourceUrl?: string;
};

export const GUIDED_DESTINATIONS: GuidedDestination[] = [
  { id: 'guided:yosemite-national-park', name: 'Yosemite National Park', region: 'California, United States', group: 'Mountain', lat: 37.7489, lng: -119.5885, searchQuery: 'Yosemite National Park', terms: ['yosemite national park', 'yosemite', 'yosemite valley'] },
  { id: 'guided:banff-national-park', name: 'Banff National Park', region: 'Alberta, Canada', group: 'Mountain', lat: 51.1784, lng: -115.5708, searchQuery: 'Banff National Park', terms: ['banff national park', 'banff', 'canadian rockies'] },
  { id: 'guided:swiss-alps', name: 'Swiss Alps', region: 'Switzerland', group: 'Mountain', lat: 46.5591, lng: 7.8916, searchQuery: 'Swiss Alps', terms: ['swiss alps', 'bernese oberland', 'jungfrau region', 'interlaken'] },
  { id: 'guided:dolomites', name: 'The Dolomites', region: 'Northern Italy', group: 'Mountain', lat: 46.5405, lng: 11.8854, searchQuery: 'Dolomites Italy', terms: ['dolomites italy', 'dolomites', 'italian dolomites', "cortina d'ampezzo"] },
  { id: 'guided:patagonia', name: 'Patagonia', region: 'Argentina and Chile', group: 'Mountain', lat: -50.3379, lng: -72.2648, searchQuery: 'Patagonia', terms: ['patagonia', 'el calafate', 'el chalten', 'torres del paine'] },
  { id: 'guided:nepal-himalayas', name: 'Nepal Himalayas', region: 'Nepal', group: 'Mountain', lat: 27.9881, lng: 86.925, searchQuery: 'Nepal Himalayas', terms: ['nepal himalayas', 'everest region', 'annapurna', 'kathmandu trekking'] },
  { id: 'guided:queenstown', name: 'Queenstown', region: 'South Island, New Zealand', group: 'Mountain', lat: -45.0312, lng: 168.6626, searchQuery: 'Queenstown New Zealand', terms: ['queenstown new zealand', 'queenstown', 'otago', 'lake wakatipu'] },

  { id: 'guided:moab', name: 'Moab', region: 'Utah, United States', group: 'Desert', lat: 38.5733, lng: -109.5498, searchQuery: 'Moab Utah', terms: ['moab utah', 'moab', 'arches national park', 'canyonlands'] },
  { id: 'guided:grand-canyon', name: 'Grand Canyon', region: 'Arizona, United States', group: 'Desert', lat: 36.0544, lng: -112.1401, searchQuery: 'Grand Canyon National Park', terms: ['grand canyon national park', 'grand canyon', 'south rim', 'north rim'] },
  { id: 'guided:sedona', name: 'Sedona', region: 'Arizona, United States', group: 'Desert', lat: 34.8697, lng: -111.761, searchQuery: 'Sedona Arizona', terms: ['sedona arizona', 'sedona', 'red rock country'] },
  { id: 'guided:zion-national-park', name: 'Zion National Park', region: 'Utah, United States', group: 'Desert', lat: 37.2982, lng: -113.0263, searchQuery: 'Zion National Park', terms: ['zion national park', 'zion', 'springdale utah'] },
  { id: 'guided:wadi-rum', name: 'Wadi Rum', region: 'Aqaba Governorate, Jordan', group: 'Desert', lat: 29.5764, lng: 35.4195, searchQuery: 'Wadi Rum Jordan', terms: ['wadi rum jordan', 'wadi rum', 'valley of the moon'] },
  { id: 'guided:atacama-desert', name: 'Atacama Desert', region: 'Antofagasta Region, Chile', group: 'Desert', lat: -22.9087, lng: -68.1997, searchQuery: 'San Pedro de Atacama', terms: ['san pedro de atacama', 'atacama', 'atacama desert'] },
  { id: 'guided:namib-desert', name: 'Namib Desert', region: 'Namibia', group: 'Desert', lat: -24.7286, lng: 15.3414, searchQuery: 'Namib Desert Namibia', terms: ['namib desert namibia', 'sossusvlei', 'namib-naukluft', 'swakopmund desert'] },

  { id: 'guided:costa-rica', name: 'Costa Rica', region: 'Costa Rica', group: 'Water', lat: 10.2736, lng: -84.0739, searchQuery: 'Costa Rica nature adventure', terms: ['costa rica nature adventure', 'costa rica', 'arenal', 'monteverde', 'manuel antonio'] },
  { id: 'guided:iceland-south-coast', name: 'Iceland South Coast', region: 'Southern Region, Iceland', group: 'Water', lat: 63.5321, lng: -19.5114, searchQuery: 'Iceland South Coast', terms: ['iceland south coast', 'south iceland', 'vik', 'jokulsarlon'] },
  { id: 'guided:norwegian-fjords', name: 'Norwegian Fjords', region: 'Western Norway', group: 'Water', lat: 61.098, lng: 6.7487, searchQuery: 'Norway fjords', terms: ['norway fjords', 'norwegian fjords', 'geirangerfjord', 'sognefjord'] },
  { id: 'guided:great-barrier-reef', name: 'Great Barrier Reef', region: 'Queensland, Australia', group: 'Water', lat: -16.9203, lng: 145.771, searchQuery: 'Great Barrier Reef', terms: ['great barrier reef', 'cairns reef', 'port douglas reef', 'whitsundays'] },
  { id: 'guided:hawaii-big-island', name: 'Hawaii Island', region: 'Hawaii, United States', group: 'Water', lat: 19.5429, lng: -155.6659, searchQuery: 'Big Island Hawaii', terms: ['big island hawaii', 'hawaii island', 'big island', 'kona', 'hilo'] },
  { id: 'guided:lake-district', name: 'Lake District', region: 'England, United Kingdom', group: 'Water', lat: 54.4609, lng: -3.0886, searchQuery: 'Lake District England', terms: ['lake district england', 'the lakes', 'cumbria', 'windermere'] },

  { id: 'guided:yellowstone-national-park', name: 'Yellowstone National Park', region: 'Wyoming, Montana, and Idaho', group: 'Worldwide', lat: 44.5964, lng: -110.5472, searchQuery: 'Yellowstone National Park', terms: ['yellowstone national park', 'yellowstone', 'old faithful'] },
  { id: 'guided:machu-picchu-cusco', name: 'Cusco and Machu Picchu', region: 'Cusco Region, Peru', group: 'Worldwide', lat: -13.1631, lng: -72.545, searchQuery: 'Machu Picchu Cusco', terms: ['machu picchu cusco', 'machu picchu', 'cusco', 'sacred valley'] },
  { id: 'guided:cape-town', name: 'Cape Town', region: 'Western Cape, South Africa', group: 'Worldwide', lat: -33.9628, lng: 18.4098, searchQuery: 'Cape Town South Africa', terms: ['cape town south africa', 'cape town', 'table mountain', 'cape peninsula'] },
  { id: 'guided:scottish-highlands', name: 'Scottish Highlands', region: 'Scotland, United Kingdom', group: 'Worldwide', lat: 57.1201, lng: -4.7108, searchQuery: 'Scottish Highlands', terms: ['scottish highlands', 'highlands scotland', 'isle of skye', 'glencoe'] },
  { id: 'guided:tasmania', name: 'Tasmania', region: 'Australia', group: 'Worldwide', lat: -42.0409, lng: 146.8087, searchQuery: 'Tasmania nature adventure', terms: ['tasmania nature adventure', 'tasmania', 'cradle mountain', 'freycinet'] },
];

type Props = {
  destinations?: GuidedDestination[];
  onSelect: (destination: GuidedDestination) => void;
};

const GROUPS: GuidedDestination['group'][] = ['Mountain', 'Desert', 'Water', 'Worldwide'];

export function GuidedDestinationBrowser({ destinations = GUIDED_DESTINATIONS, onSelect }: Props) {
  const C = useTheme();
  return (
    <View style={styles.shell}>
      <View style={styles.intro}>
        <Text style={[styles.title, { color: C.text }]}>Popular guided destinations</Text>
        <Text style={[styles.subtitle, { color: C.text2 }]}>Choose an area to check current tours and availability.</Text>
      </View>
      {GROUPS.map(group => {
        const groupDestinations = destinations.filter(destination => destination.group === group);
        return (
          <View key={group} style={styles.group}>
            <View style={styles.groupHeader}>
              <Text style={[styles.groupTitle, { color: C.text }]}>{group}</Text>
              <Text style={[styles.groupCount, { color: C.text3 }]}>{groupDestinations.length} destinations</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
              {groupDestinations.map(destination => (
                <View
                  key={destination.id}
                  style={[styles.card, { borderColor: C.border, backgroundColor: C.s1 }]}
                >
                  <TouchableOpacity
                    activeOpacity={0.88}
                    onPress={() => onSelect(destination)}
                    accessibilityRole="button"
                    accessibilityLabel={`Browse guided trips near ${destination.name}`}
                  >
                    <View style={styles.cardMedia}>
                      <StaticMapboxPreview
                        pins={[{ id: destination.id, title: destination.name, lat: destination.lat, lng: destination.lng, active: true }]}
                        title={destination.name}
                        imageUrl={destination.imageUrl}
                        imageAlt={destination.imageAlt}
                        showBadge={false}
                        showCopy={false}
                        height={142}
                      />
                      <View style={styles.cardCopyBackdrop} pointerEvents="none" />
                      <View style={styles.cardCopy} pointerEvents="none">
                        <Text
                          style={styles.cardTitle}
                          numberOfLines={2}
                          adjustsFontSizeToFit
                          minimumFontScale={0.72}
                          maxFontSizeMultiplier={1.4}
                        >
                          {destination.name}
                        </Text>
                        <Text
                          style={styles.cardRegion}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.8}
                          maxFontSizeMultiplier={1.35}
                        >
                          {destination.region}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.cardAction}>
                      <Text style={[styles.cardActionText, { color: C.text2 }]}>Browse trips</Text>
                      <Ionicons name="arrow-forward" size={16} color={C.orange} />
                    </View>
                  </TouchableOpacity>
                  {!!destination.imageCredit && !!destination.imageSourceUrl ? (
                    <TouchableOpacity
                      style={[styles.creditRow, { borderTopColor: C.border }]}
                      onPress={() => Linking.openURL(destination.imageSourceUrl!).catch(() => {})}
                      accessibilityRole="link"
                      accessibilityLabel={`Photo by ${destination.imageCredit}, ${destination.imageLicense || 'source details'}`}
                    >
                      <Ionicons name="camera-outline" size={11} color={C.text3} />
                      <Text style={[styles.creditText, { color: C.text3 }]} numberOfLines={1}>
                        Photo: {destination.imageCredit}{destination.imageLicense ? ` | ${destination.imageLicense}` : ''}
                      </Text>
                      <Ionicons name="open-outline" size={10} color={C.text3} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))}
            </ScrollView>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { gap: 24, paddingBottom: 8 },
  intro: { paddingHorizontal: 20, gap: 5 },
  title: { fontSize: 22, lineHeight: 27, fontWeight: '900', letterSpacing: 0 },
  subtitle: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  group: { gap: 10 },
  groupHeader: { paddingHorizontal: 20, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  groupTitle: { fontSize: 17, lineHeight: 22, fontWeight: '900' },
  groupCount: { fontSize: 11, lineHeight: 15, fontWeight: '700' },
  rail: { gap: 12, paddingHorizontal: 20, paddingRight: 32 },
  card: { width: 224, borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  cardMedia: { height: 142, position: 'relative' },
  cardCopyBackdrop: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 98, backgroundColor: 'rgba(3,7,18,0.58)' },
  cardCopy: { position: 'absolute', left: 14, right: 14, bottom: 12, gap: 3 },
  cardTitle: { color: '#fff', fontSize: 21, lineHeight: 23, fontWeight: '900', letterSpacing: 0 },
  cardRegion: { color: 'rgba(255,255,255,0.84)', fontSize: 11, lineHeight: 15, fontWeight: '800' },
  cardAction: { minHeight: 42, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardActionText: { fontSize: 12, lineHeight: 16, fontWeight: '800' },
  creditRow: { minHeight: 28, borderTopWidth: 1, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5 },
  creditText: { flex: 1, fontSize: 9, lineHeight: 12, fontWeight: '700' },
});
