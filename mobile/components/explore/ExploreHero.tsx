import React from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { EXPLORE_CATEGORY_CHIPS, type ExploreCategoryKey, type ExploreMode } from './exploreDisplay';

const DEFAULT_HERO_IMAGE = require('@/assets/explore-hero-welcome-mountains.jpg');
const HERO_CATEGORY_KEYS: ExploreCategoryKey[] = [
  'all',
  'guided',
  'parks',
  'camp',
  'trails',
  'things',
  'views',
  'waterfalls',
  'peaks',
  'trailheads',
  'water',
  'fuel',
  'resupply',
  'huts',
  'glamping',
  'nearby',
];

type HeroWeather = {
  loading: boolean;
  unavailable?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  temp: string;
  detail: string;
  unitMode: 'auto' | 'imperial' | 'metric';
  onUnitChange: (mode: 'imperial' | 'metric') => void;
};

type Props = {
  greeting: string;
  displayName: string;
  height: number;
  topInset?: number;
  query: string;
  selectedCategory: ExploreCategoryKey;
  mode: ExploreMode;
  weather: HeroWeather;
  hideSearch?: boolean;
  onQueryChange: (value: string) => void;
  onClearQuery: () => void;
  onCategorySelect: (key: ExploreCategoryKey) => void;
};

