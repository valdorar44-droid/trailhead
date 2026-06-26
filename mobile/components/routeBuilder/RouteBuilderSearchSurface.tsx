import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import TourTarget from '@/components/TourTarget';
import { mono, useTheme, type ColorPalette } from '@/lib/design';
import type { RouteBuilderSearchPlace, RouteBuilderStopType } from '@/lib/routeBuilder';
import RouteBuilderInsertNotice from './RouteBuilderInsertNotice';

const DEFAULT_STOP_TYPES: RouteBuilderStopType[] = ['start', 'fuel', 'waypoint', 'camp', 'motel'];

type RouteBuilderSearchSurfaceProps = {
  pendingType: RouteBuilderStopType;
  query: string;
  searching: boolean;
  results: RouteBuilderSearchPlace[];
  selectedStopName?: string | null;
  targetDay?: number | null;
  fallbackDay?: number | null;
  stopTypes?: RouteBuilderStopType[];
  resultMetaLabel?: string;
  stopIcon: (type: RouteBuilderStopType) => keyof typeof Ionicons.glyphMap;
  stopColor: (type: RouteBuilderStopType) => string;
  onSelectType: (type: RouteBuilderStopType) => void;
  onChangeQuery: (query: string) => void;
  onSubmitSearch: () => void;
  onSelectResult: (place: RouteBuilderSearchPlace) => void;
  onClearInsert: () => void;
};

function normalizeMetaToken(value?: string | null) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function searchResultLabel(place: RouteBuilderSearchPlace, fallback: string) {
  const tokens = [
    normalizeMetaToken(place.feature_type),
    normalizeMetaToken(place.category),
    normalizeMetaToken(place.type),
    normalizeMetaToken(place.subtype),
    ...(place.place_types ?? []).map(normalizeMetaToken),
  ].filter(Boolean);
  const source = normalizeMetaToken(place.source);
  const hay = `${tokens.join(' ')} ${normalizeMetaToken(place.source_label)} ${normalizeMetaToken(place.address)}`;
  if (/\b(fuel|gas|diesel|propane|charging_station)\b/.test(hay)) return 'Fuel';
  if (/\b(camp|campground|campsite|rv_site|recreation_site)\b/.test(hay)) return 'Camp';
  if (/\b(trail|trailhead|hiking)\b/.test(hay)) return 'Trailhead';
  if (/\b(address|street|postcode|house|poi_address)\b/.test(hay)) return 'Address';
  if (/\b(place|locality|city|town|village|hamlet|municipality|settlement|neighborhood|suburb)\b/.test(hay)) return 'Town';
  if (source === 'trailhead_explore') return 'Explorer pick';
  return fallback;
}

export default function RouteBuilderSearchSurface({
  pendingType,
  query,
  searching,
  results,
  selectedStopName,
  targetDay,
  fallbackDay,
  stopTypes = DEFAULT_STOP_TYPES,
  resultMetaLabel = 'Map result',
  stopIcon,
  stopColor,
  onSelectType,
  onChangeQuery,
  onSubmitSearch,
  onSelectResult,
  onClearInsert,
}: RouteBuilderSearchSurfaceProps) {
  const C = useTheme();
  const s = styles(C);

  return (
    <>
      <View style={s.typeRow}>
        {stopTypes.map(type => {
          const active = pendingType === type;
          const color = stopColor(type);
          return (
            <TouchableOpacity
              key={type}
              style={[s.typeChip, active && { borderColor: color, backgroundColor: color + '18' }]}
              onPress={() => onSelectType(type)}
              activeOpacity={0.84}
            >
              <Ionicons name={stopIcon(type)} size={13} color={active ? color : C.text3} />
              <Text style={[s.typeChipText, active && { color }]}>{type.toUpperCase()}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <RouteBuilderInsertNotice
        selectedStopName={selectedStopName}
        targetDay={targetDay}
        fallbackDay={fallbackDay}
        onClearInsert={onClearInsert}
      />

      <TourTarget id="routeBuilder.search">
        <View style={s.searchBox}>
          <Ionicons name="search" size={17} color={C.text3} />
          <TextInput
            value={query}
            onChangeText={onChangeQuery}
            onSubmitEditing={onSubmitSearch}
            placeholder="Search city, address, trailhead, or map point"
            placeholderTextColor={C.text3}
            style={s.searchInput}
            returnKeyType="search"
          />
          <TouchableOpacity style={s.searchBtn} onPress={onSubmitSearch} disabled={searching} activeOpacity={0.84}>
            {searching ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.searchBtnText}>ADD</Text>}
          </TouchableOpacity>
        </View>
      </TourTarget>

      {results.length > 0 ? (
        <View style={s.resultsBox}>
          {results.map(place => (
            <TouchableOpacity
              key={`${place.name}_${place.lat}_${place.lng}`}
              style={s.resultRow}
              onPress={() => onSelectResult(place)}
              activeOpacity={0.86}
            >
              <Ionicons name={stopIcon(pendingType)} size={15} color={stopColor(pendingType)} />
              <View style={s.resultBody}>
                <Text style={s.resultName} numberOfLines={1}>{place.name}</Text>
                <Text style={s.resultMeta}>{searchResultLabel(place, resultMetaLabel)}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </>
  );
}

const styles = (C: ColorPalette) => StyleSheet.create({
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 7,
    backgroundColor: C.s2,
  },
  typeChipText: {
    color: C.text3,
    fontSize: 9,
    fontFamily: mono,
    fontWeight: '800',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    backgroundColor: C.s2,
    paddingLeft: 12,
  },
  searchInput: {
    flex: 1,
    color: C.text,
    fontSize: 13,
    paddingVertical: 11,
  },
  searchBtn: {
    alignSelf: 'stretch',
    minWidth: 56,
    backgroundColor: C.orange,
    borderTopRightRadius: 11,
    borderBottomRightRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBtnText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: mono,
    fontWeight: '900',
  },
  resultsBox: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 11,
    borderBottomWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
  },
  resultBody: {
    flex: 1,
    minWidth: 0,
  },
  resultName: {
    color: C.text,
    fontSize: 13,
    fontWeight: '700',
  },
  resultMeta: {
    color: C.text3,
    fontSize: 10,
    fontFamily: mono,
    marginTop: 2,
  },
});
