import React from 'react';
import { Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/design';

type Props = {
  greeting: string;
  displayName: string;
  heroImage?: string;
  height: number;
  query: string;
  onQueryChange: (value: string) => void;
  onClearQuery: () => void;
};

export function ExploreHero({ greeting, displayName, heroImage, height, query, onQueryChange, onClearQuery }: Props) {
  const C = useTheme();
  return (
    <View style={[styles.shell, { height }]}>
      {heroImage ? (
        <Image source={{ uri: heroImage }} style={styles.image} resizeMode="cover" />
      ) : (
        <View style={[styles.fallback, { backgroundColor: C.s3 }]}>
          <Ionicons name="compass-outline" size={44} color="#fff" />
        </View>
      )}
      <View style={styles.overlay} />
      <View style={styles.content}>
        <Text style={styles.greeting}>{greeting}, {displayName}</Text>
        <Text style={styles.title}>Find your next adventure</Text>
        <View style={styles.searchRow}>
          <View style={styles.search}>
            <Ionicons name="search-outline" size={22} color="rgba(15,23,42,0.58)" />
            <TextInput
              value={query}
              onChangeText={onQueryChange}
              placeholder="Search camps, huts, trails, peaks, fuel, more"
              placeholderTextColor="rgba(15,23,42,0.5)"
              style={styles.input}
              returnKeyType="search"
            />
            {query ? (
              <TouchableOpacity onPress={onClearQuery} style={styles.iconButton} hitSlop={8}>
                <Ionicons name="close" size={16} color="rgba(15,23,42,0.62)" />
              </TouchableOpacity>
            ) : (
              <View style={styles.iconButton}>
                <Ionicons name="options-outline" size={18} color="rgba(15,23,42,0.62)" />
              </View>
            )}
          </View>
          <View style={styles.viewToggle}>
            <View style={styles.toggleIconActive}>
              <Ionicons name="map-outline" size={23} color="#64748b" />
            </View>
            <Ionicons name="list-outline" size={24} color="#64748b" />
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
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(3,7,18,0.28)' },
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
    backgroundColor: 'rgba(255,255,255,0.94)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
  },
  input: { flex: 1, color: '#111827', fontSize: 15, fontWeight: '700', paddingVertical: 0 },
  iconButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  viewToggle: {
    height: 58,
    minWidth: 90,
    borderRadius: 22,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  toggleIconActive: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 9,
  },
});
