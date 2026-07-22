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

import { useTheme, type ColorPalette } from '@/lib/design';
import { cleanExploreSourceLabel } from '@/lib/exploreContextFilters';
import { trailheadFonts } from '@/lib/typography';

export type MapSearchResultItem = {
  name: string;
  lat?: number;
  lng?: number;
  result_id?: string;
  resolution_required?: boolean;
  resolving?: boolean;
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
  id?: string;
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
      <SafeAreaView style={s.modal} edges={['top', 'left', 'right']} testID="map.search.sheet">
        <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.header}>
            <TouchableOpacity
              style={s.iconBtn}
              onPress={close}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close search"
              testID="map.search.close"
            >
              <Ionicons name="chevron-back" size={22} color={C.text} />
            </TouchableOpacity>
            <Text style={s.title}>Search</Text>
            <TouchableOpacity
              style={s.cancelButton}
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel="Cancel search"
              testID="map.search.cancel"
            >
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <View style={s.searchBox} testID="map.search.field">
              <Ionicons name="search-outline" size={18} color={C.text3} />
              <TextInput
                ref={inputRef}
                testID="map.search.input"
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
                <TouchableOpacity
                  style={s.clearButton}
                  onPress={onClear}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  testID="map.search.clear"
                >
                  <Ionicons name="close-circle" size={18} color={C.text3} />
                </TouchableOpacity>
              ) : null}
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[s.content, { paddingBottom: Math.max(insets.bottom + 22, 34) }]}
          >
            {!cleanQuery ? (
              <>
                <View style={s.quickHeader}>
                  <Text style={s.sectionTitle}>{hasLocation ? 'SEARCH NEARBY' : 'QUICK SEARCH'}</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.quickRail}>
                  {quickActions.map(action => (
                    <TouchableOpacity
                      key={action.id || action.label}
                      style={s.quickChip}
                      onPress={() => onQuickAction(action)}
                      activeOpacity={0.84}
                      accessibilityRole="button"
                      accessibilityLabel={action.label}
                      testID={`map.search.quick.${action.id || action.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                    >
                      <Ionicons name={action.icon} size={16} color={C.orange} />
                      <Text style={s.quickText}>{action.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            ) : null}

            {cleanQuery.length >= 2 || searching || hasError || usableResults.length > 0 ? (
              <View style={s.resultsBlock}>
                <View style={s.resultsHeader}>
                  <Text style={s.sectionTitle}>{cleanQuery ? 'SUGGESTIONS' : 'RESULTS'}</Text>
                  {usableResults.length ? <Text style={s.count}>{usableResults.length}</Text> : null}
                </View>
                {searching && usableResults.length === 0 ? (
                  <View style={s.stateCard} testID="map.search.loading">
                    <ActivityIndicator size="small" color={C.orange} />
                    <Text style={s.stateText}>Looking nearby</Text>
                  </View>
                ) : hasError ? (
                  <View style={s.stateCard} testID="map.search.error">
                    <Ionicons name="cloud-offline-outline" size={18} color={C.text3} />
                    <Text style={s.stateText}>Search is not available right now.</Text>
                  </View>
                ) : usableResults.length === 0 ? (
                  <View style={s.stateCard} testID="map.search.empty">
                    <Ionicons name="search-outline" size={18} color={C.text3} />
                    <Text style={s.stateText}>Try a nearby town, park, or service.</Text>
                  </View>
                ) : (
                  usableResults.slice(0, 18).map((place, idx) => (
                    <ResultRow
                      key={place.result_id || `${place.name}:${place.lat ?? 'pending'}:${place.lng ?? 'pending'}:${idx}`}
                      place={place}
                      testID={`map.search.result.${place.result_id || `${place.name}:${place.lat ?? 'pending'}:${place.lng ?? 'pending'}`}`}
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
                      testID={`map.search.recent.${idx}`}
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
                        <Text style={s.resultName}>{item.name}</Text>
                        <Text style={s.resultMeta}>{cleanSearchSourceLabel(item.source_label, 'Recent')}</Text>
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
  testID,
  colors,
  styles,
  onPress,
  onRoute,
}: {
  place: MapSearchResultItem;
  testID: string;
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
    cleanSearchSourceLabel(place.source_label || place.source, cleanLabel(place.subtype || place.type || 'Place')),
    dist != null ? `${dist >= 10 ? dist.toFixed(0) : dist.toFixed(1)} mi` : '',
    place.rating != null ? `${Number(place.rating).toFixed(1)} rating` : '',
  ].filter(Boolean).join(' · ');
  const detail = searchResultDetail(place);
  return (
    <TouchableOpacity
      style={styles.resultRow}
      onPress={onPress}
      activeOpacity={0.86}
      accessibilityRole="button"
      accessibilityLabel={[place.name, source, detail].filter(Boolean).join(', ')}
      testID={testID}
    >
      <View style={styles.resultIcon}>
        <Ionicons name={iconForPlace(place)} size={16} color={colors.orange} />
      </View>
      <View style={styles.resultCopy}>
        <Text style={styles.resultName}>{place.name}</Text>
        <Text style={styles.resultMeta}>{source}</Text>
        {!!detail && (
          <Text style={styles.resultDetail}>{detail}</Text>
        )}
      </View>
      <TouchableOpacity
        style={styles.routeBtn}
        onPress={onRoute}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Route to ${place.name}`}
        testID={`${testID}.route`}
      >
        {place.resolving ? (
          <ActivityIndicator size="small" color={colors.orange} />
        ) : (
          <Ionicons name="navigate-outline" size={16} color={colors.orange} />
        )}
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function cleanLabel(value?: string) {
  return String(value || 'Place').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function cleanSearchSourceLabel(value?: string | null, fallback = 'Place') {
  return cleanExploreSourceLabel(value, fallback || 'Place');
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
  return firstSentence.length > 118 ? firstSentence.slice(0, 115).replace(/\s+\S*$/, '').trim() : firstSentence;
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
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  iconBtn: {
    width: Platform.OS === 'android' ? 48 : 44,
    height: Platform.OS === 'android' ? 48 : 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    color: C.text,
    fontFamily: trailheadFonts.displayBold,
    fontSize: 28,
    lineHeight: 32,
  },
  cancelButton: {
    minWidth: 62,
    minHeight: Platform.OS === 'android' ? 48 : 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  cancelText: { color: C.orange, fontSize: 14, lineHeight: 18, fontWeight: '700' },
  searchBox: {
    minHeight: 48,
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: C.orange,
    backgroundColor: C.s1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingLeft: 13,
  },
  input: { flex: 1, minHeight: 48, color: C.text, fontSize: 15, lineHeight: 20, fontWeight: '600', paddingVertical: 0 },
  clearButton: {
    width: Platform.OS === 'android' ? 48 : 44,
    height: Platform.OS === 'android' ? 48 : 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { padding: 16, gap: 16 },
  quickHeader: { gap: 4 },
  sectionTitle: { color: C.text2, fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.2 },
  quickRail: { gap: 8, paddingRight: 8 },
  quickChip: {
    minHeight: Platform.OS === 'android' ? 48 : 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    paddingHorizontal: 12,
  },
  quickText: { color: C.text, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  resultsBlock: { gap: 10 },
  resultsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { color: C.text3, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  stateCard: {
    minHeight: 72,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
  },
  stateText: { flex: 1, color: C.text2, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  resultRow: {
    minHeight: 72,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  recentRow: {
    minHeight: 64,
    borderRadius: 12,
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
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.s2,
  },
  resultCopy: { flex: 1, minWidth: 0, gap: 3 },
  resultName: { color: C.text, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  resultMeta: { color: C.text2, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  resultDetail: { color: C.text3, fontSize: 12, lineHeight: 17 },
  routeBtn: {
    width: Platform.OS === 'android' ? 48 : 44,
    height: Platform.OS === 'android' ? 48 : 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.s2,
    borderWidth: 1,
    borderColor: C.border,
  },
});
