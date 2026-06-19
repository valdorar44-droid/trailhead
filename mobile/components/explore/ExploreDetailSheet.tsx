import React, { useEffect, useMemo, useState } from 'react';
import { Image, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ExplorePlaceProfile, ExploreSourcePackItem, ExploreTrailCard } from '@/lib/api';
import { mono, useTheme } from '@/lib/design';
import { ExploreTrailArea } from './ExploreTrailArea';
import {
  getExploreCategoryColor,
  getExploreCardSummary,
  getExploreDisplayCategory,
  getExploreDisplayRegion,
  getExploreDisplayTitle,
  getExploreIcon,
  getExploreSourceRows,
  getExploreTrustBadge,
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
  const [placeSearch, setPlaceSearch] = useState('');
  const searchNeedle = placeSearch.trim().toLowerCase();

  useEffect(() => {
    setPlaceSearch('');
    if (tab === 'story') {
      setActiveModule('story');
    } else if (tab === 'nearby') {
      setActiveModule('nearby');
    } else {
      setActiveModule(null);
    }
  }, [place.id, tab]);

  const firstItemImage = (items?: ExploreSourcePackItem[]) => {
    const found = items?.find(item => item.image_url)?.image_url;
    return found ? mediaUrl(found) : '';
  };

  const searchTextForItems = (items?: ExploreSourcePackItem[]) => (items ?? [])
    .map(item => [item.title, item.description, item.kind, item.source_label, item.source].filter(Boolean).join(' '))
    .join(' ');

  const detailModules = useMemo<ExploreDetailModule[]>(() => {
    const modules: ExploreDetailModule[] = [];
    const add = (module: ExploreDetailModule | null | false | undefined) => {
      if (module) modules.push(module);
    };
    const count = (items?: ExploreSourcePackItem[]) => Array.isArray(items) ? items.length : 0;
    const packPhoto = pack?.photos?.find(photo => photo.url)?.url;
    const heroOrPack = packPhoto ? mediaUrl(packPhoto) : imageUrl;
    const activityCount = (pack?.activities?.length ?? 0) + (place.amenities?.length ?? 0);
    const hasCoords = place.summary.lat != null && place.summary.lng != null;

    add({
      key: 'see',
      label: 'What to See',
      detail: count(pack?.things_to_see) ? `${count(pack?.things_to_see)} places` : 'Highlights',
      icon: 'camera-outline',
      tone: '#0f766e',
      count: count(pack?.things_to_see) || undefined,
      imageUrl: firstItemImage(pack?.things_to_see) || heroOrPack,
      searchText: `${searchTextForItems(pack?.things_to_see)} ${place.profile?.why_it_matters ?? ''} ${place.wiki_extract ?? ''}`,
    });

    add(Boolean(count(pack?.things_to_do) || activityCount > 0 || experiencesSlot) && {
      key: 'do',
      label: 'Things to Do',
      detail: count(pack?.things_to_do) ? `${count(pack?.things_to_do)} options` : 'Activities',
      icon: 'walk-outline',
      tone: '#f97316',
      count: count(pack?.things_to_do) || activityCount || undefined,
      imageUrl: firstItemImage(pack?.things_to_do) || heroOrPack,
      searchText: `${searchTextForItems(pack?.things_to_do)} ${(pack?.activities ?? []).join(' ')} ${(place.amenities ?? []).join(' ')}`,
    });

    add(Boolean(count(pack?.campgrounds) || campgroundsSlot) && {
      key: 'stay',
      label: 'Where to Stay',
      detail: count(pack?.campgrounds) ? `${count(pack?.campgrounds)} stays` : 'Camp nearby',
      icon: 'bonfire-outline',
      tone: '#16a34a',
      count: count(pack?.campgrounds) || undefined,
      imageUrl: firstItemImage(pack?.campgrounds) || heroOrPack,
      searchText: `${searchTextForItems(pack?.campgrounds)} camp campground lodge cabin rv overnight`,
    });

    add(Boolean(count(pack?.visitor_centers) || pack?.nps_park_code) && {
      key: 'visitor',
      label: 'Visitor Centers',
      detail: count(pack?.visitor_centers) ? `${count(pack?.visitor_centers)} centers` : 'Park info',
      icon: 'information-circle-outline',
      tone: '#2563eb',
      count: count(pack?.visitor_centers) || undefined,
      imageUrl: firstItemImage(pack?.visitor_centers) || heroOrPack,
      searchText: `${searchTextForItems(pack?.visitor_centers)} visitor center ranger station park info`,
    });

    add(((place.trails?.length ?? 0) > 0 || (place.linked_trail_ids?.length ?? 0) > 0 || /trail|trek|peak|waterfall|glacier/i.test(`${place.category ?? ''} ${(place.subcategories ?? []).join(' ')}`)) && {
      key: 'trails',
      label: 'Trails',
      detail: place.trails?.length ? `${place.trails.length} trail cards` : 'Trail cards',
      icon: 'trail-sign-outline',
      tone: '#ca8a04',
      count: place.trails?.length || undefined,
      imageUrl: place.trails?.find(trail => trail.image_url)?.image_url ? mediaUrl(place.trails.find(trail => trail.image_url)?.image_url) : heroOrPack,
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
      label: 'Map',
      detail: 'Show area',
      icon: 'map-outline',
      tone: '#0f766e',
      searchText: 'map route directions area navigation',
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

  const filteredItems = (items?: ExploreSourcePackItem[]) => {
    const list = items ?? [];
    if (!searchNeedle) return list;
    return list.filter(item => `${item.title ?? ''} ${item.description ?? ''} ${item.kind ?? ''} ${item.source_label ?? ''}`.toLowerCase().includes(searchNeedle));
  };

  function openModule(key: ExploreDetailModuleKey) {
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
    if (item.lat != null && item.lng != null && onSourcePackItem) {
      onSourcePackItem(item);
      return;
    }
    if (item.url) Linking.openURL(item.url);
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
    return (
      <View style={styles.itemList}>
        {items.map((item, idx) => {
          const itemImage = item.image_url ? mediaUrl(item.image_url) : imageUrl;
          const canOpen = !!item.url || (item.lat != null && item.lng != null && !!onSourcePackItem);
          return (
            <TouchableOpacity
              key={`${item.title}-${idx}`}
              style={[styles.detailItem, { borderColor: C.border, backgroundColor: C.s1 }]}
              activeOpacity={0.88}
              disabled={!canOpen}
              onPress={() => openSourceItem(item)}
            >
              {!!itemImage && <Image source={{ uri: itemImage }} style={styles.detailItemImage} resizeMode="cover" />}
              <View style={styles.detailItemBody}>
                <Text style={[styles.detailItemTitle, { color: C.text }]} numberOfLines={2}>{item.title || 'Place'}</Text>
                {!!item.description && (
                  <Text style={[styles.detailItemCopy, { color: C.text2 }]} numberOfLines={4}>{item.description}</Text>
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

  function renderModuleContent(key: ExploreDetailModuleKey) {
    if (key === 'see') {
      const seeItems = filteredItems(pack?.things_to_see);
      return (
        <>
          {seeItems.length > 0 ? renderItemList(seeItems, 'No saved highlights yet.') : null}
          {!!place.profile?.why_it_matters && (
            <View style={[styles.copyPanel, { borderColor: C.border, backgroundColor: C.s1 }]}>
              <Text style={[styles.copyTitle, { color: C.text }]}>Why Go</Text>
              <Text style={[styles.copyBody, { color: C.text2 }]}>{place.profile.why_it_matters}</Text>
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
          {campgroundsSlot}
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
    if (key === 'weather') {
      return weatherSlot ?? (
        <View style={[styles.emptyModule, { borderColor: C.border, backgroundColor: C.s1 }]}>
          <Ionicons name="partly-sunny-outline" size={24} color={accent} />
          <Text style={[styles.emptyModuleText, { color: C.text2 }]}>Forecast unavailable.</Text>
        </View>
      );
    }
    if (key === 'map') {
      return (
        <View style={styles.mapActions}>
          {renderAction('Show Area', 'map-outline', onShowArea, true)}
          {renderAction('Route', 'navigate-outline', onRoute)}
          {renderAction(saved ? 'Saved' : 'Save', saved ? 'bookmark' : 'bookmark-outline', onToggleSave)}
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
    return (
      <View style={styles.moduleHub}>
        <View style={styles.moduleIntro}>
          <Text style={[styles.moduleIntroTitle, { color: C.text }]}>Explore this place</Text>
        </View>
        <View style={styles.moduleGrid}>
          {visibleModules.map(module => {
            const hasImage = !!module.imageUrl;
            return (
              <TouchableOpacity
                key={module.key}
                style={[styles.moduleTile, { borderColor: C.border, backgroundColor: C.s1 }, hasImage && styles.moduleImageTile]}
                activeOpacity={0.88}
                onPress={() => openModule(module.key)}
              >
                {hasImage ? (
                  <>
                    <Image source={{ uri: module.imageUrl }} style={styles.moduleTileImage} resizeMode="cover" />
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

  return (
    <View style={[styles.screen, { backgroundColor: C.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.heroImage} resizeMode="cover" />
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
            <Text style={styles.heroSummary} numberOfLines={2}>{getExploreCardSummary(place)}</Text>
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

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionRail}>
          {renderAction('Map', 'map-outline', onShowArea, true)}
          {renderAction('Route', 'navigate-outline', onRoute)}
          {renderAction('Weather', 'partly-sunny-outline', () => openModule('weather'))}
          {renderAction(isPlaying ? 'Stop' : 'Audio', isPlaying ? 'stop' : 'play', onPlayAudio)}
          {renderAction(saved ? 'Saved' : 'Save', saved ? 'bookmark' : 'bookmark-outline', onToggleSave)}
        </ScrollView>

        {activeModuleDef ? (
          <View style={styles.moduleDetailScreen}>
            <TouchableOpacity style={styles.moduleBack} onPress={() => { setActiveModule(null); onTabChange('summary'); }}>
              <Ionicons name="chevron-back" size={18} color={C.text2} />
              <Text style={[styles.moduleBackText, { color: C.text2 }]}>Explore this place</Text>
            </TouchableOpacity>
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
          <Text style={[styles.sourcePanelBody, { color: C.text2 }]} numberOfLines={3}>{sourceBodyForPlace(place)}</Text>
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
                  {!!item.image_url && <Image source={{ uri: mediaUrl(item.image_url) }} style={styles.miniImage} resizeMode="cover" />}
                  <View style={styles.miniBody}>
                    <Text style={[styles.miniTitle, { color: C.text }]} numberOfLines={2}>{item.title}</Text>
                    {!!item.description && <Text style={[styles.miniDesc, { color: C.text3 }]} numberOfLines={3}>{item.description}</Text>}
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
  moduleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  moduleTile: { width: '48.5%', minHeight: 142, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
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
  infoRowCard: { borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  mapActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
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