export function ExploreHero({
  greeting,
  displayName,
  height,
  topInset = 0,
  query,
  selectedCategory,
  mode,
  weather,
  hideSearch = false,
  onQueryChange,
  onClearQuery,
  onCategorySelect,
}: Props) {
  return (
    <View style={[styles.shell, { height }]}>
      <Image source={DEFAULT_HERO_IMAGE} style={styles.image} resizeMode="cover" />
      <View style={styles.overlay} />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(3,7,18,0.46)', 'rgba(3,7,18,0.16)', 'rgba(3,7,18,0)']}
        locations={[0, 0.58, 1]}
        style={[styles.statusShade, { height: Math.max(104, topInset + 76) }]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(3,7,18,0)', 'rgba(3,7,18,0.62)']}
        locations={[0, 1]}
        style={styles.bottomShade}
      />
      <View style={styles.content}>
        <Text style={styles.greeting}>{displayName ? `${greeting}, ${displayName}` : greeting}</Text>
        <Text style={styles.title}>Find your next adventure</Text>
        {!hideSearch ? (
          <View style={styles.searchRow}>
            <View style={styles.search}>
              <Ionicons name="search-outline" size={22} color="rgba(255,255,255,0.9)" />
              <TextInput
                value={query}
                onChangeText={onQueryChange}
                placeholder="Search camps, trails, fuel"
                placeholderTextColor="rgba(255,255,255,0.72)"
                style={styles.input}
                returnKeyType="search"
              />
              {query ? (
                <TouchableOpacity onPress={onClearQuery} style={styles.iconButton} hitSlop={8}>
                  <Ionicons name="close" size={16} color="rgba(255,255,255,0.86)" />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ) : null}
        {weather.loading || !weather.unavailable ? (
          <View style={styles.weather}>
            <View style={styles.weatherLeft}>
              {weather.loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name={weather.icon} size={22} color="rgba(255,255,255,0.92)" />
              )}
              <View style={styles.weatherTextWrap}>
                <Text style={styles.weatherTemp} numberOfLines={1}>
                  {weather.loading ? 'Checking weather' : weather.temp}
                </Text>
                <Text style={styles.weatherDetail} numberOfLines={1}>
                  {weather.loading ? 'Current area' : weather.detail}
                </Text>
              </View>
            </View>
            <View style={styles.unitToggle}>
              {(['imperial', 'metric'] as const).map(unit => {
                const label = unit === 'imperial' ? 'F' : 'C';
                const active = weather.unitMode === unit || (weather.unitMode === 'auto' && unit === 'imperial');
                return (
                  <TouchableOpacity
                    key={unit}
                    style={[styles.unitOption, active && styles.unitOptionActive]}
                    onPress={() => weather.onUnitChange(unit)}
                    activeOpacity={0.82}
                  >
                    <Text style={[styles.unitText, active && styles.unitTextActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : null}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoryScroller}
          contentContainerStyle={styles.categoryRail}
        >
          {HERO_CATEGORY_KEYS.map(key => {
            const source = EXPLORE_CATEGORY_CHIPS.find(item => item.key === key);
            if (!source) return null;
            const active = key === 'nearby'
              ? mode === 'nearby'
              : key === 'all'
                ? selectedCategory === 'all' && mode !== 'nearby'
                : selectedCategory === key && mode !== 'nearby';
            const label = heroCategoryLabel(key, source.label);
            const icon = heroCategoryIcon(key, source.icon);
            return (
              <TouchableOpacity
                key={key}
                style={[styles.categoryItem, { width: heroCategoryWidth(key) }]}
                onPress={() => onCategorySelect(key)}
                activeOpacity={0.84}
              >
                <View style={[styles.categoryIcon, active && styles.categoryIconActive]}>
                  <Ionicons name={icon as any} size={24} color="#fff" />
                </View>
                <Text style={styles.categoryLabel} numberOfLines={1}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

function heroCategoryLabel(key: ExploreCategoryKey, fallback: string) {
  if (key === 'parks') return 'National Parks';
  if (key === 'camp') return 'Camps';
  if (key === 'huts') return 'Cabins';
  if (key === 'peaks') return 'Mountains';
  if (key === 'things') return 'Things';
  if (key === 'resupply') return 'Supplies';
  if (key === 'nearby') return 'Nearby';
  return fallback;
}

function heroCategoryIcon(key: ExploreCategoryKey, fallback: string) {
  if (key === 'huts') return 'home-outline';
  if (key === 'peaks') return 'triangle-outline';
  return fallback;
}

function heroCategoryWidth(key: ExploreCategoryKey) {
  if (key === 'parks') return 96;
  if (key === 'waterfalls' || key === 'trailheads' || key === 'glamping' || key === 'peaks') return 84;
  if (key === 'resupply' || key === 'guided') return 74;
  if (key === 'things' || key === 'nearby') return 70;
  return 64;
}

const styles = StyleSheet.create({
  shell: {
    overflow: 'hidden',
    backgroundColor: '#0f172a',
  },
  image: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(3,7,18,0.12)' },
  statusShade: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottomShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '58%' },
  content: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 10,
  },
  greeting: {
    color: '#fff',
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.32)',
    textShadowRadius: 10,
  },
  title: {
    color: '#fff',
    fontSize: 37,
    lineHeight: 41,
    fontWeight: '900',
    letterSpacing: 0,
    maxWidth: 430,
    textShadowColor: 'rgba(0,0,0,0.28)',
    textShadowRadius: 12,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  search: {
    flex: 1,
    minHeight: 56,
    borderRadius: 22,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(15,23,42,0.30)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.34)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
  },
  input: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '800', paddingVertical: 0 },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  weather: {
    minHeight: 48,
    borderRadius: 18,
    paddingLeft: 14,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: 'rgba(15,23,42,0.38)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  weatherLeft: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  weatherTextWrap: { flex: 1, minWidth: 0 },
  weatherTemp: { color: '#fff', fontSize: 14, lineHeight: 17, fontWeight: '900' },
  weatherDetail: { color: 'rgba(255,255,255,0.72)', fontSize: 11, lineHeight: 15, fontWeight: '800', marginTop: 1 },
  unitToggle: {
    minHeight: 34,
    borderRadius: 999,
    padding: 3,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  unitOption: {
    width: 31,
    height: 28,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitOptionActive: { backgroundColor: '#fff' },
  unitText: { color: 'rgba(255,255,255,0.74)', fontSize: 12, fontWeight: '900' },
  unitTextActive: { color: '#0f172a' },
  categoryScroller: { flexGrow: 0, flexShrink: 0, height: 82 },
  categoryRail: { gap: 10, paddingTop: 5, paddingRight: 30 },
  categoryItem: { alignItems: 'center', gap: 7 },
  categoryIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.34)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  categoryIconActive: {
    backgroundColor: 'rgba(15,23,42,0.74)',
    borderColor: 'rgba(255,255,255,0.56)',
  },
  categoryLabel: {
    color: '#fff',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.38)',
    textShadowRadius: 8,
  },
});
