import React, { useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { mono, useTheme, type ColorPalette } from '@/lib/design';

export type MapSearchResultItem = {
  name: string;
  lat: number;
  lng: number;
  source?: string;
  source_label?: string;
  type?: string;
  subtype?: string;
  address?: string;
  summary?: string;
  dist?: number | null;
  distance_mi?: number | null;
  rating?: number;
  rating_count?: number;
};

export type MapSearchQuickAction = {
  label: string;
  query: string;
  icon: keyof typeof Ionicons.glyphMap;
};

type Props = {
  visible: boolean;
  query: string;
  results: MapSearchResultItem[];
  searching: boolean;
  hasLocation: boolean;
  recent: Array<{ name: string; lat?: number; lng?: number; source_label?: string }>;
  quickActions: MapSearchQuickAction[];
  onQueryChange: (query: string) => void;
  onSubmit: (query?: string) => void;
  onSelect: (place: MapSearchResultItem) => void;
  onRoute: (place: MapSearchResultItem) => void;
  onQuickAction: (action: MapSearchQuickAction) => void;
  onClose: () => void;
  onClear: () => void;
};

export default function MapSearchSheet({
  visible,
  query,
  results,
  searching,
  hasLocation,
  recent,
  quickActions,
  onQueryChange,
  onSubmit,
  onSelect,
  onRoute,
  onQuickAction,
  onClose,
  onClear,
}: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput | null>(null);
  const cleanQuery = query.trim();
  const hasError = results.some(result => result.name === '__error__');
  const usableResults = results.filter(result => result.name !== '__error__');

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => inputRef.current?.focus(), Platform.OS === 'android' ? 180 : 90);
    return () => clearTimeout(t);
  }, [visible]);

  function close() {
    Keyboard.dismiss();
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView style={s.modal}>
        <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.header}>
            <TouchableOpacity style={s.iconBtn} onPress={close} hitSlop={8}>
              <Ionicons name="chevron-back" size={22} color={C.text} />
            </TouchableOpacity>
            <View style={s.searchBox}>
              <Ionicons name="search-outline" size={18} color={C.text3} />
              <TextInput
                ref={inputRef}
                value={query}
                onChangeText={onQueryChange}
                placeholder="Search camps, trails, fuel"
                placeholderTextColor={C.text3}
                style={s.input}
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="none"
                onSubmitEditing={() => onSubmit()}
              />
              {searching ? (
                <ActivityIndicator size="small" color={C.orange} />
              ) : cleanQuery ? (
                <TouchableOpacity onPress={onClear} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={C.text3} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[s.content, { paddingBottom: Math.max(insets.bottom + 22, 34) }]}
          >
            <View style={s.quickHeader}>
              <Text style={s.sectionTitle}>Search nearby</Text>
              <Text style={s.sectionSub}>{hasLocation ? 'Use your current area or type a place.' : 'Type a city, park, camp, trail, or service.'}</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.quickRail}>
              {quickActions.map(action => (
                <TouchableOpacity key={action.label} style={s.quickChip} onPress={() => onQuickAction(action)} activeOpacity={0.84}>
                  <Ionicons name={action.icon} size={15} color={C.orange} />
                  <Text style={s.quickText}>{action.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {cleanQuery.length >= 2 || searching || hasError || usableResults.length > 0 ? (
              <View style={s.resultsBlock}>
                <View style={s.resultsHeader}>
                  <Text style={s.sectionTitle}>{searching ? 'Searching' : 'Results'}</Text>
                  {!searching && usableResults.length ? <Text style={s.count}>{usableResults.length}</Text> : null}
                </View>
                {searching ? (
                  <View style={s.stateCard}>
                    <ActivityIndicator size="small" color={C.orange} />
                    <Text style={s.stateText}>Looking nearby</Text>
                  </View>
                ) : hasError ? (
                  <View style={s.stateCard}>
                    <Ionicons name="cloud-offline-outline" size={18} color={C.text3} />
                    <Text style={s.stateText}>Search is not available right now.</Text>
                  </View>
                ) : usableResults.length === 0 ? (
                  <View style={s.stateCard}>
                    <Ionicons name="search-outline" size={18} color={C.text3} />
                    <Text style={s.stateText}>No places found. Try a nearby town, park, or service.</Text>
                  </View>
                ) : (
                  usableResults.slice(0, 18).map((place, idx) => (
                    <ResultRow
                      key={`${place.name}:${place.lat}:${place.lng}:${idx}`}
                      place={place}
                      colors={C}
                      styles={s}
                      onPress={() => onSelect(place)}
                      onRoute={() => onRoute(place)}
                    />
                  ))
                )}
              </View>
            ) : (
              <View style={s.resultsBlock}>
                <Text style={s.sectionTitle}>Recent</Text>
                {recent.length ? (
                  recent.slice(0, 6).map((item, idx) => (
                    <TouchableOpacity
                      key={`${item.name}-${idx}`}
                      style={s.recentRow}
                      onPress={() => {
                        onQueryChange(item.name);
                        onSubmit(item.name);
                      }}
                      activeOpacity={0.84}
                    >
                      <View style={s.resultIcon}>
                        <Ionicons name="time-outline" size={15} color={C.text2} />
                      </View>
                      <View style={s.resultCopy}>
                        <Text style={s.resultName} numberOfLines={1}>{item.name}</Text>
                        <Text style={s.resultMeta} numberOfLines={1}>{item.source_label || 'Recent search'}</Text>
                      </View>
                    </TouchableOpacity>
                  ))
                ) : (
                  <View style={s.stateCard}>
                    <Ionicons name="map-outline" size={18} color={C.text3} />
                    <Text style={s.stateText}>Search for a camp, trail, town, fuel, water, or place to start.</Text>
                  </View>
                )}
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function ResultRow({
  place,
  colors,
  styles,
  onPress,
  onRoute,
}: {
  place: MapSearchResultItem;
  colors: ColorPalette;
  styles: ReturnType<typeof makeStyles>;
  onPress: () => void;
  onRoute: () => void;
}) {
  const dist = typeof place.distance_mi === 'number'
    ? place.distance_mi
    : typeof place.dist === 'number'
      ? place.dist * 0.621371
      : null;
  const source = [
    place.source_label || cleanLabel(place.type || place.source || 'Place'),
    dist != null ? `${dist >= 10 ? dist.toFixed(0) : dist.toFixed(1)} mi` : '',
    place.rating != null ? `${Number(place.rating).toFixed(1)} rating` : '',
  ].filter(Boolean).join(' · ');
  const detail = searchResultDetail(place);
  return (
    <TouchableOpacity style={styles.resultRow} onPress={onPress} activeOpacity={0.86}>
      <View style={styles.resultIcon}>
        <Ionicons name={iconForPlace(place)} size={16} color={colors.orange} />
      </View>
      <View style={styles.resultCopy}>
        <Text style={styles.resultName} numberOfLines={1}>{place.name}</Text>
        <Text style={styles.resultMeta} numberOfLines={1}>{source}</Text>
        {!!detail && (
          <Text style={styles.resultDetail} numberOfLines={1}>{detail}</Text>
        )}
      </View>
      <TouchableOpacity style={styles.routeBtn} onPress={onRoute} hitSlop={8}>
        <Ionicons name="navigate-outline" size={16} color={colors.orange} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function cleanLabel(value?: string) {
  return String(value || 'Place').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function searchResultDetail(place: MapSearchResultItem) {
  const raw = place.address || place.summary || cleanLabel(place.subtype);
  if (!raw) return '';
  const clean = raw
    .replace(/\bUse live map results\.?\s*/gi, '')
    .replace(/\bLive map results\.?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';
  const firstSentence = clean.match(/^[^.!?]+[.!?]/)?.[0] || clean;
  return firstSentence.length > 118 ? `${firstSentence.slice(0, 115).trim()}...` : firstSentence;
}

function iconForPlace(place: MapSearchResultItem): keyof typeof Ionicons.glyphMap {
  const haystack = `${place.type || ''} ${place.subtype || ''} ${place.source || ''} ${place.name || ''}`.toLowerCase();
  if (haystack.includes('camp')) return 'bonfire-outline';
  if (haystack.includes('fuel') || haystack.includes('gas')) return 'car-sport-outline';
  if (haystack.includes('water')) return 'water-outline';
  if (haystack.includes('trail')) return 'trail-sign-outline';
  if (haystack.includes('grocery') || haystack.includes('market')) return 'cart-outline';
  if (haystack.includes('hotel') || haystack.includes('lodging')) return 'bed-outline';
  return 'location-outline';
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  flex: { flex: 1 },
  modal: { flex: 1, backgroundColor: C.bg },
  header: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.s2,
  },
  searchBox: {
    flex: 1,
    minHeight: 44,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 12,
  },
  input: { flex: 1, color: C.text, fontSize: 15, fontWeight: '800', paddingVertical: 0 },
  content: { padding: 16, gap: 18 },
  quickHeader: { gap: 4 },
  sectionTitle: { color: C.text, fontSize: 16, fontWeight: '900' },
  sectionSub: { color: C.text3, fontSize: 12, lineHeight: 17 },
  quickRail: { gap: 8, paddingRight: 8 },
  quickChip: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.orange + '45',
    backgroundColor: C.orange + '10',
    paddingHorizontal: 12,
  },
  quickText: { color: C.text2, fontSize: 12, fontWeight: '800' },
  resultsBlock: { gap: 10 },
  resultsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { color: C.text3, fontSize: 11, fontFamily: mono, fontWeight: '900' },
  stateCard: {
    minHeight: 74,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
  },
  stateText: { flex: 1, color: C.text2, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  resultRow: {
    minHeight: 78,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  recentRow: {
    minHeight: 62,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  resultIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.orange + '45',
    backgroundColor: C.orange + '10',
  },
  resultCopy: { flex: 1, minWidth: 0, gap: 3 },
  resultName: { color: C.text, fontSize: 14, lineHeight: 18, fontWeight: '900' },
  resultMeta: { color: C.text2, fontSize: 11, lineHeight: 15, fontWeight: '700' },
  resultDetail: { color: C.text3, fontSize: 10.5, lineHeight: 14 },
  routeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.s2,
    borderWidth: 1,
    borderColor: C.border,
  },
});
