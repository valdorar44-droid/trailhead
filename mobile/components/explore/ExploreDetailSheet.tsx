import React, { useEffect, useMemo, useState } from 'react';
import { Image, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, type ImageResizeMode, type ImageStyle, type StyleProp, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ExplorePlaceProfile, ExploreSourcePackItem, ExploreTrailCard } from '@/lib/api';
import { mono, useTheme } from '@/lib/design';
import { ExploreTrailArea } from './ExploreTrailArea';
import { StaticMapboxPreview, type StaticMapboxPin } from './StaticMapboxPreview';
import {
  getExploreCategoryColor,
  getExploreCardSummary,
  getExploreDisplayCategory,
  getExploreDisplayRegion,
  getExploreDisplayTitle,
  getExploreIcon,
  getExploreSourceRows,
  getExploreTrustBadge,
  normalizeExploreCopyBlock,
  type ExploreNearbyModule,
  type ExploreDisplayContext,
} from './exploreDisplay';

export type ExploreDetailTab = 'summary' | 'story' | 'nearby';
type ExploreDetailModuleKey =
  | 'see'
  | 'do'
  | 'stay'
  | 'visitor'
  | 'trails'
  | 'amenities'
  | 'fees'
  | 'alerts'
  | 'calendar'
  | 'weather'
  | 'map'
  | 'story'
  | 'nearby';

type ExploreDetailModule = {
  key: ExploreDetailModuleKey;
  label: string;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: string;
  count?: number;
  imageUrl?: string;
  imageCandidates?: string[];
  searchText: string;
};

export type ExploreDetailWeather = {
  loading?: boolean;
  unavailable?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  temp: string;
  detail: string;
};

type Props = {
  place: ExplorePlaceProfile;
  tab: ExploreDetailTab;
  onTabChange: (tab: ExploreDetailTab) => void;
  imageUrl: string;
  topInset: number;
  saved?: boolean;
  isPlaying?: boolean;
  context?: ExploreDisplayContext;
  storySentences: string[];
  highlightedSentence: number;
  storyScrollRef: React.RefObject<ScrollView | null>;
  campgroundsSlot?: React.ReactNode;
  experiencesSlot?: React.ReactNode;
  relatedSlot?: React.ReactNode;
  weatherSlot?: React.ReactNode;
  weather?: ExploreDetailWeather | null;
  trailStatusSlot?: React.ReactNode;
  onClose: () => void;
  onPlayAudio: () => void;
  onShowArea: () => void;
  onRoute: () => void;
  onToggleSave: () => void;
  onNearbyAction?: (module: ExploreNearbyModule) => void;
  onSourcePackItem?: (item: ExploreSourcePackItem) => void;
  onTrailMap?: (trail: ExploreTrailCard) => void;
  onTrailRoute?: (trail: ExploreTrailCard) => void;
  mediaUrl: (url?: string | null) => string;
};

function ResilientImage({
  uris,
  style,
  resizeMode = 'cover',
}: {
  uris: string[];
  style: StyleProp<ImageStyle>;
  resizeMode?: ImageResizeMode;
}) {
  const cleanUris = useMemo(() => {
    const seen = new Set<string>();
    return uris.map(uri => String(uri || '').trim()).filter(uri => {
      if (!uri || seen.has(uri)) return false;
      seen.add(uri);
      return true;
    });
  }, [uris]);
  const resetKey = cleanUris.join('|');
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [resetKey]);

  const uri = cleanUris[index];
  if (!uri) return null;
  return (
    <Image
      key={uri}
      source={{ uri }}
      style={style}
      resizeMode={resizeMode}
      onError={() => setIndex(current => current < cleanUris.length - 1 ? current + 1 : cleanUris.length)}
    />
  );
}

