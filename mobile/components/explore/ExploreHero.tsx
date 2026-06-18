import React from 'react';
import { Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

const DEFAULT_HERO_IMAGE = require('@/assets/explore-hero-welcome-mountains.jpg');

type Props = {
  greeting: string;
  displayName: string;
  height: number;
  topInset?: number;
  query: string;
  onQueryChange: (value: string) => void;
  onClearQuery: () => void;
};

export function ExploreHero({ greeting, displayName, height, topInset = 0, query, onQueryChange, onClearQuery }: Props) {
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
        <Text style={styles.greeting}>{greeting}, {displayName}</Text>
        <Text style={styles.title}>Find your next adventure</Text>
        <View style={styles.searchRow}>
          <View style={styles.search}>
            <Ionicons name="search-outline" size={22} color="rgba(255,255,255,0.86)" />
            <TextInput
              value={query}
              onChangeText={onQueryChange}
              placeholder="Search camps, trails, fuel"
              placeholderTextColor="rgba(255,255,255,0.68)"
              style={styles.input}
              returnKeyType="search"
            />
            {query ? (
              <TouchableOpacity onPress={onClearQuery} style={styles.iconButton} hitSlop={8}>
                <Ionicons name="close" size={16} color="rgba(255,255,255,0.82)" />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
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
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingBottom: 34,
    gap: 12,
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
    fontSize: 39,
    lineHeight: 43,
    fontWeight: '900',
    letterSpacing: 0,
    maxWidth: 430,
    textShadowColor: 'rgba(0,0,0,0.28)',
    textShadowRadius: 12,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  search: {
    flex: 1,
    minHeight: 58,
    borderRadius: 22,
    paddingHorizontal: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(15,23,42,0.36)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.32)',
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
});