function sizedNpsMediaUrl(url?: string | null, width = 900) {
  const clean = String(url || '').trim();
  if (!clean) return '';
  if (!/^https:\/\/www\.nps\.gov\/common\/uploads\//i.test(clean)) return clean;
  if (/[?&](width|maxwidth)=/i.test(clean)) return clean;
  return `${clean}${clean.includes('?') ? '&' : '?'}width=${width}&quality=85&mode=crop`;
}

function ExpandableText({
  value,
  textStyle,
}: {
  value?: string | null;
  textStyle: StyleProp<TextStyle>;
  previewChars?: number;
}) {
  const clean = normalizeExploreCopyBlock(value);
  if (!clean) return null;
  return <Text style={textStyle}>{clean}</Text>;
}

export function ExploreDetailSheet({
  place,
  tab,
  onTabChange,
  imageUrl,
  topInset,
  saved,
  isPlaying,
  context,
  storySentences,
  highlightedSentence,
  storyScrollRef,
  campgroundsSlot,
  experiencesSlot,
  relatedSlot,
  weatherSlot,
  weather,
  trailStatusSlot,
  onClose,
  onPlayAudio,
  onShowArea,
  onRoute,
  onToggleSave,
  onNearbyAction,
  onSourcePackItem,
  onTrailMap,
  onTrailRoute,
  mediaUrl,
}: Props) {
  const C = useTheme();
  const accent = getExploreCategoryColor(place);
  const pack = place.source_pack;
  const sourceUrl = place.source_pack?.booking_url || place.source_pack?.official_url || place.summary.source_url;
  const [activeModule, setActiveModule] = useState<ExploreDetailModuleKey | null>(null);
  const [selectedItem, setSelectedItem] = useState<ExploreSourcePackItem | null>(null);
  const [placeSearch, setPlaceSearch] = useState('');
  const searchNeedle = placeSearch.trim().toLowerCase();

  useEffect(() => {
    setPlaceSearch('');
    setSelectedItem(null);
    if (tab === 'story') {
      setActiveModule('story');
    } else if (tab === 'nearby') {
      setActiveModule('nearby');
    } else {
      setActiveModule(null);
    }
  }, [place.id, tab]);

  const mediaCandidates = (...groups: Array<Array<string | null | undefined> | string | null | undefined>) => {
    const urls: string[] = [];
    const seen = new Set<string>();
    for (const group of groups) {
      const rawList = Array.isArray(group) ? group : [group];
      for (const raw of rawList) {
        const normalized = mediaUrl(raw).trim();
        if (!normalized) continue;
        const sized = sizedNpsMediaUrl(normalized);
        for (const url of [sized, normalized]) {
          if (!url || seen.has(url)) continue;
          seen.add(url);
          urls.push(url);
        }
      }
    }
    return urls;
  };

  const searchTextForItems = (items?: ExploreSourcePackItem[]) => (items ?? [])
    .map(item => [item.title, item.description, item.kind, item.source_label, item.source].filter(Boolean).join(' '))
    .join(' ');

  const detailModules = useMemo<ExploreDetailModule[]>(() => {
    const modules: ExploreDetailModule[] = [];
    const usedTileImages = new Set<string>();
    const add = (module: ExploreDetailModule | null | false | undefined) => {
      if (module) modules.push(module);
    };
    const count = (items?: ExploreSourcePackItem[]) => Array.isArray(items) ? items.length : 0;
    const packPhotoCandidates = mediaCandidates((pack?.photos ?? []).map(photo => photo.url));
    const imageKey = (url: string) => url.replace(/\?.*$/, '');
    const tileImages = (items?: ExploreSourcePackItem[], extra: Array<string | null | undefined> = []) => {
      const candidates = mediaCandidates((items ?? []).map(item => item.image_url), extra, packPhotoCandidates, imageUrl);
      const primary = candidates.find(url => !usedTileImages.has(imageKey(url))) || candidates[0] || '';
      if (primary) usedTileImages.add(imageKey(primary));
      return { imageUrl: primary, imageCandidates: primary ? [primary, ...candidates.filter(url => url !== primary)] : candidates };
    };
    const activityCount = (pack?.activities?.length ?? 0) + (place.amenities?.length ?? 0);
    const hasCoords = place.summary.lat != null && place.summary.lng != null;
    const seeImages = tileImages(pack?.things_to_see);
    const doImages = tileImages(pack?.things_to_do);
    const stayImages = tileImages(pack?.campgrounds);
    const visitorImages = tileImages(pack?.visitor_centers);
    const trailImages = tileImages([], (place.trails ?? []).map(trail => trail.image_url));
    const eventImages = tileImages(pack?.events);

    add({
      key: 'see',
      label: 'What to See',
      detail: count(pack?.things_to_see) ? `${count(pack?.things_to_see)} places` : 'Highlights',
      icon: 'camera-outline',
      tone: '#0f766e',
      count: count(pack?.things_to_see) || undefined,
      imageUrl: seeImages.imageUrl,
      imageCandidates: seeImages.imageCandidates,
      searchText: `${searchTextForItems(pack?.things_to_see)} ${place.profile?.why_it_matters ?? ''} ${place.wiki_extract ?? ''}`,
    });

    add(Boolean(count(pack?.things_to_do) || activityCount > 0 || experiencesSlot) && {
      key: 'do',
      label: 'Things to Do',
      detail: count(pack?.things_to_do) ? `${count(pack?.things_to_do)} options` : 'Activities',
      icon: 'walk-outline',
      tone: '#f97316',
      count: count(pack?.things_to_do) || activityCount || undefined,
      imageUrl: doImages.imageUrl,
      imageCandidates: doImages.imageCandidates,
      searchText: `${searchTextForItems(pack?.things_to_do)} ${(pack?.activities ?? []).join(' ')} ${(place.amenities ?? []).join(' ')}`,
    });

    add(Boolean(count(pack?.campgrounds) || campgroundsSlot) && {
      key: 'stay',
      label: 'Where to Stay',
      detail: count(pack?.campgrounds) ? `${count(pack?.campgrounds)} stays` : 'Camp nearby',
      icon: 'bonfire-outline',
      tone: '#16a34a',
      count: count(pack?.campgrounds) || undefined,
      imageUrl: stayImages.imageUrl,
      imageCandidates: stayImages.imageCandidates,
      searchText: `${searchTextForItems(pack?.campgrounds)} camp campground lodge cabin rv overnight`,
    });

    add(Boolean(count(pack?.visitor_centers) || pack?.nps_park_code) && {
      key: 'visitor',
      label: 'Visitor Centers',
      detail: count(pack?.visitor_centers) ? `${count(pack?.visitor_centers)} centers` : 'Park info',
      icon: 'information-circle-outline',
      tone: '#2563eb',
      count: count(pack?.visitor_centers) || undefined,
      imageUrl: visitorImages.imageUrl,
      imageCandidates: visitorImages.imageCandidates,
      searchText: `${searchTextForItems(pack?.visitor_centers)} visitor center ranger station park info`,
    });

    add(((place.trails?.length ?? 0) > 0 || (place.linked_trail_ids?.length ?? 0) > 0 || /trail|trek|peak|waterfall|glacier/i.test(`${place.category ?? ''} ${(place.subcategories ?? []).join(' ')}`)) && {
      key: 'trails',
      label: 'Trails',
      detail: place.trails?.length ? `${place.trails.length} trail cards` : 'Trail cards',
      icon: 'trail-sign-outline',
      tone: '#ca8a04',
      count: place.trails?.length || undefined,
      imageUrl: trailImages.imageUrl,
      imageCandidates: trailImages.imageCandidates,
      searchText: `${(place.trails ?? []).map(trail => `${trail.title} ${trail.summary} ${trail.description ?? ''}`).join(' ')} trail trek route hike glacier`,
    });

    add(activityCount > 0 && {
      key: 'amenities',
      label: 'Amenities',
      detail: `${activityCount} listed`,
      icon: 'grid-outline',
      tone: '#7c3aed',
      count: activityCount,
      searchText: `${(pack?.activities ?? []).join(' ')} ${(place.amenities ?? []).join(' ')}`,
    });

    add(((pack?.fees?.length ?? 0) > 0 || !!pack?.operating_hours) && {
      key: 'fees',
      label: 'Fees & Hours',
      detail: pack?.fees?.length ? `${pack.fees.length} notes` : 'Hours',
      icon: 'card-outline',
      tone: '#64748b',
      count: pack?.fees?.length || undefined,
      searchText: `${pack?.operating_hours ?? ''} ${(pack?.fees ?? []).join(' ')}`,
    });

    add((pack?.alerts?.length ?? 0) > 0 && {
      key: 'alerts',
      label: 'Alerts',
      detail: `${pack?.alerts?.length ?? 0} current`,
      icon: 'warning-outline',
      tone: '#dc2626',
      count: pack?.alerts?.length,
      searchText: `${(pack?.alerts ?? []).map(alert => `${alert.title} ${alert.category}`).join(' ')}`,
    });

    add((pack?.events?.length ?? 0) > 0 && {
      key: 'calendar',
      label: 'Calendar',
      detail: `${pack?.events?.length ?? 0} events`,
      icon: 'calendar-outline',
      tone: '#22c55e',
      count: pack?.events?.length,
      imageUrl: eventImages.imageUrl,
      imageCandidates: eventImages.imageCandidates,
      searchText: `${searchTextForItems(pack?.events)} ranger program event calendar schedule`,
    });

    add(hasCoords && {
      key: 'weather',
      label: 'Weather',
      detail: weather?.loading ? 'Loading forecast' : weather?.detail || 'Forecast',
      icon: weather?.icon || 'partly-sunny-outline',
      tone: '#0ea5e9',
      searchText: 'weather forecast temperature wind precipitation conditions',
    });

    add({
      key: 'map',
      label: 'Map & Directions',
      detail: 'Preview',
      icon: 'map-outline',
      tone: '#0f766e',
      searchText: 'map route directions area navigation campgrounds visitor centers stops',
    });

    add(storySentences.length > 0 && {
      key: 'story',
      label: 'Story',
      detail: 'Read aloud',
      icon: 'book-outline',
      tone: '#9333ea',
      searchText: storySentences.join(' '),
    });

    add(Boolean(relatedSlot || context?.relatedCount) && {
      key: 'nearby',
      label: 'Nearby',
      detail: context?.relatedCount ? `${context.relatedCount} close by` : 'Close by',
      icon: 'locate-outline',
      tone: '#a855f7',
      count: context?.relatedCount,
      searchText: 'nearby close by similar places camp parks trails stops',
    });

    return modules;
  }, [
    campgroundsSlot,
    context?.relatedCount,
    experiencesSlot,
    imageUrl,
    mediaUrl,
    pack,
    place.amenities,
    place.category,
    place.linked_trail_ids,
    place.profile?.why_it_matters,
    place.source_pack,
    place.subcategories,
    place.summary.lat,
    place.summary.lng,
    place.trails,
    place.wiki_extract,
    relatedSlot,
    storySentences,
    weather?.detail,
    weather?.icon,
    weather?.loading,
  ]);

  const visibleModules = detailModules.filter(module => {
    if (!searchNeedle) return true;
    return `${module.label} ${module.detail} ${module.searchText}`.toLowerCase().includes(searchNeedle);
  });
  const activeModuleDef = detailModules.find(module => module.key === activeModule) ?? null;
  const heroWeather = weather ?? (place.summary.lat != null && place.summary.lng != null
    ? { icon: 'partly-sunny-outline' as const, temp: 'Weather', detail: 'Forecast' }
    : null);
  const placeHeroCandidates = mediaCandidates(imageUrl, (pack?.photos ?? []).map(photo => photo.url), place.summary.image_url, place.summary.thumbnail_url);

  const filteredItems = (items?: ExploreSourcePackItem[]) => {
    const list = items ?? [];
    if (!searchNeedle) return list;
    return list.filter(item => `${item.title ?? ''} ${item.description ?? ''} ${item.kind ?? ''} ${item.source_label ?? ''}`.toLowerCase().includes(searchNeedle));
  };

  const itemHasCoords = (item?: ExploreSourcePackItem | null) => {
    const lat = Number(item?.lat);
    const lng = Number(item?.lng);
    return Number.isFinite(lat) && Number.isFinite(lng);
  };

  const mapRadiusMi = exploreMapRadiusMi(place);
  const parentLat = Number(place.summary.lat);
  const parentLng = Number(place.summary.lng);
  const hasParentCoords = Number.isFinite(parentLat) && Number.isFinite(parentLng);
  const itemDistanceFromParent = (item?: ExploreSourcePackItem | null) => {
    if (!itemHasCoords(item) || !hasParentCoords) return null;
    return haversineMiles(parentLat, parentLng, Number(item?.lat), Number(item?.lng));
  };
  const itemCanRenderOnMap = (item?: ExploreSourcePackItem | null, active = false) => {
    if (!itemHasCoords(item)) return false;
    if (active) return true;
    if (item?.map_hidden) return false;
    const explicitDistance = Number(item?.distance_mi);
    if (Number.isFinite(explicitDistance) && explicitDistance > mapRadiusMi) return false;
    const measuredDistance = itemDistanceFromParent(item);
    if (measuredDistance != null && measuredDistance > mapRadiusMi) return false;
    return true;
  };

  const moduleItems = (key: ExploreDetailModuleKey): ExploreSourcePackItem[] => {
    if (key === 'see') return filteredItems(pack?.things_to_see);
    if (key === 'do') return filteredItems(pack?.things_to_do);
    if (key === 'stay') return filteredItems(pack?.campgrounds);
    if (key === 'visitor') return filteredItems(pack?.visitor_centers);
    if (key === 'calendar') return filteredItems(pack?.events);
    if (key === 'map') {
      return [
        ...(pack?.things_to_see ?? []),
        ...(pack?.things_to_do ?? []),
        ...(pack?.campgrounds ?? []),
        ...(pack?.visitor_centers ?? []),
        ...(pack?.parking_lots ?? []),
      ].filter(item => itemCanRenderOnMap(item));
    }
    return [];
  };

  function openModule(key: ExploreDetailModuleKey) {
    setSelectedItem(null);
    setActiveModule(key);
    if (key === 'story') onTabChange('story');
    if (key === 'nearby') onTabChange('nearby');
    if (key === 'weather') {
      onNearbyAction?.({ label: 'Weather', detail: 'Forecast', icon: 'partly-sunny-outline', tone: '#0ea5e9', action: 'weather' });
    }
    if (key === 'trails') {
      onNearbyAction?.({ label: 'Trails', detail: 'Trail cards', icon: 'trail-sign-outline', tone: '#ca8a04', action: 'trails' });
    }
  }

  function openSourceItem(item: ExploreSourcePackItem) {
    setSelectedItem(item);
  }

  function renderAction(label: string, icon: keyof typeof Ionicons.glyphMap, onPress: () => void, highlighted = false) {
    return (
      <TouchableOpacity
        key={label}
        style={[styles.detailAction, { borderColor: highlighted ? accent + '66' : C.border, backgroundColor: highlighted ? accent + '16' : C.s1 }]}
        activeOpacity={0.86}
        onPress={onPress}
      >
        <Ionicons name={icon} size={18} color={highlighted ? accent : C.text2} />
        <Text style={[styles.detailActionText, { color: highlighted ? accent : C.text }]}>{label}</Text>
      </TouchableOpacity>
    );
  }

  function renderItemList(items: ExploreSourcePackItem[], emptyText: string) {
    if (items.length === 0) {
      return (
        <View style={[styles.emptyModule, { borderColor: C.border, backgroundColor: C.s1 }]}>
          <Ionicons name="leaf-outline" size={22} color={C.text3} />
          <Text style={[styles.emptyModuleText, { color: C.text2 }]}>{emptyText}</Text>
        </View>
      );
    }
    const moduleFallbackImages = activeModuleDef?.imageCandidates ?? [];
    return (
      <View style={styles.itemList}>
        {items.map((item, idx) => {
          const itemImages = item.image_url ? mediaCandidates(item.image_url, moduleFallbackImages, imageUrl) : [];
          const canOpen = !!item.title || !!item.url || itemHasCoords(item);
          return (
            <TouchableOpacity
              key={`${item.title}-${idx}`}
              style={[styles.detailItem, { borderColor: C.border, backgroundColor: C.s1 }]}
              activeOpacity={0.88}
              disabled={!canOpen}
              onPress={() => openSourceItem(item)}
            >
              {itemImages.length > 0 && <ResilientImage uris={itemImages} style={styles.detailItemImage} />}
              <View style={styles.detailItemBody}>
                <Text style={[styles.detailItemTitle, { color: C.text }]} numberOfLines={2}>{item.title || 'Place'}</Text>
                {!!item.description && (
                  <Text style={[styles.detailItemCopy, { color: C.text2 }]}>{normalizeExploreCopyBlock(item.description)}</Text>
                )}
                <View style={styles.detailItemMeta}>
                  {!!item.source_label && <Text style={[styles.detailItemMetaText, { color: C.text3 }]} numberOfLines={1}>{item.source_label}</Text>}
                  {item.lat != null && item.lng != null && <Ionicons name="map-outline" size={15} color={accent} />}
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  }

  function renderActivityGrid() {
    const activities = [...(pack?.activities ?? []), ...(place.amenities ?? [])]
      .map(item => String(item).trim())
      .filter(Boolean);
    const unique = Array.from(new Set(activities));
    const filtered = searchNeedle ? unique.filter(item => item.toLowerCase().includes(searchNeedle)) : unique;
    if (filtered.length === 0) return null;
    return (
      <View style={styles.activityGrid}>
        {filtered.slice(0, 18).map(activity => (
          <View key={activity} style={[styles.activityPill, { borderColor: C.border, backgroundColor: C.s1 }]}>
            <Ionicons name="checkmark-circle-outline" size={16} color={accent} />
            <Text style={[styles.activityText, { color: C.text }]} numberOfLines={2}>{activity}</Text>
          </View>
        ))}
      </View>
    );
  }

  function renderMapPreview({
    items,
    activeItem,
    title,
    subtitle,
    onPress,
    height = 260,
  }: {
    items: ExploreSourcePackItem[];
    activeItem?: ExploreSourcePackItem | null;
    title: string;
    subtitle?: string;
    onPress?: () => void;
    height?: number;
  }) {
    const childPins: StaticMapboxPin[] = items
      .filter(item => itemCanRenderOnMap(item))
      .map((item, idx) => ({
        id: String(item.source_id || item.title || idx),
        title: item.title || 'Place',
        lat: Number(item.lat),
        lng: Number(item.lng),
        kind: item.kind || 'place',
        active: activeItem ? item === activeItem || item.source_id === activeItem.source_id : false,
      }));
    const pins: StaticMapboxPin[] = [
      ...(Number.isFinite(Number(place.summary.lat)) && Number.isFinite(Number(place.summary.lng)) ? [{
        id: 'parent',
        title: getExploreDisplayTitle(place),
        lat: Number(place.summary.lat),
        lng: Number(place.summary.lng),
        kind: 'park',
        active: !activeItem,
      }] : []),
      ...childPins,
      ...(activeItem && itemCanRenderOnMap(activeItem, true) && !childPins.some(pin => pin.id === String(activeItem.source_id || activeItem.title)) ? [{
        id: 'active',
        title: activeItem.title || 'Place',
        lat: Number(activeItem.lat),
        lng: Number(activeItem.lng),
        kind: activeItem.kind || 'place',
        active: true,
      }] : []),
    ].filter(pin => Number.isFinite(pin.lat) && Number.isFinite(pin.lng));
    return (
      <StaticMapboxPreview
        pins={pins}
        title={title}
        subtitle={subtitle}
        height={height}
        onPress={onPress}
      />
    );
  }

  function renderModuleHero(module: ExploreDetailModule) {
    const items = moduleItems(module.key);
    const mappedCount = items.filter(item => itemCanRenderOnMap(item)).length;
    return (
      <View style={styles.moduleMapHero}>
        {renderMapPreview({
          items,
          title: module.label,
          subtitle: mappedCount ? `${mappedCount} mapped places` : getExploreDisplayTitle(place),
          onPress: onShowArea,
          height: 360,
        })}
        <TouchableOpacity style={[styles.roundButton, styles.backButton, { top: Math.max(topInset + 10, 22) }]} onPress={() => { setActiveModule(null); onTabChange('summary'); }}>
          <Ionicons name="arrow-back" size={25} color="#fff" />
        </TouchableOpacity>
        <View style={[styles.heroRight, { top: Math.max(topInset + 10, 22) }]}>
          <TouchableOpacity style={styles.roundButton} onPress={onShowArea}>
            <Ionicons name="map-outline" size={23} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  function openItemDirections(item: ExploreSourcePackItem) {
    const lat = Number(item.lat);
    const lng = Number(item.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      if (item.url) Linking.openURL(item.url);
      return;
    }
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`);
  }

  function showItemOnMap(item: ExploreSourcePackItem) {
    if (itemHasCoords(item) && onSourcePackItem) {
      onSourcePackItem(item);
      return;
    }
    if (item.url) Linking.openURL(item.url);
  }

  function formatEventDate(item: ExploreSourcePackItem) {
    const raw = item.date_start || item.date_end || '';
    if (!raw) return { month: 'DATE', day: '' };
    const date = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(date.getTime())) return { month: raw.slice(0, 3).toUpperCase(), day: raw.slice(-2) };
    return {
      month: date.toLocaleString(undefined, { month: 'short' }).toUpperCase(),
      day: String(date.getDate()).padStart(2, '0'),
    };
  }

  function formatEventTime(item: ExploreSourcePackItem) {
    if (item.time_start && item.time_end) return `${item.time_start} - ${item.time_end}`;
    if (item.time_start) return item.time_start;
    return item.location || item.category || 'Event';
  }

  function renderCalendarItems(items: ExploreSourcePackItem[]) {
    if (!items.length) return renderItemList([], 'No events saved yet.');
    return (
      <View style={styles.calendarList}>
        <View style={[styles.calendarPicker, { backgroundColor: C.s1, borderColor: C.border }]}>
          <Ionicons name="chevron-back" size={20} color={C.text2} />
          <Text style={[styles.calendarPickerText, { color: C.text }]}>{new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
          <Ionicons name="chevron-forward" size={20} color={C.text2} />
        </View>
        {items.map((item, idx) => {
          const date = formatEventDate(item);
          const chips = [item.category, ...(item.tags ?? [])].filter(Boolean).slice(0, 3);
          return (
            <TouchableOpacity
              key={`${item.source_id || item.title}-${idx}`}
              style={[styles.eventCard, { borderColor: C.border, backgroundColor: C.s1 }]}
              activeOpacity={0.88}
              onPress={() => openSourceItem(item)}
            >
              <View style={[styles.eventDateBlock, { backgroundColor: C.s2 }]}>
                <Text style={[styles.eventMonth, { color: C.text2 }]}>{date.month}</Text>
                <Text style={[styles.eventDay, { color: C.text }]}>{date.day}</Text>
              </View>
              <View style={styles.eventBody}>
                <Text style={[styles.detailItemTitle, { color: C.text }]} numberOfLines={2}>{item.title || 'Event'}</Text>
                <View style={styles.eventTimeRow}>
                  <Ionicons name="time-outline" size={15} color={accent} />
                  <Text style={[styles.detailItemCopy, { color: C.text2 }]} numberOfLines={1}>{formatEventTime(item)}</Text>
                </View>
                {!!chips.length && (
                  <View style={styles.eventChips}>
                    {chips.map(chip => (
                      <View key={chip} style={[styles.eventChip, { backgroundColor: C.s2 }]}>
                        <Text style={[styles.eventChipText, { color: C.text2 }]} numberOfLines={1}>{chip}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
              <Ionicons name="chevron-forward" size={22} color={C.text3} />
            </TouchableOpacity>
          );
        })}
      </View>
    );
  }

  function renderDetailFacts(item: ExploreSourcePackItem) {
    const rows = [
      item.address && { icon: 'location-outline' as const, label: 'Address', value: item.address },
      item.operating_hours && { icon: 'time-outline' as const, label: 'Hours', value: item.operating_hours },
      item.directions && { icon: 'navigate-outline' as const, label: 'Directions', value: item.directions },
      item.location && { icon: 'pin-outline' as const, label: 'Location', value: item.location },
      item.category && { icon: 'pricetag-outline' as const, label: 'Type', value: item.category },
    ].filter(Boolean) as Array<{ icon: keyof typeof Ionicons.glyphMap; label: string; value: string }>;
    if (!rows.length && !(item.amenities?.length)) return null;
    return (
      <View style={styles.childFactList}>
        {rows.map(row => (
          <View key={`${row.label}-${row.value}`} style={[styles.infoRowCard, { borderColor: C.border, backgroundColor: C.s1 }]}>
            <Ionicons name={row.icon} size={21} color={accent} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.copyTitle, { color: C.text }]}>{row.label}</Text>
              <Text style={[styles.copyBody, { color: C.text2 }]}>{row.value}</Text>
            </View>
          </View>
        ))}
        {!!item.amenities?.length && (
          <View style={styles.activityGrid}>
            {item.amenities.slice(0, 12).map(amenity => (
              <View key={amenity} style={[styles.activityPill, { borderColor: C.border, backgroundColor: C.s1 }]}>
                <Ionicons name="checkmark-circle-outline" size={16} color={accent} />
                <Text style={[styles.activityText, { color: C.text }]} numberOfLines={2}>{amenity}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  }

  function renderChildDetail(item: ExploreSourcePackItem) {
    const itemImages = item.image_url ? mediaCandidates(item.image_url, activeModuleDef?.imageCandidates ?? [], imageUrl) : [];
    const siblingItems = activeModule ? moduleItems(activeModule) : moduleItems('map');
    return (
      <>
        <View style={styles.childHero}>
          {itemImages.length > 0 ? (
            <ResilientImage uris={itemImages} style={styles.heroImage} />
          ) : renderMapPreview({ items: siblingItems, activeItem: item, title: item.title || 'Place', height: 340 })}
          {itemImages.length > 0 && <View style={styles.heroShade} />}
          <TouchableOpacity style={[styles.roundButton, styles.backButton, { top: Math.max(topInset + 10, 22) }]} onPress={() => setSelectedItem(null)}>
            <Ionicons name="arrow-back" size={25} color="#fff" />
          </TouchableOpacity>
          <View style={[styles.heroRight, { top: Math.max(topInset + 10, 22) }]}>
            <TouchableOpacity style={styles.roundButton} onPress={() => showItemOnMap(item)}>
              <Ionicons name="map-outline" size={23} color="#fff" />
            </TouchableOpacity>
            {!!item.url && (
              <TouchableOpacity style={styles.roundButton} onPress={() => Linking.openURL(item.url!)}>
                <Ionicons name="open-outline" size={23} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
          {itemImages.length > 0 && (
            <View style={styles.heroText}>
              <Text style={[styles.kicker, { color: '#bbf7d0' }]} numberOfLines={1}>{(item.kind || activeModuleDef?.label || 'Place').replace(/_/g, ' ').toUpperCase()}</Text>
              <Text style={styles.title} numberOfLines={3}>{item.title || 'Place'}</Text>
            </View>
          )}
        </View>
        <ScrollView contentContainerStyle={styles.childContent} showsVerticalScrollIndicator={false}>
          {itemImages.length === 0 && (
            <View style={[styles.copyPanel, { borderColor: C.border, backgroundColor: C.s1 }]}>
              <Text style={[styles.copyTitle, { color: C.text }]}>{item.title || 'Place'}</Text>
              {!!item.description && <ExpandableText value={item.description} textStyle={[styles.copyBody, { color: C.text2 }]} previewChars={420} />}
            </View>
          )}
          {!!item.description && itemImages.length > 0 && (
            <View style={[styles.copyPanel, { borderColor: C.border, backgroundColor: C.s1 }]}>
              <Text style={[styles.copyTitle, { color: C.text }]}>Details</Text>
              <ExpandableText value={item.description} textStyle={[styles.copyBody, { color: C.text2 }]} previewChars={420} />
            </View>
          )}
          {renderDetailFacts(item)}
          <View style={styles.childSection}>
            <Text style={[styles.blockHeading, { color: C.text, marginHorizontal: 0 }]}>Map & Directions</Text>
            {renderMapPreview({
              items: siblingItems,
              activeItem: item,
              title: item.title || 'Map',
              subtitle: itemHasCoords(item) ? 'Selected pin' : getExploreDisplayTitle(place),
              onPress: () => showItemOnMap(item),
              height: 230,
            })}
            <View style={styles.mapActions}>
              {renderAction('Show on Map', 'map-outline', () => showItemOnMap(item), true)}
              {renderAction('Directions', 'navigate-outline', () => openItemDirections(item))}
              {!!item.reservation_url && renderAction('Reserve', 'calendar-outline', () => Linking.openURL(item.reservation_url!))}
            </View>
          </View>
          {!!item.image_credit && (
            <Text style={[styles.imageCredit, { color: C.text3 }]}>{item.image_credit}</Text>
          )}
        </ScrollView>
      </>
    );
  }

  function renderModuleContent(key: ExploreDetailModuleKey) {
    if (key === 'see') {
      const seeItems = filteredItems(pack?.things_to_see);
      return (
        <>
          {seeItems.length > 0 ? renderItemList(seeItems, 'No saved highlights yet.') : null}
          {!!place.profile?.why_it_matters && (
            <View style={[styles.copyPanel, { borderColor: C.border, backgroundColor: C.s1 }]}>
              <Text style={[styles.copyTitle, { color: C.text }]}>Why Go</Text>
              <ExpandableText value={place.profile.why_it_matters} textStyle={[styles.copyBody, { color: C.text2 }]} previewChars={420} />
            </View>
          )}
          {seeItems.length === 0 && !place.profile?.why_it_matters ? renderItemList([], 'No saved highlights yet.') : null}
        </>
      );
    }
    if (key === 'do') {
      const doItems = filteredItems(pack?.things_to_do);
      const hasActivities = Boolean((pack?.activities?.length ?? 0) || (place.amenities?.length ?? 0));
      return (
        <>
          {doItems.length > 0 ? renderItemList(doItems, 'No saved activities yet.') : null}
          {renderActivityGrid()}
          {experiencesSlot}
          {doItems.length === 0 && !hasActivities && !experiencesSlot ? renderItemList([], 'No saved activities yet.') : null}
        </>
      );
    }
    if (key === 'stay') {
      const stayItems = filteredItems(pack?.campgrounds);
      return (
        <>
          {stayItems.length > 0 ? renderItemList(stayItems, 'No saved stays yet.') : null}
          {stayItems.length === 0 ? campgroundsSlot : null}
          {stayItems.length === 0 && !campgroundsSlot ? renderItemList([], 'No saved stays yet.') : null}
        </>
      );
    }
    if (key === 'visitor') {
      return (
        <>
          {renderItemList(filteredItems(pack?.visitor_centers), 'No visitor centers saved yet.')}
          {!!sourceUrl && renderAction('Official site', 'open-outline', () => Linking.openURL(sourceUrl))}
        </>
      );
    }
    if (key === 'trails') {
      return (
        <>
          {trailStatusSlot}
          <ExploreTrailArea place={place} mediaUrl={mediaUrl} onTrailMap={onTrailMap} onTrailRoute={onTrailRoute} />
        </>
      );
    }
    if (key === 'amenities') {
      return renderActivityGrid() ?? (
        <View style={[styles.emptyModule, { borderColor: C.border, backgroundColor: C.s1 }]}>
          <Text style={[styles.emptyModuleText, { color: C.text2 }]}>No amenities saved yet.</Text>
        </View>
      );
    }
    if (key === 'fees') {
      return (
        <View style={styles.itemList}>
          {!!pack?.operating_hours && (
            <View style={[styles.infoRowCard, { borderColor: C.border, backgroundColor: C.s1 }]}>
              <Ionicons name="time-outline" size={22} color={accent} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.copyTitle, { color: C.text }]}>Hours</Text>
                <Text style={[styles.copyBody, { color: C.text2 }]}>{pack.operating_hours}</Text>
              </View>
            </View>
          )}
          {(pack?.fees ?? []).map((fee, idx) => (
            <View key={`${fee}-${idx}`} style={[styles.infoRowCard, { borderColor: C.border, backgroundColor: C.s1 }]}>
              <Ionicons name="card-outline" size={22} color={accent} />
              <Text style={[styles.copyBody, { color: C.text2, flex: 1 }]}>{fee}</Text>
            </View>
          ))}
        </View>
      );
    }
    if (key === 'alerts') {
      const alerts = pack?.alerts ?? [];
      return (
        <View style={styles.itemList}>
          {alerts.map((alert, idx) => (
            <TouchableOpacity
              key={`${alert.title}-${idx}`}
              style={[styles.infoRowCard, { borderColor: C.border, backgroundColor: C.s1 }]}
              disabled={!alert.url}
              onPress={() => alert.url && Linking.openURL(alert.url)}
            >
              <Ionicons name="warning-outline" size={22} color="#dc2626" />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.copyTitle, { color: C.text }]}>{alert.title || 'Alert'}</Text>
                {!!alert.category && <Text style={[styles.copyBody, { color: C.text2 }]}>{alert.category}</Text>}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      );
    }
    if (key === 'calendar') {
      return renderCalendarItems(filteredItems(pack?.events));
    }
    if (key === 'weather') {
      return weatherSlot ?? (
        <View style={[styles.emptyModule, { borderColor: C.border, backgroundColor: C.s1 }]}>
          <Ionicons name="partly-sunny-outline" size={24} color={accent} />
          <Text style={[styles.emptyModuleText, { color: C.text2 }]}>Forecast unavailable.</Text>
        </View>
      );
    }
    if (key === 'map') {
      const mapItems = moduleItems('map');
      return (
        <View style={styles.itemList}>
          {renderMapPreview({
            items: mapItems,
            title: 'Map & Directions',
            subtitle: `${mapItems.length} mapped places`,
            onPress: onShowArea,
            height: 240,
          })}
          <View style={styles.mapActions}>
            {renderAction('Show Area', 'map-outline', onShowArea, true)}
            {renderAction('Route', 'navigate-outline', onRoute)}
            {renderAction(saved ? 'Saved' : 'Save', saved ? 'bookmark' : 'bookmark-outline', onToggleSave)}
          </View>
        </View>
      );
    }
    if (key === 'story') {
      return (
        <View style={[styles.panel, { borderColor: C.border, backgroundColor: C.s1 }]}>
          <ScrollView ref={storyScrollRef} style={styles.storyBox} nestedScrollEnabled showsVerticalScrollIndicator>
            {(storySentences.length ? storySentences : ['No story saved yet.']).map((sentence, idx) => (
              <Text
                key={`${idx}-${sentence.slice(0, 24)}`}
                style={[
                  styles.storySentence,
                  { color: C.text2 },
                  highlightedSentence === idx && { color: C.text, backgroundColor: C.orangeGlow },
                ]}
              >
                {sentence}{' '}
              </Text>
            ))}
          </ScrollView>
          {renderAction(isPlaying ? 'Stop Audio' : 'Play Audio', isPlaying ? 'stop' : 'play', onPlayAudio, true)}
        </View>
      );
    }
    return (
      <>
        {relatedSlot}
        {campgroundsSlot}
      </>
    );
  }

  function renderModuleHub() {
    const aboutCopy = normalizeExploreCopyBlock(
      place.profile?.story
      || place.wiki_extract
      || place.source_pack?.extract
      || place.profile?.summary
      || place.profile?.why_it_matters
      || getExploreCardSummary(place),
    );
    return (
      <View style={styles.moduleHub}>
        <View style={styles.moduleIntro}>
          <Text style={[styles.moduleIntroTitle, { color: C.text }]}>Explore this place</Text>
        </View>
        {!!aboutCopy && (
          <View style={[styles.copyPanel, { borderColor: C.border, backgroundColor: C.s1 }]}>
            <Text style={[styles.copyTitle, { color: C.text }]}>About</Text>
            <ExpandableText value={aboutCopy} textStyle={[styles.copyBody, { color: C.text2 }]} previewChars={520} />
          </View>
        )}
        <View style={styles.moduleGrid}>
          {visibleModules.map(module => {
            const imageCandidates = module.imageCandidates?.length ? module.imageCandidates : module.imageUrl ? [module.imageUrl] : [];
            const hasImage = imageCandidates.length > 0;
            return (
              <TouchableOpacity
                key={module.key}
                style={[styles.moduleTile, { borderColor: C.border, backgroundColor: C.s1 }, hasImage && styles.moduleImageTile]}
                activeOpacity={0.88}
                onPress={() => openModule(module.key)}
              >
                {hasImage ? (
                  <>
                    <ResilientImage uris={imageCandidates} style={styles.moduleTileImage} />
                    <View style={styles.moduleTileShade} />
                  </>
                ) : (
                  <View style={[styles.moduleIconBubble, { backgroundColor: module.tone + '18' }]}>
                    <Ionicons name={module.icon} size={26} color={module.tone} />
                  </View>
                )}
                <View style={hasImage ? styles.moduleTileOverlay : styles.moduleTileBody}>
                  <View style={styles.moduleTileTop}>
                    <Ionicons name={module.icon} size={18} color={hasImage ? '#fff' : module.tone} />
                    {!!module.count && <Text style={[styles.moduleCount, { color: hasImage ? '#fff' : C.text3 }]}>{module.count}</Text>}
                  </View>
                  <Text style={[styles.moduleTileTitle, { color: hasImage ? '#fff' : C.text }]} numberOfLines={2}>{module.label}</Text>
                  <Text style={[styles.moduleTileDetail, { color: hasImage ? 'rgba(255,255,255,0.82)' : C.text3 }]} numberOfLines={1}>{module.detail}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
        {visibleModules.length === 0 && (
          <View style={[styles.emptyModule, { borderColor: C.border, backgroundColor: C.s1 }]}>
            <Ionicons name="search-outline" size={22} color={C.text3} />
            <Text style={[styles.emptyModuleText, { color: C.text2 }]}>No matching section.</Text>
          </View>
        )}
        <SourceFreshnessPanel place={place} />
      </View>
    );
  }

  if (selectedItem) {
    return (
      <View style={[styles.screen, { backgroundColor: C.bg }]}>
        {renderChildDetail(selectedItem)}
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: C.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {activeModuleDef ? renderModuleHero(activeModuleDef) : (
        <View style={styles.hero}>
          {placeHeroCandidates.length > 0 ? (
            <ResilientImage uris={placeHeroCandidates} style={styles.heroImage} />
          ) : (
            <View style={[styles.heroFallback, { backgroundColor: C.s3 }]}>
              <Ionicons name={getExploreIcon(place) as any} size={52} color="#fff" />
            </View>
          )}
          <View style={styles.heroShade} />
          <TouchableOpacity style={[styles.roundButton, styles.backButton, { top: Math.max(topInset + 10, 22) }]} onPress={onClose}>
            <Ionicons name="arrow-back" size={25} color="#fff" />
          </TouchableOpacity>
          <View style={[styles.heroRight, { top: Math.max(topInset + 10, 22) }]}>
            <TouchableOpacity style={styles.roundButton} onPress={onToggleSave}>
              <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={24} color="#fff" />
            </TouchableOpacity>
            {!!sourceUrl && (
              <TouchableOpacity style={styles.roundButton} onPress={() => Linking.openURL(sourceUrl)}>
                <Ionicons name="share-outline" size={23} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.heroText}>
            <Text style={[styles.kicker, { color: '#fed7aa' }]} numberOfLines={1}>
              {getExploreDisplayCategory(place).toUpperCase()} · {place.summary.state || getExploreDisplayRegion(place)}
            </Text>
            <Text style={styles.title} numberOfLines={3}>{getExploreDisplayTitle(place)}</Text>
            <View style={styles.heroMetaRow}>
              <View style={styles.heroTrust}>
                <Ionicons name="star" size={16} color="#facc15" />
                <Text style={styles.heroTrustText} numberOfLines={1}>{getExploreTrustBadge(place)}</Text>
              </View>
              {!!heroWeather && (
                <TouchableOpacity style={styles.heroWeather} activeOpacity={0.86} onPress={() => openModule('weather')}>
                  <Ionicons name={heroWeather.icon} size={17} color="#fff" />
                  <Text style={styles.heroWeatherText} numberOfLines={1}>
                    {heroWeather.loading ? 'Loading' : heroWeather.unavailable ? 'Weather' : heroWeather.temp}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.placeSearch}>
              <Ionicons name="search-outline" size={18} color="rgba(255,255,255,0.78)" />
              <TextInput
                value={placeSearch}
                onChangeText={setPlaceSearch}
                placeholder="Search this place"
                placeholderTextColor="rgba(255,255,255,0.66)"
                style={styles.placeSearchInput}
                returnKeyType="search"
              />
            </View>
          </View>
        </View>
        )}

        {!activeModuleDef && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionRail}>
          {renderAction('Map', 'map-outline', onShowArea, true)}
          {renderAction('Route', 'navigate-outline', onRoute)}
          {renderAction('Weather', 'partly-sunny-outline', () => openModule('weather'))}
          {renderAction(isPlaying ? 'Stop' : 'Audio', isPlaying ? 'stop' : 'play', onPlayAudio)}
          {renderAction(saved ? 'Saved' : 'Save', saved ? 'bookmark' : 'bookmark-outline', onToggleSave)}
        </ScrollView>
        )}

        {activeModuleDef ? (
          <View style={styles.moduleDetailScreen}>
            <View style={styles.moduleDetailHeader}>
              <View style={[styles.moduleDetailIcon, { backgroundColor: activeModuleDef.tone + '18' }]}>
                <Ionicons name={activeModuleDef.icon} size={23} color={activeModuleDef.tone} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.moduleDetailTitle, { color: C.text }]}>{activeModuleDef.label}</Text>
                <Text style={[styles.moduleDetailSub, { color: C.text2 }]}>{activeModuleDef.detail}</Text>
              </View>
            </View>
            {renderModuleContent(activeModuleDef.key)}
          </View>
        ) : renderModuleHub()}

        {!!sourceUrl && (
          <TouchableOpacity style={[styles.sourceButton, { borderColor: C.border }]} onPress={() => Linking.openURL(sourceUrl)}>
            <Ionicons name="open-outline" size={16} color={C.text2} />
            <Text style={[styles.sourceButtonText, { color: C.text3 }]} numberOfLines={2}>{place.attribution}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

function SourceFreshnessPanel({ place }: { place: ExplorePlaceProfile }) {
  const C = useTheme();
  const rows = getExploreSourceRows(place);
  return (
    <View style={[styles.sourcePanel, { borderColor: C.border, backgroundColor: C.s1 }]}>
      <View style={styles.sourcePanelTop}>
        <View style={[styles.sourceIcon, { backgroundColor: '#2563eb18' }]}>
          <Ionicons name="shield-checkmark-outline" size={23} color="#2563eb" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.sourcePanelTitle, { color: C.text }]}>Details</Text>
          <ExpandableText value={sourceBodyForPlace(place)} textStyle={[styles.sourcePanelBody, { color: C.text2 }]} previewChars={230} />
        </View>
      </View>
      <View style={styles.sourceRows}>
        {rows.slice(0, 6).map(row => (
          <View key={`${row.label}-${row.value}`} style={[styles.sourceRow, { borderColor: C.border, backgroundColor: C.s2 }]}>
            <Ionicons name={row.icon as any} size={17} color={row.tone} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.sourceRowLabel, { color: C.text3 }]} numberOfLines={1}>{row.label.toUpperCase()}</Text>
              <Text style={[styles.sourceRowValue, { color: C.text }]} numberOfLines={2}>{row.value}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function SourcePack({
  place,
  mediaUrl,
  onSourcePackItem,
}: {
  place: ExplorePlaceProfile;
  mediaUrl: (url?: string | null) => string;
  onSourcePackItem?: (item: ExploreSourcePackItem) => void;
}) {
  const C = useTheme();
  if (!place.source_pack) return null;
  const pack = place.source_pack;
  const rows: Array<[string, ExploreSourcePackItem[] | undefined]> = [
    ['Things to do', pack.things_to_do],
    ['Things to see', pack.things_to_see],
    ['Visitor centers', pack.visitor_centers],
    ['Campgrounds', pack.campgrounds],
  ];
  return (
    <View style={[styles.pack, { borderColor: C.border, backgroundColor: C.s1 }]}>
      <View style={styles.packTop}>
        <Text style={[styles.blockHeading, { color: C.text, marginBottom: 0 }]}>More Details</Text>
        {!!pack.primary && <Text style={[styles.packBadge, { color: C.text3 }]}>{sourcePublisherLabel(pack.primary)}</Text>}
      </View>
      {!!pack.operating_hours && (
        <Text style={[styles.packText, { color: C.text2 }]}>Hours: {pack.operating_hours}</Text>
      )}
      {!!pack.fees?.length && (
        <Text style={[styles.packText, { color: C.text2 }]}>Fees: {pack.fees.slice(0, 2).join(' · ')}</Text>
      )}
      {!!pack.activities?.length && (
        <View style={styles.pillRow}>
          {pack.activities.slice(0, 8).map(activity => (
            <View key={activity} style={[styles.packPill, { borderColor: C.border, backgroundColor: C.s2 }]}>
              <Text style={[styles.packPillText, { color: C.text2 }]}>{activity}</Text>
            </View>
          ))}
        </View>
      )}
      {rows.map(([label, items]) => Array.isArray(items) && items.length ? (
        <View key={label}>
          <Text style={[styles.packLabel, { color: C.text3 }]}>{label.toUpperCase()}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.miniRail}>
            {items.slice(0, 6).map((item, idx) => {
              const hasLocation = item.lat != null && item.lng != null;
              const canOpen = (!!onSourcePackItem && hasLocation) || !!item.url;
              return (
                <TouchableOpacity
                  key={`${item.title}-${idx}`}
                  style={[styles.miniCard, { borderColor: C.border, backgroundColor: C.s2 }]}
                  disabled={!canOpen}
                  onPress={() => {
                    if (hasLocation && onSourcePackItem) {
                      onSourcePackItem(item);
                      return;
                    }
                    if (item.url) Linking.openURL(item.url);
                  }}
                >
                  {!!item.image_url && <ResilientImage uris={[sizedNpsMediaUrl(mediaUrl(item.image_url)), mediaUrl(item.image_url)]} style={styles.miniImage} />}
                  <View style={styles.miniBody}>
                    <Text style={[styles.miniTitle, { color: C.text }]} numberOfLines={2}>{item.title}</Text>
                    {!!item.description && <Text style={[styles.miniDesc, { color: C.text3 }]}>{normalizeExploreCopyBlock(item.description)}</Text>}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : null)}
    </View>
  );
}

function sourceBodyForPlace(place: ExplorePlaceProfile) {
  const raw = String(place.source_pack?.source_note || '').trim();
  if (/wiki|source pack/i.test(raw)) {
    return 'Check current access, fees, closures, and rules before you go.';
  }
  return raw || place.attribution || 'Details available. Verify access before you go.';
}

function sourcePublisherLabel(primary: string) {
  if (/wiki/i.test(primary)) return 'CURATED';
  return primary.toUpperCase();
}

function exploreMapRadiusMi(place: ExplorePlaceProfile) {
  const hay = `${place.category ?? ''} ${place.summary.category ?? ''} ${place.summary.explore_group ?? ''}`.toLowerCase();
  if (/park|public|land|forest|wilderness|glacier/.test(hay)) return 90;
  if (/camp|trail|water|lake|view|overlook|fall|peak|climb/.test(hay)) return 45;
  return 60;
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number) {
  const radiusMi = 3958.7613;
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * radiusMi * Math.asin(Math.min(1, Math.sqrt(a)));
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { paddingBottom: 42 },
  hero: { height: 430, backgroundColor: '#111827' },
  heroImage: { width: '100%', height: '100%' },
  heroFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heroShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(3,7,18,0.34)' },
  roundButton: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.54)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  backButton: { position: 'absolute', left: 20 },
  heroRight: { position: 'absolute', right: 20, flexDirection: 'row', gap: 10 },
  heroText: { position: 'absolute', left: 22, right: 22, bottom: 18 },
  kicker: { fontSize: 13, fontFamily: mono, fontWeight: '900', letterSpacing: 0 },
  title: { color: '#fff', fontSize: 40, lineHeight: 43, fontWeight: '900', letterSpacing: 0, marginTop: 9 },
  heroSummary: { color: 'rgba(255,255,255,0.86)', fontSize: 14, lineHeight: 19, fontWeight: '700', marginTop: 9 },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 11, flexWrap: 'wrap' },
  heroTrust: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroTrustText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  heroWeather: {
    minHeight: 34,
    borderRadius: 17,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(15,23,42,0.46)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  heroWeatherText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  placeSearch: {
    height: 50,
    borderRadius: 25,
    marginTop: 14,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  placeSearchInput: { flex: 1, minWidth: 0, color: '#fff', fontSize: 15, fontWeight: '800', paddingVertical: 0 },
  actionRail: { gap: 10, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10 },
  detailAction: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  detailActionText: { fontSize: 13, fontWeight: '900' },
  moduleHub: { paddingHorizontal: 20, paddingTop: 8, gap: 14 },
  moduleIntro: { gap: 4 },
  moduleIntroTitle: { fontSize: 23, lineHeight: 28, fontWeight: '900' },
  moduleIntroBody: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  moduleGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  moduleTile: { flexBasis: '48%', maxWidth: '48%', minHeight: 142, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  moduleImageTile: { minHeight: 166 },
  moduleTileImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  moduleTileShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(3,7,18,0.34)' },
  moduleTileBody: { flex: 1, padding: 13, justifyContent: 'space-between', gap: 14 },
  moduleTileOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 13, gap: 6 },
  moduleTileTop: { minHeight: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  moduleIconBubble: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  moduleCount: { fontSize: 12, fontFamily: mono, fontWeight: '900' },
  moduleTileTitle: { fontSize: 17, lineHeight: 21, fontWeight: '900' },
  moduleTileDetail: { fontSize: 12, lineHeight: 15, fontWeight: '800' },
  moduleDetailScreen: { paddingHorizontal: 20, paddingTop: 8, gap: 14 },
  moduleBack: { minHeight: 34, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4 },
  moduleBackText: { fontSize: 13, fontWeight: '900' },
  moduleDetailHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  moduleDetailIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  moduleDetailTitle: { fontSize: 24, lineHeight: 29, fontWeight: '900' },
  moduleDetailSub: { fontSize: 13, lineHeight: 18, fontWeight: '800', marginTop: 2 },
  itemList: { gap: 12 },
  detailItem: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  detailItemImage: { width: '100%', height: 150 },
  detailItemBody: { padding: 13, gap: 7 },
  detailItemTitle: { fontSize: 17, lineHeight: 21, fontWeight: '900' },
  detailItemCopy: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  detailItemMeta: { minHeight: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  detailItemMetaText: { flex: 1, minWidth: 0, fontSize: 10, fontFamily: mono, fontWeight: '900' },
  emptyModule: { minHeight: 82, borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  emptyModuleText: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  activityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  activityPill: { width: '48.5%', minHeight: 50, borderWidth: 1, borderRadius: 13, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  activityText: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 16, fontWeight: '900' },
  copyPanel: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 6 },
  copyTitle: { fontSize: 15, lineHeight: 19, fontWeight: '900' },
  copyBody: { fontSize: 13, lineHeight: 19, fontWeight: '700' },
  expandLink: { fontWeight: '900' },
  infoRowCard: { borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  mapActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  moduleMapHero: { height: 360, backgroundColor: '#101811' },
  mapPreview: { width: '100%', borderRadius: 0, overflow: 'hidden', backgroundColor: '#182318' },
  mapPreviewBase: { flex: 1, overflow: 'hidden', backgroundColor: '#1c2a1d' },
  mapContour: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(204,214,189,0.16)', borderRadius: 999 },
  mapContourOne: { width: 320, height: 130, left: -40, top: 36, transform: [{ rotate: '-13deg' }] },
  mapContourTwo: { width: 390, height: 180, right: -130, top: 92, transform: [{ rotate: '18deg' }] },
  mapContourThree: { width: 260, height: 105, left: 70, bottom: 18, transform: [{ rotate: '8deg' }] },
  mapRoad: { position: 'absolute', height: 3, borderRadius: 2, backgroundColor: 'rgba(232,226,204,0.22)' },
  mapRoadOne: { width: '82%', left: '-8%', top: '58%', transform: [{ rotate: '-17deg' }] },
  mapRoadTwo: { width: '74%', right: '-18%', top: '36%', transform: [{ rotate: '28deg' }] },
  mapPinWrap: { position: 'absolute', alignItems: 'center', transform: [{ translateX: -20 }, { translateY: -20 }] },
  mapPin: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#315f43',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.86)',
  },
  mapPinActive: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#166534' },
  mapPinCamp: { backgroundColor: '#7c4a2a' },
  mapPinLabel: {
    maxWidth: 150,
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
    color: '#fff',
    fontSize: 10,
    fontWeight: '900',
    backgroundColor: 'rgba(3,7,18,0.72)',
  },
  mapPreviewBadge: {
    position: 'absolute',
    right: 14,
    top: 14,
    minHeight: 32,
    borderRadius: 16,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(3,7,18,0.54)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  mapPreviewBadgeText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  mapPreviewTitle: { position: 'absolute', left: 18, right: 92, bottom: 18 },
  mapPreviewTitleText: { color: '#fff', fontSize: 31, lineHeight: 34, fontWeight: '900' },
  mapPreviewSubtitle: { color: 'rgba(255,255,255,0.78)', fontSize: 13, lineHeight: 17, fontWeight: '800', marginTop: 5 },
  calendarList: { gap: 12 },
  calendarPicker: { minHeight: 52, borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  calendarPickerText: { fontSize: 17, lineHeight: 22, fontWeight: '900' },
  eventCard: { minHeight: 116, borderWidth: 1, borderRadius: 16, overflow: 'hidden', flexDirection: 'row', alignItems: 'stretch' },
  eventDateBlock: { width: 78, alignItems: 'center', justifyContent: 'center', gap: 3 },
  eventMonth: { fontSize: 13, fontFamily: mono, fontWeight: '900' },
  eventDay: { fontSize: 34, lineHeight: 37, fontWeight: '900' },
  eventBody: { flex: 1, minWidth: 0, padding: 14, gap: 7, justifyContent: 'center' },
  eventTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  eventChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  eventChip: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  eventChipText: { fontSize: 10, lineHeight: 13, fontWeight: '800' },
  childHero: { height: 390, backgroundColor: '#111827' },
  childContent: { padding: 20, paddingBottom: 48, gap: 14 },
  childFactList: { gap: 10 },
  childSection: { gap: 10 },
  imageCredit: { fontSize: 11, lineHeight: 15, fontWeight: '700', textAlign: 'center' },
  actions: { marginHorizontal: 20, marginTop: 10 },
  primaryAction: { flex: 1, minHeight: 56, borderRadius: 15 },
  tabs: { marginHorizontal: 20, marginTop: 14, borderWidth: 1, borderRadius: 14, flexDirection: 'row', overflow: 'hidden' },
  tab: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontSize: 14, fontWeight: '800' },
  tabUnderline: { position: 'absolute', left: 14, right: 14, bottom: 0, height: 2 },
  highlight: { margin: 20, borderWidth: 1, borderRadius: 18, padding: 16 },
  highlightIcon: { width: 72, height: 72, borderRadius: 36, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  highlightBody: { marginBottom: 14 },
  highlightTitle: { fontSize: 21, lineHeight: 29, fontWeight: '900' },
  factGrid: { borderTopWidth: 1, paddingTop: 14, flexDirection: 'row', flexWrap: 'wrap' },
  factCell: { width: '50%', minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 9, paddingRight: 8, paddingVertical: 4 },
  factValue: { fontSize: 19, lineHeight: 21, fontWeight: '900' },
  factLabel: { fontSize: 12, lineHeight: 15, fontWeight: '700' },
  whyCard: { marginHorizontal: 20, marginBottom: 14, borderWidth: 1, borderRadius: 16, padding: 14, flexDirection: 'row', gap: 12 },
  whyIcon: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 16, fontWeight: '900', marginBottom: 5 },
  bodyText: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  planCard: { marginHorizontal: 20, marginBottom: 14, borderWidth: 1, borderRadius: 16, padding: 14, gap: 12 },
  planTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  planIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  planGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  planCell: { width: '48%', minHeight: 70, borderWidth: 1, borderRadius: 13, padding: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  planLabel: { fontSize: 9, fontFamily: mono, fontWeight: '900', marginBottom: 3 },
  planValue: { fontSize: 12, lineHeight: 16, fontWeight: '800' },
  blockHeading: { marginHorizontal: 20, marginBottom: 9, fontSize: 18, fontWeight: '900', letterSpacing: 0 },
  sourcePanel: { marginHorizontal: 20, marginBottom: 18, borderWidth: 1, borderRadius: 16, padding: 14, gap: 12 },
  sourcePanelTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  sourceIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  sourcePanelTitle: { fontSize: 15, lineHeight: 19, fontWeight: '900', marginBottom: 4 },
  sourcePanelBody: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  sourceRows: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sourceRow: { width: '48%', minHeight: 66, borderWidth: 1, borderRadius: 13, padding: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  sourceRowLabel: { fontSize: 8.5, fontFamily: mono, fontWeight: '900', marginBottom: 3 },
  sourceRowValue: { fontSize: 12, lineHeight: 16, fontWeight: '800' },
  moduleRail: { gap: 10, paddingHorizontal: 20, paddingBottom: 18 },
  moduleCard: { minWidth: 158, minHeight: 64, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9 },
  moduleText: { flex: 1, minWidth: 0 },
  moduleTitle: { fontSize: 13, fontWeight: '900' },
  moduleDetail: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  panel: { margin: 20, borderWidth: 1, borderRadius: 16, padding: 12 },
  storyBox: { maxHeight: 390 },
  storySentence: { fontSize: 16, lineHeight: 25, fontWeight: '600', borderRadius: 8, paddingHorizontal: 4 },
  pack: { marginHorizontal: 20, marginTop: 2, marginBottom: 16, borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  packTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  packBadge: { fontSize: 10, fontFamily: mono, fontWeight: '900' },
  packText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  packPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  packPillText: { fontSize: 11, fontWeight: '800' },
  packLabel: { fontSize: 10, fontFamily: mono, fontWeight: '900', marginTop: 6, marginBottom: 6 },
  miniRail: { gap: 10, paddingRight: 6 },
  miniCard: { width: 210, borderWidth: 1, borderRadius: 13, overflow: 'hidden' },
  miniImage: { width: '100%', height: 90 },
  miniBody: { padding: 10, gap: 4 },
  miniTitle: { fontSize: 13, lineHeight: 17, fontWeight: '900' },
  miniDesc: { fontSize: 11, lineHeight: 15, fontWeight: '600' },
  sourceButton: { marginHorizontal: 20, borderWidth: 1, borderRadius: 14, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sourceButtonText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '700' },
});
