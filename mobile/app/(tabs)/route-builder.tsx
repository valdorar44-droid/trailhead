import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput,
  ActivityIndicator, Animated, Keyboard, Modal, Alert, Image, Platform,
  useWindowDimensions, KeyboardAvoidingView, Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Asset } from 'expo-asset';
import { ResizeMode, Video } from 'expo-av';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import PaywallModal from '@/components/PaywallModal';
import PremiumPlaceSheet from '@/components/PremiumPlaceSheet';
import ActivityStatusCard from '@/components/planning/ActivityStatusCard';
import RouteBuilderActiveDayControls, { RouteBuilderEmptyDayGuidance } from '@/components/routeBuilder/RouteBuilderActiveDayControls';
import RouteBuilderActiveDayStopList from '@/components/routeBuilder/RouteBuilderActiveDayStopList';
import RouteBuilderFooterDock from '@/components/routeBuilder/RouteBuilderFooterDock';
import RouteBuilderHub from '@/components/routeBuilder/RouteBuilderHub';
import RouteBuilderInlineResults, {
  RouteBuilderInlineCampCard,
  RouteBuilderInlineResultRow,
} from '@/components/routeBuilder/RouteBuilderInlineResults';
import RouteBuilderReadinessCard from '@/components/routeBuilder/RouteBuilderReadinessCard';
import RouteBuilderSearchSurface from '@/components/routeBuilder/RouteBuilderSearchSurface';
import {
  RouteBuilderCampPreviewCard,
  RouteBuilderFuelPreviewCard,
  RouteBuilderPlacePreviewCard,
} from '@/components/routeBuilder/RouteBuilderStopPreviewCards';
import RouteBuilderTimelineActions from '@/components/routeBuilder/RouteBuilderTimelineActions';
import RouteBuilderTimelineDayCard from '@/components/routeBuilder/RouteBuilderTimelineDayCard';
import RentalSuggestionModule from '@/components/trip/RentalSuggestionModule';
import useRouteBuilderDiscoveryState, {
  type DiscoveryTab,
  type LegSearchContext,
} from '@/components/routeBuilder/useRouteBuilderDiscoveryState';
import RouteWizardProgressHeader from '@/components/routeBuilder/RouteWizardProgressHeader';
import { TrailheadButton, TrailheadCard, TrailheadCardSkeleton, TrailheadSheet, TrailheadTopBar } from '@/components/TrailheadUI';
import TrailheadPhotoGallery, { type TrailheadGalleryPhoto } from '@/components/TrailheadPhotoGallery';
import { api, ApiError, CampFullness, Campsite, CampsiteDetail, CampsiteInsight, CampsitePin, CampReusePolicy, ExcursionCandidate, FuelEstimate, GasStation, GeocodePlace, OutdoorOffer, OsmPoi, PaywallError, RouteStyleMode, SavedRouteGeometryPayload, TripResult, TripShapeMode, TripTimeline, Waypoint, WeatherForecast } from '@/lib/api';
import { loadAllPlacePoints } from '@/lib/offlinePlacePacks';
import { deleteOfflineTrail, listOfflineTrails, type OfflineTrail } from '@/lib/offlineTrails';
import { loadOfflineTrip, saveOfflineTrip } from '@/lib/offlineTrips';
import { useStore, type TripHistoryItem } from '@/lib/store';
import { storage } from '@/lib/storage';
import { trackPhase0Once } from '@/lib/telemetry';
import { buildRentalSuggestionFit } from '@/lib/outdoorRentals';
import {
  clearTrailheadRouteBuilderDraft,
  loadTrailheadRouteBuilderDraft,
  type TrailheadRouteBuilderDraft,
  type TrailheadRouteBuilderDraftStop,
} from '@/lib/copilotCapabilities';
import { useTheme, mono, ColorPalette, RADIUS } from '@/lib/design';
import { computeOfflineReadiness } from '@/lib/offlineReadiness';
import { useOfflineFiles } from '@/lib/useOfflineFiles';
import { loadWelcomeSetupPreferences, type WelcomeSetupPreferences } from '@/lib/welcomeGate';
import { tripPreferenceContextFromWelcomePreferences } from '@/lib/tripPreferences';
import {
  ROUTE_BUILDER_AUDIT_MATRIX,
  buildRouteBuilderSearchStop,
  buildRouteFitCards,
  buildRouteBuilderSession,
  buildRouteLocationsForShape,
  computeDaySegmentsFromRouteGeometry,
  filterDurableNavigationStops,
  fmtDistance as fmtUnitDistance,
  fmtFuelVolumeFromMiles,
  providerGeometryFromRoute,
  rebalanceAfterCampSelection,
  routeUnitsParam,
  savedGeometryFromCoords,
  resolveRouteBuilderSearchResults,
  searchRouteBuilderFallbackPois,
  searchRouteBuilderProviderAtPoints,
  searchOfflineRouteBuilderPlaces,
  type RouteBuilderSearchPlace,
  type RouteBuilderStopType,
  type RouteFitCard,
  type ProviderRouteGeometry,
  type RouteBuilderIntent,
} from '@/lib/routeBuilder';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.gettrailhead.app';
const ROUTE_BUILDER_LOAD_VIDEO = require('../../assets/route-builder-load.mp4');
const ROUTE_BUILDER_MAP_SETTLE_MS = 2800;
const ROUTE_HERO_PHOTO = 'https://www.nps.gov/common/uploads/structured_data/473F5463-F0D2-261D-CEF5FCB39363590B.jpg';
const ROUTE_BUILDER_RENTAL_DISMISSED_KEY = 'trailhead_route_builder_rental_dismissed_at';

const ROUTE_COVER_FALLBACKS = [
  { match: /utah|moab|arches|canyonlands|red rock|\but\b/i, url: 'https://www.nps.gov/common/uploads/structured_data/473F5463-F0D2-261D-CEF5FCB39363590B.jpg' },
  { match: /zion/i, url: 'https://www.nps.gov/common/uploads/structured_data/68BFC1AC-BF96-629F-89D261D78F181C64.jpg' },
  { match: /yosemite|\bca\b|sierra/i, url: 'https://www.nps.gov/common/uploads/structured_data/3C84CC4C-1DD8-B71B-0BE967E5E5D93F25.jpg' },
  { match: /grand canyon|\baz\b/i, url: 'https://www.nps.gov/common/uploads/structured_data/3C7B12D1-1DD8-B71B-0BCE0712F9CEA155.jpg' },
  { match: /yellowstone|\bwy\b/i, url: 'https://www.nps.gov/common/uploads/structured_data/3C7D5920-1DD8-B71B-0B83F012ED802CEA.jpg' },
  { match: /glacier|\bmt\b/i, url: 'https://www.nps.gov/common/uploads/structured_data/C20E6CD3-CDF7-B3AB-8448CDCD7FD590FF.jpg' },
  { match: /rocky|colorado|\bco\b/i, url: 'https://www.nps.gov/common/uploads/structured_data/25871823-F36D-9986-8C552F7496B7D557.jpg' },
  { match: /olympic|\bwa\b/i, url: 'https://www.nps.gov/common/uploads/structured_data/3C7B1DB4-1DD8-B71B-0B9DFEFDD398DB71.jpg' },
  { match: /big bend|texas|\btx\b/i, url: 'https://www.nps.gov/common/uploads/structured_data/8BF8356B-BB63-76A4-19F5296EF94C96B4.jpg' },
  { match: /smoky|tennessee|north carolina|\btn\b|\bnc\b/i, url: 'https://www.nps.gov/common/uploads/structured_data/3C80EC37-1DD8-B71B-0B87F63E8B030D15.jpg' },
] as const;

type RouteTripCardData = {
  coverUrl: string;
  stats: string;
};

function mediaUrl(url?: string | null) {
  if (!url) return '';
  if (url.startsWith('/common/uploads')) return `https://www.nps.gov${url}`;
  return url.startsWith('/') ? `${API_BASE_URL}${url}` : url;
}

function campPhotoUrl(photo: unknown): string {
  if (typeof photo === 'string') return mediaUrl(photo);
  if (photo && typeof photo === 'object') {
    const value = (photo as { url?: string | null }).url;
    return mediaUrl(value);
  }
  return '';
}

function campPhotoItems(camp?: Partial<CampsitePin> | null, detail?: Partial<CampsiteDetail> | null): TrailheadGalleryPhoto[] {
  const items: TrailheadGalleryPhoto[] = [];
  const seen = new Set<string>();
  const push = (photo: unknown, source?: string) => {
    const url = campPhotoUrl(photo);
    if (!url || seen.has(url)) return;
    seen.add(url);
    const photoSource = typeof photo === 'object' && photo
      ? ((photo as { source?: string; credit?: string; caption?: string }).source || source)
      : source;
    items.push({ url, source: photoSource || detail?.media_source || detail?.verified_source || camp?.verified_source || camp?.source_badge || camp?.source || 'Trailhead' });
  };
  (detail?.photos ?? []).forEach(photo => push(photo, detail?.media_source || detail?.verified_source));
  (detail?.campsites ?? []).forEach(site => (site.photos ?? []).forEach(photo => push(photo, site.source_badge || site.verified_source || 'Recreation.gov')));
  (camp?.photos ?? []).forEach(photo => push(photo, camp?.verified_source || camp?.source_badge || camp?.source));
  push(camp?.photo_url, camp?.verified_source || camp?.source_badge || camp?.source);
  return items;
}

type BuilderStopType = RouteBuilderStopType;
type BuilderStop = {
  id: string;
  day: number;
  name: string;
  lat: number;
  lng: number;
  type: BuilderStopType;
  description: string;
  land_type: string;
  source?: 'search' | 'camp' | 'gas' | 'poi' | 'map';
  camp?: CampsitePin;
  gas?: GasStation;
  poi?: OsmPoi;
  routePointType?: 'side_stop' | 'through' | 'break';
  campWindowStart?: number;
  campWindowEnd?: number;
  campWindowLabel?: string;
  routeShapeRole?: 'start' | 'destination' | 'outbound_anchor' | 'return_anchor' | 'overnight' | 'side_stop';
};
type SearchPlace = RouteBuilderSearchPlace;
type CampPreferenceMode = 'public' | 'developed' | 'rv' | 'private' | 'any';
type CampCadenceMode = 'nightly' | 'alternate' | 'manual';
type RoutePlaceSelection =
  | { kind: 'gas'; day: number; place: any; data: GasStation }
  | { kind: 'poi'; day: number; place: any; data: OsmPoi }
  | { kind: 'excursion'; day: number; place: any; data: ExcursionCandidate };
type RouteDayPlan = {
  day: number;
  campWindowLabel: string;
  campWindowStart: number;
  campWindowEnd: number;
  needsCamp: boolean;
  needsOvernight: boolean;
  hasOvernight: boolean;
  needsReview: boolean;
  previous: BuilderStop | null;
  target: BuilderStop | null;
  frameworkTarget: BuilderStop | null;
  stops: BuilderStop[];
  miles: number;
  hours: number;
  rest: boolean;
  complete: boolean;
};
type TripBuildMode = 'recommended' | 'blank';
type DistanceMode = 'hours' | 'miles';
type RouteTabMode = 'hub' | 'wizard';
type RouteSpineBuild = {
  spine: Array<{ lat: number; lng: number }>;
  geometry: ProviderRouteGeometry;
};

const PLACE_FILTER_TYPES = [
  { id: 'fuel', label: 'Fuel', icon: 'flash-outline', color: '#ea580c' },
  { id: 'propane', label: 'Propane', icon: 'flame-outline', color: '#f97316' },
  { id: 'water', label: 'Water Fill', icon: 'water-outline', color: '#0284c7' },
  { id: 'boat_ramp', label: 'Boat Ramps', icon: 'boat-outline', color: '#1d4ed8' },
  { id: 'paddle_launch', label: 'Paddle', icon: 'navigate-circle-outline', color: '#0f766e' },
  { id: 'fishing_access', label: 'Fishing', icon: 'fish-outline', color: '#15803d' },
  { id: 'marina', label: 'Marinas', icon: 'boat-outline', color: '#0891b2' },
  { id: 'dock', label: 'Docks', icon: 'albums-outline', color: '#0369a1' },
  { id: 'shore_access', label: 'Shore Access', icon: 'map-outline', color: '#0e7490' },
  { id: 'dump', label: 'Dump', icon: 'trash-bin-outline', color: '#a16207' },
  { id: 'shower', label: 'Showers', icon: 'rainy-outline', color: '#06b6d4' },
  { id: 'laundromat', label: 'Laundry', icon: 'shirt-outline', color: '#06b6d4' },
  { id: 'lodging', label: 'Lodging', icon: 'bed-outline', color: '#6366f1' },
  { id: 'private_stay', label: 'Private Stays', icon: 'home-outline', color: '#0ea5e9' },
  { id: 'farm_stay', label: 'Farm stays', icon: 'home-outline', color: '#65a30d' },
  { id: 'ranch', label: 'Ranches', icon: 'home-outline', color: '#a16207' },
  { id: 'winery', label: 'Wineries', icon: 'wine-outline', color: '#7c3aed' },
  { id: 'glamping', label: 'Glamping', icon: 'sparkles-outline', color: '#0ea5e9' },
  { id: 'private_camp', label: 'Private camps', icon: 'key-outline', color: '#16a34a' },
  { id: 'food', label: 'Food', icon: 'restaurant-outline', color: '#06b6d4' },
  { id: 'grocery', label: 'Groceries', icon: 'cart-outline', color: '#06b6d4' },
  { id: 'mechanic', label: 'Mechanic', icon: 'construct-outline', color: '#f97316' },
  { id: 'parking', label: 'Parking', icon: 'car-outline', color: '#d97706' },
  { id: 'attraction', label: 'Attractions', icon: 'camera-outline', color: '#0ea5e9' },
  { id: 'trailhead', label: 'Trailheads', icon: 'trail-sign-outline', color: '#22c55e' },
  { id: 'viewpoint', label: 'Views', icon: 'flag-outline', color: '#a855f7' },
  { id: 'peak', label: 'Peaks', icon: 'triangle-outline', color: '#92400e' },
  { id: 'pass', label: 'Passes', icon: 'git-compare-outline', color: '#7c2d12' },
  { id: 'glacier', label: 'Glaciers', icon: 'snow-outline', color: '#0284c7' },
  { id: 'bridge', label: 'Bridges', icon: 'swap-horizontal-outline', color: '#64748b' },
  { id: 'checkpost', label: 'Checkposts', icon: 'shield-checkmark-outline', color: '#475569' },
  { id: 'settlement', label: 'Villages', icon: 'business-outline', color: '#0f766e' },
  { id: 'medical', label: 'Medical', icon: 'medkit-outline', color: '#dc2626' },
  { id: 'hot_spring', label: 'Hot Springs', icon: 'flame-outline', color: '#f97316' },
] as const;
const DEFAULT_PLACE_FILTERS = ['fuel', 'propane', 'water', 'boat_ramp', 'paddle_launch', 'fishing_access', 'marina', 'dock', 'shore_access', 'dump', 'trailhead', 'pass', 'glacier', 'bridge', 'checkpost', 'settlement'];
const WATER_PLACE_FILTER_IDS = new Set(['boat_ramp', 'paddle_launch', 'fishing_access', 'marina', 'dock', 'shore_access', 'swimming', 'spring', 'water_fill', 'gauge']);
const FUEL_POI_TYPES = 'fuel,propane';
const ROUTE_POI_TYPES = 'water,trailhead,viewpoint,peak,pass,glacier,bridge,checkpost,settlement,hot_spring,dump,shower,laundromat,lodging,private_stay,farm_stay,ranch,winery,glamping,private_camp,food,grocery,mechanic,parking,attraction,medical';
const CAMP_PREFERENCE_OPTIONS: Array<{ id: CampPreferenceMode; label: string; sub: string; icon: keyof typeof Ionicons.glyphMap; filters: string[] }> = [
  { id: 'public', label: 'Public', sub: 'BLM / USFS first', icon: 'trail-sign-outline', filters: ['blm', 'usfs', 'dispersed', 'free', 'tent'] },
  { id: 'developed', label: 'Developed', sub: 'Parks + reservable', icon: 'bonfire-outline', filters: ['tent', 'reservable', 'state', 'nps', 'usfs'] },
  { id: 'rv', label: 'RV', sub: 'Hookups + parks', icon: 'car-sport-outline', filters: ['rv', 'reservable'] },
  { id: 'private', label: 'Private Stays', sub: 'Farms, ranches, glamping', icon: 'home-outline', filters: ['private', 'farm', 'ranch', 'winery', 'glamping', 'private_camp'] },
  { id: 'any', label: 'Any legal', sub: 'Broad search', icon: 'map-outline', filters: [] },
];
const CAMP_CADENCE_OPTIONS: Array<{ id: CampCadenceMode; label: string; sub: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: 'nightly', label: 'Every night', sub: 'Camp each route day', icon: 'moon-outline' },
  { id: 'alternate', label: 'Every other', sub: 'Camp on alternating days', icon: 'swap-horizontal-outline' },
  { id: 'manual', label: 'Manual', sub: 'Pick camps yourself', icon: 'hand-left-outline' },
];
const CAMP_REUSE_OPTIONS: Array<{ id: CampReusePolicy; label: string; sub: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: 'different_each_night', label: 'Different camps', sub: 'Move camp each drive day', icon: 'git-branch-outline' },
  { id: 'same_camp_window', label: 'Same camp window', sub: 'Basecamp multi-night windows', icon: 'bed-outline' },
  { id: 'manual', label: 'Manual reuse', sub: 'You decide night by night', icon: 'hand-left-outline' },
];
const BUILD_STATUS_LINES = [
  'Tracing the route line',
  'Checking camp windows',
  'Adding fuel and useful stops',
  'Saving the route preview',
];

function normalizedWaterSubtype(place: Pick<OsmPoi, 'type' | 'subtype'> & Record<string, any>) {
  if (String(place.type || '') !== 'water') return '';
  const subtype = String(place.subtype || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (subtype === 'tap' || subtype === 'drinking_water' || subtype === 'water_point' || subtype === 'fountain' || subtype === 'spring') return 'water';
  if (WATER_PLACE_FILTER_IDS.has(subtype)) return subtype;
  return 'shore_access';
}

function placeMatchesFilterId(place: OsmPoi, filterId: string) {
  if (String(place.type || '') !== 'water') return place.type === filterId;
  const subtype = normalizedWaterSubtype(place);
  if (filterId === 'water') return subtype === 'water';
  return subtype === filterId;
}

function placeMatchesFilters(place: OsmPoi, filters: string[]) {
  if (String(place.type || '') !== 'water') return filters.includes(place.type);
  const subtype = normalizedWaterSubtype(place);
  return filters.includes(subtype) || (subtype === 'water' && filters.includes('water'));
}

const STATE_INFO: Record<string, { name: string; minLat: number; maxLat: number; minLng: number; maxLng: number }> = {
  AL: { name: 'Alabama', minLat: 30.1, maxLat: 35.1, minLng: -88.6, maxLng: -84.9 },
  AZ: { name: 'Arizona', minLat: 31.2, maxLat: 37.1, minLng: -114.9, maxLng: -109.0 },
  AR: { name: 'Arkansas', minLat: 33.0, maxLat: 36.6, minLng: -94.7, maxLng: -89.6 },
  CA: { name: 'California', minLat: 32.4, maxLat: 42.1, minLng: -124.5, maxLng: -114.1 },
  CO: { name: 'Colorado', minLat: 36.9, maxLat: 41.1, minLng: -109.1, maxLng: -102.0 },
  CT: { name: 'Connecticut', minLat: 40.9, maxLat: 42.1, minLng: -73.8, maxLng: -71.8 },
  DE: { name: 'Delaware', minLat: 38.4, maxLat: 39.9, minLng: -75.8, maxLng: -75.0 },
  FL: { name: 'Florida', minLat: 24.4, maxLat: 31.1, minLng: -87.7, maxLng: -80.0 },
  GA: { name: 'Georgia', minLat: 30.3, maxLat: 35.1, minLng: -85.7, maxLng: -80.8 },
  ID: { name: 'Idaho', minLat: 42.0, maxLat: 49.1, minLng: -117.3, maxLng: -111.0 },
  IL: { name: 'Illinois', minLat: 36.9, maxLat: 42.6, minLng: -91.6, maxLng: -87.5 },
  IN: { name: 'Indiana', minLat: 37.7, maxLat: 41.8, minLng: -88.1, maxLng: -84.8 },
  IA: { name: 'Iowa', minLat: 40.3, maxLat: 43.6, minLng: -96.7, maxLng: -90.1 },
  KS: { name: 'Kansas', minLat: 36.9, maxLat: 40.1, minLng: -102.1, maxLng: -94.5 },
  KY: { name: 'Kentucky', minLat: 36.4, maxLat: 39.2, minLng: -89.6, maxLng: -81.9 },
  LA: { name: 'Louisiana', minLat: 28.9, maxLat: 33.1, minLng: -94.1, maxLng: -88.8 },
  ME: { name: 'Maine', minLat: 43.0, maxLat: 47.5, minLng: -71.1, maxLng: -66.9 },
  MD: { name: 'Maryland', minLat: 37.8, maxLat: 39.8, minLng: -79.6, maxLng: -75.0 },
  MA: { name: 'Massachusetts', minLat: 41.2, maxLat: 42.9, minLng: -73.6, maxLng: -69.9 },
  MI: { name: 'Michigan', minLat: 41.6, maxLat: 48.4, minLng: -90.5, maxLng: -82.1 },
  MN: { name: 'Minnesota', minLat: 43.4, maxLat: 49.4, minLng: -97.3, maxLng: -89.5 },
  MS: { name: 'Mississippi', minLat: 30.1, maxLat: 35.1, minLng: -91.7, maxLng: -88.1 },
  MO: { name: 'Missouri', minLat: 35.9, maxLat: 40.7, minLng: -95.8, maxLng: -89.1 },
  MT: { name: 'Montana', minLat: 44.3, maxLat: 49.1, minLng: -116.1, maxLng: -104.0 },
  NE: { name: 'Nebraska', minLat: 39.9, maxLat: 43.1, minLng: -104.1, maxLng: -95.3 },
  NV: { name: 'Nevada', minLat: 35.0, maxLat: 42.1, minLng: -120.1, maxLng: -114.0 },
  NH: { name: 'New Hampshire', minLat: 42.7, maxLat: 45.4, minLng: -72.6, maxLng: -70.6 },
  NJ: { name: 'New Jersey', minLat: 38.8, maxLat: 41.4, minLng: -75.6, maxLng: -73.9 },
  NM: { name: 'New Mexico', minLat: 31.2, maxLat: 37.1, minLng: -109.1, maxLng: -103.0 },
  NY: { name: 'New York', minLat: 40.4, maxLat: 45.1, minLng: -79.8, maxLng: -71.7 },
  NC: { name: 'North Carolina', minLat: 33.8, maxLat: 36.7, minLng: -84.4, maxLng: -75.4 },
  ND: { name: 'North Dakota', minLat: 45.9, maxLat: 49.1, minLng: -104.1, maxLng: -96.5 },
  OH: { name: 'Ohio', minLat: 38.3, maxLat: 42.4, minLng: -84.9, maxLng: -80.5 },
  OK: { name: 'Oklahoma', minLat: 33.6, maxLat: 37.1, minLng: -103.1, maxLng: -94.4 },
  OR: { name: 'Oregon', minLat: 41.9, maxLat: 46.4, minLng: -124.7, maxLng: -116.4 },
  PA: { name: 'Pennsylvania', minLat: 39.6, maxLat: 42.6, minLng: -80.6, maxLng: -74.7 },
  RI: { name: 'Rhode Island', minLat: 41.1, maxLat: 42.1, minLng: -71.9, maxLng: -71.1 },
  SC: { name: 'South Carolina', minLat: 32.0, maxLat: 35.3, minLng: -83.4, maxLng: -78.5 },
  SD: { name: 'South Dakota', minLat: 42.4, maxLat: 45.9, minLng: -104.1, maxLng: -96.4 },
  TN: { name: 'Tennessee', minLat: 34.9, maxLat: 36.7, minLng: -90.4, maxLng: -81.6 },
  TX: { name: 'Texas', minLat: 25.8, maxLat: 36.6, minLng: -106.7, maxLng: -93.5 },
  UT: { name: 'Utah', minLat: 36.9, maxLat: 42.1, minLng: -114.1, maxLng: -109.0 },
  VT: { name: 'Vermont', minLat: 42.7, maxLat: 45.1, minLng: -73.5, maxLng: -71.5 },
  VA: { name: 'Virginia', minLat: 36.5, maxLat: 39.5, minLng: -83.8, maxLng: -75.2 },
  WA: { name: 'Washington', minLat: 45.5, maxLat: 49.1, minLng: -124.9, maxLng: -116.9 },
  WV: { name: 'West Virginia', minLat: 37.2, maxLat: 40.7, minLng: -82.7, maxLng: -77.7 },
  WI: { name: 'Wisconsin', minLat: 42.4, maxLat: 47.2, minLng: -92.9, maxLng: -86.8 },
  WY: { name: 'Wyoming', minLat: 40.9, maxLat: 45.1, minLng: -111.1, maxLng: -104.0 },
};

function haversineMi(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 3958.8;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function midpoint(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}

function scenicPoint(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  progress: number,
  offsetMi: number
) {
  const t = Math.max(0, Math.min(1, progress));
  const base = { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t };
  if (!offsetMi || t <= 0 || t >= 1) return base;
  const avgLat = ((from.lat + to.lat) / 2) * Math.PI / 180;
  const milesPerLng = Math.max(8, 69 * Math.cos(avgLat));
  const dx = (to.lng - from.lng) * milesPerLng;
  const dy = (to.lat - from.lat) * 69;
  const len = Math.hypot(dx, dy);
  if (!len) return base;
  const bow = Math.sin(Math.PI * t) * offsetMi;
  const perpLngMi = -dy / len * bow;
  const perpLatMi = dx / len * bow;
  return {
    lat: base.lat + perpLatMi / 69,
    lng: base.lng + perpLngMi / milesPerLng,
  };
}

function decodePolyline6(shape: string): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < shape.length) {
    let shift = 0;
    let result = 0;
    let byte = 0;
    do {
      byte = shape.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index <= shape.length);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0;
    result = 0;
    do {
      byte = shape.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index <= shape.length);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    const coord: [number, number] = [lng / 1e6, lat / 1e6];
    if (Number.isFinite(coord[0]) && Number.isFinite(coord[1])) coords.push(coord);
  }
  return coords;
}

function coordsToStops(coords: [number, number][]) {
  return coords.map(([lng, lat]) => ({ lat, lng }));
}

function routeDistanceMi(points: Array<{ lat: number; lng: number }>) {
  let miles = 0;
  for (let i = 1; i < points.length; i++) miles += haversineMi(points[i - 1], points[i]);
  return miles;
}

function pointAtRouteMile(points: Array<{ lat: number; lng: number }>, targetMi: number) {
  if (points.length === 0) return null;
  if (points.length === 1 || targetMi <= 0) return points[0];
  let traveled = 0;
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    const seg = haversineMi(from, to);
    if (traveled + seg >= targetMi) {
      const t = seg > 0 ? (targetMi - traveled) / seg : 0;
      return {
        lat: from.lat + (to.lat - from.lat) * t,
        lng: from.lng + (to.lng - from.lng) * t,
      };
    }
    traveled += seg;
  }
  return points[points.length - 1];
}

function routeWindowPoints(points: Array<{ lat: number; lng: number }>, centerMi: number, radiusMi: number) {
  if (points.length < 2) return points;
  const out: Array<{ lat: number; lng: number }> = [];
  let traveled = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) traveled += haversineMi(points[i - 1], points[i]);
    if (Math.abs(traveled - centerMi) <= radiusMi) out.push(points[i]);
  }
  const center = pointAtRouteMile(points, centerMi);
  if (center) out.push(center);
  return out.length ? out : center ? [center] : points;
}

function routeTargetMile(day: number, count: number, totalMi: number, style: RouteStyleMode) {
  if (count <= 1) return totalMi;
  const equal = totalMi / count;
  const firstCap = style === 'wild' ? 130 : style === 'direct' ? 220 : 180;
  const firstDay = Math.max(45, Math.min(equal, firstCap, totalMi * 0.42));
  if (day <= 1) return firstDay;
  const remainingDays = Math.max(1, count - 1);
  const remainingMi = Math.max(0, totalMi - firstDay);
  return Math.min(totalMi, firstDay + (remainingMi * (day - 1)) / remainingDays);
}

function pointSegmentDistanceMi(point: { lat: number; lng: number }, a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  return pointSegmentProjection(point, a, b).distanceMi;
}

function pointSegmentProjection(point: { lat: number; lng: number }, a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const refLat = ((point.lat + a.lat + b.lat) / 3) * Math.PI / 180;
  const px = point.lng * Math.cos(refLat), py = point.lat;
  const ax = a.lng * Math.cos(refLat), ay = a.lat;
  const bx = b.lng * Math.cos(refLat), by = b.lat;
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0) return { distanceMi: haversineMi(point, a), progress: 0, progressMi: 0 };
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const projected = { lat: ay + t * dy, lng: (ax + t * dx) / Math.cos(refLat) };
  return { distanceMi: haversineMi(point, projected), progress: t, progressMi: haversineMi(a, b) * t };
}

function pointRouteProjection(point: { lat: number; lng: number }, coords: [number, number][]) {
  if (coords.length < 2) return null;
  const points = coordsToStops(coords);
  const total = Math.max(routeDistanceMi(points), 0.0001);
  let cumulative = 0;
  let best: { distanceMi: number; progress: number; progressMi: number; segmentIndex: number } | null = null;
  for (let i = 0; i < points.length - 1; i += 1) {
    const projection = pointSegmentProjection(point, points[i], points[i + 1]);
    const candidate = {
      distanceMi: projection.distanceMi,
      progress: Math.max(0, Math.min(1, (cumulative + projection.progressMi) / total)),
      progressMi: cumulative + projection.progressMi,
      segmentIndex: i,
    };
    if (!best || candidate.distanceMi < best.distanceMi) best = candidate;
    cumulative += haversineMi(points[i], points[i + 1]);
  }
  return best;
}

function routeProgressLabel(progress?: number) {
  if (progress == null || !Number.isFinite(progress)) return '';
  if (progress < 0.34) return 'early leg';
  if (progress < 0.67) return 'mid leg';
  return 'late leg';
}

function smartPlaceToExcursion(place: OsmPoi): ExcursionCandidate {
  const type = (place.type === 'attraction' ? (place.subtype || 'attraction') : place.type) as string;
  return {
    id: place.id,
    name: place.name || place.type,
    type,
    subtype: place.subtype,
    lat: place.lat,
    lng: place.lng,
    source: place.source || 'smart_pack',
    source_label: place.source_label || place.attribution || 'Trailhead',
    summary: (place as any).summary || place.address || '',
    access_notes: (place as any).access_note || '',
    best_for: place.subtype || 'Side trip',
    distance_from_route_mi: place.route_distance_mi ?? (place as any).distance_mi,
    route_progress: place.route_progress,
    route_progress_mi: place.route_progress_mi,
    route_segment_index: place.route_segment_index,
    recommended_day: (place as any).recommended_day,
    source_confidence: (place as any).confidence || 'medium',
    offline_ready: place.source === 'offline',
    length_mi: place.length_mi,
    activities: place.activities,
  };
}

function withLegProjection<T extends { lat: number; lng: number }>(item: T, leg: LegSearchContext) {
  const routeProjection = leg.routeCoords && leg.routeCoords.length >= 2 ? pointRouteProjection(item, leg.routeCoords) : null;
  const projection = routeProjection ?? pointSegmentProjection(item, leg.from, leg.to);
  return {
    ...item,
    route_distance_mi: projection.distanceMi,
    route_progress: projection.progress,
    route_progress_mi: projection.progressMi,
    route_segment_index: routeProjection?.segmentIndex,
    recommended_day: leg.targetDay,
  };
}

function spreadAlongLeg<T extends { route_distance_mi?: number; route_progress?: number }>(items: T[]) {
  const buckets = [0, 1, 2].map(bucket => items
    .filter(item => Math.min(2, Math.floor(((item.route_progress ?? 0) * 3))) === bucket)
    .sort((a, b) => (a.route_distance_mi ?? 999) - (b.route_distance_mi ?? 999)));
  const out: T[] = [];
  const rounds = Math.max(...buckets.map(bucket => bucket.length), 0);
  for (let round = 0; round < rounds; round++) {
    for (const bucket of buckets) {
      const item = bucket[round];
      if (item) out.push(item);
    }
  }
  return out;
}

function overnightEndpointCamps<T extends { lat: number; lng: number; route_distance_mi?: number; route_progress?: number }>(items: T[], leg: LegSearchContext) {
  const withEndpointDistance = items.map(item => ({
    ...item,
    endpoint_distance_mi: haversineMi(item, leg.to),
  }));
  const routeBuffer = routeBufferForMiles(leg.miles) + 8;
  const nearEndpoint = withEndpointDistance
    .filter(item => item.endpoint_distance_mi <= 30 && (item.route_distance_mi ?? 999) <= routeBuffer)
    .sort((a, b) => (a.endpoint_distance_mi - b.endpoint_distance_mi) || ((a.route_distance_mi ?? 999) - (b.route_distance_mi ?? 999)));
  if (nearEndpoint.length) return nearEndpoint;
  const endpointFallback = withEndpointDistance
    .filter(item => item.endpoint_distance_mi <= 45)
    .sort((a, b) => (a.endpoint_distance_mi - b.endpoint_distance_mi) || ((a.route_distance_mi ?? 999) - (b.route_distance_mi ?? 999)));
  if (endpointFallback.length) return endpointFallback;
  return withEndpointDistance.sort((a, b) => {
    const aScore = (a.route_distance_mi ?? 999) + Math.abs(1 - (a.route_progress ?? 0)) * 30 + a.endpoint_distance_mi * 0.45;
    const bScore = (b.route_distance_mi ?? 999) + Math.abs(1 - (b.route_progress ?? 0)) * 30 + b.endpoint_distance_mi * 0.45;
    return aScore - bScore;
  });
}

function fmtMi(mi: number) {
  if (!Number.isFinite(mi)) return '-';
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

function fmtHours(hours: number) {
  if (!Number.isFinite(hours) || hours <= 0) return '-';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h <= 0) return `${m} min`;
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}

function parsePositiveNumber(value?: string | null) {
  const n = Number(String(value ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function estimateMovingHours(mi: number) {
  // Manual builder does not have turn-by-turn route durations yet, so use a
  // conservative overland planning speed rather than interstate speed.
  return mi / 42;
}

function estimateMpg(rig: ReturnType<typeof useStore.getState>['rigProfile']) {
  const realMpg = parsePositiveNumber(rig?.fuel_mpg);
  if (realMpg) return Math.max(6, Math.round(realMpg * 10) / 10);
  const type = (rig?.vehicle_type || '').toLowerCase();
  let mpg = type.includes('rv') ? 10 : type.includes('truck') ? 15 : type.includes('van') ? 17 : type.includes('suv') ? 18 : 20;
  if (rig?.is_towing) mpg *= 0.72;
  if (parsePositiveNumber(rig?.lift_in) || parsePositiveNumber(rig?.tire_size)) mpg *= 0.9;
  return Math.max(8, Math.round(mpg));
}

function stateForPoint(point: { lat: number; lng: number }) {
  return Object.entries(STATE_INFO).find(([, box]) =>
    point.lat >= box.minLat && point.lat <= box.maxLat && point.lng >= box.minLng && point.lng <= box.maxLng
  )?.[0] ?? null;
}

function sampleRouteStates(stops: BuilderStop[], loop: boolean) {
  const out: Record<string, number> = {};
  const sorted = stops;
  for (let i = 1; i < sorted.length; i++) {
    const from = sorted[i - 1];
    const to = sorted[i];
    const miles = haversineMi(from, to);
    const samples = Math.max(1, Math.ceil(miles / 60));
    for (let j = 0; j < samples; j++) {
      const t = (j + 0.5) / samples;
      const point = { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t };
      const state = stateForPoint(point);
      if (state) out[state] = (out[state] ?? 0) + miles / samples;
    }
  }
  if (loop && sorted.length > 2) {
    const from = sorted[sorted.length - 1];
    const to = sorted[0];
    const miles = haversineMi(from, to);
    const samples = Math.max(1, Math.ceil(miles / 60));
    for (let j = 0; j < samples; j++) {
      const t = (j + 0.5) / samples;
      const point = { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t };
      const state = stateForPoint(point);
      if (state) out[state] = (out[state] ?? 0) + miles / samples;
    }
  }
  return out;
}

function estimateShapeMiles(stops: BuilderStop[], shape: TripShapeMode) {
  if (stops.length < 2) return 0;
  let miles = routeDistanceMi(stops);
  const first = stops[0];
  const last = stops[stops.length - 1];
  if ((shape === 'loop' || shape === 'there_and_back') && first && last) {
    miles += haversineMi(last, first);
  }
  if (!miles && first && last) {
    const locations = buildRouteLocationsForShape({
      shape,
      start: first,
      destination: last,
      routeStyle: 'balanced',
    });
    miles = routeDistanceMi(locations);
  }
  return miles;
}

function fuelSourceLabel(estimate: FuelEstimate | null, hasRigMpg: boolean) {
  if (!hasRigMpg) return 'Add MPG in Profile';
  if (!estimate) return 'Using rig profile';
  return estimate.confidence === 'estimated' ? 'Estimated' : 'Using rig profile';
}

function routeBufferForMiles(mi: number) {
  return Math.max(10, Math.min(30, mi * 0.16));
}

function legSamplePoints(leg: LegSearchContext) {
  if (leg.routeCoords && leg.routeCoords.length >= 2) {
    const points = coordsToStops(leg.routeCoords);
    const count = Math.max(3, Math.min(8, Math.ceil(leg.miles / 80) + 1));
    const start = leg.purpose === 'overnight' ? 0.62 : 0;
    return Array.from({ length: count }, (_, idx) => {
      const raw = count === 1 ? 0.5 : idx / (count - 1);
      const t = start + (1 - start) * raw;
      return pointAtRouteMile(points, leg.miles * t) ?? leg.center;
    });
  }
  const count = Math.max(3, Math.min(8, Math.ceil(leg.miles / 80) + 1));
  const start = leg.purpose === 'overnight' ? 0.62 : 0;
  const end = leg.purpose === 'overnight' ? 1 : 1;
  return Array.from({ length: count }, (_, idx) => {
    const raw = count === 1 ? 0.5 : idx / (count - 1);
    const t = start + (end - start) * raw;
    return {
      lat: leg.from.lat + (leg.to.lat - leg.from.lat) * t,
      lng: leg.from.lng + (leg.to.lng - leg.from.lng) * t,
    };
  });
}

function legRouteCoords(leg: LegSearchContext): [number, number][] {
  if (leg.routeCoords && leg.routeCoords.length >= 2) return leg.routeCoords;
  return legSamplePoints(leg).map(point => [point.lng, point.lat] as [number, number]);
}

function coordsLengthMi(coords: [number, number][]) {
  return routeDistanceMi(coordsToStops(coords));
}

function nearestCoordIndex(coords: [number, number][], point: { lat: number; lng: number }) {
  let best = 0;
  let bestMi = Infinity;
  coords.forEach(([lng, lat], idx) => {
    const mi = haversineMi({ lat, lng }, point);
    if (mi < bestMi) {
      bestMi = mi;
      best = idx;
    }
  });
  return { idx: best, distanceMi: bestMi };
}

function sliceRouteCoordsBetween(
  coords: [number, number][] | undefined,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
) {
  if (!coords || coords.length < 2) return [];
  const a = nearestCoordIndex(coords, from);
  const b = nearestCoordIndex(coords, to);
  if (a.distanceMi > 35 || b.distanceMi > 35 || a.idx === b.idx) return [];
  const sliced = a.idx < b.idx ? coords.slice(a.idx, b.idx + 1) : coords.slice(b.idx, a.idx + 1).reverse();
  const first: [number, number] = [from.lng, from.lat];
  const last: [number, number] = [to.lng, to.lat];
  return [first, ...sliced, last].filter((coord, idx, arr) => idx === 0 || coord[0] !== arr[idx - 1][0] || coord[1] !== arr[idx - 1][1]);
}

function uniqueByGeo<T extends { id?: string | number; name?: string; lat: number; lng: number }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = String(item.id || `${item.name}_${item.lat.toFixed(4)}_${item.lng.toFixed(4)}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stopColor(type: string) {
  if (type === 'start') return '#22c55e';
  if (type === 'camp') return '#14b8a6';
  if (type === 'fuel') return '#eab308';
  if (type === 'motel') return '#6366f1';
  return '#f97316';
}

function stopIcon(type: string): keyof typeof Ionicons.glyphMap {
  if (type === 'start') return 'flag-outline';
  if (type === 'camp') return 'bonfire-outline';
  if (type === 'fuel') return 'flash-outline';
  if (type === 'motel') return 'bed-outline';
  return 'navigate-outline';
}

function stopLabel(type: string) {
  if (type === 'start') return 'Start';
  if (type === 'fuel') return 'Fuel';
  if (type === 'camp') return 'Camp';
  if (type === 'motel') return 'Lodging';
  return 'Stop';
}

function placeIcon(type: string): keyof typeof Ionicons.glyphMap {
  const match = PLACE_FILTER_TYPES.find(t => t.id === type);
  return (match?.icon as keyof typeof Ionicons.glyphMap) ?? 'navigate-outline';
}

function placeColor(type: string) {
  return PLACE_FILTER_TYPES.find(t => t.id === type)?.color ?? '#f97316';
}

function builderTypeForPoi(type: string): BuilderStopType {
  if (type === 'fuel' || type === 'propane') return 'fuel';
  if (type === 'lodging') return 'motel';
  return 'waypoint';
}

function dedupePois(points: OsmPoi[]) {
  const seen = new Set<string>();
  return points.filter(point => {
    const key = point.id || `${point.type}_${point.lat.toFixed(5)}_${point.lng.toFixed(5)}_${point.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function poiToGasStation(point: OsmPoi): GasStation {
  return {
    id: point.id,
    name: point.name || (point.type === 'propane' ? 'Propane stop' : 'Fuel stop'),
    lat: point.lat,
    lng: point.lng,
    fuel_types: point.type === 'propane' ? 'Propane' : 'Fuel',
    address: point.subtype || point.type.replace(/_/g, ' '),
    route_distance_mi: point.route_distance_mi,
    route_fit: point.route_fit,
  };
}

function offlinePoiToCamp(point: OsmPoi): CampsitePin {
  const anyPoint = point as any;
  const subtype = normalizeCampSubtype(point.subtype || '');
  const cachedNotes = [
    subtype,
    point.address,
    anyPoint.source_freshness,
    anyPoint.official_url ? 'Official link cached.' : '',
    anyPoint.booking_url ? 'Booking link cached.' : '',
  ].filter(Boolean).join(' ');
  return {
    id: point.id,
    name: point.name || 'Offline camp',
    lat: point.lat,
    lng: point.lng,
    tags: [
      ...(Array.isArray(anyPoint.tags) ? anyPoint.tags : []),
      ...(Array.isArray(anyPoint.site_types) ? anyPoint.site_types : []),
      'downloaded',
    ],
    land_type: anyPoint.source_badge || subtype || 'Downloaded camp',
    description: cachedNotes || 'Downloaded camp point.',
    reservable: Boolean(anyPoint.reservable),
    cost: anyPoint.reservable ? 'Reservable' : undefined,
    url: anyPoint.booking_url || anyPoint.official_url || point.website || '',
    photo_url: anyPoint.photo_url,
    ada: false,
    route_distance_mi: point.route_distance_mi,
    route_fit: point.route_fit,
    recommended_day: anyPoint.recommended_day,
    verified_source: point.source_label || point.source || 'Offline pack',
    amenities: Array.isArray(anyPoint.amenities) ? anyPoint.amenities : undefined,
    site_types: Array.isArray(anyPoint.site_types) ? anyPoint.site_types : undefined,
  } as CampsitePin;
}

function smartPlaceToCamp(point: OsmPoi): CampsitePin {
  const anyPoint = point as any;
  const subtype = normalizeCampSubtype(point.subtype || anyPoint.land_type || '');
  const photoUrl = anyPoint.photo_url || anyPoint.hero_photo_url || anyPoint.primary_image || anyPoint.image_url;
  return {
    id: point.id,
    name: point.name || 'Camp',
    lat: point.lat,
    lng: point.lng,
    tags: Array.isArray(anyPoint.tags) ? anyPoint.tags : ['route intelligence'],
    land_type: anyPoint.source_badge || subtype || 'Camp',
    description: point.description || point.summary || anyPoint.access_note || 'Camp option near this route.',
    reservable: Boolean(anyPoint.reservable),
    cost: anyPoint.cost,
    url: anyPoint.booking_url || anyPoint.official_url || point.website || anyPoint.url || '',
    photo_url: photoUrl,
    photos: anyPoint.photos,
    hero_photo_url: anyPoint.hero_photo_url || photoUrl,
    ada: Boolean(anyPoint.ada),
    route_distance_mi: point.route_distance_mi ?? anyPoint.distance_mi,
    route_fit: point.route_fit,
    route_progress: anyPoint.route_progress,
    route_progress_mi: anyPoint.route_progress_mi,
    recommended_day: anyPoint.recommended_day,
    verified_source: point.source_label || point.source || anyPoint.verified_source || 'Trailhead cache',
    source_badge: anyPoint.source_badge || point.source_label,
    source_freshness: anyPoint.source_freshness,
    amenities: Array.isArray(anyPoint.amenities) ? anyPoint.amenities : undefined,
    site_types: Array.isArray(anyPoint.site_types) ? anyPoint.site_types : undefined,
    cache_status: anyPoint.cache_status,
    rating: anyPoint.rating,
    rating_count: anyPoint.rating_count,
    phone: anyPoint.phone,
    address: anyPoint.address,
    provider_place_id: anyPoint.provider_place_id,
    place_id: anyPoint.place_id,
  } as CampsitePin;
}

function routeIntelligenceCamps(pack: Awaited<ReturnType<typeof api.getRouteIntelligence>> | null | undefined) {
  const explicit = Array.isArray(pack?.camps) ? pack!.camps! : [];
  const fromPlaces = (pack?.places ?? [])
    .filter(point => point.type === 'camp' || point.type === 'camping')
    .map(point => smartPlaceToCamp(point as OsmPoi));
  return uniqueByGeo([...explicit, ...fromPlaces]);
}

function routeIntelligenceFuel(pack: Awaited<ReturnType<typeof api.getRouteIntelligence>> | null | undefined) {
  const explicit = Array.isArray(pack?.fuel) ? pack!.fuel! : [];
  const fromPlaces = (pack?.places ?? [])
    .filter(point => point.type === 'fuel' || point.type === 'propane')
    .map(point => poiToGasStation(point as OsmPoi));
  return uniqueByGeo([...explicit, ...fromPlaces]);
}

function routeIntelligencePois(pack: Awaited<ReturnType<typeof api.getRouteIntelligence>> | null | undefined, excludeTypes: string[] = []) {
  const excluded = new Set(excludeTypes);
  return uniqueByGeo((pack?.places ?? [])
    .filter(point => !excluded.has(point.type))
    .map(point => point as OsmPoi));
}

function normalizeCampSubtype(value: string) {
  const normalized = String(value || '').trim().toLowerCase().replace(/_/g, ' ');
  if (normalized === 'camp site') return 'Tent camp';
  if (normalized === 'caravan site') return 'RV/caravan site';
  if (normalized === 'basic camp') return 'Primitive camp';
  return String(value || '').replace(/_/g, ' ').trim();
}

function campFilterTags(camp: CampsitePin) {
  const raw = [
    camp.name,
    camp.land_type,
    camp.description,
    camp.cost,
    camp.source,
    camp.verified_source,
    (camp as any).source_badge,
    ...(Array.isArray(camp.tags) ? camp.tags : []),
    ...(Array.isArray(camp.site_types) ? camp.site_types : []),
  ].filter(Boolean).join(' ').toLowerCase();
  const tags = new Set<string>();
  if (camp.reservable || raw.includes('reserv') || raw.includes('recreation.gov')) tags.add('reservable');
  if (raw.includes('rv') || raw.includes('hookup') || raw.includes('caravan')) tags.add('rv');
  if (raw.includes('tent')) tags.add('tent');
  if (raw.includes('dispersed') || raw.includes('primitive') || raw.includes('boondock')) tags.add('dispersed');
  if (raw.includes('free')) tags.add('free');
  if (raw.includes('ada') || raw.includes('accessible')) tags.add('ada');
  if (raw.includes('blm') || raw.includes('bureau of land management')) tags.add('blm');
  if (raw.includes('usfs') || raw.includes('forest service') || raw.includes('national forest')) tags.add('usfs');
  if (raw.includes('nps') || raw.includes('national park')) tags.add('nps');
  if (raw.includes('state park')) tags.add('state');
  if (raw.includes('corps')) tags.add('corps');
  if (raw.includes('private')) tags.add('private');
  if (raw.includes('farm')) tags.add('farm');
  if (raw.includes('ranch')) tags.add('ranch');
  if (raw.includes('winery') || raw.includes('vineyard')) tags.add('winery');
  if (raw.includes('glamping') || raw.includes('yurt') || raw.includes('cabin')) tags.add('glamping');
  return tags;
}

function campMatchesFilters(camp: CampsitePin, filters: string[]) {
  if (!filters.length) return true;
  const tags = campFilterTags(camp);
  return filters.some(filter => tags.has(filter));
}

function routeScopedOfflinePlaces(points: OsmPoi[], leg: LegSearchContext, types: string[], extraBuffer = 8) {
  const allowed = new Set(types);
  return dedupePois(points
    .filter(point => allowed.has(point.type))
    .map(point => withLegProjection(point, leg))
    .filter(point => (point.route_distance_mi ?? 999) <= routeBufferForMiles(leg.miles) + extraBuffer)
  );
}

function areaScopedOfflinePlaces(points: OsmPoi[], center: { lat: number; lng: number }, types: string[], radiusMi: number) {
  const allowed = new Set(types);
  return dedupePois(points
    .filter(point => allowed.has(point.type))
    .map(point => ({ ...point, route_distance_mi: haversineMi(point, center) }))
    .filter(point => (point.route_distance_mi ?? 999) <= radiusMi)
    .sort((a, b) => (a.route_distance_mi ?? 999) - (b.route_distance_mi ?? 999))
  );
}

function stopTypeFromWaypoint(type?: string): BuilderStopType {
  const t = (type || '').toLowerCase();
  if (t === 'start') return 'start';
  if (t.includes('fuel') || t.includes('gas')) return 'fuel';
  if (t.includes('camp')) return 'camp';
  if (t.includes('motel') || t.includes('hotel') || t.includes('lodg')) return 'motel';
  return 'waypoint';
}

function closeEnough(a: { lat?: number; lng?: number }, b: { lat?: number; lng?: number }) {
  if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng) || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return false;
  return Math.abs((a.lat ?? 0) - (b.lat ?? 0)) < 0.0008 && Math.abs((a.lng ?? 0) - (b.lng ?? 0)) < 0.0008;
}

function campsiteToPin(camp: Campsite): CampsitePin {
  return {
    id: camp.id,
    name: camp.name,
    lat: camp.lat,
    lng: camp.lng,
    tags: [],
    land_type: 'camp',
    description: camp.description || 'Trip camp.',
    reservable: camp.reservable,
    cost: undefined,
    url: camp.url,
    ada: false,
    route_distance_mi: camp.route_distance_mi,
    route_fit: camp.route_fit,
    recommended_day: camp.recommended_day,
    verified_source: camp.verified_source,
  };
}

function campMediaUrl(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') return String((value as { url?: unknown; uri?: unknown }).url || (value as { uri?: unknown }).uri || '').trim();
  return '';
}

function isGeneratedCampPlaceholder(url: string) {
  const value = url.toLowerCase();
  return !value || /placeholder|generated|trailhead-placeholder|\/api\/camps\/placeholder/.test(value);
}

function campHasPhotos(camp: Partial<CampsitePin> & Record<string, any>) {
  if (camp.photo_status === 'official' || Number(camp.site_media_count) > 0) return true;
  const candidates = [
    camp.photo_url,
    camp.hero_photo_url,
    camp.primary_image,
    camp.image_url,
    ...(Array.isArray(camp.photos) ? camp.photos : []),
    ...(Array.isArray(camp.photo_candidates) ? camp.photo_candidates : []),
    ...(Array.isArray(camp.images) ? camp.images : []),
    ...(Array.isArray(camp.other_images) ? camp.other_images : []),
  ].map(campMediaUrl).filter(Boolean);
  if (candidates.some(url => !isGeneratedCampPlaceholder(url))) return true;
  const fallbackChain = Array.isArray(camp.photo_fallback_chain) ? camp.photo_fallback_chain.join(' ').toLowerCase() : '';
  return Boolean(candidates.length && fallbackChain && !/generated|placeholder/.test(fallbackChain));
}

function filterCampsByPhotoMode<T extends CampsitePin>(camps: T[], photoOnly: boolean) {
  return photoOnly ? camps.filter(campHasPhotos) : camps;
}

function sourceLabel(source?: BuilderStop['source']) {
  if (source === 'camp') return 'verified camp';
  if (source === 'gas') return 'fuel search';
  if (source === 'poi') return 'places search';
  if (source === 'search') return 'search';
  if (source === 'map') return 'map tap';
  return 'manual';
}

function routeCoverPhotoFromValue(value: unknown) {
  const url = campMediaUrl(value);
  return url && !isGeneratedCampPlaceholder(url) ? mediaUrl(url) : '';
}

function firstRouteCoverPhoto(items: unknown[]) {
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, any>;
    const direct = [
      entry.hero_photo_url,
      entry.photo_url,
      entry.primary_image,
      entry.image_url,
      entry.thumbnail_url,
      entry.cover_url,
    ].map(routeCoverPhotoFromValue).find(Boolean);
    if (direct) return direct;
    for (const key of ['photos', 'photo_candidates', 'images', 'media']) {
      const values = Array.isArray(entry[key]) ? entry[key] : [];
      const nested = values.map(routeCoverPhotoFromValue).find(Boolean);
      if (nested) return nested;
    }
  }
  return '';
}

function fallbackRouteCover(route: TripHistoryItem, trip?: TripResult | null) {
  const finalWaypoint = trip?.plan?.waypoints?.[trip.plan.waypoints.length - 1];
  const text = [
    route.trip_name,
    ...(route.states ?? []),
    trip?.plan?.trip_name,
    ...(trip?.plan?.states ?? []),
    finalWaypoint?.name,
  ].filter(Boolean).join(' ');
  return ROUTE_COVER_FALLBACKS.find(item => item.match.test(text))?.url || ROUTE_HERO_PHOTO;
}

function nearestCatalogRouteCover(trip: TripResult | null | undefined, places: OsmPoi[]) {
  const finalWaypoint = trip?.plan?.waypoints?.[trip.plan.waypoints.length - 1];
  if (!finalWaypoint || !Number.isFinite(finalWaypoint.lat) || !Number.isFinite(finalWaypoint.lng)) return '';
  const target = { lat: finalWaypoint.lat!, lng: finalWaypoint.lng! };
  const candidates = places.map(place => {
    const entry = place as Record<string, any>;
    const url = [
      entry.hero_photo_url,
      entry.photo_url,
      entry.primary_image,
      entry.image_url,
      entry.thumbnail_url,
    ].map(routeCoverPhotoFromValue).find(Boolean);
    if (!url || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return null;
    const sourceText = `${entry.source_label ?? ''} ${entry.source_badge ?? ''} ${entry.source ?? ''} ${entry.name ?? ''}`;
    const npsPriority = /nps|national park|national monument|national preserve|national seashore/i.test(sourceText) ? 0 : 1;
    return { url, miles: haversineMi(target, place), npsPriority };
  }).filter((item): item is { url: string; miles: number; npsPriority: number } => !!item && item.miles <= 160);
  candidates.sort((a, b) => a.npsPriority - b.npsPriority || a.miles - b.miles);
  return candidates[0]?.url || '';
}

function tripCardData(route: TripHistoryItem, trip?: TripResult | null, catalogPlaces: OsmPoi[] = []): RouteTripCardData {
  const waypoints = trip?.plan?.waypoints ?? [];
  const pois = trip?.route_pois ?? [];
  const coverUrl = firstRouteCoverPhoto([...(trip?.campsites ?? []), ...pois, ...(waypoints as unknown[])])
    || nearestCatalogRouteCover(trip, catalogPlaces)
    || fallbackRouteCover(route, trip);
  const days = trip?.plan?.duration_days || route.duration_days || 0;
  const miles = Math.round(trip?.plan?.total_est_miles || route.est_miles || 0);
  const camps = Math.max(
    trip?.campsites?.length ?? 0,
    waypoints.filter(wp => /camp|overnight/i.test(wp.type || '')).length,
  );
  const trails = pois.filter(poi => /trail|trailhead|climb/i.test(`${poi.type} ${poi.subtype ?? ''}`)).length;
  const gas = Math.max(
    trip?.gas_stations?.length ?? 0,
    waypoints.filter(wp => /fuel|gas/i.test(wp.type || '')).length,
  );
  const poi = Math.max(0, pois.length - trails);
  const stateCount = (trip?.plan?.states?.length || route.states?.length || 0);
  const parts = [
    days ? `${days} day${days === 1 ? '' : 's'}` : '',
    miles ? `${miles.toLocaleString()} mi` : '',
    camps ? `${camps} camp${camps === 1 ? '' : 's'}` : '',
    trails ? `${trails} trail${trails === 1 ? '' : 's'}` : '',
    gas ? `${gas} gas` : '',
    poi ? `${poi} place${poi === 1 ? '' : 's'}` : '',
    stateCount ? `${stateCount} state${stateCount === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return { coverUrl, stats: parts.join('  •  ') };
}

function isFrameworkTarget(stop: BuilderStop) {
  return stop.source === 'map' && stop.type === 'waypoint' && /(target area|camp search area|overnight area|review area)/i.test(stop.name);
}

function isFrameworkManagedStop(stop: BuilderStop) {
  return isFrameworkTarget(stop) || /Picked for|Auto-picked by Trailhead/i.test(stop.description);
}

function stopRouteOrderWeight(stop: BuilderStop) {
  if (stop.routeShapeRole === 'start') return 0;
  if (stop.type === 'start') return 2;
  if (stop.routeShapeRole === 'destination') return 60;
  if (stop.routeShapeRole === 'outbound_anchor') return 65;
  if (stop.routeShapeRole === 'overnight') return 80;
  if (stop.routeShapeRole === 'return_anchor') return 100;
  return 50;
}

function orderBuilderStops(stops: BuilderStop[]) {
  return [...stops].sort((a, b) => (
    a.day - b.day
    || stopRouteOrderWeight(a) - stopRouteOrderWeight(b)
    || stops.indexOf(a) - stops.indexOf(b)
  ));
}

function builderStopFromCopilotDraft(stop: string | TrailheadRouteBuilderDraftStop, index: number, dayCount: number): BuilderStop | null {
  if (typeof stop === 'string') return null;
  const lat = Number(stop.lat);
  const lng = Number(stop.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !stop.name?.trim()) return null;
  const rawType = String(stop.type || '').toLowerCase();
  const routePointType = stop.routePointType === 'side_stop' || stop.routePointType === 'through' || stop.routePointType === 'break'
    ? stop.routePointType
    : undefined;
  const routeShapeRole = stop.routeShapeRole === 'start'
    || stop.routeShapeRole === 'destination'
    || stop.routeShapeRole === 'outbound_anchor'
    || stop.routeShapeRole === 'return_anchor'
    || stop.routeShapeRole === 'overnight'
    || stop.routeShapeRole === 'side_stop'
    ? stop.routeShapeRole
    : undefined;
  const type: BuilderStopType = rawType === 'start'
    ? 'start'
    : rawType === 'camp' || rawType === 'motel'
      ? rawType
      : rawType === 'fuel'
        ? 'fuel'
        : 'waypoint';
  const day = type === 'start'
    ? 1
    : rawType === 'destination'
      ? Math.max(1, dayCount)
      : Math.max(1, Math.min(dayCount, Math.round(Number(stop.day) || index + 1)));
  return {
    id: stop.id || `copilot_${Date.now()}_${index}`,
    day,
    name: stop.name.trim(),
    lat,
    lng,
    type,
    description: stop.description || (type === 'camp' ? 'Scout-picked overnight option. Verify access, rules, and fit before you head out.' : 'Scout-added route stop. Review it before you lock the trip.'),
    land_type: stop.label || '',
    source: stop.source === 'camp' || stop.source === 'gas' || stop.source === 'poi' || stop.source === 'search' || stop.source === 'map'
      ? stop.source
      : type === 'camp' || type === 'motel'
        ? 'camp'
        : 'map',
    routePointType: routePointType ?? (type === 'fuel' ? 'side_stop' : 'break'),
    routeShapeRole: routeShapeRole ?? (type === 'start'
      ? 'start'
      : rawType === 'destination'
        ? 'destination'
        : type === 'camp' || type === 'motel'
          ? 'overnight'
          : undefined),
  };
}

function landColor(lt?: string | null) {
  if (!lt) return { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' };
  const l = lt.toLowerCase();
  if (l.includes('national forest') || l.includes('usfs') || l.includes('forest service') || l.includes('ranger'))
    return { bg: '#dcfce7', text: '#15803d', border: '#86efac' };
  if (l.includes('national park') || l.includes('nps') || l.includes('national monument') || l.includes('national recreation'))
    return { bg: '#dbeafe', text: '#1d4ed8', border: '#93c5fd' };
  if (l.includes('blm') || l.includes('bureau of land'))
    return { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' };
  if (l.includes('state park') || l.includes('state forest') || l.includes('state beach'))
    return { bg: '#ede9fe', text: '#6d28d9', border: '#c4b5fd' };
  if (l.includes('koa') || l.includes('resort') || l.includes('rv park') || l.includes('private'))
    return { bg: '#f1f5f9', text: '#475569', border: '#94a3b8' };
  return { bg: '#ecfdf5', text: '#065f46', border: '#6ee7b7' };
}

function tagEmoji(tag: string): string {
  const t = tag.toLowerCase();
  if (t === 'rv' || t === 'hookups') return 'RV';
  if (t === 'tent') return 'TENT';
  if (t === 'dispersed') return 'WILD';
  if (t === 'water') return 'H2O';
  if (t === 'showers') return 'SHWR';
  if (t === 'ada') return 'ADA';
  if (t === 'dogs' || t === 'dog friendly') return 'PET';
  if (t === 'free') return 'FREE';
  if (t === 'reservable') return 'RSV';
  if (t === 'usfs') return 'USFS';
  if (t === 'blm') return 'BLM';
  if (t === 'nps') return 'NPS';
  return '';
}

function stripHtml(text?: string | null) {
  if (!text) return '';
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function amenityIcon(name: string): keyof typeof Ionicons.glyphMap {
  const n = name.toLowerCase();
  if (n.includes('water')) return 'water-outline';
  if (n.includes('shower')) return 'rainy-outline';
  if (n.includes('toilet') || n.includes('restroom')) return 'male-female-outline';
  if (n.includes('electric') || n.includes('hookup')) return 'flash-outline';
  if (n.includes('dump') || n.includes('trash')) return 'trash-outline';
  if (n.includes('fire')) return 'flame-outline';
  if (n.includes('picnic')) return 'restaurant-outline';
  if (n.includes('wifi') || n.includes('internet')) return 'wifi-outline';
  if (n.includes('rv')) return 'car-outline';
  if (n.includes('pet') || n.includes('dog')) return 'paw-outline';
  return 'checkmark-circle-outline';
}

function isRouteBuilderCategoryQuery(query: string) {
  const q = query.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!q) return false;
  return /\b(camp|campground|campsite|rv|dispersed|fuel|gas|diesel|propane|trail|trailhead|hike|hiking|lodging|motel|hotel|water|dump|grocery|groceries|food|restaurant|mechanic|parking|viewpoint|attraction|overlook|arches|service|services)\b/.test(q);
}

function isRouteBuilderServiceQuery(query: string) {
  const q = query.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return /\b(fuel|gas|diesel|propane|charging|lodging|motel|hotel|water|dump|grocery|groceries|food|restaurant|mechanic|parking|service|services)\b/.test(q);
}

function hasTrailheadCatalogResult(query: string, places: GeocodePlace[]) {
  if (isRouteBuilderServiceQuery(query)) return false;
  return places.some(place => String(place.source || '').startsWith('trailhead'));
}

async function geocodePlaces(query: string): Promise<SearchPlace[]> {
  const coord = query.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (coord && coord.length >= 2 && Math.abs(coord[0]) <= 90 && Math.abs(coord[1]) <= 180) {
    return [{ name: `${coord[0].toFixed(5)}, ${coord[1].toFixed(5)}`, lat: coord[0], lng: coord[1] }];
  }
  const catalogFirst = isRouteBuilderCategoryQuery(query);
  const serverPlaces = await api.geocodePlaces(query, 8, catalogFirst ? {} : { prefer: 'locality' }).catch(() => [] as GeocodePlace[]);
  if (!catalogFirst && serverPlaces.length) return serverPlaces;
  if (catalogFirst && hasTrailheadCatalogResult(query, serverPlaces)) return serverPlaces;
  const mapContextPlaces = await api.mapContextResolve({
    q: query,
    limit: 8,
    types: 'poi,place,address',
    language: 'en',
    metadata: { surface: 'route_builder', source: 'route_builder_geocode' },
  }).then(res => res.places ?? []).catch(() => []);
  if (mapContextPlaces.length) {
    return mapContextPlaces.map(place => ({
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      source: place.source || 'search',
      source_label: place.source_label,
      feature_type: place.feature_type,
      place_types: place.place_types,
      category: place.category,
      type: place.type,
      subtype: place.subtype,
      address: place.address,
    }));
  }
  if (serverPlaces.length) return serverPlaces;
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=8&q=${encodeURIComponent(query)}`,
    { headers: { 'User-Agent': 'TrailheadRouteBuilder/1.0' } }
  );
  const data = await res.json();
  return (data ?? []).map((p: any) => ({
    name: p.display_name?.split(',').slice(0, 3).join(',') ?? query,
    lat: Number(p.lat),
    lng: Number(p.lon),
  })).filter((p: SearchPlace) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

async function searchMapContextNearby(query: string, center: { lat: number; lng: number }, radiusMi = 25, type: OsmPoi['type'] = 'poi', limit = 8): Promise<OsmPoi[]> {
  const latDelta = radiusMi / 69;
  const lngDelta = radiusMi / Math.max(8, 69 * Math.cos(center.lat * Math.PI / 180));
  const bbox = `${(center.lng - lngDelta).toFixed(6)},${(center.lat - latDelta).toFixed(6)},${(center.lng + lngDelta).toFixed(6)},${(center.lat + latDelta).toFixed(6)}`;
  const category = type === 'fuel'
    ? 'fuel'
    : type === 'lodging'
      ? 'lodging'
      : type === 'viewpoint'
        ? 'viewpoint'
        : type === 'trailhead' || type === 'trail'
          ? 'trailhead'
          : type === 'grocery'
            ? 'grocery'
            : type === 'water'
              ? 'water'
              : 'attraction';
  const data = await api.mapContextSearch({
    q: query,
    category,
    center,
    proximity: `${center.lng},${center.lat}`,
    bbox,
    limit,
    language: 'en',
    metadata: { surface: 'route_builder', source: 'route_builder_nearby', type },
  }).catch(() => ({ places: [] }));
  return (data.places ?? []).map((place: any) => ({
    id: String(place.id || place.mapbox_id || `mapbox_${place.lat}_${place.lng}`),
    name: String(place.name || query),
    lat: Number(place.lat),
    lng: Number(place.lng),
    type,
    subtype: String(place.subtype || place.feature_type || category),
    source: 'mapbox_search',
    source_label: 'Mapbox Search',
    provider_place_id: place.provider_place_id || place.mapbox_id,
    place_id: place.place_id || place.mapbox_id,
    address: place.address,
    phone: place.phone,
    website: place.website,
    rating: place.rating,
    rating_count: place.rating_count,
    average_rating: place.average_rating,
    review_count: place.review_count,
    attribution: 'Mapbox',
    mapbox_id: place.mapbox_id,
    mapbox_categories: place.mapbox_categories || place.categories,
    distance_mi: place.distance_mi,
    distance_meters: place.distance_meters,
    enrichment_source: 'mapbox_searchbox_rest',
    enrichment_status: 'enriched',
  })).filter((p: OsmPoi) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

async function searchNominatimNearby(query: string, center: { lat: number; lng: number }, radiusMi = 25, type: OsmPoi['type'] = 'poi', limit = 8): Promise<OsmPoi[]> {
  const latDelta = radiusMi / 69;
  const lngDelta = radiusMi / Math.max(8, 69 * Math.cos(center.lat * Math.PI / 180));
  const west = center.lng - lngDelta;
  const east = center.lng + lngDelta;
  const south = center.lat - latDelta;
  const north = center.lat + latDelta;
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=${limit}&bounded=1&viewbox=${west},${north},${east},${south}&q=${encodeURIComponent(query)}`,
    { headers: { 'User-Agent': 'TrailheadRouteBuilder/1.0' } }
  );
  const data = await res.json();
  return (data ?? []).map((p: any) => ({
    id: `${type}_${p.osm_type ?? 'n'}_${p.osm_id ?? `${p.lat}_${p.lon}`}`,
    name: p.name || p.display_name?.split(',').slice(0, 2).join(',') || query,
    lat: Number(p.lat),
    lng: Number(p.lon),
    type,
    subtype: p.type || p.class,
  })).filter((p: OsmPoi) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

export default function RouteBuilderScreen() {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const bottomInset = Math.max(insets.bottom, Platform.OS === 'android' ? 0 : 0);
  const bottomSheetPad = Math.max(insets.bottom, Platform.OS === 'android' ? 16 : 18);
  const blurTint: 'dark' | 'light' = C.bg === '#050505' ? 'dark' : 'light';
  const wizardFade = useRef(new Animated.Value(1)).current;
  const wizardSlide = useRef(new Animated.Value(0)).current;
  const router = useRouter();
  const activeTrip = useStore(st => st.activeTrip);
  const setActiveTrip = useStore(st => st.setActiveTrip);
  const user = useStore(st => st.user);
  const addTripToHistory = useStore(st => st.addTripToHistory);
  const tripHistory = useStore(st => st.tripHistory);
  const setTabBarHidden = useStore(st => st.setTabBarHidden);
  const userLoc = useStore(st => st.userLoc);
  const setStoreUserLoc = useStore(st => st.setUserLoc);
  const rigProfile = useStore(st => st.rigProfile);
  const weatherUnitMode = useStore(st => st.weatherUnitMode);
  const sessionId = useStore(st => st.sessionId);
  const setPendingSavedTrailId = useStore(st => st.setPendingSavedTrailId);
  const {
    getState: getOfflineMapState,
    getRoutingState: getOfflineRoutingState,
    getContourState: getOfflineContourState,
    getTrailState: getOfflineTrailState,
  } = useOfflineFiles();

  const [activeDay, setActiveDay] = useState(1);
  const [routeTabMode, setRouteTabMode] = useState<RouteTabMode>('hub');
  const [buildingVideoReady, setBuildingVideoReady] = useState(false);
  const [buildingVideoSource, setBuildingVideoSource] = useState<any>(ROUTE_BUILDER_LOAD_VIDEO);
  const [savedTrails, setSavedTrails] = useState<OfflineTrail[]>([]);
  const [routeTripCards, setRouteTripCards] = useState<Record<string, RouteTripCardData>>({});
  const [days, setDays] = useState([1]);
  const [stops, setStops] = useState<BuilderStop[]>([]);
  const [tripShapeMode, setTripShapeMode] = useState<TripShapeMode>('one_way');
  const [driveHoursPerDay, setDriveHoursPerDay] = useState('5');
  const [plannedDays, setPlannedDays] = useState('3');
  const [routeStyle, setRouteStyle] = useState<RouteStyleMode>('balanced');
  const [tripBuildMode, setTripBuildMode] = useState<TripBuildMode>('recommended');
  const [distanceMode, setDistanceMode] = useState<DistanceMode>('hours');
  const [campPreferenceMode, setCampPreferenceMode] = useState<CampPreferenceMode>('public');
  const [campPhotoOnly, setCampPhotoOnly] = useState(false);
  const [campCadenceMode, setCampCadenceMode] = useState<CampCadenceMode>('nightly');
  const [campReusePolicy, setCampReusePolicy] = useState<CampReusePolicy>('different_each_night');
  const [welcomeSetupPreferences, setWelcomeSetupPreferences] = useState<WelcomeSetupPreferences | null>(null);
  const [welcomeDefaultsApplied, setWelcomeDefaultsApplied] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [targetMiles, setTargetMiles] = useState('180');
  const [startQuery, setStartQuery] = useState('');
  const [endQuery, setEndQuery] = useState('');
  const [buildingFramework, setBuildingFramework] = useState(false);
  const [routeSaving, setRouteSaving] = useState(false);
  const [frameworkStatus, setFrameworkStatus] = useState('');
  const [copilotAutoBuildRunId, setCopilotAutoBuildRunId] = useState(0);
  const [restDays, setRestDays] = useState<number[]>([]);
  const [dayDriveTargets, setDayDriveTargets] = useState<Record<number, string>>({});
  const [rentalOffers, setRentalOffers] = useState<OutdoorOffer[]>([]);
  const [rentalOffersLoading, setRentalOffersLoading] = useState(false);
  const [rentalDismissedAt, setRentalDismissedAt] = useState(0);
  const [rentalIdeaSaved, setRentalIdeaSaved] = useState(false);
  const gasPrice = '3.65';

  useEffect(() => {
    if (!buildingFramework) {
      setBuildingVideoReady(false);
      deactivateKeepAwake('route-builder-build').catch(() => {});
      return;
    }
    let cancelled = false;
    setBuildingVideoReady(false);
    activateKeepAwakeAsync('route-builder-build').catch(() => {});
    const asset = Asset.fromModule(ROUTE_BUILDER_LOAD_VIDEO);
    const immediateUri = asset.localUri || asset.uri;
    setBuildingVideoSource(immediateUri ? { uri: immediateUri } : ROUTE_BUILDER_LOAD_VIDEO);
    asset.downloadAsync()
      .then(downloaded => {
        if (cancelled) return;
        const uri = downloaded.localUri || downloaded.uri || asset.localUri || asset.uri;
        setBuildingVideoSource(uri ? { uri } : ROUTE_BUILDER_LOAD_VIDEO);
      })
      .catch(() => {
        if (!cancelled) setBuildingVideoSource(ROUTE_BUILDER_LOAD_VIDEO);
      });
    return () => {
      cancelled = true;
      deactivateKeepAwake('route-builder-build').catch(() => {});
    };
  }, [buildingFramework]);
  const [fuelEstimate, setFuelEstimate] = useState<FuelEstimate | null>(null);
  const [routeGeometry, setRouteGeometry] = useState<ProviderRouteGeometry | null>(null);
  const [importedTripId, setImportedTripId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [routeName, setRouteName] = useState('');
  const [routeActionSheet, setRouteActionSheet] = useState<'actions' | 'rename' | null>(null);
  const [routeNameDraft, setRouteNameDraft] = useState('');
  const [searchResults, setSearchResults] = useState<SearchPlace[]>([]);
  const [pendingType, setPendingType] = useState<BuilderStopType>('start');
  const [insertAfterId, setInsertAfterId] = useState<string | null>(null);
  const [insertTargetDay, setInsertTargetDay] = useState<number | null>(null);
  const [replaceStopId, setReplaceStopId] = useState<string | null>(null);
  const {
    discoverTab,
    setDiscoverTab,
    discoverLoading,
    setDiscoverLoading,
    activeDiscoveryKey,
    setActiveDiscoveryKey,
    activeDiscovery,
    inlineSearch,
    setInlineSearch,
    discoveryKeyFor,
    storeDiscoveryResults,
    clearDiscoveryResults,
    resetDiscoveryResults,
  } = useRouteBuilderDiscoveryState({ activeDay, insertTargetDay });
  const [offlinePlaces, setOfflinePlaces] = useState<OsmPoi[]>([]);
  const [activePlaceFilters, setActivePlaceFilters] = useState<string[]>(DEFAULT_PLACE_FILTERS);
  const [showPlaceFilters, setShowPlaceFilters] = useState(false);
  const [selectedRoutePlace, setSelectedRoutePlace] = useState<RoutePlaceSelection | null>(null);
  const [selectedCamp, setSelectedCamp] = useState<CampsitePin | null>(null);
  const selectedCampRef = useRef<CampsitePin | null>(null);
  const [campDetail, setCampDetail] = useState<CampsiteDetail | null>(null);
  const [campWeather, setCampWeather] = useState<WeatherForecast | null>(null);
  const [campFullness, setCampFullness] = useState<CampFullness | null>(null);
  const [campInsight, setCampInsight] = useState<CampsiteInsight | null>(null);
  const [showCampDetail, setShowCampDetail] = useState(false);
  const [campGalleryIndex, setCampGalleryIndex] = useState<number | null>(null);
  const [quickCampPhotoIndex, setQuickCampPhotoIndex] = useState(0);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showNewRouteConfirm, setShowNewRouteConfirm] = useState(false);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [paywallCode, setPaywallCode] = useState('camp_detail');
  const [paywallMessage, setPaywallMessage] = useState('Use credits to open full campsite profiles. You can still add this camp to your route from the free preview.');
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const tripLoop = tripShapeMode !== 'one_way';
  const effectiveCampReusePolicy: CampReusePolicy = tripShapeMode === 'there_and_back' ? 'same_camp_window' : campReusePolicy;
  const tripPreferenceContext = useMemo(
    () => tripPreferenceContextFromWelcomePreferences(welcomeSetupPreferences),
    [welcomeSetupPreferences],
  );
  const fmtRouteDistance = (mi: number) => fmtUnitDistance(mi, weatherUnitMode);
  const builderIntentFor = (inputDays: number[] = days): RouteBuilderIntent => ({
    shape: tripShapeMode,
    routeStyle,
    campReusePolicy: effectiveCampReusePolicy,
    days: inputDays,
    maxDriveHoursPerDay: parsePositiveNumber(driveHoursPerDay),
    targetMilesPerDay: parsePositiveNumber(targetMiles),
  });

  function applyTripShapeMode(mode: TripShapeMode) {
    setTripShapeMode(mode);
    if (mode === 'there_and_back') {
      setCampReusePolicy('same_camp_window');
    }
  }

  useEffect(() => {
    let mounted = true;
    loadWelcomeSetupPreferences()
      .then(preferences => { if (mounted) setWelcomeSetupPreferences(preferences); })
      .catch(() => { if (mounted) setWelcomeSetupPreferences(null); });
    return () => { mounted = false; };
  }, [user?.id]);

  useEffect(() => {
    if (!tripPreferenceContext || welcomeDefaultsApplied || stops.length > 0 || importedTripId) return;
    setRouteStyle(tripPreferenceContext.route_builder.route_style);
    setCampPreferenceMode(tripPreferenceContext.route_builder.camp_preference);
    setCampReusePolicy(tripPreferenceContext.route_builder.camp_reuse_policy);
    if (tripPreferenceContext.route_builder.place_filters.length) {
      setActivePlaceFilters(current => Array.from(new Set([...current, ...tripPreferenceContext.route_builder.place_filters])));
    }
    setWelcomeDefaultsApplied(true);
  }, [importedTripId, stops.length, tripPreferenceContext, welcomeDefaultsApplied]);

  function applyCopilotDraft(draft: TrailheadRouteBuilderDraft) {
    const dayCount = draft.days ? Math.max(1, Math.min(30, Math.round(draft.days))) : days.length || 1;
    if (draft.days) {
      setPlannedDays(String(dayCount));
      setDays(Array.from({ length: dayCount }, (_, idx) => idx + 1));
    }
    if (draft.start) setStartQuery(draft.start);
    if (draft.destination) setEndQuery(draft.destination);
    if (draft.tripShape) applyTripShapeMode(draft.tripShape);
    if (draft.routeStyle) setRouteStyle(draft.routeStyle);
    if (draft.campPreference) setCampPreferenceMode(draft.campPreference);
    setCampPhotoOnly(draft.campPhotoOnly === true);
    if (draft.campReuse) setCampReusePolicy(draft.campReuse);
    if (draft.driveHours) {
      setDistanceMode('hours');
      setDriveHoursPerDay(String(draft.driveHours));
    }
    if (draft.targetMiles) {
      setDistanceMode('miles');
      setTargetMiles(String(draft.targetMiles));
    }
    if (draft.restDays?.length) setRestDays(draft.restDays);
    const draftStops = Array.isArray(draft.stops)
      ? draft.stops.map((stop, idx) => builderStopFromCopilotDraft(stop, idx, dayCount)).filter((stop): stop is BuilderStop => !!stop)
      : [];
    if (draftStops.length >= 2) {
      setStops(orderBuilderStops(draftStops));
      setActiveDay(Math.max(1, draftStops.find(stop => stop.type !== 'start')?.day ?? 1));
      setInsertAfterId(null);
      setInsertTargetDay(null);
    }
    setTripBuildMode('recommended');
    setRouteTabMode('wizard');
    setWizardStep(draft.start && draft.destination ? 3 : draft.destination ? 1 : 0);
    if (draft.autoBuild) setCopilotAutoBuildRunId(Date.now());
  }

  useEffect(() => {
    selectedCampRef.current = selectedCamp;
    setQuickCampPhotoIndex(0);
  }, [selectedCamp]);

  useEffect(() => {
    wizardFade.setValue(0);
    wizardSlide.setValue(10);
    Animated.parallel([
      Animated.timing(wizardFade, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(wizardSlide, { toValue: 0, tension: 82, friction: 12, useNativeDriver: true }),
    ]).start();
  }, [wizardFade, wizardSlide, wizardStep]);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardVisible(true);
      setTabBarHidden(true);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
      setTabBarHidden(routeTabMode !== 'hub');
    });
    return () => {
      showSub.remove();
      hideSub.remove();
      setTabBarHidden(false);
    };
  }, [routeTabMode, setTabBarHidden]);

  useEffect(() => {
    setTabBarHidden(routeTabMode !== 'hub' || keyboardVisible);
    return () => setTabBarHidden(false);
  }, [keyboardVisible, routeTabMode, setTabBarHidden]);

  useEffect(() => {
    let cancelled = false;
    loadTrailheadRouteBuilderDraft().then(draft => {
      if (cancelled || !draft) return;
      applyCopilotDraft(draft);
      clearTrailheadRouteBuilderDraft().catch(() => {});
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let mounted = true;
    storage.get(ROUTE_BUILDER_RENTAL_DISMISSED_KEY).then(raw => {
      if (!mounted) return;
      const ts = Number(raw || 0);
      if (Number.isFinite(ts) && ts > 0) setRentalDismissedAt(ts);
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    loadAllPlacePoints()
      .then(points => {
        if (!mounted) return;
        setOfflinePlaces(points.map(point => ({
          id: point.id,
          name: point.name,
          lat: point.lat,
          lng: point.lng,
          type: point.type,
          subtype: normalizeCampSubtype(point.subtype || ''),
          elevation: point.elevation,
          source: point.source || 'offline',
          source_label: point.source_badge || point.source,
          address: point.address,
          photo_url: point.photo_url,
          website: point.official_url || point.booking_url,
          activities: point.amenities,
          amenities: point.amenities,
          site_types: point.site_types,
          tags: point.tags,
          reservable: point.reservable,
          booking_url: point.booking_url,
          official_url: point.official_url,
          source_badge: point.source_badge,
          source_freshness: point.source_freshness,
          last_checked: point.last_checked,
          waterbody_name: point.waterbody_name,
          waterbody_type: point.waterbody_type,
          access: point.access,
          craft: point.craft,
          fishing_score: point.fishing_score,
          fishing_score_label: point.fishing_score_label,
          fish_species: point.fish_species,
          stocking_notes: point.stocking_notes,
          regulations_url: point.regulations_url,
          gauge_id: point.gauge_id,
          gauge_url: point.gauge_url,
          flow_cfs: point.flow_cfs,
          gage_height_ft: point.gage_height_ft,
          observed_at: point.observed_at,
          chart_source: point.chart_source,
          chart_url: point.chart_url,
          navigation_note: point.navigation_note,
          aliases: point.aliases,
          search_terms: point.search_terms,
          local_terms: point.local_terms,
          trek_name: point.trek_name,
          stage_name: point.stage_name,
          safety_note: point.safety_note,
        })));
      })
      .catch(() => {
        if (mounted) setOfflinePlaces([]);
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    listOfflineTrails()
      .then(items => {
        if (mounted) setSavedTrails(items.filter(item => item.geometry?.features?.length).slice(0, 20));
      })
      .catch(() => {
        if (mounted) setSavedTrails([]);
      });
    return () => { mounted = false; };
  }, [routeTabMode]);

  useEffect(() => {
    let cancelled = false;
    const routes = tripHistory.slice(0, 10);
    if (!routes.length) {
      setRouteTripCards({});
      return;
    }
    Promise.all(routes.map(async route => {
      const trip = activeTrip?.trip_id === route.trip_id
        ? activeTrip
        : await loadOfflineTrip(route.trip_id).catch(() => null);
      return [route.trip_id, tripCardData(route, trip, offlinePlaces)] as const;
    })).then(entries => {
      if (!cancelled) setRouteTripCards(Object.fromEntries(entries));
    }).catch(() => {
      if (!cancelled) setRouteTripCards(Object.fromEntries(routes.map(route => [route.trip_id, tripCardData(route, null, offlinePlaces)])));
    });
    return () => { cancelled = true; };
  }, [activeTrip, offlinePlaces, tripHistory]);

  useEffect(() => {
    if (routeTabMode !== 'wizard' || !activeTrip || importedTripId === activeTrip.trip_id || stops.length > 0) return;
    const importedStops: BuilderStop[] = activeTrip.plan.waypoints
      .filter(wp => Number.isFinite(wp.lat) && Number.isFinite(wp.lng))
      .map((wp, idx) => {
        const type = stopTypeFromWaypoint(wp.type);
        const camp = type === 'camp'
          ? activeTrip.campsites
              .map(campsiteToPin)
              .find(c => c.recommended_day === wp.day && (closeEnough(c, wp) || c.name === wp.name)) ?? {
                id: `wp_${idx}`,
                name: wp.name || 'Camp',
                lat: wp.lat!,
                lng: wp.lng!,
                tags: [],
                land_type: wp.land_type || 'camp',
                description: wp.description || wp.notes || 'Trip camp.',
                reservable: false,
                url: '',
                ada: false,
                recommended_day: wp.day,
                verified_source: wp.verified_source,
              }
          : undefined;
        const station = type === 'fuel'
          ? activeTrip.gas_stations.find(g => g.recommended_day === wp.day && (closeEnough(g, wp) || g.name === wp.name)) ?? {
            id: `wp_${idx}`,
            name: wp.name || 'Fuel stop',
            lat: wp.lat!,
            lng: wp.lng!,
            fuel_types: '',
            address: wp.description || '',
            recommended_day: wp.day,
          }
          : undefined;
        const poi = type === 'waypoint'
          ? activeTrip.route_pois?.find(p => closeEnough(p, wp) || p.name === wp.name)
          : undefined;
        return {
          id: `import_${idx}_${Math.random().toString(36).slice(2, 7)}`,
          day: wp.day || 1,
          name: wp.name || stopLabel(type),
          lat: wp.lat!,
          lng: wp.lng!,
          type,
          description: wp.description || wp.notes || 'Imported trip stop.',
          land_type: wp.land_type || (type === 'fuel' || type === 'motel' ? 'town' : 'route'),
          source: camp ? 'camp' : station ? 'gas' : poi ? 'poi' : 'search',
          camp,
          gas: station,
          poi,
          routePointType: wp.route_point_type,
        };
      });
    if (!importedStops.length) return;
    const importedDays = Array.from(new Set([
      ...activeTrip.plan.daily_itinerary.map(day => day.day),
      ...importedStops.map(stop => stop.day),
    ])).filter(Number.isFinite).sort((a, b) => a - b);
    setStops(importedStops);
    setDays(importedDays.length ? importedDays : [1]);
    setActiveDay(importedStops[0]?.day ?? 1);
    setRouteName(activeTrip.plan.trip_name || '');
    const saved = activeTrip.route_geometry;
    if (saved?.coords?.length) {
      setRouteGeometry(savedGeometryFromCoords(
        saved.coords,
        saved.totalDistance ?? saved.total_distance,
        saved.totalDuration ?? saved.total_duration,
      ));
    }
    setImportedTripId(activeTrip.trip_id);
  }, [activeTrip, importedTripId, routeTabMode, stops.length]);

  const dayStops = stops.filter(st => st.day === activeDay);
  const selectedInsertStop = stops.find(st => st.id === insertAfterId) ?? null;
  const orderedStops = orderBuilderStops(stops);
  const anchor = [...dayStops].reverse()[0] ?? [...stops].reverse()[0] ?? (userLoc ? { lat: userLoc.lat, lng: userLoc.lng, name: 'Current location' } : null);
  const selectedStopIndex = selectedInsertStop ? orderedStops.findIndex(st => st.id === selectedInsertStop.id) : -1;
  const selectedNextStop = selectedStopIndex >= 0 ? orderedStops[selectedStopIndex + 1] ?? null : null;
  const previousDayEnd = [...orderedStops].reverse().find(st => st.day < activeDay) ?? null;
  const activeDayDestination = [...dayStops].reverse().find(st => st.type !== 'fuel' && st.type !== 'waypoint') ?? [...dayStops].reverse()[0] ?? null;
  const dayBridge = previousDayEnd && activeDayDestination
    ? { from: previousDayEnd, to: activeDayDestination, source: 'day' as const }
    : null;
  const activeSegment = selectedInsertStop && selectedNextStop
    ? { from: selectedInsertStop, to: selectedNextStop, source: 'selected' as const, targetDay: insertTargetDay ?? selectedInsertStop.day }
    : dayBridge ? { ...dayBridge, targetDay: activeDay } : null;
  const legContext = activeSegment
    ? {
        ...activeSegment,
        miles: haversineMi(activeSegment.from, activeSegment.to),
        hours: estimateMovingHours(haversineMi(activeSegment.from, activeSegment.to)),
        center: midpoint(activeSegment.from, activeSegment.to),
        targetDay: activeSegment.targetDay,
      }
    : null;
  const discoverContextLabel = legContext
    ? `${legContext.from.name.split(',')[0]} to ${legContext.to.name.split(',')[0]} · ${fmtRouteDistance(legContext.miles)}`
    : anchor ? anchor.name.split(',')[0] : 'add a stop first';
  const camps = activeDiscovery.camps;
  const gas = activeDiscovery.gas;
  const pois = activeDiscovery.pois;
  const excursions = activeDiscovery.excursions;
  const discoverySummary = activeDiscovery.summary;
  const filteredOfflinePlaces = useMemo(() => (
    offlinePlaces.filter(place => placeMatchesFilters(place, activePlaceFilters))
  ), [offlinePlaces, activePlaceFilters]);
  const campTypeFilters = useMemo(() => (
    CAMP_PREFERENCE_OPTIONS.find(option => option.id === campPreferenceMode)?.filters ?? []
  ), [campPreferenceMode]);
  const campPreferenceLabel = CAMP_PREFERENCE_OPTIONS.find(option => option.id === campPreferenceMode)?.label ?? 'Public';
  const campWindowFor = (day: number, sourceDays: number[] = days, cadence: CampCadenceMode = campCadenceMode) => {
    const lastDay = sourceDays[sourceDays.length - 1] ?? day;
    if (cadence !== 'alternate') {
      return { start: day, end: day, campDay: day, label: `Day ${day}` };
    }
    const start = Math.floor((day - 1) / 2) * 2 + 1;
    const end = Math.min(start + 1, lastDay);
    return {
      start,
      end,
      campDay: end,
      label: start === end ? `Day ${start}` : `Days ${start}-${end}`,
    };
  };
  const campWindowForDay = (day: number) => campWindowFor(day);
  const dayNeedsCamp = (day: number) => {
    if (campCadenceMode === 'manual') return false;
    if (campCadenceMode === 'alternate') return day === campWindowFor(day).campDay;
    return true;
  };
  const dayNeedsCampFor = (day: number, sourceDays: number[]) => {
    if (campCadenceMode === 'manual') return false;
    if (campCadenceMode === 'alternate') return day === campWindowFor(day, sourceDays).campDay;
    return true;
  };
  const dayNeedsOvernight = (day: number) => {
    if (campCadenceMode === 'manual') return true;
    return dayNeedsCamp(day);
  };
  const dayNeedsOvernightFor = (day: number, sourceDays: number[]) => {
    if (campCadenceMode === 'manual') return true;
    return dayNeedsCampFor(day, sourceDays);
  };
  const offlinePlaceCandidates = useMemo(() => {
    const target = legContext ? legContext.center : anchor;
    if (!target) return [];
    const scoped = filteredOfflinePlaces
      .map(place => ({
        ...place,
        route_distance_mi: legContext
          ? pointSegmentDistanceMi(place, legContext.from, legContext.to)
          : haversineMi(place, target),
      }))
      .filter(place => place.route_distance_mi <= (legContext ? Math.max(20, Math.min(50, legContext.miles * 0.5)) : 45))
      .sort((a, b) => (a.route_distance_mi ?? 999) - (b.route_distance_mi ?? 999));
    return dedupePois(scoped);
  }, [anchor, filteredOfflinePlaces, legContext]);
  const discoveryPois = useMemo(() => dedupePois([...pois, ...offlinePlaceCandidates]), [pois, offlinePlaceCandidates]);
  useEffect(() => {
    if (!inlineSearch || discoverLoading) return;
    const payload = {
      surface: 'route_builder_inline',
      day: inlineSearch.day,
      tab: inlineSearch.tab,
      active_key: activeDiscoveryKey,
    };
    if (inlineSearch.tab === 'camps' && camps.length === 0) {
      trackPhase0Once(`phase0:route-builder-empty:camps:${activeDiscoveryKey || 'none'}:${inlineSearch.day}`, 'phase0_empty_state_seen', payload);
      return;
    }
    if (inlineSearch.tab === 'gas' && gas.length === 0) {
      trackPhase0Once(`phase0:route-builder-empty:gas:${activeDiscoveryKey || 'none'}:${inlineSearch.day}`, 'phase0_empty_state_seen', payload);
      return;
    }
    if (inlineSearch.tab === 'excursions' && excursions.length === 0) {
      trackPhase0Once(`phase0:route-builder-empty:excursions:${activeDiscoveryKey || 'none'}:${inlineSearch.day}`, 'phase0_empty_state_seen', payload);
      return;
    }
    if (inlineSearch.tab === 'poi' && discoveryPois.length === 0) {
      trackPhase0Once(`phase0:route-builder-empty:poi:${activeDiscoveryKey || 'none'}:${inlineSearch.day}`, 'phase0_empty_state_seen', payload);
    }
  }, [activeDiscoveryKey, camps.length, discoverLoading, discoveryPois.length, excursions.length, gas.length, inlineSearch]);
  const routeStateMiles = useMemo(() => sampleRouteStates(orderedStops, tripLoop), [orderedStops, tripLoop]);
  const routeStates = useMemo(() => Object.keys(routeStateMiles).sort((a, b) => routeStateMiles[b] - routeStateMiles[a]), [routeStateMiles]);
  const routeDaySegments = useMemo(() => {
    if (!routeGeometry || routeGeometry.coords.length < 2) return [];
    return computeDaySegmentsFromRouteGeometry({
      geometry: routeGeometry,
      days,
      maxDriveHoursByDay: Object.fromEntries(days.map(day => [day, parsePositiveNumber(dayDriveTargets[day]) ?? undefined])),
      defaultMaxDriveHours: parsePositiveNumber(driveHoursPerDay) ?? 5,
      campWindowForDay: day => campWindowFor(day),
      shape: tripShapeMode,
    });
  }, [routeGeometry, days, dayDriveTargets, driveHoursPerDay, campCadenceMode, tripShapeMode]);

  const totals = useMemo(() => {
    let miles = routeGeometry?.totalDistanceMi && routeGeometry.totalDistanceMi > 0 ? routeGeometry.totalDistanceMi : 0;
    if (!miles) miles = routeDaySegments.reduce((sum, segment) => sum + (segment.providerDistanceMi || 0), 0);
    if (!miles) miles = estimateShapeMiles(orderedStops, tripShapeMode);
    return { miles, stops: orderedStops.length, camps: orderedStops.filter(st => st.type === 'camp').length };
  }, [orderedStops, routeGeometry?.totalDistanceMi, routeDaySegments, tripShapeMode]);
  const planningStats = useMemo(() => {
    const mpg = estimateMpg(rigProfile);
    const fallbackPrice = parsePositiveNumber(gasPrice) ?? fuelEstimate?.price_per_gallon ?? 3.65;
    const gallons = totals.miles / mpg;
    const fuelCost = totals.miles > 0 ? fuelEstimate?.estimated_cost ?? gallons * fallbackPrice : 0;
    const price = gallons > 0 ? fuelCost / gallons : fallbackPrice;
    const driveLimit = parsePositiveNumber(driveHoursPerDay) ?? 5;
    const range = parsePositiveNumber(rigProfile?.fuel_range_miles);
    return {
      mpg,
      price,
      gallons,
      fuelCost,
      driveLimit,
      range,
      driveHours: estimateMovingHours(totals.miles),
    };
  }, [driveHoursPerDay, fuelEstimate, gasPrice, rigProfile, totals.miles]);

  useEffect(() => {
    if (!totals.miles) {
      setFuelEstimate(null);
      return;
    }
    let cancelled = false;
    api.getFuelEstimate(totals.miles, planningStats.mpg, routeStates.slice(0, 6), weatherUnitMode)
      .then(estimate => {
        if (cancelled) return;
        setFuelEstimate(estimate);
      })
      .catch(() => {
        if (cancelled) return;
        setFuelEstimate(null);
      });
    return () => { cancelled = true; };
  }, [planningStats.mpg, routeStates.join(','), totals.miles, weatherUnitMode]);
  const routeBuildSession = useMemo(() => buildRouteBuilderSession({
    intent: builderIntentFor(days),
    stops: orderedStops,
    geometry: routeGeometry,
    restDays,
    fuelRangeMi: planningStats.range,
    dayNeedsOvernight,
    campWindowForDay: day => campWindowFor(day),
    maxDriveHoursByDay: Object.fromEntries(days.map(day => [day, parsePositiveNumber(dayDriveTargets[day]) ?? undefined])),
    existingDaySegments: routeDaySegments,
  }), [orderedStops, routeGeometry, routeDaySegments, days, restDays, planningStats.range, campCadenceMode, dayDriveTargets, tripShapeMode, routeStyle, effectiveCampReusePolicy, driveHoursPerDay, targetMiles]);
  const routeOfflineReadiness = useMemo(() => computeOfflineReadiness({
    coords: routeGeometry?.coords,
    points: orderedStops,
    getMapState: getOfflineMapState,
    getRoutingState: getOfflineRoutingState,
    getContourState: getOfflineContourState,
    getTrailState: getOfflineTrailState,
    placesReady: orderedStops.some(st => st.camp || st.gas || st.poi),
  }), [routeGeometry?.coords, orderedStops, getOfflineMapState, getOfflineRoutingState, getOfflineContourState, getOfflineTrailState]);
  const rigRouteSummary = useMemo(() => {
    if (!rigProfile || (!rigProfile.make && !rigProfile.model && !rigProfile.vehicle_type)) {
      return {
        title: 'No rig profile yet',
        meta: `${weatherUnitMode === 'metric' ? `${(235.214583 / Math.max(1, planningStats.mpg)).toFixed(1)} L/100km` : `${planningStats.mpg} MPG`} fallback · add rig specs in Profile`,
        ready: false,
      };
    }
    const title = [rigProfile.year, rigProfile.make, rigProfile.model].filter(Boolean).join(' ') || rigProfile.vehicle_type || 'Saved rig';
    const specs = [
      rigProfile.vehicle_type,
      rigProfile.drive,
      rigProfile.fuel_range_miles ? `${fmtRouteDistance(parsePositiveNumber(rigProfile.fuel_range_miles) ?? 0)} range` : null,
      weatherUnitMode === 'metric' ? `${(235.214583 / Math.max(1, planningStats.mpg)).toFixed(1)} L/100km` : `${planningStats.mpg} MPG`,
      rigProfile.is_towing ? 'towing' : null,
    ].filter(Boolean).join(' · ');
    return { title, meta: specs, ready: true };
  }, [planningStats.mpg, rigProfile]);
  const dayMileage = useMemo(() => {
    const out: Record<number, number> = {};
    for (const segment of routeDaySegments) out[segment.day] = segment.providerDistanceMi;
    for (const day of days) {
      if (out[day] != null) continue;
      const prev = [...orderedStops].reverse().find(st => st.day < day) ?? null;
      const wps = orderedStops.filter(st => st.day === day);
      let miles = 0;
      if (prev && wps.length) miles += haversineMi(prev, wps[0]);
      for (let i = 1; i < wps.length; i++) miles += haversineMi(wps[i - 1], wps[i]);
      out[day] = miles;
    }
    return out;
  }, [days, orderedStops, routeDaySegments]);
  const routeDayPlans = useMemo<RouteDayPlan[]>(() => (
    days.map(day => {
      const wps = orderedStops.filter(st => st.day === day);
      const routableWps = wps.filter(st => st.routePointType !== 'side_stop');
      const previous = [...orderedStops].reverse().find(st => st.day < day) ?? null;
      const frameworkTarget = routableWps.find(isFrameworkTarget) ?? null;
      const target = [...routableWps].reverse().find(st => st.type === 'camp' || st.type === 'motel')
        ?? frameworkTarget
        ?? [...routableWps].reverse().find(st => st.type !== 'fuel')
        ?? routableWps[routableWps.length - 1]
        ?? null;
      const miles = dayMileage[day] ?? 0;
      const providerSegment = routeDaySegments.find(segment => segment.day === day);
      const hasOvernight = wps.some(st => st.type === 'camp' || st.type === 'motel');
      const needsOvernight = dayNeedsOvernight(day);
      const needsReview = Boolean(frameworkTarget) || (needsOvernight && !hasOvernight);
      return {
        day,
        campWindowLabel: campWindowForDay(day).label,
        campWindowStart: campWindowForDay(day).start,
        campWindowEnd: campWindowForDay(day).end,
        needsCamp: dayNeedsCamp(day),
        needsOvernight,
        hasOvernight,
        needsReview,
        previous,
        target,
        frameworkTarget,
        stops: wps,
        miles,
        hours: providerSegment?.providerDurationHours ?? estimateMovingHours(miles),
        rest: restDays.includes(day),
        complete: !needsOvernight || (hasOvernight && !frameworkTarget),
      };
    })
  ), [days, orderedStops, dayMileage, routeDaySegments, restDays, campCadenceMode]);
  const hasBaseRoute = orderedStops.length >= 2;
  const realOvernights = routeDayPlans.filter(day => day.complete).length;
  const setupProgress = useMemo(() => {
    let score = 0;
    if (startQuery.trim() || orderedStops.length >= 1 || userLoc) score += 1;
    if (endQuery.trim() || orderedStops.length >= 2) score += 1;
    if (parsePositiveNumber(plannedDays)) score += 1;
    return score;
  }, [endQuery, orderedStops.length, plannedDays, startQuery, userLoc]);
  const baseRouteSummary = hasBaseRoute
    ? `${orderedStops[0].name.split(',')[0]} to ${orderedStops[orderedStops.length - 1].name.split(',')[0]}`
    : 'Build a base route first';
  const activeDayDriveLimit = parsePositiveNumber(dayDriveTargets[activeDay]) ?? planningStats.driveLimit;
  const tripReadiness = routeBuildSession.readiness;
  const routeFitCards = useMemo<RouteFitCard[]>(() => buildRouteFitCards({
    readinessTasks: tripReadiness.tasks,
    stopCount: orderedStops.length,
    fuelStopCount: orderedStops.filter(st => st.type === 'fuel').length,
    totalMiles: totals.miles,
    days,
    restDays,
    maxDriveHoursByDay: Object.fromEntries(days.map(day => [day, parsePositiveNumber(dayDriveTargets[day]) ?? undefined])),
    defaultDriveLimitHours: planningStats.driveLimit,
    fuelRangeMi: planningStats.range,
    fuelSummaryText: `${fmtFuelVolumeFromMiles(totals.miles, planningStats.mpg, weatherUnitMode)} · $${Math.round(planningStats.fuelCost)} ${fuelSourceLabel(fuelEstimate, !!parsePositiveNumber(rigProfile?.fuel_mpg)).toLowerCase()}.`,
    offlineReady: routeOfflineReadiness.ready,
    offlineMessage: routeOfflineReadiness.message,
  }), [days, orderedStops, totals.miles, planningStats.driveLimit, planningStats.fuelCost, planningStats.mpg, planningStats.range, weatherUnitMode, fuelEstimate, rigProfile?.fuel_mpg, dayDriveTargets, restDays, tripReadiness.tasks, routeOfflineReadiness.ready, routeOfflineReadiness.message]);
  const rentalCampNights = routeDayPlans.filter(plan => plan.needsOvernight).length;
  const rentalSuggestion = useMemo(() => buildRentalSuggestionFit({
    start: orderedStops[0],
    days: days.length,
    campNights: rentalCampNights,
    routeStyle,
    campPreference: campPreferenceMode,
    tripShape: tripShapeMode,
    rigProfile,
    dismissedAt: rentalDismissedAt,
  }), [orderedStops, days.length, rentalCampNights, routeStyle, campPreferenceMode, tripShapeMode, rigProfile, rentalDismissedAt]);
  useEffect(() => {
    if (!rentalSuggestion.shouldSearch || !rentalSuggestion.query) {
      setRentalOffers([]);
      setRentalOffersLoading(false);
      return;
    }
    let cancelled = false;
    setRentalOffersLoading(true);
    setRentalIdeaSaved(false);
    api.getRentalOffers(rentalSuggestion.query)
      .then(res => {
        if (cancelled) return;
        const offers = res.status === 'ok' ? res.offers : [];
        setRentalOffers(offers);
        if (offers.length) {
          api.trackOutdoorOfferEvent('impression', {
            offer_id: offers[0].id,
            provider: offers[0].provider || 'outdoorsy',
            placement: 'route_builder',
            route_type: rentalSuggestion.context.route_type,
            session_id: sessionId,
            context: rentalSuggestion.context,
          }).catch(() => {});
        }
      })
      .catch(() => {
        if (!cancelled) setRentalOffers([]);
      })
      .finally(() => {
        if (!cancelled) setRentalOffersLoading(false);
      });
    return () => { cancelled = true; };
  }, [rentalSuggestion.cacheKey, sessionId]);
  const discoverEmptyText = discoverTab === 'camps'
    ? 'Tap scan to find legal camps near the selected leg or route point.'
    : discoverTab === 'gas'
      ? 'Tap scan to find fuel between the selected stops.'
      : discoverTab === 'excursions'
        ? 'Tap scan to find side trips, parks, trails, viewpoints, climbing, and historic stops from real map sources.'
        : 'Tap scan to find water, trailheads, viewpoints, peaks, and hot springs near this route.';

  function fly(_lat: number, _lng: number, _zoom = 11) {}

  function addStop(input: Omit<BuilderStop, 'id' | 'day'> & { day?: number }) {
    const target = insertAfterId ? stops.find(st => st.id === insertAfterId) : null;
    const stop: BuilderStop = {
      ...input,
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      day: input.day ?? insertTargetDay ?? target?.day ?? activeDay,
    };
    setStops(prev => {
      const idx = target ? prev.findIndex(st => st.id === target.id) : -1;
      if (idx < 0) return [...prev, stop];
      return [...prev.slice(0, idx + 1), stop, ...prev.slice(idx + 1)];
    });
    setActiveDay(stop.day);
    if (stop.type === 'start') setPendingType('waypoint');
    fly(stop.lat, stop.lng, stop.type === 'camp' ? 12 : 11);
  }

  function addPlace(place: SearchPlace, type = pendingType) {
    addStop(buildRouteBuilderSearchStop(place, type));
    setSearchResults([]);
    setQuery('');
  }

  async function getRouteBuilderLocation() {
    if (userLoc) return userLoc;
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Location needed', 'Allow location or type a start city so Trailhead knows where this route begins.');
      return null;
    }
    const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const loc = { lat: fix.coords.latitude, lng: fix.coords.longitude };
    setStoreUserLoc(loc);
    return loc;
  }

  async function setWizardStartFromLocation() {
    const loc = await getRouteBuilderLocation();
    if (!loc) return;
    const start: BuilderStop = {
      id: `start_${Date.now()}`,
      day: 1,
      name: 'Current location',
      lat: loc.lat,
      lng: loc.lng,
      type: 'start',
      description: 'Route start from current location.',
      land_type: 'route',
      source: 'map',
      routeShapeRole: 'start',
    };
    setStops(prev => {
      const withoutOldStart = prev.filter((st, idx) => !(idx === 0 && st.type === 'start'));
      return [start, ...withoutOldStart];
    });
    setStartQuery('');
    setPendingType('waypoint');
    fly(start.lat, start.lng, 10);
  }

  function rebalanceFrameworkTargets(prev: BuilderStop[], anchor: BuilderStop): BuilderStop[] {
    const sorted = orderBuilderStops(prev);
    const final = sorted[sorted.length - 1] ?? null;
    return (rebalanceAfterCampSelection({
      stops: prev,
      selectedCamp: anchor,
      selectedDay: anchor.day,
      finalStop: final,
    }) as BuilderStop[]).map(st => isFrameworkManagedStop(st)
      ? { ...st, type: 'waypoint' as BuilderStopType, land_type: 'route' }
      : st
    );
  }

  function campPreferenceScore(camp: CampsitePin) {
    const text = `${camp.name} ${camp.land_type} ${(camp.tags ?? []).join(' ')} ${camp.description}`.toLowerCase();
    const isPublic = /(blm|usfs|forest|public|dispersed|free|boondock)/i.test(text);
    const isRv = /(rv|hookup|koa|resort)/i.test(text);
    const isReservable = /(reservable|reservation|state|nps|recreation\.gov|developed)/i.test(text);
    const isPrivateStay = /(private|farm|ranch|winery|vineyard|glamping|yurt|cabin|hipcamp|harvest)/i.test(text);
    const distance = camp.route_distance_mi ?? 0;
    const photoAdjust = campHasPhotos(camp) ? -8 : (campPhotoOnly ? 60 : 0);
    if (campPreferenceMode === 'rv') return distance + photoAdjust + (isRv ? -14 : 8) + (isReservable ? -3 : 0);
    if (campPreferenceMode === 'private') return distance + photoAdjust + (isPrivateStay ? -14 : 10) + (isReservable ? -4 : 0) + (isPublic ? 6 : 0);
    if (campPreferenceMode === 'developed') return distance + photoAdjust + (isReservable ? -10 : 0) + (isPublic ? -4 : 0) + (isRv ? 3 : 0);
    if (campPreferenceMode === 'public') return distance + photoAdjust + (isPublic ? -16 : 8) + (isRv ? 18 : 0);
    return distance + photoAdjust + (isPublic ? -6 : 0) + (isRv ? 3 : 0);
  }

  async function runSearch() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      setSearchResults(await resolveRouteBuilderSearchResults({
        query,
        offlinePlaces,
        searchOnline: geocodePlaces,
        catalogFirst: isRouteBuilderCategoryQuery(query),
      }));
    } catch {
      setSearchResults(searchOfflineRouteBuilderPlaces(offlinePlaces, query.trim()));
    } finally {
      setSearching(false);
    }
  }

  async function resolveLegSearchContext(leg: LegSearchContext): Promise<LegSearchContext> {
    if (leg.routeCoords && leg.routeCoords.length >= 2) return leg;
    const savedCoords = activeTrip?.route_geometry?.coords;
    const savedSlice = sliceRouteCoordsBetween(savedCoords, leg.from, leg.to);
    if (savedSlice.length >= 2) {
      const miles = coordsLengthMi(savedSlice);
      return {
        ...leg,
        miles,
        center: pointAtRouteMile(coordsToStops(savedSlice), miles / 2) ?? leg.center,
        routeCoords: savedSlice,
        routeSource: 'saved',
      };
    }
    try {
      const routed = await buildBridgeRoute([
        { lat: leg.from.lat, lng: leg.from.lng, type: 'break' },
        { lat: leg.to.lat, lng: leg.to.lng, type: 'break' },
      ], {
        backRoads: routeStyle === 'wild',
        avoidHighways: routeStyle === 'wild',
        avoidTolls: true,
        noFerries: false,
      }, routeUnitsParam(weatherUnitMode));
      const coords = (routed.trip?.legs ?? []).flatMap(part => typeof part.shape === 'string' ? decodePolyline6(part.shape) : []);
      if (coords.length >= 2) {
        const miles = coordsLengthMi(coords);
        return {
          ...leg,
          miles,
          center: pointAtRouteMile(coordsToStops(coords), miles / 2) ?? leg.center,
          routeCoords: coords,
          routeSource: 'live',
        };
      }
    } catch {}
    return { ...leg, routeCoords: legRouteCoords(leg), routeSource: 'straight' };
  }

  async function runDiscovery(tab: DiscoveryTab, target: { lat: number; lng: number }, leg: LegSearchContext | null, opts: { focusMap?: boolean } = {}) {
    const key = discoveryKeyFor(tab, target, leg);
    setActiveDiscoveryKey(key);
    const useLeg = !!leg;
    setDiscoverLoading(true);
    storeDiscoveryResults(key, { summary: '' });
    if (opts.focusMap !== false) fly(target.lat, target.lng, useLeg ? 8 : 9);
    try {
      const searchLeg = leg ? await resolveLegSearchContext(leg) : null;
      if (tab === 'camps') {
        if (useLeg) {
          const radius = Math.max(34, Math.min(62, searchLeg!.miles / 3.5 + 14));
          let found = routeIntelligenceCamps(await api.getRouteIntelligence({
            route: legRouteCoords(searchLeg!),
            center: searchLeg!.center,
            radius,
            categories: ['camp', 'camping'],
            scope_id: key,
            recommended_day: searchLeg!.targetDay ?? activeDay,
            route_scope: 'leg',
            max_samples: 6,
            include_stale: true,
            limit: 140,
          }).catch(() => null));
          if (found.length === 0) {
            found = uniqueByGeo((await Promise.all(
              legSamplePoints(searchLeg!).map(point => api.getNearbyCamps(point.lat, point.lng, radius, campTypeFilters).catch(() => []))
            )).flat());
          }
          const offlineCamps = routeScopedOfflinePlaces(offlinePlaces, searchLeg!, ['camp'], 18)
            .map(point => offlinePoiToCamp(point))
            .filter(camp => campMatchesFilters(camp, campTypeFilters));
          const scopedRaw = filterCampsByPhotoMode(uniqueByGeo([...found, ...offlineCamps]), campPhotoOnly)
              .map(camp => withLegProjection(camp, searchLeg!))
              .filter(camp => campMatchesFilters(camp, campTypeFilters))
              .filter(camp => (camp.route_distance_mi ?? 999) <= routeBufferForMiles(searchLeg!.miles) + 14);
          let scoped = (searchLeg!.purpose === 'overnight' ? overnightEndpointCamps(scopedRaw, searchLeg!) : spreadAlongLeg(scopedRaw))
            .sort((a, b) => campPreferenceScore(a) - campPreferenceScore(b));
          let fallbackText = '';
          if (searchLeg!.purpose === 'overnight' && scoped.length === 0) {
            const endpointCamps = await api.getNearbyCamps(searchLeg!.to.lat, searchLeg!.to.lng, 55, campTypeFilters).catch(() => []);
            scoped = filterCampsByPhotoMode(endpointCamps, campPhotoOnly)
              .map(camp => withLegProjection(camp, searchLeg!))
              .sort((a, b) => campPreferenceScore(a) - campPreferenceScore(b) || haversineMi(a, searchLeg!.to) - haversineMi(b, searchLeg!.to));
            fallbackText = ' using the day-end area';
            if (scoped.length === 0 && campPhotoOnly && endpointCamps.length > 0) {
              scoped = endpointCamps
                .filter(camp => campMatchesFilters(camp, campTypeFilters))
                .map(camp => ({
                  ...withLegProjection(camp, searchLeg!),
                  photo_status: 'missing',
                  route_fit: camp.route_fit || 'No photo fallback',
                  photo_fallback_reason: 'Photos only found no photo-backed camp near this overnight stop.',
                }))
                .sort((a, b) => campPreferenceScore(a) - campPreferenceScore(b) || haversineMi(a, searchLeg!.to) - haversineMi(b, searchLeg!.to))
                .slice(0, 3);
              fallbackText = ' using a no-photo fallback near the day-end area';
            }
          }
          storeDiscoveryResults(key, { camps: scoped, summary: `${scoped.length} ${campPhotoOnly ? 'photo-backed ' : ''}${campPreferenceLabel.toLowerCase()} camp${scoped.length === 1 ? '' : 's'} ${searchLeg!.purpose === 'overnight' ? `near Day ${searchLeg!.targetDay ?? activeDay} stop${fallbackText}` : 'spread along this leg'}` });
        } else {
          const offlineCamps = areaScopedOfflinePlaces(offlinePlaces, target, ['camp'], 50)
            .map(point => offlinePoiToCamp(point))
            .filter(camp => campMatchesFilters(camp, campTypeFilters));
          let liveCamps = routeIntelligenceCamps(await api.getRouteIntelligence({
            center: target,
            radius: 45,
            categories: ['camp', 'camping'],
            scope_id: key,
            recommended_day: activeDay,
            route_scope: 'area',
            max_samples: 1,
            include_stale: true,
            limit: 120,
          }).catch(() => null));
          if (liveCamps.length === 0) {
            liveCamps = await api.getNearbyCamps(target.lat, target.lng, 45, campTypeFilters).catch(() => []);
          }
          const found = filterCampsByPhotoMode(uniqueByGeo([...liveCamps, ...offlineCamps]), campPhotoOnly)
            .filter(camp => campMatchesFilters(camp, campTypeFilters))
            .sort((a, b) => campPreferenceScore(a) - campPreferenceScore(b));
          storeDiscoveryResults(key, { camps: found, summary: `${found.length} ${campPhotoOnly ? 'photo-backed ' : ''}${campPreferenceLabel.toLowerCase()} camp${found.length === 1 ? '' : 's'} near this area` });
        }
      } else if (tab === 'gas') {
        if (useLeg) {
          const radius = Math.max(32, Math.min(64, searchLeg!.miles / 4 + 14));
          const samplePoints = legSamplePoints(searchLeg!);
          const intelFuel = routeIntelligenceFuel(await api.getRouteIntelligence({
            route: legRouteCoords(searchLeg!),
            center: searchLeg!.center,
            radius,
            categories: ['fuel', 'propane'],
            scope_id: key,
            recommended_day: searchLeg!.targetDay ?? activeDay,
            route_scope: 'leg',
            max_samples: 6,
            include_stale: true,
            limit: 120,
          }).catch(() => null));
          const offlineFuel = routeScopedOfflinePlaces(offlinePlaces, searchLeg!, ['fuel', 'propane']);
          const stations = uniqueByGeo([...intelFuel, ...offlineFuel.map(poiToGasStation)]);
          if (stations.length === 0) {
            const [nrelStations, osmFuel, mapboxFuel] = await Promise.all([
              searchRouteBuilderProviderAtPoints({
                points: samplePoints,
                provider: point => api.getGas(point.lat, point.lng, radius),
                dedupe: uniqueByGeo,
              }),
              searchRouteBuilderProviderAtPoints({
                points: samplePoints,
                provider: point => api.getOsmPois(point.lat, point.lng, radius, FUEL_POI_TYPES),
                dedupe: uniqueByGeo,
              }),
              searchRouteBuilderProviderAtPoints({
                points: samplePoints,
                provider: point => searchMapContextNearby('gas station', point, radius, 'fuel', 5),
                dedupe: uniqueByGeo,
              }),
            ]);
            stations.push(...uniqueByGeo([
              ...mapboxFuel.map(poiToGasStation),
              ...nrelStations,
              ...osmFuel.map(poiToGasStation),
            ]));
          }
          if (stations.length === 0) {
            const nominatimFuel = await searchRouteBuilderProviderAtPoints({
              points: samplePoints,
              provider: point => searchNominatimNearby('gas station', point, Math.max(radius, 45), 'fuel', 6),
              dedupe: uniqueByGeo,
            });
            stations.push(...nominatimFuel.map(poiToGasStation));
          }
          const scoped = spreadAlongLeg(stations
            .map(st => withLegProjection(st, searchLeg!))
            .filter(st => (st.route_distance_mi ?? 999) <= routeBufferForMiles(searchLeg!.miles) + 18)
          );
          storeDiscoveryResults(key, { gas: scoped, summary: `${scoped.length} fuel stop${scoped.length === 1 ? '' : 's'} along this leg` });
        } else {
          const intelFuel = routeIntelligenceFuel(await api.getRouteIntelligence({
            center: target,
            radius: 35,
            categories: ['fuel', 'propane'],
            scope_id: key,
            recommended_day: activeDay,
            route_scope: 'area',
            max_samples: 1,
            include_stale: true,
            limit: 80,
          }).catch(() => null));
          const offlineFuel = areaScopedOfflinePlaces(offlinePlaces, target, ['fuel', 'propane'], 45);
          const stations = uniqueByGeo([...intelFuel, ...offlineFuel.map(poiToGasStation)]);
          if (stations.length === 0) {
            const [nrelStations, osmFuel, mapboxFuel] = await Promise.all([
              searchRouteBuilderProviderAtPoints({
                points: [target],
                provider: point => api.getGas(point.lat, point.lng, 35),
              }),
              searchRouteBuilderProviderAtPoints({
                points: [target],
                provider: point => api.getOsmPois(point.lat, point.lng, 35, FUEL_POI_TYPES),
              }),
              searchRouteBuilderProviderAtPoints({
                points: [target],
                provider: point => searchMapContextNearby('gas station', point, 35, 'fuel', 8),
              }),
            ]);
            stations.push(...uniqueByGeo([
              ...mapboxFuel.map(poiToGasStation),
              ...nrelStations,
              ...osmFuel.map(poiToGasStation),
            ]));
          }
          if (stations.length === 0) {
            const nominatimFuel = await searchRouteBuilderProviderAtPoints({
              points: [target],
              provider: point => searchNominatimNearby('gas station', point, 35, 'fuel', 8),
            });
            stations.push(...nominatimFuel.map(poiToGasStation));
          }
          stations.sort((a, b) => (a.route_distance_mi ?? haversineMi(a, target)) - (b.route_distance_mi ?? haversineMi(b, target)));
          storeDiscoveryResults(key, { gas: stations, summary: `${stations.length} fuel stop${stations.length === 1 ? '' : 's'} near this area` });
        }
      } else if (tab === 'excursions') {
        const center = useLeg ? searchLeg!.center : target;
        const radius = useLeg ? Math.max(28, Math.min(60, searchLeg!.miles / 4 + 18)) : 45;
        const smart = await api.getRouteIntelligence({
          route: useLeg ? legRouteCoords(searchLeg!) : excursionRouteCoords(),
          center,
          radius,
          categories: ['trailhead', 'viewpoint', 'peak', 'hot_spring', 'park', 'historic', 'climbing', 'ohv', 'attraction', 'water'],
          scope_id: key,
          recommended_day: searchLeg?.targetDay ?? activeDay,
          route_scope: useLeg ? 'leg' : 'area',
          max_samples: useLeg ? 6 : 1,
          include_stale: true,
          limit: 120,
        }).catch(async () => {
          const found = await api.getExcursionsNearby({
            center,
            radius,
            day: searchLeg?.targetDay ?? activeDay,
            route: useLeg ? legRouteCoords(searchLeg!) : excursionRouteCoords(),
            source_context: useLeg ? 'route_leg' : 'area',
            categories: ['trail', 'ohv', 'viewpoint', 'peak', 'hot_spring', 'park', 'historic', 'climbing', 'water', 'attraction'],
          }).catch(() => ({ excursions: [] }));
          return { places: (found.excursions ?? []).map(item => ({
            id: item.id, name: item.name, lat: item.lat, lng: item.lng,
            type: item.type as OsmPoi['type'], subtype: item.subtype, source: item.source,
            source_label: item.source_label, route_distance_mi: item.distance_from_route_mi,
            summary: item.summary || item.why_go, access_note: item.access_notes,
          } as any)) };
        });
        const scoped = ((smart.places ?? []) as OsmPoi[])
          .map(smartPlaceToExcursion)
          .filter(item => !item.sensitive_location || item.source_confidence === 'high')
          .sort((a, b) => (a.distance_from_route_mi ?? 999) - (b.distance_from_route_mi ?? 999));
        storeDiscoveryResults(key, { excursions: scoped, summary: `${scoped.length} excursion${scoped.length === 1 ? '' : 's'} near ${useLeg ? 'this leg' : 'this area'}` });
      } else {
        if (useLeg) {
          const radius = Math.max(24, Math.min(42, searchLeg!.miles / 5 + 12));
          const legRoute = legRouteCoords(searchLeg!);
          let found = routeIntelligencePois(await api.getRouteIntelligence({
            route: legRoute,
            center: searchLeg!.center,
            radius,
            categories: ROUTE_POI_TYPES.split(',').filter(Boolean),
            scope_id: key,
            recommended_day: searchLeg!.targetDay ?? activeDay,
            route_scope: 'leg',
            max_samples: 6,
            include_stale: true,
            limit: 140,
          }).catch(() => null), ['fuel', 'propane', 'camp', 'camping']);
          if (found.length === 0) {
            found = uniqueByGeo((await Promise.all(
              legSamplePoints(searchLeg!).map(point => api.getNearbySmartPack(point.lat, point.lng, radius, ROUTE_POI_TYPES, legRoute, { scope_id: key, recommended_day: searchLeg!.targetDay ?? activeDay, route_scope: 'leg' }).then(pack => pack.places as OsmPoi[]).catch(() => []))
            )).flat());
          }
          const offlineRoutePlaces = routeScopedOfflinePlaces(
            filteredOfflinePlaces,
            searchLeg!,
            ROUTE_POI_TYPES.split(',').filter(type => type !== 'fuel' && type !== 'propane')
          );
          const routePlaces = uniqueByGeo([...found, ...offlineRoutePlaces]);
          if (routePlaces.length === 0) {
            const mapboxPlaces = uniqueByGeo(await searchRouteBuilderFallbackPois({
              points: legSamplePoints(searchLeg!),
              radiusMi: radius,
              limitPerQuery: 3,
              provider: searchMapContextNearby,
            }));
            routePlaces.push(...mapboxPlaces);
          }
          if (routePlaces.length === 0) {
            const nominatimPlaces = uniqueByGeo(await searchRouteBuilderFallbackPois({
              points: legSamplePoints(searchLeg!),
              radiusMi: radius,
              limitPerQuery: 3,
              provider: searchNominatimNearby,
            }));
            routePlaces.push(...nominatimPlaces);
          }
          const scoped = spreadAlongLeg(routePlaces
              .map(poi => withLegProjection(poi, searchLeg!))
              .filter(poi => poi.route_distance_mi <= routeBufferForMiles(searchLeg!.miles) + 5)
          );
          storeDiscoveryResults(key, { pois: scoped, summary: `${scoped.length} place${scoped.length === 1 ? '' : 's'} along this leg` });
        } else {
          let found = routeIntelligencePois(await api.getRouteIntelligence({
            route: excursionRouteCoords(),
            center: target,
            radius: 40,
            categories: ROUTE_POI_TYPES.split(',').filter(Boolean),
            scope_id: key,
            recommended_day: activeDay,
            route_scope: 'area',
            max_samples: 1,
            include_stale: true,
            limit: 100,
          }).catch(() => null), ['fuel', 'propane', 'camp', 'camping']);
          if (found.length === 0) {
            found = await api.getNearbySmartPack(target.lat, target.lng, 40, ROUTE_POI_TYPES, excursionRouteCoords())
              .then(pack => pack.places as OsmPoi[])
              .catch(() => api.getOsmPois(target.lat, target.lng, 40, ROUTE_POI_TYPES).catch(() => []));
          }
          const offlineRoutePlaces = areaScopedOfflinePlaces(
            filteredOfflinePlaces,
            target,
            ROUTE_POI_TYPES.split(',').filter(type => type !== 'fuel' && type !== 'propane'),
            45
          );
          const routePlaces = uniqueByGeo([...found, ...offlineRoutePlaces]);
          if (routePlaces.length === 0) {
            const mapboxPlaces = uniqueByGeo(await searchRouteBuilderFallbackPois({
              points: [target],
              radiusMi: 40,
              limitPerQuery: 5,
              provider: searchMapContextNearby,
            }));
            routePlaces.push(...mapboxPlaces);
          }
          if (routePlaces.length === 0) {
            const nominatimPlaces = uniqueByGeo(await searchRouteBuilderFallbackPois({
              points: [target],
              radiusMi: 40,
              limitPerQuery: 5,
              provider: searchNominatimNearby,
            }));
            routePlaces.push(...nominatimPlaces);
          }
          const scoped = routePlaces
            .map(poi => ({ ...poi, route_distance_mi: poi.route_distance_mi ?? haversineMi(poi, target) }))
            .sort((a, b) => (a.route_distance_mi ?? 999) - (b.route_distance_mi ?? 999));
          storeDiscoveryResults(key, { pois: scoped, summary: `${scoped.length} place${scoped.length === 1 ? '' : 's'} near this area` });
        }
      }
    } catch {
      Alert.alert('Search failed', 'Could not load nearby stops right now.');
      setInlineSearch(null);
    } finally {
      setDiscoverLoading(false);
    }
  }

  async function discover() {
    const target = legContext ? legContext.center : anchor;
    if (!target) {
      Alert.alert('Add a stop first', 'Start with a city, address, or map point, then discover camps, fuel, and places nearby.');
      return;
    }
    setInlineSearch(null);
    await runDiscovery(discoverTab, target, legContext);
  }

  function addCamp(camp: CampsitePin) {
    setSelectedCamp(null);
    setShowCampDetail(false);
    const stopDay = insertTargetDay ?? activeDay;
    const nextDay = days.find(day => day > stopDay) ?? stopDay;
    const campStop: BuilderStop = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      day: stopDay,
      name: camp.name,
      lat: camp.lat,
      lng: camp.lng,
      type: 'camp',
      description: camp.description || 'Camp selected in Route Builder.',
      land_type: camp.land_type || 'camp',
      source: 'camp',
      camp,
      routeShapeRole: 'overnight',
    };
    if (replaceStopId) {
      setStops(prev => {
        const replaced = prev.map(st => st.id === replaceStopId ? {
          ...st,
          ...campStop,
          id: st.id,
          day: st.day,
          gas: undefined,
          poi: undefined,
        } : st);
        const anchorStop = replaced.find(st => st.id === replaceStopId) ?? campStop;
        return rebalanceFrameworkTargets(replaced, anchorStop);
      });
      setReplaceStopId(null);
      setInsertAfterId(null);
      setInsertTargetDay(null);
      clearDiscoveryResults();
      setActiveDay(nextDay);
      setTimeout(() => fly(camp.lat, camp.lng, 12), 80);
      return;
    }
    const targetDay = insertTargetDay ?? activeDay;
    const frameworkTarget = targetDay
      ? orderedStops.find(st => st.day === targetDay && isFrameworkTarget(st))
      : null;
    if (frameworkTarget) {
      setStops(prev => {
        const anchorStop = { ...campStop, id: frameworkTarget.id, day: frameworkTarget.day };
        return rebalanceFrameworkTargets(prev.map(st => st.id === frameworkTarget.id ? anchorStop : st), anchorStop);
      });
      setSelectedCamp(null);
      setInsertAfterId(null);
      setInsertTargetDay(null);
      clearDiscoveryResults();
      setActiveDay(nextDay);
      setTimeout(() => fly(camp.lat, camp.lng, 12), 80);
      return;
    }
    addStop({
      name: camp.name,
      lat: camp.lat,
      lng: camp.lng,
      type: 'camp',
      description: camp.description || 'Camp selected in Route Builder.',
      land_type: camp.land_type || 'camp',
      source: 'camp',
      camp,
      day: stopDay,
      routeShapeRole: 'overnight',
    });
    clearDiscoveryResults();
    setInsertAfterId(null);
    setInsertTargetDay(null);
    setActiveDay(nextDay);
    setTimeout(() => fly(camp.lat, camp.lng, 12), 80);
  }

  function addGas(station: GasStation) {
    const next = selectedNextStop;
    addStop({
      name: station.name,
      lat: station.lat,
      lng: station.lng,
      type: 'fuel',
      description: station.address || 'Fuel stop selected in Route Builder.',
      land_type: 'town',
      source: 'gas',
      gas: station,
    });
    clearDiscoveryResults();
    if (next) setTimeout(() => fly(next.lat, next.lng, 10), 90);
  }

  function addPoi(poi: OsmPoi, routePointType: BuilderStop['routePointType'] = 'side_stop') {
    const type = builderTypeForPoi(poi.type);
    addStop({
      name: poi.name || poi.type,
      lat: poi.lat,
      lng: poi.lng,
      type,
      description: `${poi.type.replace(/_/g, ' ')} stop selected in Route Builder.`,
      land_type: type === 'fuel' || type === 'motel' ? 'town' : 'route',
      source: 'poi',
      poi,
      routePointType: type === 'waypoint' ? routePointType : 'break',
    });
    clearDiscoveryResults();
  }

  function excursionRouteCoords(): [number, number][] {
    return orderedStops
      .filter(st => Number.isFinite(st.lat) && Number.isFinite(st.lng))
      .map(st => [st.lng, st.lat] as [number, number]);
  }

  function addExcursion(excursion: ExcursionCandidate, routePointType: BuilderStop['routePointType'] = 'side_stop') {
    const poi: OsmPoi = {
      id: excursion.id,
      name: excursion.name,
      lat: excursion.lat,
      lng: excursion.lng,
      type: excursion.type === 'ohv' || excursion.type === 'climbing' || excursion.type === 'historic' || excursion.type === 'park'
        ? 'attraction'
        : (excursion.type as OsmPoi['type']),
      subtype: excursion.subtype || excursion.best_for || 'excursion',
      source: excursion.source,
      source_label: excursion.source_label,
      address: [excursion.day_fit, excursion.source_confidence ? `${excursion.source_confidence} confidence` : ''].filter(Boolean).join(' · '),
      route_distance_mi: excursion.distance_from_route_mi,
    };
    addStop({
      name: excursion.name,
      lat: excursion.lat,
      lng: excursion.lng,
      type: 'waypoint',
      description: [
        excursion.summary || excursion.why_go || 'Excursion selected in Route Builder.',
        excursion.access_notes ? `Access: ${excursion.access_notes}` : '',
        excursion.risk_notes ? `Note: ${excursion.risk_notes}` : '',
      ].filter(Boolean).join(' '),
      land_type: excursion.type,
      source: 'poi',
      poi,
      routePointType,
    });
    clearDiscoveryResults();
  }

  function routeSheetPlaceFromGas(station: GasStation) {
    return {
      id: String(station.id),
      name: station.name,
      lat: station.lat,
      lng: station.lng,
      type: 'fuel',
      subtype: station.fuel_types || 'fuel',
      address: station.address,
      source: 'route_builder',
      source_label: 'Route Builder',
      route_distance_mi: station.route_distance_mi,
      route_progress: (station as any).route_progress,
      route_progress_mi: (station as any).route_progress_mi,
      route_segment_index: (station as any).route_segment_index,
      summary: station.address || 'Fuel stop found near this route leg.',
    };
  }

  function routeSheetPlaceFromPoi(poi: OsmPoi) {
    return {
      id: poi.id,
      name: poi.name || poi.type,
      lat: poi.lat,
      lng: poi.lng,
      type: poi.type,
      subtype: poi.subtype,
      address: poi.address,
      phone: poi.phone,
      website: poi.website,
      open_now: poi.open_now,
      rating: poi.rating,
      rating_count: poi.rating_count,
      photo_url: poi.photo_url,
      google_maps_uri: poi.google_maps_uri,
      provider_place_id: poi.provider_place_id,
      place_id: poi.place_id,
      source: poi.source,
      source_label: poi.source_label,
      attribution: poi.attribution,
      route_distance_mi: poi.route_distance_mi,
      route_progress: poi.route_progress,
      route_progress_mi: poi.route_progress_mi,
      route_segment_index: poi.route_segment_index,
      summary: poi.address || `${poi.type.replace(/_/g, ' ')} found near this route leg.`,
    };
  }

  function routeSheetPlaceFromExcursion(item: ExcursionCandidate) {
    return {
      id: item.id,
      name: item.name,
      lat: item.lat,
      lng: item.lng,
      type: item.type,
      subtype: item.subtype || item.best_for,
      source: item.source,
      source_label: item.source_label,
      route_distance_mi: item.distance_from_route_mi,
      route_progress: (item as any).route_progress,
      route_progress_mi: (item as any).route_progress_mi,
      route_segment_index: (item as any).route_segment_index,
      summary: item.summary || item.why_go,
      access_note: item.access_notes || item.risk_notes,
      length_mi: item.length_mi,
    };
  }

  function openRoutePlace(selection: RoutePlaceSelection) {
    setActiveDay(selection.day);
    setInsertTargetDay(selection.day);
    setSelectedRoutePlace(selection);
    fly(selection.place.lat, selection.place.lng, 13);
  }

  function selectedRoutePlaceContextLabel(selection: RoutePlaceSelection | null) {
    if (!selection) return '';
    const data = selection.kind === 'excursion' ? selection.place : selection.data as any;
    return [
      `Day ${selection.day}`,
      routeProgressLabel(data.route_progress),
      data.route_progress_mi != null ? `${fmtRouteDistance(Number(data.route_progress_mi))} into leg` : '',
      data.route_distance_mi != null ? `${fmtRouteDistance(Number(data.route_distance_mi))} off route` : '',
    ].filter(Boolean).join(' · ');
  }

  function addSelectedRoutePlace(promote = false) {
    if (!selectedRoutePlace) return;
    if (selectedRoutePlace.kind === 'gas') {
      addGas(selectedRoutePlace.data);
    } else if (selectedRoutePlace.kind === 'excursion') {
      addExcursion(selectedRoutePlace.data, promote ? 'through' : 'side_stop');
    } else {
      addPoi(selectedRoutePlace.data, promote ? 'through' : 'side_stop');
    }
    setSelectedRoutePlace(null);
  }

  function removeStop(id: string) {
    if (insertAfterId === id) setInsertAfterId(null);
    if (insertAfterId === id) setInsertTargetDay(null);
    if (replaceStopId === id) setReplaceStopId(null);
    setStops(prev => prev.filter(st => st.id !== id));
  }

  function selectInsertStop(stop: BuilderStop) {
    setInsertAfterId(prev => {
      const next = prev === stop.id ? null : stop.id;
      setInsertTargetDay(next ? stop.day : null);
      return next;
    });
    setActiveDay(stop.day);
    fly(stop.lat, stop.lng, 13);
  }

  function scanBetweenStops(from: BuilderStop, to: BuilderStop, tab: DiscoveryTab, targetDay = from.day, purpose: LegSearchContext['purpose'] = 'leg', inline = true) {
    const miles = haversineMi(from, to);
    const leg = { from, to, miles, center: midpoint(from, to), targetDay, purpose };
    setInsertAfterId(stops.some(stop => stop.id === from.id) ? from.id : null);
    setInsertTargetDay(targetDay);
    setActiveDay(targetDay);
    setDiscoverTab(tab);
    setInlineSearch(inline ? {
      day: targetDay,
      tab,
      label: tab === 'camps'
        ? `Choose an overnight near Day ${targetDay} endpoint`
        : `Add ${tab === 'gas' ? 'fuel' : tab === 'excursions' ? 'side trips' : 'places'} between ${from.name.split(',')[0]} and ${to.name.split(',')[0]}`,
    } : null);
    runDiscovery(tab, leg.center, leg, { focusMap: false });
  }

  function scanDayPlan(plan: RouteDayPlan, tab: DiscoveryTab) {
    if (tab === 'camps' && !plan.needsCamp && campCadenceMode === 'alternate') {
      const campPlan = routeDayPlans.find(dayPlan => dayPlan.day === plan.campWindowEnd) ?? plan;
      if (campPlan.day !== plan.day) {
        scanDayPlan(campPlan, tab);
        return;
      }
    }
    setActiveDay(plan.day);
    const routableStops = plan.stops.filter(st => st.routePointType !== 'side_stop');
    const providerSegment = routeDaySegments.find(segment => segment.day === plan.day);
    const segmentStart: BuilderStop | null = providerSegment
      ? {
          id: `day_${plan.day}_route_start`,
          day: plan.day,
          name: `Day ${plan.day} start`,
          lat: providerSegment.startPoint.lat,
          lng: providerSegment.startPoint.lng,
          type: 'waypoint',
          description: 'Temporary day route point.',
          land_type: 'route',
          source: 'map',
          routePointType: 'through',
        }
      : null;
    const segmentEnd: BuilderStop | null = providerSegment
      ? {
          id: `day_${plan.day}_route_end`,
          day: plan.day,
          name: `Day ${plan.day} area`,
          lat: providerSegment.endPoint.lat,
          lng: providerSegment.endPoint.lng,
          type: 'waypoint',
          description: 'Temporary day route point.',
          land_type: 'route',
          source: 'map',
          routePointType: 'through',
          routeShapeRole: 'outbound_anchor',
        }
      : null;
    const from = plan.previous ?? routableStops[0] ?? segmentStart ?? plan.stops[0] ?? null;
    const to = tab === 'camps'
      ? plan.target ?? segmentEnd ?? plan.stops[plan.stops.length - 1] ?? null
      : routableStops[routableStops.length - 1] ?? plan.target ?? segmentEnd ?? null;
    if (from && to && from.id !== to.id) {
      scanBetweenStops(from, to, tab, plan.day, tab === 'camps' ? 'overnight' : 'leg');
      return;
    }
    if (to) {
      setDiscoverTab(tab);
      setInsertTargetDay(plan.day);
      setInlineSearch({
        day: plan.day,
        tab,
        label: tab === 'camps' ? `Choose a camp near Day ${plan.day}` : `Add ${tab === 'gas' ? 'fuel' : tab === 'excursions' ? 'side trips' : 'places'} near Day ${plan.day}`,
      });
      runDiscovery(tab, { lat: to.lat, lng: to.lng }, null, { focusMap: false });
      return;
    }
    const fallbackTarget = plan.previous ?? orderedStops[orderedStops.length - 1] ?? anchor;
    if (fallbackTarget) {
      setDiscoverTab(tab);
      setInsertTargetDay(plan.day);
      setInlineSearch({
        day: plan.day,
        tab,
        label: tab === 'camps'
          ? `Choose a camp near Day ${plan.day}`
          : `Add ${tab === 'gas' ? 'fuel' : tab === 'excursions' ? 'side trips' : 'places'} near Day ${plan.day}`,
      });
      runDiscovery(tab, { lat: fallbackTarget.lat, lng: fallbackTarget.lng }, null, { focusMap: false });
      return;
    }
    setInlineSearch(null);
    Alert.alert('Pick a route point', 'Add a start and destination, or tap a place on the map so Trailhead can search nearby options.');
  }

  function rerunInlineSearch(day: number, tab: DiscoveryTab) {
    const plan = routeDayPlans.find(item => item.day === day);
    if (plan) {
      scanDayPlan(plan, tab);
      return;
    }
    const fallbackTarget = orderedStops.find(stop => stop.day === day) ?? orderedStops[orderedStops.length - 1] ?? anchor;
    if (!fallbackTarget) return;
    setDiscoverTab(tab);
    setInlineSearch({
      day,
      tab,
      label: tab === 'camps'
        ? `Choose a camp near Day ${day}`
        : `Add ${tab === 'gas' ? 'fuel' : tab === 'excursions' ? 'side trips' : 'places'} near Day ${day}`,
    });
    runDiscovery(tab, { lat: fallbackTarget.lat, lng: fallbackTarget.lng }, null, { focusMap: false });
  }

  function renderInlineEmptyState(day: number, tab: DiscoveryTab) {
    const title = tab === 'camps'
      ? 'No camp cards landed on this day segment.'
      : tab === 'gas'
        ? 'No fuel stops landed on this day segment.'
        : tab === 'excursions'
          ? 'No side trips landed on this day segment.'
          : 'No place cards landed on this day segment.';
    const hint = tab === 'camps'
      ? campPhotoOnly
        ? 'Photo-only is still on. Open the search to no-photo camp backups or rerun the segment scan.'
        : 'Rerun the segment scan or keep building and search a wider map area from the day stop.'
      : tab === 'gas'
        ? 'Rerun the segment scan. Fuel often appears once the route day or nearby town is tightened up.'
        : tab === 'excursions'
          ? 'Rerun the segment scan or use the map after you lock in the day route.'
          : 'Rerun the segment scan or use the map to search a wider area around this day.';
    return (
      <View style={s.inlineEmptyCard}>
        <Text style={s.inlineEmpty}>{title}</Text>
        <Text style={s.inlineEmptyHint}>{hint}</Text>
        <View style={s.inlineEmptyActions}>
          {tab === 'camps' && campPhotoOnly ? (
            <TouchableOpacity
              style={s.sectionAction}
              onPress={() => {
                setCampPhotoOnly(false);
                rerunInlineSearch(day, tab);
              }}
            >
              <Ionicons name="images-outline" size={13} color={C.orange} />
              <Text style={s.sectionActionText}>ALLOW NO-PHOTO</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={s.sectionAction} onPress={() => rerunInlineSearch(day, tab)}>
            <Ionicons name="refresh-outline" size={13} color={C.orange} />
            <Text style={s.sectionActionText}>SEARCH AGAIN</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  function replaceCampStop(stop: BuilderStop) {
    const sortedIdx = orderedStops.findIndex(st => st.id === stop.id);
    const from = orderedStops[sortedIdx - 1] ?? orderedStops[sortedIdx];
    const leg = from && from.id !== stop.id
      ? { from, to: stop, miles: haversineMi(from, stop), center: midpoint(from, stop), targetDay: stop.day, purpose: 'overnight' as const }
      : null;
    setReplaceStopId(stop.id);
    setInsertAfterId(from?.id ?? null);
    setInsertTargetDay(stop.day);
    setActiveDay(stop.day);
    setDiscoverTab('camps');
    setInlineSearch({ day: stop.day, tab: 'camps', label: `Swap the Day ${stop.day} camp` });
    if (leg) runDiscovery('camps', leg.center, leg, { focusMap: false });
    else runDiscovery('camps', { lat: stop.lat, lng: stop.lng }, null, { focusMap: false });
  }

  function moveStop(id: string, dir: -1 | 1) {
    setStops(prev => {
      const dayList = prev.filter(st => st.day === activeDay);
      const idx = dayList.findIndex(st => st.id === id);
      const swap = idx + dir;
      if (idx < 0 || swap < 0 || swap >= dayList.length) return prev;
      const nextDayList = [...dayList];
      [nextDayList[idx], nextDayList[swap]] = [nextDayList[swap], nextDayList[idx]];
      const next: BuilderStop[] = [];
      for (const st of prev) {
        if (st.day === activeDay) {
          const replacement = nextDayList.shift();
          if (replacement) next.push(replacement);
        } else {
          next.push(st);
        }
      }
      return next;
    });
  }

  async function openCampDetail(camp: CampsitePin) {
    setSelectedCamp(camp);
    setCampDetail(null);
    setCampInsight(null);
    setShowCampDetail(false);
    setCampWeather(null);
    setCampFullness(null);
    fly(camp.lat, camp.lng, 13);
    api.getWeather(camp.lat, camp.lng, 3, weatherUnitMode).then(setCampWeather).catch(() => {});
    if (camp.id) api.getCampFullness(camp.id).then(setCampFullness).catch(() => {});
    if (camp.id) {
      api.getCampsiteDetail(camp.id)
        .then(detail => enrichCampDetailWithGoogle(detail, camp))
        .then(detail => {
          if (selectedCampRef.current?.id === camp.id) setCampDetail({ ...detail, description: stripHtml(detail.description) });
        })
        .catch(() => {});
    }
  }

  async function loadFullCampDetail() {
    if (!selectedCamp) return;
    const camp = selectedCamp;
    setDetailLoading(true);
    try {
      const detail = await enrichCampDetailWithGoogle(await api.getCampsiteDetail(camp.id), camp);
      if (selectedCampRef.current?.id !== camp.id) {
        setDetailLoading(false);
        return;
      }
      const insight = await api.getCampsiteInsight({
        name: camp.name,
        lat: camp.lat,
        lng: camp.lng,
        description: stripHtml(detail.description || camp.description),
        land_type: detail.land_type || camp.land_type,
        amenities: detail.amenities ?? [],
        facility_id: camp.id ?? '',
      });
      if (selectedCampRef.current?.id !== camp.id) {
        setDetailLoading(false);
        return;
      }
      setCampDetail({ ...detail, description: stripHtml(detail.description) });
      setCampInsight(insight);
      setShowCampDetail(true);
    } catch (e: any) {
      if (e instanceof PaywallError) {
        setPaywallCode(e.code || 'camp_detail');
        setPaywallMessage(e.message || 'Use credits to open full campsite profiles. You can still add this camp to your route from the free preview.');
        setPaywallVisible(true);
      } else {
        const fallbackDetail = await enrichCampDetailWithGoogle({
          ...camp,
          photos: camp.photo_url ? [camp.photo_url] : [],
          amenities: camp.amenities ?? [],
          site_types: camp.site_types ?? camp.tags ?? [],
          activities: [],
          campsites_count: 0,
          source: camp.verified_source ?? camp.source,
          source_confidence_notes: camp.source_freshness,
          description: stripHtml(camp.description) || 'This camp has a route preview, but a full profile has not been built yet. You can still add it to the trip and replace it later from the route.',
        } as CampsiteDetail, camp);
        if (selectedCampRef.current?.id !== camp.id) {
          setDetailLoading(false);
          return;
        }
        setCampDetail(fallbackDetail);
        setCampInsight(null);
        setShowCampDetail(true);
      }
    } finally {
      setDetailLoading(false);
    }
  }

  function closeCampDetail() {
    setShowCampDetail(false);
    setSelectedCamp(null);
    setCampDetail(null);
    setCampInsight(null);
    setCampGalleryIndex(null);
    setCampWeather(null);
    setCampFullness(null);
  }

  async function enrichCampDetailWithGoogle(detail: CampsiteDetail, camp: CampsitePin): Promise<CampsiteDetail> {
    return detail;
  }

  function addDay() {
    const next = Math.max(...days) + 1;
    setDays(prev => [...prev, next]);
    setActiveDay(next);
  }

  function ensureCampForDay(campStop: BuilderStop, targetDay: number, rest = false) {
    setDays(prev => prev.includes(targetDay) ? prev : [...prev, targetDay].sort((a, b) => a - b));
    setStops(prev => {
      const hasSameCamp = prev.some(st => st.day === targetDay && (st.type === 'camp' || st.type === 'motel') && closeEnough(st, campStop));
      const withoutFrameworkTarget = prev.filter(st => !(st.day === targetDay && isFrameworkTarget(st)));
      if (hasSameCamp) return withoutFrameworkTarget;
      const clone: BuilderStop = {
        ...campStop,
        id: `rest_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        day: targetDay,
        type: campStop.type === 'motel' ? 'motel' : 'camp',
        description: rest ? `Rest day at ${campStop.name}.` : campStop.description,
        gas: undefined,
        poi: undefined,
      };
      return [...withoutFrameworkTarget, clone];
    });
    if (rest) setRestDays(prev => prev.includes(targetDay) ? prev : [...prev, targetDay].sort((a, b) => a - b));
    setActiveDay(targetDay);
    setInsertAfterId(null);
    setInsertTargetDay(null);
    setReplaceStopId(null);
    fly(campStop.lat, campStop.lng, 12);
  }

  function stayAtCampNextDay(campStop: BuilderStop) {
    ensureCampForDay(campStop, campStop.day + 1, true);
  }

  function stayAtCampTwoNights(campStop: BuilderStop) {
    ensureCampForDay(campStop, campStop.day + 1, true);
    ensureCampForDay(campStop, campStop.day + 2, true);
  }

  function toggleRestDay(day: number) {
    if (restDays.includes(day)) {
      setRestDays(prev => prev.filter(d => d !== day));
      return;
    }
    const sameDayCamp = [...orderedStops].reverse().find(st => st.day === day && (st.type === 'camp' || st.type === 'motel')) ?? null;
    const previousCamp = [...orderedStops].reverse().find(st => st.day < day && (st.type === 'camp' || st.type === 'motel')) ?? null;
    const camp = sameDayCamp ?? previousCamp;
    if (camp) {
      ensureCampForDay(camp, day, true);
      return;
    }
    setRestDays(prev => [...prev, day].sort((a, b) => a - b));
  }

  async function addDestinationFromSetup(manageLoading = true) {
    const q = endQuery.trim();
    if (!q) {
      Alert.alert('Destination needed', 'Enter the place you want to end up at, then build the trip outline.');
      return null;
    }
    if (manageLoading) setBuildingFramework(true);
    try {
      let start = orderedStops[0] ?? null;
      const startQ = startQuery.trim();
      if (startQ) {
        const [startPlace] = await geocodePlaces(startQ);
        if (!startPlace) {
          Alert.alert('Start not found', 'Try a city, address, trailhead, or map point for the route start.');
          return null;
        }
        start = {
          id: `start_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          day: 1,
          name: startPlace.name,
          lat: startPlace.lat,
          lng: startPlace.lng,
          type: 'start',
          description: 'Route start.',
          land_type: 'route',
          source: 'search',
          routeShapeRole: 'start',
        };
      } else if (!start && userLoc) {
        start = {
          id: `start_${Date.now()}`,
          day: 1,
          name: 'Current location',
          lat: userLoc.lat,
          lng: userLoc.lng,
          type: 'start' as BuilderStopType,
          description: 'Route start.',
          land_type: 'route',
          source: 'map' as const,
          routeShapeRole: 'start',
        };
      } else if (!start && !startQ) {
        const loc = await getRouteBuilderLocation();
        if (!loc) return null;
        start = {
          id: `start_${Date.now()}`,
          day: 1,
          name: 'Current location',
          lat: loc.lat,
          lng: loc.lng,
          type: 'start' as BuilderStopType,
          description: 'Route start.',
          land_type: 'route',
          source: 'map' as const,
          routeShapeRole: 'start',
        };
      }
      const [place] = await geocodePlaces(q);
      if (!place) {
        Alert.alert('Destination not found', 'Try a city, campground, park, trailhead, or map point.');
        return null;
      }
      if (!start) {
        Alert.alert('Start needed', 'Add a start point or allow location so Trailhead knows where the route begins.');
        return null;
      }
      const destination: BuilderStop = {
        id: `dest_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        day: Math.max(1, Math.round(parsePositiveNumber(plannedDays) ?? 3)),
        name: place.name,
        lat: place.lat,
        lng: place.lng,
        type: 'waypoint',
        description: 'Route destination.',
        land_type: 'route',
        source: 'search',
        routeShapeRole: 'destination',
      };
      const next = orderedStops.length
        ? [start, ...orderedStops.slice(1, Math.max(1, orderedStops.length - 1)), destination]
        : [start, destination];
      setStops(next);
      setEndQuery('');
      fly((start.lat + destination.lat) / 2, (start.lng + destination.lng) / 2, 5);
      return next;
    } finally {
      if (manageLoading) setBuildingFramework(false);
    }
  }

  function straightRouteSpine(first: BuilderStop, last: BuilderStop, count = 60) {
    const directMi = haversineMi(first, last);
    const loopOffset = Math.max(22, Math.min(90, directMi * 0.12));
    if (tripShapeMode === 'loop') {
      const outbound = Array.from({ length: count }, (_, idx) => {
        const t = count <= 1 ? 0 : idx / (count - 1);
        return scenicPoint(first, last, t, loopOffset);
      });
      const inbound = Array.from({ length: count }, (_, idx) => {
        const t = count <= 1 ? 0 : idx / (count - 1);
        return scenicPoint(last, first, t, loopOffset);
      });
      return [...outbound, ...inbound.slice(1)];
    }
    const points = Array.from({ length: count }, (_, idx) => {
      const t = count <= 1 ? 0 : idx / (count - 1);
      return scenicPoint(
        first,
        last,
        t,
        routeStyle === 'wild' ? Math.max(18, Math.min(60, directMi * 0.055)) * Math.sin(Math.PI * t) : 0
      );
    });
    if (tripShapeMode === 'there_and_back' && points.length > 1) return [...points, ...points.slice(0, -1).reverse()];
    return points;
  }

  async function buildBridgeRoute(
    locations: Array<{ lat: number; lng: number; type?: 'break' | 'through' }>,
    opts: { backRoads: boolean; avoidHighways: boolean; avoidTolls: boolean; noFerries: boolean },
    units: 'miles' | 'kilometers',
  ) {
    try {
      return await api.mapContextRouteBuild(locations, opts, units);
    } catch (err) {
      console.warn('Route Builder Mapbox bridge route failed; falling back to Trailhead route', err instanceof Error ? err.message : err);
      return api.buildRoute(locations, opts, units);
    }
  }

  async function buildRouteSpine(first: BuilderStop, last: BuilderStop): Promise<RouteSpineBuild | null> {
    if (closeEnough(first, last)) {
      setRouteGeometry(null);
      return null;
    }
    const directMi = haversineMi(first, last);
    if (directMi > 2800 && Math.abs(first.lng - last.lng) > 45) {
      Alert.alert(
        'Route needs correction',
        'Those route points look like an unsupported long jump. Add realistic land-route stops or keep this route inside Trailhead supported regions.'
      );
      setRouteGeometry(null);
      return null;
    }
    try {
      const opts = {
        backRoads: routeStyle === 'wild',
        avoidHighways: routeStyle === 'wild',
        avoidTolls: true,
        noFerries: false,
      };
      const locations = buildRouteLocationsForShape({
        shape: tripShapeMode,
        start: first,
        destination: last,
        routeStyle,
      });
      const units = routeUnitsParam(weatherUnitMode);
      const routed = await buildBridgeRoute(locations.map(loc => ({ lat: loc.lat, lng: loc.lng, type: loc.type })), opts, units);
      const geometry = providerGeometryFromRoute(routed, units);
      if (geometry.coords.length >= 2) {
        setRouteGeometry(geometry);
        return { spine: coordsToStops(geometry.coords), geometry };
      }
      setRouteGeometry(null);
      Alert.alert('Route unavailable', 'Trailhead could not build a road route for this outline. Add a road anchor, allow ferries, or save it as a draft after choosing real stops.');
      return null;
    } catch (e: any) {
      setRouteGeometry(null);
      if (e instanceof ApiError && e.status === 422) {
        const detail: any = e.detail;
        Alert.alert('Route needs correction', detail?.reason || e.message || 'This route cannot be built safely.');
        return null;
      }
      Alert.alert('Route unavailable', 'Trailhead could not build a road route right now. Try a shorter leg, add a road anchor, or check signal.');
      return null;
    }
  }

  async function buildSavedRouteGeometry(inputStops: BuilderStop[]): Promise<SavedRouteGeometryPayload | null> {
    const navStops = filterDurableNavigationStops(orderBuilderStops(inputStops));
    if (navStops.length < 2) return null;
    try {
      const units = routeUnitsParam(weatherUnitMode);
      const routed = await buildBridgeRoute(
        navStops.map(st => ({
          lat: st.lat,
          lng: st.lng,
          type: st.routePointType === 'through' ? 'through' as const : 'break' as const,
        })),
        {
          backRoads: routeStyle === 'wild',
          avoidHighways: routeStyle === 'wild',
          avoidTolls: true,
          noFerries: false,
        },
        units,
      );
      const geometry = providerGeometryFromRoute(routed, units);
      if (geometry.coords.length < 2) return null;
      setRouteGeometry(geometry);
      return {
        coords: geometry.coords,
        totalDistance: geometry.totalDistanceMi * 1609.344,
        totalDuration: geometry.totalDurationHours * 3600,
        source: geometry.engine ?? 'route-builder',
        ts: Date.now(),
      };
    } catch (err) {
      console.warn('Route Builder geometry save route failed', err instanceof Error ? err.message : err);
      return null;
    }
  }

  async function findCampAwareAnchor(day: number, count: number, spine: Array<{ lat: number; lng: number }>, totalMi: number) {
    const targetMi = routeTargetMile(day, count, totalMi, routeStyle);
    const target = pointAtRouteMile(spine, targetMi) ?? spine[Math.min(spine.length - 1, Math.max(0, Math.round((day / count) * (spine.length - 1))))];
    const searchWindowMi = Math.max(24, Math.min(70, totalMi / Math.max(2, count) * 0.55));
    const samples = routeWindowPoints(spine, targetMi, searchWindowMi)
      .filter((point, idx, arr) => idx === 0 || idx === arr.length - 1 || idx % Math.max(1, Math.floor(arr.length / 4)) === 0)
      .slice(0, 6);
    const radius = Math.max(28, Math.min(58, searchWindowMi * 0.65));
    let found = routeIntelligenceCamps(await api.getRouteIntelligence({
      route: samples.map(point => [point.lng, point.lat] as [number, number]),
      center: target,
      radius,
      categories: ['camp', 'camping'],
      scope_id: `camp-anchor-${day}-${Math.round(targetMi)}`,
      recommended_day: day,
      route_scope: 'leg',
      max_samples: samples.length,
      include_stale: true,
      limit: 120,
    }).catch(() => null)).filter(camp => campMatchesFilters(camp, campTypeFilters));
    if (found.length === 0) {
      found = uniqueByGeo((await Promise.all(
        samples.map(point => api.getNearbyCamps(point.lat, point.lng, radius, campTypeFilters).catch(() => [] as CampsitePin[]))
      )).flat());
    }
    const scored = found
      .map(camp => {
        const routeDistance = Math.min(...samples.map(sample => haversineMi(camp, sample)));
        const endpointDistance = haversineMi(camp, target);
        return {
          ...camp,
          route_distance_mi: routeDistance,
          route_progress: totalMi > 0 ? targetMi / totalMi : day / count,
          route_progress_mi: targetMi,
          _score: endpointDistance * 0.75 + routeDistance * 0.9 + campPreferenceScore({ ...camp, route_distance_mi: routeDistance }),
        };
      })
      .filter(camp => (camp.route_distance_mi ?? 999) <= routeBufferForMiles(totalMi / Math.max(1, count)) + 22)
      .sort((a, b) => a._score - b._score);

    const best = scored[0];
    if (best) {
      const strong = (best.route_distance_mi ?? 999) <= 22 && haversineMi(best, target) <= 42;
      return {
        stop: {
          id: `camp_anchor_${Date.now()}_${day}_${Math.random().toString(36).slice(2, 6)}`,
          day,
          name: best.name,
          lat: best.lat,
          lng: best.lng,
          type: 'camp' as BuilderStopType,
          description: `Picked for Day ${day}. Swap it if you want a different camp or distance.`,
          land_type: best.land_type || 'camp',
          source: 'camp' as const,
          camp: best,
          routeShapeRole: 'overnight' as const,
        },
        strong,
        found: scored.length,
      };
    }

    return {
      stop: {
        id: `target_${Date.now()}_${day}_${Math.random().toString(36).slice(2, 6)}`,
        day,
        name: `Day ${day} review area`,
        lat: target.lat,
        lng: target.lng,
        type: 'waypoint' as BuilderStopType,
        description: 'Review this day. Choose an overnight stop before navigation.',
        land_type: 'route',
        source: 'map' as const,
        routeShapeRole: 'outbound_anchor' as const,
      },
      strong: false,
      found: 0,
    };
  }

  async function findCampAwareAnchors(count: number, sourceDays: number[], spine: Array<{ lat: number; lng: number }>, totalMi: number) {
    const campDays = sourceDays.filter(day => dayNeedsCampFor(day, sourceDays));
    const windows = campDays.map(day => {
      const targetMi = routeTargetMile(day, count, totalMi, routeStyle);
      const searchWindowMi = Math.max(24, Math.min(70, totalMi / Math.max(2, count) * 0.55));
      const window = campWindowFor(day, sourceDays);
      return {
        day,
        start: window.start,
        end: window.end,
        label: window.label,
        target_mi: targetMi,
        search_window_mi: searchWindowMi,
      };
    });
    if (!windows.length) return [];
    try {
      const result = await api.getRouteCampWindows({
        route: spine,
        windows,
        camp_filters: campTypeFilters,
        route_style: routeStyle,
        camp_preference: campPreferenceMode,
        require_photos: campPhotoOnly,
        region_hint: routeStates.join(','),
        camp_reuse_policy: effectiveCampReusePolicy,
        max_daily_drive_hours: parsePositiveNumber(driveHoursPerDay) ?? undefined,
        max_radius: 90,
      });
      return result.windows.map(originalWin => {
        const win = originalWin;
        const selectedCamp = win.selected ?? win.camp ?? win.candidates?.[0] ?? null;
        if (selectedCamp) {
          const needsReview = win.confidence !== 'strong' && !win.strong;
          return {
            stop: {
              id: `camp_anchor_${Date.now()}_${win.day}_${Math.random().toString(36).slice(2, 6)}`,
              day: win.day,
              name: selectedCamp.name,
              lat: selectedCamp.lat,
              lng: selectedCamp.lng,
              type: 'camp' as BuilderStopType,
              description: needsReview
                ? `Review this overnight option for ${win.label}. Swap it if you want a better fit.`
                : `Picked for ${win.label}. Swap it if you want a different camp or distance.`,
              land_type: selectedCamp.land_type || 'camp',
              source: 'camp' as const,
              camp: {
                ...selectedCamp,
                source_freshness: selectedCamp.source_freshness || win.reason,
              },
              campWindowStart: win.start,
              campWindowEnd: win.end,
              campWindowLabel: win.label,
              routeShapeRole: 'overnight' as const,
            },
            strong: !needsReview,
            found: win.found ?? win.candidates?.length ?? 1,
          };
        }
        const fallbackPoint = pointAtRouteMile(spine, windows.find(w => w.day === win.day)?.target_mi ?? 0)
          ?? spine[Math.min(spine.length - 1, Math.max(0, Math.round((win.day / count) * (spine.length - 1))))];
        const target = {
          lat: win.fallback?.lat ?? fallbackPoint.lat,
          lng: win.fallback?.lng ?? fallbackPoint.lng,
          name: win.fallback?.name ?? win.fallback_label ?? `${win.label} review area`,
          description: win.fallback?.description ?? 'Review this day. Choose an overnight stop before navigation.',
        };
        return {
          stop: {
            id: `target_${Date.now()}_${win.day}_${Math.random().toString(36).slice(2, 6)}`,
            day: win.day,
            name: target.name,
            lat: target.lat,
            lng: target.lng,
            type: 'waypoint' as BuilderStopType,
            description: target.description,
            land_type: 'route',
            source: 'map' as const,
            campWindowStart: win.start,
            campWindowEnd: win.end,
            campWindowLabel: win.label,
            routeShapeRole: 'outbound_anchor' as const,
          },
          strong: false,
          found: win.found,
        };
      });
    } catch {
      const anchors = [];
      for (const day of campDays) {
        setFrameworkStatus(`Finding overnight options for ${campWindowFor(day, sourceDays).label}...`);
        anchors.push(await findCampAwareAnchor(day, count, spine, totalMi));
      }
      return anchors;
    }
  }

  async function findFuelStopsForRoute(count: number, spine: Array<{ lat: number; lng: number }>, totalMi: number) {
    const rigRange = parsePositiveNumber(rigProfile?.fuel_range_miles);
    const inferredRange = Math.max(180, Math.min(320, planningStats.mpg * 15));
    const usableRange = Math.max(120, Math.min(500, rigRange ?? inferredRange));
    if (totalMi < usableRange * 0.75) return [] as BuilderStop[];
    const intervalMi = Math.max(95, Math.min(260, usableRange * 0.68));
    const targetMiles: number[] = [];
    for (let mile = intervalMi; mile < totalMi - Math.min(60, intervalMi * 0.45); mile += intervalMi) {
      targetMiles.push(mile);
      if (targetMiles.length >= 8) break;
    }
    const placed: GasStation[] = [];
    const stops: BuilderStop[] = [];
    for (const targetMi of targetMiles) {
      const target = pointAtRouteMile(spine, targetMi);
      if (!target) continue;
      setFrameworkStatus(`Checking fuel around mile ${Math.round(targetMi)}...`);
      const radius = Math.max(28, Math.min(55, intervalMi * 0.22));
      let liveFuel = routeIntelligenceFuel(await api.getRouteIntelligence({
        center: target,
        radius,
        categories: ['fuel', 'propane'],
        scope_id: `fuel-anchor-${Math.round(targetMi)}`,
        route_scope: 'area',
        max_samples: 1,
        include_stale: true,
        limit: 60,
      }).catch(() => null));
      if (liveFuel.length === 0) {
        const [liveGas, osmFuel] = await Promise.all([
          api.getGas(target.lat, target.lng, radius).catch(() => [] as GasStation[]),
          api.getOsmPois(target.lat, target.lng, radius, FUEL_POI_TYPES).catch(() => [] as OsmPoi[]),
        ]);
        liveFuel = uniqueByGeo([...liveGas, ...osmFuel.map(poiToGasStation)]);
      }
      const offlineFuel = areaScopedOfflinePlaces(offlinePlaces, target, ['fuel', 'propane'], radius + 12).map(poiToGasStation);
      const candidates = uniqueByGeo([
        ...liveFuel,
        ...offlineFuel,
      ])
        .filter(station => !placed.some(existing => haversineMi(existing, station) < 45))
        .map(station => ({
          ...station,
          route_distance_mi: haversineMi(station, target),
          route_progress: totalMi > 0 ? targetMi / totalMi : 0,
          route_progress_mi: targetMi,
        }))
        .filter(station => (station.route_distance_mi ?? 999) <= radius + 8)
        .sort((a, b) => (a.route_distance_mi ?? 999) - (b.route_distance_mi ?? 999));
      const best = candidates[0];
      if (!best) continue;
      placed.push(best);
      const day = Math.max(1, Math.min(count, Math.ceil((targetMi / Math.max(totalMi, 1)) * count)));
      stops.push({
        id: `fuel_anchor_${Date.now()}_${day}_${Math.random().toString(36).slice(2, 6)}`,
        day,
        name: best.name || 'Fuel stop',
        lat: best.lat,
        lng: best.lng,
        type: 'fuel',
        description: `Auto-added because this route may exceed usable rig range (${Math.round(usableRange)} mi).`,
        land_type: 'town',
        source: 'gas',
        gas: best,
        routePointType: 'break',
      });
    }
    return stops;
  }

  async function buildRouteFramework() {
    setBuildingFramework(true);
    setFrameworkStatus('Setting up your trip...');
    let base = orderedStops;
    try {
      if (endQuery.trim()) {
        const next = await addDestinationFromSetup(false);
        if (!next) return;
        base = next;
      }
      if (base.length < 2) {
        Alert.alert('Start and end needed', 'Add a start and destination first. Trailhead will split the route into camp-aware day areas from there.');
        return;
      }
      const first = base[0];
      const last = base[base.length - 1];
      const roughMiles = haversineMi(first, last) * (tripLoop ? 2 : 1);
      const plannedCount = parsePositiveNumber(plannedDays) ?? days.length ?? 3;
      const milesCount = Math.ceil(roughMiles / (parsePositiveNumber(targetMiles) ?? 180));
      const count = Math.max(1, Math.min(30, Math.round(distanceMode === 'miles' ? milesCount : plannedCount)));
      const nextDays = Array.from({ length: count }, (_, i) => i + 1);
      const framework: BuilderStop[] = [
        { ...first, day: 1, type: first.type === 'start' ? 'start' : first.type, routeShapeRole: 'start' },
      ];

      const spineBuild = await buildRouteSpine(first, last);
      if (!spineBuild || spineBuild.spine.length < 2) return;
      const { spine, geometry: buildGeometry } = spineBuild;
      const routeMiles = routeDistanceMi(spine) || roughMiles;
      let strongAnchors = 0;
      let weakAnchors = 0;

      if (tripBuildMode === 'recommended') {
        setFrameworkStatus('Finding overnight options...');
        const anchors = await findCampAwareAnchors(count, nextDays, spine, routeMiles);
        for (const anchor of anchors) {
          framework.push(anchor.stop);
          if (anchor.strong) strongAnchors += 1;
          else weakAnchors += 1;
        }
      }
      setFrameworkStatus('Checking fuel range and resupply...');
      const fuelStops = await findFuelStopsForRoute(count, spine, routeMiles);
      framework.push(...fuelStops);

      if (tripLoop) {
        framework.push({
          ...last,
          id: `dest_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          day: Math.max(1, Math.min(count, Math.ceil(count / 2))),
          type: 'waypoint',
          description: tripShapeMode === 'loop'
            ? 'Outbound destination before the distinct return corridor.'
            : 'Turnaround destination before returning to the start.',
          source: last.source ?? 'search',
          routeShapeRole: 'destination',
        });
        framework.push({
          ...first,
          id: `return_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          day: count,
          type: 'waypoint',
          name: `${first.name.split(',')[0]} return`,
          description: tripShapeMode === 'loop'
            ? 'Loop return to the route start using a distinct return corridor.'
            : 'There-and-back return to the route start.',
          source: 'map',
          routeShapeRole: 'return_anchor',
        });
      } else {
        framework.push({ ...last, day: count, routeShapeRole: 'destination' });
      }
      const shapeLabel = tripShapeMode === 'loop' ? 'Loop' : tripShapeMode === 'there_and_back' ? 'There and Back' : '';
      const nextName = routeName.trim() || (tripLoop ? `${first.name.split(',')[0]} to ${last.name.split(',')[0]} ${shapeLabel}` : `${first.name.split(',')[0]} to ${last.name.split(',')[0]}`);
      const status = tripBuildMode === 'recommended'
        ? weakAnchors
          ? `${strongAnchors} camp stop${strongAnchors === 1 ? '' : 's'} placed; ${weakAnchors} day${weakAnchors === 1 ? '' : 's'} need review.${fuelStops.length ? ` ${fuelStops.length} fuel stop${fuelStops.length === 1 ? '' : 's'} added.` : ''}`
          : `${strongAnchors} camp stop${strongAnchors === 1 ? '' : 's'} placed from route search.${fuelStops.length ? ` ${fuelStops.length} fuel stop${fuelStops.length === 1 ? '' : 's'} added.` : ''}`
        : 'Route ready for hand-building.';
      setFrameworkStatus(status);
      setDays(nextDays);
      setStops(framework);
      setActiveDay(1);
      setInsertAfterId(null);
      setInsertTargetDay(null);
      setRouteName(nextName);
      setFrameworkStatus('Route built. Preparing your trip overview...');
      await commitTrip(
        buildTrip(framework, nextDays, nextName, buildGeometry),
        true,
        ROUTE_BUILDER_MAP_SETTLE_MS,
        framework,
        nextDays,
        nextName,
        buildGeometry,
      );
    } finally {
      setBuildingFramework(false);
    }
  }

  useEffect(() => {
    if (!copilotAutoBuildRunId || buildingFramework) return;
    const timer = setTimeout(() => {
      buildRouteFramework().catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [copilotAutoBuildRunId]);

  function closeLoopToStart() {
    if (orderedStops.length < 2) return;
    const first = orderedStops[0];
    const last = orderedStops[orderedStops.length - 1];
    if (closeEnough(first, last)) {
      setTripShapeMode('loop');
      return;
    }
    setInsertAfterId(null);
    setInsertTargetDay(null);
    setActiveDay(last.day);
    setTripShapeMode('loop');
    const stop: BuilderStop = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: `${first.name.split(',')[0]} return`,
      lat: first.lat,
      lng: first.lng,
      type: 'waypoint',
      description: 'Loop return to the route start.',
      land_type: first.land_type || 'route',
      source: 'map',
      day: last.day,
    };
    setStops(prev => [...prev, stop]);
    fly(stop.lat, stop.lng, 11);
  }

  function resolvedRouteName() {
    const clean = routeName.trim();
    if (clean) return clean;
    const first = orderedStops[0]?.name?.split(',')[0]?.trim();
    const last = orderedStops[orderedStops.length - 1]?.name?.split(',')[0]?.trim();
    if (first && last && first !== last) return `${first} to ${last}`;
    if (last) return `${last} Route`;
    return 'Manual Route';
  }

  function buildBuilderTimeline(navStops: BuilderStop[], inputDays: number[], dailyItinerary: Array<{ day: number; title: string; description: string; est_miles: number; road_type: string; highlights: string[] }>): TripTimeline {
    const timelineDays = inputDays.map(day => {
      const dayStopsForTimeline = navStops.filter(st => st.day === day);
      const previous = [...navStops].reverse().find(st => st.day < day && (st.type === 'camp' || st.type === 'motel')) ?? null;
      const dayPlan = dailyItinerary.find(item => item.day === day);
      const rest = restDays.includes(day) || dayPlan?.road_type === 'none';
      const events = [];
      const start = previous ?? dayStopsForTimeline[0];
      if (start) {
        events.push({
          type: day === 1 ? 'start' : 'depart',
          title: day === 1 ? 'Start' : 'Break camp',
          description: start.description,
          day,
          source: sourceLabel(start.source),
          warning_level: 'info',
          point: { lat: start.lat, lng: start.lng },
          quick_actions: ['navigate'],
        });
      }
      events.push({
        type: rest ? 'rest' : 'drive',
        title: dayPlan?.title ?? `Day ${day}`,
        description: dayPlan?.description ?? '',
        day,
        source: 'Route Builder',
        warning_level: !rest && (dayPlan?.est_miles ?? 0) > ((parsePositiveNumber(dayDriveTargets[day]) ?? planningStats.driveLimit) * 42) ? 'warn' : 'info',
        distance_mi: dayPlan?.est_miles ?? 0,
        road_type: dayPlan?.road_type ?? 'mixed',
        quick_actions: rest ? ['add_place', 'swap_camp'] : ['start_day', 'add_stop'],
      });
      for (const stop of dayStopsForTimeline) {
        if (stop === start) continue;
        events.push({
          type: stop.type === 'camp' || stop.type === 'motel' ? 'overnight' : stop.type === 'fuel' ? 'fuel' : 'poi',
          title: stop.name,
          description: stop.description,
          day,
          source: stop.camp?.verified_source || stop.poi?.source_label || sourceLabel(stop.source),
          warning_level: isFrameworkTarget(stop) ? 'warn' : 'info',
          point: { lat: stop.lat, lng: stop.lng },
          quick_actions: stop.type === 'camp' ? ['swap_camp', 'add_rest_day'] : ['open', 'swap_stop'],
        });
      }
      if (!rest && !dayStopsForTimeline.some(st => st.type === 'camp' || st.type === 'motel') && day < inputDays.length) {
        events.push({
          type: 'overnight',
          title: 'Choose overnight',
          description: 'Pick a camp or lodging stop before using this day for navigation.',
          day,
          source: 'Route Builder',
          warning_level: 'warn',
          quick_actions: ['scan_camps', 'add_lodging'],
        });
      }
      return {
        day,
        title: dayPlan?.title ?? `Day ${day}`,
        summary: dayPlan?.description ?? '',
        distance_mi: dayPlan?.est_miles ?? 0,
        road_type: dayPlan?.road_type ?? 'mixed',
        warning_level: events.some(event => event.warning_level === 'warn') ? 'warn' : 'info',
        events,
      };
    });
    return {
      schema_version: 1,
      days: timelineDays,
      warnings: timelineDays.flatMap(day => day.events.filter(event => event.warning_level === 'warn').map(event => ({ level: 'warn', message: `Day ${day.day}: ${event.title}` }))).slice(0, 12),
      offline_readiness: {
        map: routeOfflineReadiness.rows.find(row => row.key === 'map')?.ready ?? false,
        navigation: routeOfflineReadiness.rows.find(row => row.key === 'navigation')?.ready ?? false,
        places: routeOfflineReadiness.rows.find(row => row.key === 'places')?.ready ?? navStops.some(st => st.camp || st.gas || st.poi),
        topo: routeOfflineReadiness.rows.find(row => row.key === 'topo')?.ready ?? false,
        trails: routeOfflineReadiness.rows.find(row => row.key === 'trails')?.ready ?? false,
        trip_download: routeOfflineReadiness.ready,
        message: routeOfflineReadiness.ready
          ? 'Trip downloads are ready.'
          : 'Download the missing route area before leaving signal.',
      },
    };
  }

  function buildTrip(
    inputStops: BuilderStop[] = orderedStops,
    inputDays: number[] = days,
    nameOverride?: string,
    geometryOverride?: ProviderRouteGeometry | null,
  ): TripResult {
    const sorted = orderBuilderStops(inputStops);
    const navStops = filterDurableNavigationStops(sorted);
    const geometryForTrip = geometryOverride ?? routeGeometry;
    const session = buildRouteBuilderSession({
      intent: builderIntentFor(inputDays),
      stops: sorted,
      geometry: geometryForTrip,
      restDays,
      fuelRangeMi: planningStats.range,
      dayNeedsOvernight: day => dayNeedsOvernightFor(day, inputDays),
      campWindowForDay: day => campWindowFor(day, inputDays),
      maxDriveHoursByDay: Object.fromEntries(inputDays.map(day => [day, parsePositiveNumber(dayDriveTargets[day]) ?? undefined])),
      existingDaySegments: routeDaySegments,
    });
    const tripDaySegments = session.daySegments;
    let inputMiles = geometryForTrip?.totalDistanceMi && geometryForTrip.totalDistanceMi > 0 ? geometryForTrip.totalDistanceMi : 0;
    if (!inputMiles) {
      for (let i = 1; i < navStops.length; i += 1) inputMiles += haversineMi(navStops[i - 1], navStops[i]);
    }
    const tripFuelCost = (inputMiles / Math.max(1, planningStats.mpg)) * planningStats.price;
    const waypoints: Waypoint[] = navStops.map(st => ({
      day: st.day,
      name: st.name,
      type: st.type,
      description: st.description,
      land_type: st.land_type,
      lat: st.lat,
      lng: st.lng,
      route_point_type: st.routePointType ?? (st.source === 'poi' && st.type === 'waypoint' ? 'side_stop' : 'break'),
      verified_source: st.source === 'camp' ? st.camp?.verified_source ?? 'manual' : 'manual',
      verified_match: true,
      camp_window_start: st.campWindowStart ?? campWindowFor(st.day, inputDays).start,
      camp_window_end: st.campWindowEnd ?? campWindowFor(st.day, inputDays).end,
      camp_window_label: st.campWindowLabel ?? campWindowFor(st.day, inputDays).label,
    }));
    const daily_itinerary = inputDays.map(day => {
      const wps = navStops.filter(st => st.day === day);
      const hasPlanningTarget = sorted.some(st => st.day === day && isFrameworkTarget(st));
      const prev = [...navStops].reverse().find(st => st.day < day) ?? null;
      const window = campWindowFor(day, inputDays);
      const needsWindowCamp = dayNeedsOvernightFor(day, inputDays);
      const providerSegment = tripDaySegments.find(segment => segment.day === day);
      let miles = providerSegment?.providerDistanceMi ?? 0;
      if (!miles) {
        if (prev && wps.length) miles += haversineMi(prev, wps[0]);
        for (let i = 1; i < wps.length; i++) miles += haversineMi(wps[i - 1], wps[i]);
      }
      const first = wps[0]?.name?.split(',')[0] ?? 'Start';
      const last = wps[wps.length - 1]?.name?.split(',')[0] ?? (hasPlanningTarget ? 'overnight camp needed' : 'Finish');
      const rest = restDays.includes(day);
      return {
        day,
        title: rest ? `Day ${day}: Rest / local exploring` : needsWindowCamp ? `${window.label} Camp: ${first} to ${last}` : `${window.label}: Travel window`,
        description: rest
          ? 'Rest day. Keep the camp, add local places, or set a shorter drive max.'
          : campCadenceMode === 'alternate' && !needsWindowCamp
          ? `${window.label} shares an overnight camp on Day ${window.end}.`
          : wps.length
          ? `Manual route day with ${wps.length} planned stop${wps.length === 1 ? '' : 's'}.`
          : hasPlanningTarget
          ? 'Planning day. Pick an overnight camp before using GPS navigation.'
          : 'Open day. Add a destination, fuel, places, and camp.',
        est_miles: Math.round(miles),
        road_type: rest ? 'none' : routeStyle === 'wild' ? 'backroads' : routeStyle === 'direct' ? 'direct' : 'mixed',
        highlights: wps.filter(st => st.type === 'waypoint' || st.type === 'camp').slice(0, 3).map(st => st.name),
      };
    });
    const timeline = buildBuilderTimeline(navStops, inputDays, daily_itinerary);
    const campsites = navStops.filter(st => st.camp).map(st => ({ ...st.camp!, recommended_day: st.day }));
    const gas_stations = navStops.filter(st => st.gas).map(st => ({ ...st.gas!, recommended_day: st.day }));
    const routePois = sorted.filter(st => st.poi).map(st => ({ ...st.poi!, recommended_day: st.day }));
    return {
      trip_id: importedTripId ? `${importedTripId}_edited_${Date.now()}` : `manual_${Date.now()}`,
      plan: {
        trip_name: nameOverride ?? resolvedRouteName(),
        overview: importedTripId
          ? 'A Trailhead route edited in Route Builder with user-selected stops, fuel, places, and camps.'
          : 'A manually built Trailhead route with user-selected stops, fuel, places, and camps.',
        duration_days: inputDays.length,
        states: importedTripId ? activeTrip?.plan.states ?? [] : [],
        total_est_miles: Math.round(inputMiles),
        waypoints,
        daily_itinerary,
        timeline,
        route_preferences: {
          route_style: routeStyle,
          camp_preference: campPreferenceMode,
          require_photos: campPhotoOnly,
          camp_reuse_policy: effectiveCampReusePolicy,
          region_hint: routeStates.join(','),
          max_daily_drive_hours: parsePositiveNumber(driveHoursPerDay),
          rental_interest: tripPreferenceContext?.rental_interest,
          trip_preferences: tripPreferenceContext,
        },
        logistics: {
          vehicle_recommendation: `User-built ${routeStyle} route. Review road surfaces against the saved rig profile before departure.`,
          fuel_strategy: `Estimated fuel: ${fmtFuelVolumeFromMiles(inputMiles, planningStats.mpg, weatherUnitMode)} / $${Math.round(tripFuelCost)}. Fuel stops are manually selected.`,
          water_strategy: 'Carry water for each day and add water stops where needed.',
          permits_needed: `${tripShapeMode === 'loop' ? 'Loop route. ' : tripShapeMode === 'there_and_back' ? 'There-and-back route. ' : ''}Check local land manager rules for selected camps and trailheads.`,
          best_season: `Verify seasonal closures and weather before departure. Daily drive max: ${fmtHours(planningStats.driveLimit)}.`,
        },
      },
      campsites,
      gas_stations,
      route_pois: routePois,
      timeline,
    };
  }

  async function commitTrip(
    trip: TripResult,
    openMap = true,
    settleBeforeOpenMs = 0,
    inputStops: BuilderStop[] = orderedStops,
    inputDays: number[] = days,
    nameOverride?: string,
    fallbackGeometry?: ProviderRouteGeometry | null,
  ) {
    if (routeSaving) return;
    setRouteSaving(true);
    const knownGoodGeometry = fallbackGeometry?.coords?.length ? fallbackGeometry : routeGeometry;
    const routeGeometryPayload = await buildSavedRouteGeometry(inputStops)
      ?? (knownGoodGeometry?.coords?.length
        ? {
            coords: knownGoodGeometry.coords,
            totalDistance: knownGoodGeometry.totalDistanceMi * 1609.344,
            totalDuration: knownGoodGeometry.totalDurationHours * 3600,
            source: knownGoodGeometry.engine ?? knownGoodGeometry.source,
            ts: Date.now(),
          } satisfies SavedRouteGeometryPayload
        : null);
    const geometryForTrip = routeGeometryPayload?.coords?.length
      ? savedGeometryFromCoords(
          routeGeometryPayload.coords,
          routeGeometryPayload.totalDistance ?? (routeGeometryPayload as any).total_distance,
          routeGeometryPayload.totalDuration ?? (routeGeometryPayload as any).total_duration,
        )
      : routeGeometry;
    const rebuiltTrip = buildTrip(inputStops, inputDays, nameOverride ?? trip.plan.trip_name, geometryForTrip);
    const savedMiles = routeGeometryPayload?.totalDistance ? routeGeometryPayload.totalDistance / 1609.344 : null;
    const tripToSave: TripResult = routeGeometryPayload ? {
      ...rebuiltTrip,
      route_geometry: routeGeometryPayload,
      plan: savedMiles
        ? { ...rebuiltTrip.plan, total_est_miles: Math.round(savedMiles) }
        : rebuiltTrip.plan,
    } : rebuiltTrip;
    const builderState = {
      stops: inputStops,
      days: inputDays,
      routeStyle,
      tripShapeMode,
      tripLoop,
      driveHoursPerDay,
      plannedDays,
      tripBuildMode,
      distanceMode,
      targetMiles,
      restDays,
      dayDriveTargets,
      activePlaceFilters,
      campPreferenceMode,
      campPhotoOnly,
      campCadenceMode,
      campReusePolicy,
      tripPreferences: tripPreferenceContext,
    };
    try {
      setRouteName(tripToSave.plan.trip_name);
      setActiveTrip(tripToSave);
      addTripToHistory({
        trip_id: tripToSave.trip_id,
        trip_name: tripToSave.plan.trip_name,
        states: [],
        duration_days: tripToSave.plan.duration_days,
        est_miles: tripToSave.plan.total_est_miles,
        planned_at: Date.now(),
      });
      await saveOfflineTrip(tripToSave);
      api.saveTrip(tripToSave, routeGeometryPayload, builderState, 'mobile-route-builder').catch(err => {
        console.warn('Route Builder server save failed', err?.message ?? err);
      });
      if (openMap) {
        if (settleBeforeOpenMs > 0) {
          await new Promise(resolve => setTimeout(resolve, settleBeforeOpenMs));
        }
        setRouteTabMode('hub');
        router.replace('/(tabs)/map');
      }
    } finally {
      setRouteSaving(false);
    }
  }

  async function saveRoute(openMap = true) {
    if (routeSaving) return;
    if (orderedStops.length < 2) {
      Alert.alert('Add more stops', 'Add at least a start and one destination before saving the route.');
      return;
    }
    const draftWarnings = routeBuildSession.issues.filter(issue =>
      issue.code === 'temporary_anchor'
      || issue.code === 'missing_overnight'
      || issue.code === 'over_daily_max'
      || issue.code === 'fuel_range'
    );
    if (openMap && draftWarnings.length) {
      Alert.alert(
        'Save as draft?',
        `${draftWarnings[0].message} You can save it now, but review the trip before navigation.`,
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Save draft', onPress: () => { commitTrip(buildTrip(), openMap).catch(() => {}); } },
        ],
      );
      return;
    }
    await commitTrip(buildTrip(), openMap);
  }

  function resetRouteDraft() {
    setActiveDay(1);
    setDays([1]);
    setStops([]);
    setTripShapeMode('one_way');
    setRouteStyle('balanced');
    setTripBuildMode('recommended');
    setDistanceMode('hours');
    setCampPreferenceMode('public');
    setCampPhotoOnly(false);
    setCampCadenceMode('nightly');
    setCampReusePolicy('different_each_night');
    setWizardStep(0);
    setPlannedDays('3');
    setDriveHoursPerDay('5');
    setTargetMiles('180');
    setStartQuery('');
    setEndQuery('');
    setRouteName('');
    setFrameworkStatus('');
    setRestDays([]);
    setDayDriveTargets({});
    setImportedTripId(null);
    setSearchResults([]);
    resetDiscoveryResults();
    setSelectedRoutePlace(null);
  }

  function beginCleanNewRoute() {
    resetRouteDraft();
    setActiveTrip(null);
    setRouteTabMode('wizard');
  }

  function startNewRoute() {
    if (activeTrip) {
      setShowNewRouteConfirm(true);
      return;
    }
    beginCleanNewRoute();
  }

  async function saveCloseAndStartNewRoute() {
    if (routeSaving) return;
    setRouteSaving(true);
    try {
      const geometryPayload = orderedStops.length >= 2 ? await buildSavedRouteGeometry(orderedStops) : null;
      const geometryForDraft = geometryPayload?.coords?.length
        ? savedGeometryFromCoords(
            geometryPayload.coords,
            geometryPayload.totalDistance ?? (geometryPayload as any).total_distance,
            geometryPayload.totalDuration ?? (geometryPayload as any).total_duration,
          )
        : routeGeometry;
      const draftTrip = orderedStops.length >= 2 ? buildTrip(orderedStops, days, undefined, geometryForDraft) : activeTrip;
      if (draftTrip) {
        const tripToSave = geometryPayload ? { ...draftTrip, route_geometry: geometryPayload } : draftTrip;
        setActiveTrip(tripToSave);
        await saveOfflineTrip(tripToSave).catch(() => {});
        api.saveTrip(tripToSave, geometryPayload, null, 'mobile-route-builder-close').catch(err => {
          console.warn('Route Builder close save failed', err?.message ?? err);
        });
        addTripToHistory({
          trip_id: tripToSave.trip_id,
          trip_name: tripToSave.plan.trip_name,
          states: tripToSave.plan.states ?? [],
          duration_days: tripToSave.plan.duration_days ?? 0,
          est_miles: tripToSave.plan.total_est_miles ?? tripToSave.plan.daily_itinerary?.reduce((sum, day) => sum + (day.est_miles ?? 0), 0) ?? 0,
          planned_at: Date.now(),
        });
      }
      setShowNewRouteConfirm(false);
      beginCleanNewRoute();
    } finally {
      setRouteSaving(false);
    }
  }

  function discardCloseAndStartNewRoute() {
    setShowNewRouteConfirm(false);
    beginCleanNewRoute();
  }

  function openRouteRenameSheet() {
    setRouteNameDraft(resolvedRouteName());
    setRouteActionSheet('rename');
  }

  async function saveRouteFromActions(openMap = false) {
    setRouteActionSheet(null);
    await saveRoute(openMap);
  }

  async function saveCloseRouteFromActions() {
    setRouteActionSheet(null);
    await saveCloseAndStartNewRoute();
  }

  function discardRouteFromActions() {
    setRouteActionSheet(null);
    discardCloseAndStartNewRoute();
  }

  function discardAndExitRouteBuilder() {
    resetRouteDraft();
    setActiveTrip(null);
    setRouteTabMode('hub');
    router.replace('/(tabs)/map');
  }

  function exitRouteBuilder() {
    if (routeSaving) return;
    Alert.alert(
      'Exit route builder?',
      'Save this route before leaving, or discard the builder draft.',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard & exit', style: 'destructive', onPress: discardAndExitRouteBuilder },
        { text: 'Save & exit', onPress: () => { saveRoute(true).catch(() => {}); } },
      ],
    );
  }

  function applyRouteRename() {
    const clean = routeNameDraft.trim();
    setRouteName(clean || resolvedRouteName());
    setRouteActionSheet(null);
  }

  async function openSavedRoute(tripId: string) {
    const trip = activeTrip?.trip_id === tripId ? activeTrip : await loadOfflineTrip(tripId);
    if (trip) {
      setActiveTrip(trip, activeTrip?.trip_id !== tripId);
      setRouteTabMode('hub');
      router.replace('/(tabs)/map');
      return;
    }
    const serverTrip = await api.getTrip(tripId).catch(() => null);
    if (serverTrip) {
      await saveOfflineTrip(serverTrip).catch(() => {});
      setActiveTrip(serverTrip, false);
      setRouteTabMode('hub');
      router.replace('/(tabs)/map');
      return;
    }
    Alert.alert('Route unavailable', 'Trailhead could not load this route from local storage or your account.');
  }

  function openSavedTrailRoute(trail: OfflineTrail) {
    setPendingSavedTrailId(trail.id);
    router.replace('/(tabs)/map');
  }

  function deleteSavedTrailRoute(trail: OfflineTrail) {
    Alert.alert('Delete saved trail?', trail.trail.name, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteOfflineTrail(trail.id).catch(() => {});
          setSavedTrails(prev => prev.filter(item => item.id !== trail.id));
        },
      },
    ]);
  }

  function savedTrailDistance(trail: OfflineTrail) {
    const line = trail.geometry.features.find(feature => feature.geometry?.type === 'LineString');
    const distance = Number((line?.properties as any)?.distance_m);
    if (Number.isFinite(distance) && distance > 0) return fmtRouteDistance(distance / 1609.344);
    return 'saved trail';
  }

  function renderCampPreview(stop: BuilderStop, label: string, compact = false) {
    const camp = stop.camp;
    const land = landColor(stop.land_type);
    const campFeatures = [
      ...(camp?.site_types ?? []),
      ...(camp?.amenities ?? []),
      ...(camp?.tags ?? []).map(tag => tag.replace(/_/g, ' ')),
    ].filter(Boolean).slice(0, compact ? 3 : 5).join(' · ');
    return (
      <RouteBuilderCampPreviewCard
        label={label}
        name={stop.name}
        meta={`${campFeatures || stop.land_type || stopLabel(stop.type)}${camp?.cost ? ` · ${camp.cost}` : ''}${restDays.includes(stop.day) ? ' · rest day' : ''}`}
        compact={compact}
        photoUrl={camp?.photo_url}
        placeholderIcon={stop.type === 'motel' ? 'bed-outline' : 'bonfire-outline'}
        placeholderBackground={land.bg}
        placeholderColor={land.text}
        onReplace={() => replaceCampStop(stop)}
        onStayNextDay={() => stayAtCampNextDay(stop)}
        onStayTwoNights={() => stayAtCampTwoNights(stop)}
        onOpenDetail={camp ? () => openCampDetail(camp) : undefined}
      />
    );
  }

  function legFuelLabel(miles: number) {
    const mpg = Math.max(1, planningStats.mpg || 1);
    const gallons = miles / mpg;
    const cost = gallons * planningStats.price;
    return `${fmtFuelVolumeFromMiles(miles, mpg, weatherUnitMode)} · $${Math.max(1, Math.round(cost))}`;
  }

  function stopCardLabel(stop: BuilderStop) {
    if (stop.type === 'camp') return restDays.includes(stop.day) ? 'REST / OVERNIGHT' : 'OVERNIGHT';
    if (stop.type === 'fuel') return 'FUEL STOP';
    if (stop.type === 'motel') return 'LODGING';
    if (stop.poi?.type === 'trailhead') return 'TRAILHEAD';
    if (stop.poi?.type === 'viewpoint') return 'VIEWPOINT';
    if (stop.poi?.type === 'attraction') return 'PLACE';
    return stop.type === 'waypoint' ? 'ROUTE STOP' : stopLabel(stop.type).toUpperCase();
  }

  function renderStopPreview(stop: BuilderStop, compact = false) {
    if (stop.type === 'camp' || stop.type === 'motel') {
      return renderCampPreview(stop, stopCardLabel(stop), compact);
    }
    if (stop.type === 'fuel') {
      const station = stop.gas;
      return (
        <RouteBuilderFuelPreviewCard
          name={stop.name}
          meta={station?.address || station?.fuel_types || stop.description || 'Fuel stop selected in Route Builder.'}
        />
      );
    }
    const color = placeColor(stop.poi?.type ?? stop.type);
    const icon = stop.poi ? placeIcon(stop.poi.type) : stop.type === 'start' ? 'navigate-outline' : 'location-outline';
    const description = stop.poi
      ? `${stop.poi.type.replace(/_/g, ' ')} stop selected for this day.`
      : stop.description;
    return (
      <RouteBuilderPlacePreviewCard
        label={stopCardLabel(stop)}
        name={stop.name}
        description={description}
        color={color}
        icon={icon}
        sourceLabel={sourceLabel(stop.source).toUpperCase()}
        typeLabel={stop.poi?.type ? stop.poi.type.replace(/_/g, ' ').toUpperCase() : undefined}
      />
    );
  }

  function renderRouteTimeline() {
    if (!hasBaseRoute) return null;
    return (
      <View style={s.routeTimelineList}>
        {routeDayPlans.filter(plan => campCadenceMode !== 'alternate' || plan.needsCamp).map(plan => {
          const camp = plan.stops.find(st => st.type === 'camp' || st.type === 'motel') ?? null;
          const maxHours = parsePositiveNumber(dayDriveTargets[plan.day]) ?? planningStats.driveLimit;
          const overDailyMax = !plan.rest && plan.hours > maxHours + 0.05;
          const needsOvernight = plan.needsOvernight && !plan.complete;
          const statusColor = overDailyMax ? C.yellow : needsOvernight ? C.orange : plan.complete ? C.green : C.text3;
          const statusText = overDailyMax
            ? `${fmtHours(plan.hours)} over ${fmtHours(maxHours)} max`
            : needsOvernight
              ? 'choose a camp'
              : plan.complete
                ? 'overnight set'
                : 'travel day';
          return (
            <View key={plan.day} style={s.routeDayWrap}>
              <RouteBuilderTimelineDayCard
                active={activeDay === plan.day}
                title={`${plan.needsOvernight ? `${plan.campWindowLabel} Camp` : `${plan.campWindowLabel} Travel`}${plan.rest ? ' · Rest' : ''}`}
                meta={`${fmtRouteDistance(plan.miles)} · ${fmtHours(plan.hours)}${plan.previous ? ` · from ${plan.previous.name.split(',')[0]}` : ''}`}
                statusText={statusText}
                statusColor={statusColor}
                complete={plan.complete && !overDailyMax}
                placesLabel={`Day ${plan.day} Places`}
                campPreview={camp ? renderCampPreview(camp, plan.rest ? 'OVERNIGHT / REST CAMP' : 'OVERNIGHT CAMP') : undefined}
                needsOvernight={plan.needsOvernight}
                travelText={`${plan.campWindowLabel} shares the next camp window.`}
                onSelect={() => setActiveDay(plan.day)}
                onChooseOvernight={() => scanDayPlan(plan, 'camps')}
                onFindCamp={() => scanDayPlan(plan, 'camps')}
                onFindFuel={() => scanDayPlan(plan, 'gas')}
                onFindPlaces={() => scanDayPlan(plan, 'poi')}
                onFindSideTrips={() => scanDayPlan(plan, 'excursions')}
              />
              {renderInlineResultsForDay(plan.day)}
            </View>
          );
        })}
      </View>
    );
  }

  function renderInlineResultsForDay(day: number) {
    if (!inlineSearch || inlineSearch.day !== day) return null;
    const inlineTab = inlineSearch.tab;
    return (
      <RouteBuilderInlineResults
        title={inlineSearch.label}
        subtitle={discoverySummary || 'Searching along this day segment'}
        loading={discoverLoading}
        onClose={() => setInlineSearch(null)}
      >
        {inlineTab === 'camps' ? (
          camps.length ? camps.slice(0, 6).map(camp => (
            <RouteBuilderInlineCampCard
              key={camp.id}
              title={camp.name}
              meta={`Day ${day} · ${camp.route_distance_mi != null ? `${fmtRouteDistance(camp.route_distance_mi)} off route · ` : ''}${routeProgressLabel((camp as any).route_progress) ? `${routeProgressLabel((camp as any).route_progress)} · ` : ''}${(camp as any).photo_status === 'missing' ? 'No photo fallback · ' : ''}${[...(camp.site_types ?? []), ...(camp.amenities ?? []), camp.land_type || 'Camp'].filter(Boolean).slice(0, 3).join(' · ')} · ${camp.cost || 'See site'}`}
              photoUrl={camp.photo_url}
              fallbackColor={landColor(camp.land_type).text}
              fallbackBackgroundColor={landColor(camp.land_type).bg}
              actionLabel={replaceStopId ? 'SWAP' : 'USE'}
              onPress={() => openCampDetail(camp)}
              onPressAction={() => addCamp(camp)}
            />
          )) : (
            renderInlineEmptyState(day, 'camps')
          )
        ) : inlineTab === 'gas' ? (
          gas.length ? gas.slice(0, 6).map(station => (
            <RouteBuilderInlineResultRow
              key={String(station.id)}
              icon="flash-outline"
              iconColor="#eab308"
              iconBackgroundColor="#eab30818"
              iconBorderColor="#eab30866"
              title={station.name}
              meta={`Day ${day} · ${station.route_distance_mi != null ? `${fmtRouteDistance(station.route_distance_mi)} off route · ` : ''}${routeProgressLabel((station as any).route_progress) ? `${routeProgressLabel((station as any).route_progress)} · ` : ''}${station.address || station.fuel_types || 'Fuel stop'}`}
              onPress={() => openRoutePlace({ kind: 'gas', day, data: station, place: routeSheetPlaceFromGas(station) })}
            />
          )) : (
            renderInlineEmptyState(day, 'gas')
          )
        ) : inlineTab === 'excursions' ? (
          excursions.length ? excursions.slice(0, 8).map(item => (
            <RouteBuilderInlineResultRow
              key={item.id}
              icon={item.type === 'climbing' ? 'trending-up-outline' : item.type === 'historic' ? 'business-outline' : item.type === 'park' ? 'map-outline' : 'compass-outline'}
              iconColor={placeColor(item.type)}
              iconBackgroundColor={placeColor(item.type) + '18'}
              iconBorderColor={placeColor(item.type) + '66'}
              title={item.name}
              meta={`Day ${day} · ${item.distance_from_route_mi != null ? `${fmtRouteDistance(item.distance_from_route_mi)} off route · ` : ''}${routeProgressLabel((item as any).route_progress) ? `${routeProgressLabel((item as any).route_progress)} · ` : ''}${item.day_fit || item.type} · ${item.source_label}`}
              metaLines={2}
              trailingLabel={item.offline_ready ? 'OFFLINE' : item.source_confidence?.toUpperCase() || 'SOURCE'}
              trailingColor={item.offline_ready ? C.green : undefined}
              onPress={() => openRoutePlace({ kind: 'excursion', day, data: item, place: routeSheetPlaceFromExcursion(item) })}
            />
          )) : (
            renderInlineEmptyState(day, 'excursions')
          )
        ) : (
          discoveryPois.length ? discoveryPois.slice(0, 6).map(poi => (
            <RouteBuilderInlineResultRow
              key={poi.id}
              icon={placeIcon(poi.type)}
              iconColor={placeColor(poi.type)}
              iconBackgroundColor={placeColor(poi.type) + '18'}
              iconBorderColor={placeColor(poi.type) + '66'}
              title={poi.name || poi.type}
              meta={`Day ${day} · ${(poi as any).route_distance_mi != null ? `${fmtRouteDistance((poi as any).route_distance_mi)} off route · ` : ''}${routeProgressLabel((poi as any).route_progress) ? `${routeProgressLabel((poi as any).route_progress)} · ` : ''}${poi.type.replace(/_/g, ' ')}`}
              onPress={() => openRoutePlace({ kind: 'poi', day, data: poi, place: routeSheetPlaceFromPoi(poi) })}
            />
          )) : (
            renderInlineEmptyState(day, 'poi')
          )
        )}
      </RouteBuilderInlineResults>
    );
  }

  function rentalEventPayload(offer: OutdoorOffer) {
    return {
      offer_id: offer.id,
      provider: offer.provider || 'outdoorsy',
      placement: 'route_builder',
      route_type: rentalSuggestion.context.route_type,
      session_id: sessionId,
      context: rentalSuggestion.context,
    };
  }

  function viewRentalOffers(offer?: OutdoorOffer) {
    const selected = offer ?? rentalOffers[0];
    if (!selected) return;
    const url = selected.affiliate_url || selected.booking_url || '';
    api.trackOutdoorOfferEvent('click', rentalEventPayload(selected)).catch(() => {});
    if (!url) {
      Alert.alert('No rental options here yet.', 'Try nearby camps, routes, and official places.');
      return;
    }
    api.trackOutdoorOfferEvent('redirect', rentalEventPayload(selected)).catch(() => {});
    Linking.openURL(url).catch(() => {
      Alert.alert('Unable to open rentals', 'Try again in a moment.');
    });
  }

  function saveRentalIdea() {
    const selected = rentalOffers[0];
    if (!selected) return;
    setRentalIdeaSaved(true);
    api.trackOutdoorOfferEvent('save', rentalEventPayload(selected)).catch(() => {});
  }

  function dismissRentalSuggestion() {
    const ts = Date.now();
    const selected = rentalOffers[0];
    setRentalDismissedAt(ts);
    setRentalOffers([]);
    storage.set(ROUTE_BUILDER_RENTAL_DISMISSED_KEY, String(ts)).catch(() => {});
    if (selected) api.trackOutdoorOfferEvent('dismiss', rentalEventPayload(selected)).catch(() => {});
  }

  function renderRouteHub() {
    const savedRoutes = tripHistory.slice(0, 10);
    return (
      <RouteBuilderHub
        bottomInset={bottomInset}
        routeSaving={routeSaving}
        rigRouteSummary={rigRouteSummary}
        savedRoutes={savedRoutes}
        savedTrails={savedTrails}
        showOpenActive={!!activeTrip}
        showNewRouteConfirm={showNewRouteConfirm}
        routeTripCardData={route => routeTripCards[route.trip_id] || tripCardData(route, activeTrip?.trip_id === route.trip_id ? activeTrip : null, offlinePlaces)}
        savedTrailDistance={savedTrailDistance}
        onStartNewRoute={startNewRoute}
        onOpenProfile={() => router.push('/(tabs)/profile')}
        onOpenActiveMap={() => router.replace('/(tabs)/map')}
        onOpenSavedRoute={openSavedRoute}
        onOpenSavedTrailRoute={openSavedTrailRoute}
        onDeleteSavedTrailRoute={deleteSavedTrailRoute}
        onCloseNewRouteConfirm={() => setShowNewRouteConfirm(false)}
        onSaveCloseAndStartNewRoute={saveCloseAndStartNewRoute}
        onDiscardCloseAndStartNewRoute={discardCloseAndStartNewRoute}
        paywallModal={<PaywallModal visible={paywallVisible} code={paywallCode} message={paywallMessage} onClose={() => setPaywallVisible(false)} />}
      />
    );
  }

  function renderWizardSetup(fullScreen = false) {
    const steps = ['Start', 'Destination', 'Style', 'Camp', 'Pace'];
    const stepMeta = steps[wizardStep];
    const canMoveNext = wizardStep === 0
      ? !!(startQuery.trim() || orderedStops[0] || userLoc)
      : wizardStep === 1
      ? !!(endQuery.trim() || orderedStops.length > 1)
      : true;
    const nextStep = () => setWizardStep(step => Math.min(4, step + 1));
    const dockMarginBottom = keyboardVisible ? 10 + bottomInset : 18 + bottomInset;
    return (
      <TrailheadSheet
        handle={false}
        style={[s.wizardCard, fullScreen && s.wizardCardFull]}
        contentStyle={[s.routeSheetContent, fullScreen && s.routeSheetFullContent]}
      >
        <RouteWizardProgressHeader
          steps={steps}
          currentStep={wizardStep}
          title={stepMeta}
          onStepPress={setWizardStep}
          onClose={() => setRouteTabMode('hub')}
        />

        <ScrollView
          style={s.wizardStepScroll}
          contentContainerStyle={[s.wizardStepScrollContent, { paddingBottom: keyboardVisible ? 26 : 10 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Animated.View style={[
            s.wizardAnimatedPane,
            { opacity: wizardFade, transform: [{ translateY: wizardSlide }] },
          ]}>
          {wizardStep === 0 ? (
            <View style={s.wizardPane}>
            <View style={s.wizardQuestion}>
              <Text style={s.wizardTitle}>Where are you starting?</Text>
              <Text style={s.wizardHelp}>Use current location or search a known city, trailhead, address, campsite, or map point.</Text>
            </View>
            <View style={[s.routeHubRig, rigRouteSummary.ready && s.routeHubRigReady]}>
              <View style={s.routeHubRigIcon}>
                <Ionicons name={rigRouteSummary.ready ? 'car-sport-outline' : 'alert-circle-outline'} size={17} color={rigRouteSummary.ready ? C.green : C.yellow} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.routeHubRigTitle}>{rigRouteSummary.ready ? 'Planning with your rig' : 'Rig profile missing'}</Text>
                <Text style={s.routeHubRigMeta} numberOfLines={2}>{rigRouteSummary.ready ? rigRouteSummary.meta : 'Trailhead will use conservative defaults until you add vehicle specs.'}</Text>
              </View>
            </View>
            <View style={s.setupInputWrap}>
              <Text style={s.setupLabel}>START</Text>
              <View style={s.setupInputRow}>
                <View style={s.setupSearchIcon}>
                  <Ionicons name="search-outline" size={16} color={C.text3} />
                </View>
                <TextInput
                  value={startQuery}
                  onChangeText={setStartQuery}
                  placeholder={orderedStops[0]?.name?.split(',')[0] ?? 'Search city, address, trailhead'}
                  placeholderTextColor={C.text3}
                  style={[s.setupInput, s.setupInputInline]}
                  returnKeyType="next"
                  blurOnSubmit
                  onSubmitEditing={() => { Keyboard.dismiss(); if (canMoveNext) nextStep(); }}
                />
                <TouchableOpacity style={s.currentLocationBtn} onPress={async () => { await setWizardStartFromLocation(); setWizardStep(1); }}>
                  <Ionicons name="locate-outline" size={13} color={C.orange} />
                  <Text style={s.currentLocationText}>CURRENT</Text>
                </TouchableOpacity>
              </View>
            </View>
            </View>
          ) : wizardStep === 1 ? (
            <View style={s.wizardPane}>
            <View style={s.wizardQuestion}>
              <Text style={s.wizardTitle}>Where are you headed?</Text>
              <Text style={s.wizardHelp}>Pick the final destination first. Trailhead will set up the route, days, and camp search.</Text>
            </View>
            <View style={s.setupInputWrap}>
              <Text style={s.setupLabel}>DESTINATION</Text>
              <View style={s.setupInputRow}>
                <View style={s.setupSearchIcon}>
                  <Ionicons name="search-outline" size={16} color={C.text3} />
                </View>
                <TextInput
                  value={endQuery}
                  onChangeText={setEndQuery}
                  placeholder={orderedStops.length > 1 ? orderedStops[orderedStops.length - 1].name.split(',')[0] : 'Search city, park, trailhead'}
                  placeholderTextColor={C.text3}
                  style={[s.setupInput, s.setupInputInline]}
                  returnKeyType="next"
                  blurOnSubmit
                  onSubmitEditing={() => { Keyboard.dismiss(); if (canMoveNext) nextStep(); }}
                />
              </View>
            </View>
            </View>
          ) : wizardStep === 2 ? (
            <View style={s.wizardPane}>
            <View style={s.wizardQuestion}>
              <Text style={s.wizardTitle}>Choose the route feel</Text>
              <Text style={s.wizardHelp}>Recommended builds a camp-aware base route. Blank keeps it simple for hand-building.</Text>
            </View>
            <View style={s.premiumModeControl}>
              {([
                { id: 'recommended' as TripBuildMode, label: 'Plan Mode', icon: 'sparkles-outline' as const, sub: 'Camp-aware' },
                { id: 'blank' as TripBuildMode, label: 'Build Mode', icon: 'construct-outline' as const, sub: 'Manual base' },
              ]).map(mode => {
                const active = tripBuildMode === mode.id;
                return (
                  <TouchableOpacity key={mode.id} style={[s.premiumModeBtn, active && s.premiumModeBtnActive]} onPress={() => setTripBuildMode(mode.id)}>
                    <Ionicons name={mode.icon} size={14} color={active ? '#fff' : C.text3} />
                    <View>
                      <Text style={[s.premiumModeText, active && { color: '#fff' }]}>{mode.label}</Text>
                      <Text style={[s.premiumModeSub, active && { color: 'rgba(255,255,255,0.74)' }]}>{mode.sub}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={s.loopChoiceRow}>
              {([
                { id: 'one_way' as TripShapeMode, icon: 'arrow-forward-outline' as const, title: 'One way', text: 'Start and finish can be different places.' },
                { id: 'loop' as TripShapeMode, icon: 'sync-outline' as const, title: 'Loop', text: 'Outbound and return use different route points.' },
                { id: 'there_and_back' as TripShapeMode, icon: 'repeat-outline' as const, title: 'There and back', text: 'Return to the start and reuse overnight areas by default.' },
              ]).map(shape => {
                const active = tripShapeMode === shape.id;
                return (
                  <TouchableOpacity key={shape.id} style={[s.loopChoice, active && s.loopChoiceActive]} onPress={() => applyTripShapeMode(shape.id)}>
                    <Ionicons name={shape.icon} size={15} color={active ? C.orange : C.text3} />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.loopChoiceTitle, active && { color: C.orange }]}>{shape.title}</Text>
                      <Text style={s.loopChoiceText}>{shape.text}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={s.routeStyleRow}>
              {(['balanced', 'direct', 'wild'] as const).map(style => (
                <TouchableOpacity key={style} style={[s.routeStyleChip, routeStyle === style && s.routeStyleChipActive]} onPress={() => setRouteStyle(style)}>
                  <Ionicons name={style === 'direct' ? 'navigate-outline' : style === 'wild' ? 'trail-sign-outline' : 'options-outline'} size={12} color={routeStyle === style ? C.orange : C.text3} />
                  <Text style={[s.routeStyleText, routeStyle === style && { color: C.orange }]}>
                    {style.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            </View>
          ) : wizardStep === 3 ? (
            <View style={s.wizardPane}>
            <View style={s.wizardQuestion}>
              <Text style={s.wizardTitle}>Choose camp style</Text>
              <Text style={s.wizardHelp}>Trailhead will prefer these camp types when placing overnight stops. Public first avoids random RV parks unless they are the best fallback.</Text>
            </View>
            <View style={s.campPreferenceGrid}>
              {CAMP_PREFERENCE_OPTIONS.map(option => {
                const active = campPreferenceMode === option.id;
                return (
                  <TouchableOpacity key={option.id} style={[s.campPreferenceCard, active && s.campPreferenceCardActive]} onPress={() => setCampPreferenceMode(option.id)}>
                    <Ionicons name={option.icon} size={16} color={active ? C.orange : C.text3} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[s.campPreferenceTitle, active && { color: C.orange }]}>{option.label}</Text>
                      <Text style={s.campPreferenceSub} numberOfLines={1}>{option.sub}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity
              style={[s.campPhotoToggle, campPhotoOnly && s.campPhotoToggleActive]}
              onPress={() => setCampPhotoOnly(value => !value)}
              activeOpacity={0.82}
            >
              <Ionicons name={campPhotoOnly ? 'images' : 'images-outline'} size={16} color={campPhotoOnly ? C.orange : C.text3} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[s.campPreferenceTitle, campPhotoOnly && { color: C.orange }]}>Photos only</Text>
                <Text style={s.campPreferenceSub} numberOfLines={1}>Require camp media when placing overnight stops</Text>
              </View>
              <Ionicons name={campPhotoOnly ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={campPhotoOnly ? C.orange : C.text3} />
            </TouchableOpacity>
            <Text style={s.setupLabel}>CAMP CADENCE</Text>
            <View style={s.campPreferenceGrid}>
              {CAMP_CADENCE_OPTIONS.map(option => {
                const active = campCadenceMode === option.id;
                return (
                  <TouchableOpacity key={option.id} style={[s.campPreferenceCard, active && s.campPreferenceCardActive]} onPress={() => {
                    setCampCadenceMode(option.id);
                    if (option.id === 'alternate') setCampReusePolicy('same_camp_window');
                    if (option.id === 'nightly') setCampReusePolicy('different_each_night');
                    if (option.id === 'manual') setCampReusePolicy('manual');
                  }}>
                    <Ionicons name={option.icon} size={16} color={active ? C.orange : C.text3} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[s.campPreferenceTitle, active && { color: C.orange }]}>{option.label}</Text>
                      <Text style={s.campPreferenceSub} numberOfLines={1}>{option.sub}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={s.setupLabel}>MULTI-NIGHT CAMPS</Text>
            <View style={s.campPreferenceGrid}>
              {CAMP_REUSE_OPTIONS.map(option => {
                const active = campReusePolicy === option.id;
                return (
                  <TouchableOpacity key={option.id} style={[s.campPreferenceCard, active && s.campPreferenceCardActive]} onPress={() => setCampReusePolicy(option.id)}>
                    <Ionicons name={option.icon} size={16} color={active ? C.orange : C.text3} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[s.campPreferenceTitle, active && { color: C.orange }]}>{option.label}</Text>
                      <Text style={s.campPreferenceSub} numberOfLines={1}>{option.sub}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
            </View>
          ) : (
            <View style={s.wizardPane}>
            <View style={s.wizardQuestion}>
              <Text style={s.wizardTitle}>Set the daily pace</Text>
              <Text style={s.wizardHelp}>Hours per day is the max you want to drive. Trailhead should not force every day to hit that limit.</Text>
            </View>
            <View style={s.setupGridPair}>
              <View style={s.setupInputWrap}>
                <Text style={s.setupLabel}>DAYS</Text>
                <TextInput value={plannedDays} onChangeText={setPlannedDays} keyboardType="number-pad" style={s.setupInput} placeholder="3" placeholderTextColor={C.text3} />
              </View>
              <View style={s.setupInputWrap}>
                <Text style={s.setupLabel}>{distanceMode === 'hours' ? 'MAX HRS / DAY' : 'MI / STOP'}</Text>
                <TextInput
                  value={distanceMode === 'hours' ? driveHoursPerDay : targetMiles}
                  onChangeText={distanceMode === 'hours' ? setDriveHoursPerDay : setTargetMiles}
                  keyboardType="decimal-pad"
                  style={s.setupInput}
                  placeholder={distanceMode === 'hours' ? '5' : '180'}
                  placeholderTextColor={C.text3}
                />
              </View>
            </View>
            <View style={s.segmentRow}>
              {(['hours', 'miles'] as DistanceMode[]).map(mode => (
                <TouchableOpacity key={mode} style={[s.segmentBtn, distanceMode === mode && s.segmentBtnActive]} onPress={() => setDistanceMode(mode)}>
                  <Text style={[s.segmentText, distanceMode === mode && { color: '#fff' }]}>{mode === 'hours' ? 'HOURS' : 'MILES'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            </View>
          )}
          </Animated.View>

          {buildingFramework && (
            <ActivityStatusCard
              title={frameworkStatus}
              fallbackLines={BUILD_STATUS_LINES}
              helper="Keeping the builder awake until it finishes."
              tone={C.orange}
            />
          )}
        </ScrollView>

        <View style={[s.wizardNav, fullScreen && [s.wizardNavDock, wizardStep === 0 && s.wizardNavStepOne, { marginBottom: dockMarginBottom }]]}>
          <TouchableOpacity style={[s.wizardNavBtn, wizardStep === 0 && { opacity: 0.45 }]} onPress={() => setWizardStep(step => Math.max(0, step - 1))} disabled={wizardStep === 0}>
            <Ionicons name="chevron-back" size={13} color={C.text3} />
            <Text style={s.wizardNavText}>BACK</Text>
          </TouchableOpacity>
          {wizardStep < 4 ? (
            <TouchableOpacity style={[s.wizardNextBtn, !canMoveNext && { opacity: 0.55 }]} onPress={nextStep} disabled={!canMoveNext}>
              <Text style={s.wizardNextText}>NEXT</Text>
              <Ionicons name="chevron-forward" size={13} color="#fff" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={s.wizardNextBtn} onPress={buildRouteFramework} disabled={buildingFramework}>
              {buildingFramework ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="map-outline" size={13} color="#fff" />}
              <Text style={s.wizardNextText}>{hasBaseRoute ? 'REBUILD ON MAP' : 'BUILD ON MAP'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </TrailheadSheet>
    );
  }

  if (routeTabMode === 'hub') {
    return renderRouteHub();
  }

  if (buildingFramework) {
    return (
      <SafeAreaView style={s.buildingVideoScreen}>
        <LinearGradient
          colors={['#06080b', '#10201d', '#2f2415']}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={s.buildingVideoFallback}
        >
          <View style={[s.buildingTerrainBand, s.buildingTerrainBandOne]} />
          <View style={[s.buildingTerrainBand, s.buildingTerrainBandTwo]} />
          <View style={[s.buildingRouteLine, s.buildingRouteLineOne]} />
          <View style={[s.buildingRouteLine, s.buildingRouteLineTwo]} />
          <View style={[s.buildingRouteLine, s.buildingRouteLineThree]} />
          <View style={[s.buildingRoutePoint, s.buildingRoutePointStart]} />
          <View style={[s.buildingRoutePoint, s.buildingRoutePointCamp]} />
          <View style={[s.buildingRoutePoint, s.buildingRoutePointEnd]} />
        </LinearGradient>
        <Video
          source={buildingVideoSource}
          style={[s.buildingVideo, !buildingVideoReady && { opacity: 0 }]}
          resizeMode={ResizeMode.COVER}
          shouldPlay
          isLooping
          isMuted
          useNativeControls={false}
          onLoad={() => setBuildingVideoReady(true)}
          onReadyForDisplay={() => setBuildingVideoReady(true)}
          onError={() => setBuildingVideoReady(false)}
        />
        <View style={s.buildingVideoShade} />
        <View style={[s.buildingVideoContent, { paddingTop: Math.max(insets.top, 12) + 18, paddingBottom: Math.max(insets.bottom, 18) + 22 }]}>
          <View style={s.buildingVideoTop}>
            <View style={s.buildingLivePill}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={s.buildingLiveText}>BUILDING ROUTE</Text>
            </View>
          </View>

          <View style={s.buildingHeroCopy}>
            <Text style={s.buildingEyebrow}>TRAILHEAD ROUTE BUILDER</Text>
            <Text style={s.buildingHeadline}>Building your route</Text>
            <Text style={s.buildingSubtitle}>
              Checking camps, fuel, and daily drive windows.
            </Text>
          </View>

          <View style={s.buildingBottomPanel}>
            <ActivityStatusCard
              title={frameworkStatus}
              fallbackLines={BUILD_STATUS_LINES}
              helper="Keeping the builder awake until it finishes."
              tone={C.orange}
            />
          </View>
        </View>
        <PaywallModal visible={paywallVisible} code={paywallCode} message={paywallMessage} onClose={() => setPaywallVisible(false)} />
      </SafeAreaView>
    );
  }

  if (!hasBaseRoute) {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={s.wizardScreen}>
          {renderWizardSetup(true)}
          <PaywallModal visible={paywallVisible} code={paywallCode} message={paywallMessage} onClose={() => setPaywallVisible(false)} />
        </SafeAreaView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <SafeAreaView style={s.wizardScreen}>
      <View style={s.wizardCompactTop}>
        <TouchableOpacity style={s.headerBtn} onPress={exitRouteBuilder} accessibilityLabel="Exit route builder" activeOpacity={0.82}>
          <Ionicons name="close" size={17} color={C.orange} />
        </TouchableOpacity>
        <TouchableOpacity style={s.headerBtn} onPress={() => setRouteActionSheet('actions')} accessibilityLabel="Route actions" activeOpacity={0.82}>
          <Ionicons name="ellipsis-horizontal" size={17} color={C.orange} />
        </TouchableOpacity>
      </View>

      <TrailheadSheet handle={false} style={[s.routeEditorPanel, { marginBottom: keyboardVisible ? 12 : 18 + bottomInset }]} contentStyle={s.routeSheetContent}>
      <ScrollView
        style={s.body}
        contentContainerStyle={[s.bodyContent, { paddingBottom: (keyboardVisible ? 260 : 240) + bottomInset }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <RouteBuilderTimelineActions
          tripShapeMode={tripShapeMode}
          tripLoop={tripLoop}
          onAddDay={addDay}
          onToggleTripShape={() => applyTripShapeMode(tripShapeMode === 'one_way' ? 'loop' : tripShapeMode === 'loop' ? 'there_and_back' : 'one_way')}
        />

        {renderRouteTimeline()}

        <RentalSuggestionModule
          fit={rentalSuggestion}
          offers={rentalOffers}
          loading={rentalOffersLoading}
          saved={rentalIdeaSaved}
          onViewRentals={viewRentalOffers}
          onSaveIdea={saveRentalIdea}
          onDismiss={dismissRentalSuggestion}
        />

        <RouteBuilderSearchSurface
          pendingType={pendingType}
          query={query}
          searching={searching}
          results={searchResults}
          selectedStopName={selectedInsertStop?.name}
          targetDay={insertTargetDay}
          fallbackDay={selectedInsertStop?.day}
          stopIcon={stopIcon}
          stopColor={stopColor}
          onSelectType={setPendingType}
          onChangeQuery={setQuery}
          onSubmitSearch={runSearch}
          onSelectResult={addPlace}
          onClearInsert={() => { setInsertAfterId(null); setInsertTargetDay(null); }}
        />

        <RouteBuilderReadinessCard
          checks={routeFitCards}
          offlineRows={routeOfflineReadiness.rows}
          showOfflineRows={routeOfflineReadiness.regionNames.length > 0}
        />

        <RouteBuilderActiveDayControls
          activeDay={activeDay}
          meta={restDays.includes(activeDay) ? 'rest day' : `${fmtRouteDistance(dayMileage[activeDay] ?? 0)} · ${fmtHours(routeDayPlans.find(plan => plan.day === activeDay)?.hours ?? estimateMovingHours(dayMileage[activeDay] ?? 0))}`}
          restDay={restDays.includes(activeDay)}
          maxHoursValue={dayDriveTargets[activeDay] ?? driveHoursPerDay}
          maxHoursPlaceholder={driveHoursPerDay}
          maxHoursSummary={`${fmtHours(activeDayDriveLimit)} max`}
          onToggleRestDay={() => toggleRestDay(activeDay)}
          onChangeMaxHours={v => setDayDriveTargets(prev => ({ ...prev, [activeDay]: v }))}
        />
        {!hasBaseRoute ? renderInlineResultsForDay(activeDay) : null}
        {dayStops.length === 0 ? (
          <RouteBuilderEmptyDayGuidance />
        ) : (
          <RouteBuilderActiveDayStopList
            stops={dayStops}
            insertAfterId={insertAfterId}
            stopColor={stopColor}
            stopLabel={stopCardLabel}
            sourceLabel={sourceLabel}
            renderStopPreview={renderStopPreview}
            measureLeg={haversineMi}
            distanceLabel={fmtRouteDistance}
            durationLabel={miles => fmtHours(estimateMovingHours(miles))}
            fuelLabel={legFuelLabel}
            onSelectStop={selectInsertStop}
            onOpenCampDetail={stop => stop.camp && openCampDetail(stop.camp)}
            onReplaceCamp={replaceCampStop}
            onMoveStop={moveStop}
            onRemoveStop={removeStop}
            onFindFuel={(from, to) => scanBetweenStops(from, to, 'gas')}
            onFindCamp={(from, to) => scanBetweenStops(from, to, 'camps', to.day ?? from.day, 'overnight')}
            onFindPlaces={(from, to) => scanBetweenStops(from, to, 'poi')}
          />
        )}
      </ScrollView>
      </TrailheadSheet>

      {!keyboardVisible ? (
        <RouteBuilderFooterDock
          bottom={18 + bottomInset}
          distanceLabel={fmtRouteDistance(totals.miles)}
          summaryLabel={`${totals.stops} stops · ${totals.camps} camps · ${fmtFuelVolumeFromMiles(totals.miles, planningStats.mpg, weatherUnitMode)} / $${totals.miles > 0 ? Math.max(1, Math.round(planningStats.fuelCost)) : 0} · ${fuelSourceLabel(fuelEstimate, !!parsePositiveNumber(rigProfile?.fuel_mpg))}`}
          actionLabel="OPEN ON MAP"
          saving={routeSaving}
          onPressAction={() => saveRoute(true)}
        />
      ) : null}

      <Modal visible={!!selectedCamp} transparent animationType="slide" onRequestClose={() => setSelectedCamp(null)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setSelectedCamp(null)}>
          <TrailheadSheet handle={false} style={s.quickCard} contentStyle={[s.quickCardSheetContent, { paddingBottom: bottomSheetPad }]}>
            {(() => {
              const photos = campPhotoItems(selectedCamp, campDetail);
              const safeIndex = photos.length ? quickCampPhotoIndex % photos.length : 0;
              const activePhoto = photos[safeIndex];
              return (
                <TouchableOpacity style={s.quickCardImg} activeOpacity={activePhoto ? 0.88 : 1} onPress={() => activePhoto && setCampGalleryIndex(safeIndex)}>
                  {activePhoto ? (
                    <Image source={{ uri: activePhoto.url }} style={s.quickCardPhoto} resizeMode="cover" />
                  ) : (
                    <View style={[s.quickCardPhotoPlaceholder, { backgroundColor: landColor(selectedCamp?.land_type).bg }]}>
                      <Ionicons name="bonfire-outline" size={34} color={landColor(selectedCamp?.land_type).text} />
                      <Text style={[s.placeholderLand, { color: landColor(selectedCamp?.land_type).text }]}>
                        {(selectedCamp?.land_type || 'CAMP').toUpperCase().slice(0, 12)}
                      </Text>
                    </View>
                  )}
                  {photos.length > 1 ? (
                    <>
                      <View style={s.quickPhotoControls} pointerEvents="box-none">
                        <TouchableOpacity style={s.quickPhotoArrow} onPress={event => { event.stopPropagation(); setQuickCampPhotoIndex((safeIndex - 1 + photos.length) % photos.length); }}>
                          <Ionicons name="chevron-back" size={18} color="#fff" />
                        </TouchableOpacity>
                        <TouchableOpacity style={s.quickPhotoArrow} onPress={event => { event.stopPropagation(); setQuickCampPhotoIndex((safeIndex + 1) % photos.length); }}>
                          <Ionicons name="chevron-forward" size={18} color="#fff" />
                        </TouchableOpacity>
                      </View>
                      <Text style={s.quickPhotoCount}>{safeIndex + 1}/{photos.length}</Text>
                    </>
                  ) : null}
                </TouchableOpacity>
              );
            })()}
            <View style={s.quickCardBody}>
              <View style={s.quickCardHeader}>
                <Text style={s.quickCardName} numberOfLines={2}>{selectedCamp?.name}</Text>
                <TouchableOpacity style={s.quickCardClose} onPress={() => setSelectedCamp(null)}>
                  <Ionicons name="close" size={16} color={C.text3} />
                </TouchableOpacity>
              </View>
              {selectedCamp?.land_type ? (
                <View style={[s.landBadge, { backgroundColor: landColor(selectedCamp.land_type).bg, borderColor: landColor(selectedCamp.land_type).border }]}>
                  <Text style={[s.landBadgeText, { color: landColor(selectedCamp.land_type).text }]}>
                    {selectedCamp.land_type.toUpperCase()}
                  </Text>
                </View>
              ) : null}
              <View style={s.quickCardTags}>
                {(selectedCamp?.tags ?? []).slice(0, 5).map(t => (
                  <View key={t} style={s.qTag}>
                    <Text style={s.qTagText}>{tagEmoji(t) ? `${tagEmoji(t)} ` : ''}{t.toUpperCase()}</Text>
                  </View>
                ))}
                {selectedCamp?.ada && (
                  <View style={[s.qTag, { borderColor: '#3b82f6', backgroundColor: '#eff6ff' }]}>
                    <Text style={[s.qTagText, { color: '#1d4ed8' }]}>ADA</Text>
                  </View>
                )}
              </View>
              {selectedCamp?.cost ? (
                <Text style={s.quickCardCost}>{selectedCamp.reservable ? 'Reservable · ' : ''}{selectedCamp.cost}</Text>
              ) : null}
              <Text style={s.quickCardDesc} numberOfLines={3}>
                {stripHtml(selectedCamp?.description) || 'Camp profile preview. Full profile shows access notes, amenities, map details, and Trailhead camp brief.'}
              </Text>
            {campWeather?.daily?.time?.length ? (
              <View style={s.weatherStrip}>
                {[0, 1, 2].map(i => (
                  <View key={i} style={s.weatherDay}>
                    <Ionicons name={weatherIcon(campWeather.daily.weathercode?.[i] ?? 1)} size={18} color={C.orange} />
                    <Text style={s.weatherHiLo}>
                      {Math.round(campWeather.daily.temperature_2m_max?.[i] ?? 0)}{campWeather.trailhead_units?.temperature_label ?? '°'}/{Math.round(campWeather.daily.temperature_2m_min?.[i] ?? 0)}{campWeather.trailhead_units?.temperature_label ?? '°'}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            {campFullness?.status === 'full' ? (
              <View style={s.fullnessBanner}>
                <View style={s.fullnessBannerTop}>
                  <Ionicons name="warning" size={13} color={C.red} />
                  <Text style={s.fullnessBannerText}>REPORTED FULL · {campFullness.confirmations} confirmed</Text>
                </View>
              </View>
            ) : (
              <View style={s.reportFullBtn}>
                <Ionicons name="checkmark-circle-outline" size={13} color={C.green} />
                <Text style={[s.reportFullText, { color: C.green }]}>NO RECENT FULL REPORTS</Text>
              </View>
            )}
              <View style={s.quickCardActions}>
              <TouchableOpacity style={s.quickCardNav} onPress={() => { if (selectedCamp) addCamp(selectedCamp); setSelectedCamp(null); }}>
                <Ionicons name="add-circle-outline" size={13} color="#fff" />
                <Text style={s.quickCardNavText}>{replaceStopId ? 'REPLACE CAMP' : 'USE AS CAMP'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.quickCardFull} onPress={loadFullCampDetail} disabled={detailLoading}>
                {detailLoading ? <ActivityIndicator size="small" color={C.orange} /> : <Text style={s.quickCardFullText}>FULL PROFILE →</Text>}
              </TouchableOpacity>
              </View>
            </View>
          </TrailheadSheet>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showCampDetail} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeCampDetail}>
        <View style={s.detailModal}>
          {campDetail && (
            <ScrollView showsVerticalScrollIndicator={false}>
              {(campDetail.photos ?? []).length > 0 ? (
                <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={s.photoGallery}>
                  {(campDetail.photos ?? []).map((uri, i) => (
                    <TouchableOpacity key={i} activeOpacity={0.9} onPress={() => setCampGalleryIndex(i)}>
                      <Image source={{ uri: mediaUrl(uri) }} style={[s.galleryPhoto, { width: windowWidth }]} resizeMode="cover" />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              ) : (
                <View style={s.galleryPlaceholder}>
                  <Ionicons name="bonfire-outline" size={48} color={C.orange} />
                </View>
              )}

              <View style={s.detailContent}>
                <TrailheadTopBar
                  title="CAMP PROFILE"
                  subtitle={campDetail.name}
                  icon="bonfire-outline"
                  style={s.detailHeader}
                  right={(
                    <TouchableOpacity style={s.detailClose} onPress={closeCampDetail}>
                      <Ionicons name="close" size={22} color={C.text} />
                    </TouchableOpacity>
                  )}
                />
                <View style={s.detailTags}>
                  {campDetail.land_type ? (
                    <View style={[s.detailLandBadge, { backgroundColor: landColor(campDetail.land_type).bg, borderColor: landColor(campDetail.land_type).border }]}>
                      <Text style={[s.detailLandText, { color: landColor(campDetail.land_type).text }]}>{campDetail.land_type.toUpperCase()}</Text>
                    </View>
                  ) : null}
                  {(campDetail.tags ?? []).map(t => (
                    <View key={t} style={s.qTag}><Text style={s.qTagText}>{tagEmoji(t) ? `${tagEmoji(t)} ` : ''}{t.toUpperCase()}</Text></View>
                  ))}
                  {campDetail.ada && (
                    <View style={[s.qTag, { borderColor: '#3b82f6', backgroundColor: '#eff6ff' }]}>
                      <Text style={[s.qTagText, { color: '#1d4ed8' }]}>ADA</Text>
                    </View>
                  )}
	                </View>
	                <View style={s.detailMeta}>
	                  <Text style={s.detailCost}>{campDetail.price_summary?.label || campDetail.cost || 'See site'}</Text>
	                  {(campDetail.verified_source || campDetail.source) ? (
	                    <Text style={s.detailSiteCount}>{(campDetail.verified_source || campDetail.source || '').toUpperCase()}</Text>
	                  ) : null}
	                  {campDetail.campsites_count > 0 && <Text style={s.detailSiteCount}>{campDetail.campsites_count} sites</Text>}
	                </View>
	                {campDetail.price_summary?.freshness ? (
	                  <TrailheadCard style={s.detailSection}>
	                    <Text style={s.detailSectionTitle}>PRICE SOURCE</Text>
	                    <Text style={s.detailActivities}>{campDetail.price_summary.freshness}</Text>
	                  </TrailheadCard>
	                ) : null}
                {campDetail.description ? (
                  <TrailheadCard style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>ABOUT</Text>
                    <Text style={s.detailDesc}>{stripHtml(campDetail.description)}</Text>
                  </TrailheadCard>
                ) : null}
                {(campDetail.amenities ?? []).length > 0 && (
                  <TrailheadCard style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>AMENITIES</Text>
                    <View style={s.amenityGrid}>
                      {(campDetail.amenities ?? []).map(a => (
                        <View key={a} style={s.amenityItem}>
                          <Ionicons name={amenityIcon(a)} size={13} color={C.text2} />
                          <Text style={s.amenityText}>{a}</Text>
                        </View>
                      ))}
                    </View>
                  </TrailheadCard>
                )}
                {(campDetail.site_types ?? []).length > 0 && (
                  <TrailheadCard style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>SITE TYPES</Text>
                    <View style={s.amenityGrid}>
                      {(campDetail.site_types ?? []).map(st => (
                        <View key={st} style={[s.amenityItem, { backgroundColor: C.green + '12', borderColor: C.green + '55' }]}>
                          <Ionicons name="home-outline" size={13} color={C.green} />
                          <Text style={[s.amenityText, { color: C.green }]}>{st}</Text>
                        </View>
                      ))}
                    </View>
                  </TrailheadCard>
                )}
                {(campDetail.campsites ?? []).some(site => site.name || site.photo_url || site.photos?.length) ? (
                  <TrailheadCard style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>SITES</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.siteRail}>
                      {(campDetail.campsites ?? []).slice(0, 12).map((site, idx) => {
                        const photo = campPhotoUrl(site.photo_url || site.photos?.[0]);
                        const meta = [
                          site.type,
                          site.max_people ? `${site.max_people} people` : '',
                          site.equipment_length ? `${site.equipment_length} ft` : '',
                          site.surface,
                          site.accessible ? 'ADA' : '',
                        ].filter(Boolean).join(' · ');
                        return (
                          <View key={site.id || `${site.name}-${idx}`} style={s.sitePhotoCard}>
                            {photo ? (
                              <Image source={{ uri: photo }} style={s.sitePhoto} resizeMode="cover" />
                            ) : (
                              <View style={s.sitePlaceholder}>
                                <Ionicons name="bonfire-outline" size={22} color={C.orange} />
                              </View>
                            )}
                            <View style={s.siteBody}>
                              <Text style={s.siteName} numberOfLines={2}>{site.name || `Site ${idx + 1}`}</Text>
                              <Text style={s.siteMeta} numberOfLines={2}>{meta || site.source_badge || 'Recreation.gov site'}</Text>
                            </View>
                          </View>
                        );
                      })}
                    </ScrollView>
                  </TrailheadCard>
	                ) : null}
	                {(campDetail.things_to_do ?? []).length > 0 ? (
	                  <TrailheadCard style={s.detailSection}>
	                    <Text style={s.detailSectionTitle}>THINGS TO DO</Text>
	                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.siteRail}>
	                      {(campDetail.things_to_do ?? []).slice(0, 12).map((item: any, idx) => {
	                        const photo = campPhotoUrl(item.photo_url || item.photos?.[0]);
	                        return (
	                          <TouchableOpacity key={item.id || `${item.name}-${idx}`} style={s.sitePhotoCard} activeOpacity={0.86} onPress={() => item.official_url || item.booking_url ? Linking.openURL(item.official_url || item.booking_url) : undefined}>
	                            {photo ? (
	                              <Image source={{ uri: photo }} style={s.sitePhoto} resizeMode="cover" />
	                            ) : (
	                              <View style={s.sitePlaceholder}>
	                                <Ionicons name={item.type === 'tour' ? 'ticket-outline' : item.type === 'permit' ? 'document-text-outline' : 'flag-outline'} size={22} color={C.orange} />
	                              </View>
	                            )}
	                            <View style={s.siteBody}>
	                              <Text style={s.siteName} numberOfLines={2}>{item.name || `Activity ${idx + 1}`}</Text>
	                              <Text style={s.siteMeta} numberOfLines={2}>{[item.type, item.fee_text, item.source_badge].filter(Boolean).join(' · ')}</Text>
	                            </View>
	                          </TouchableOpacity>
	                        );
	                      })}
	                    </ScrollView>
	                  </TrailheadCard>
	                ) : null}
	                {(campDetail.things_to_see ?? []).length > 0 ? (
	                  <TrailheadCard style={s.detailSection}>
	                    <Text style={s.detailSectionTitle}>THINGS TO SEE</Text>
	                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.siteRail}>
	                      {(campDetail.things_to_see ?? []).slice(0, 12).map((item: any, idx) => {
	                        const photo = campPhotoUrl(item.photo_url || item.photos?.[0]);
	                        return (
	                          <TouchableOpacity key={item.id || `${item.name}-${idx}`} style={s.sitePhotoCard} activeOpacity={0.86} onPress={() => item.official_url || item.booking_url ? Linking.openURL(item.official_url || item.booking_url) : undefined}>
	                            {photo ? (
	                              <Image source={{ uri: photo }} style={s.sitePhoto} resizeMode="cover" />
	                            ) : (
	                              <View style={s.sitePlaceholder}>
	                                <Ionicons name="camera-outline" size={22} color={C.orange} />
	                              </View>
	                            )}
	                            <View style={s.siteBody}>
	                              <Text style={s.siteName} numberOfLines={2}>{item.name || `Place ${idx + 1}`}</Text>
	                              <Text style={s.siteMeta} numberOfLines={2}>{[item.type, item.source_badge || item.source_label].filter(Boolean).join(' · ')}</Text>
	                            </View>
	                          </TouchableOpacity>
	                        );
	                      })}
	                    </ScrollView>
	                  </TrailheadCard>
	                ) : null}
	                {(campDetail.visitor_centers ?? []).length > 0 ? (
	                  <TrailheadCard style={s.detailSection}>
	                    <Text style={s.detailSectionTitle}>VISITOR CENTERS</Text>
	                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.siteRail}>
	                      {(campDetail.visitor_centers ?? []).slice(0, 8).map((item: any, idx) => {
	                        const photo = campPhotoUrl(item.photo_url || item.photos?.[0]);
	                        return (
	                          <TouchableOpacity key={item.id || `${item.name}-${idx}`} style={s.sitePhotoCard} activeOpacity={0.86} onPress={() => item.official_url || item.booking_url ? Linking.openURL(item.official_url || item.booking_url) : undefined}>
	                            {photo ? (
	                              <Image source={{ uri: photo }} style={s.sitePhoto} resizeMode="cover" />
	                            ) : (
	                              <View style={s.sitePlaceholder}>
	                                <Ionicons name="information-circle-outline" size={22} color={C.orange} />
	                              </View>
	                            )}
	                            <View style={s.siteBody}>
	                              <Text style={s.siteName} numberOfLines={2}>{item.name || `Visitor center ${idx + 1}`}</Text>
	                              <Text style={s.siteMeta} numberOfLines={2}>{[item.type, item.source_badge || item.source_label].filter(Boolean).join(' · ')}</Text>
	                            </View>
	                          </TouchableOpacity>
	                        );
	                      })}
	                    </ScrollView>
	                  </TrailheadCard>
	                ) : null}
	                {(campDetail.campgrounds_nearby ?? []).length > 0 ? (
	                  <TrailheadCard style={s.detailSection}>
	                    <Text style={s.detailSectionTitle}>CAMPGROUNDS NEARBY</Text>
	                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.siteRail}>
	                      {(campDetail.campgrounds_nearby ?? []).slice(0, 8).map((item: any, idx) => {
	                        const photo = campPhotoUrl(item.photo_url || item.photos?.[0]);
	                        return (
	                          <TouchableOpacity key={item.id || `${item.name}-${idx}`} style={s.sitePhotoCard} activeOpacity={0.86} onPress={() => item.official_url || item.booking_url || item.url ? Linking.openURL(item.official_url || item.booking_url || item.url) : undefined}>
	                            {photo ? (
	                              <Image source={{ uri: photo }} style={s.sitePhoto} resizeMode="cover" />
	                            ) : (
	                              <View style={s.sitePlaceholder}>
	                                <Ionicons name="bonfire-outline" size={22} color={C.orange} />
	                              </View>
	                            )}
	                            <View style={s.siteBody}>
	                              <Text style={s.siteName} numberOfLines={2}>{item.name || `Campground ${idx + 1}`}</Text>
	                              <Text style={s.siteMeta} numberOfLines={2}>{[item.distance_mi ? `${Number(item.distance_mi).toFixed(1)} mi` : '', item.source_badge || item.source_label].filter(Boolean).join(' · ')}</Text>
	                            </View>
	                          </TouchableOpacity>
	                        );
	                      })}
	                    </ScrollView>
	                  </TrailheadCard>
	                ) : null}
	                {(campDetail.activities ?? []).length > 0 && (
                  <TrailheadCard style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>ACTIVITIES</Text>
                    <Text style={s.detailActivities}>{(campDetail.activities ?? []).join(' · ')}</Text>
                  </TrailheadCard>
                )}
                <TrailheadCard style={s.detailSection}>
                  <Text style={s.detailSectionTitle}>COORDINATES</Text>
                  <Text style={s.coordText}>{campDetail.lat.toFixed(6)}, {campDetail.lng.toFixed(6)}</Text>
                  {campInsight?.coordinates_dms ? <Text style={s.coordDms}>{campInsight.coordinates_dms}</Text> : null}
                </TrailheadCard>
                {campInsight && (
                  <TrailheadCard style={s.detailSection}>
                    <View style={s.aiHeader}>
                      <Text style={s.detailSectionTitle}>TRAILHEAD BRIEF</Text>
                      {campInsight.star_rating ? (
                        <Text style={s.aiStars}>{campInsight.star_rating}/5</Text>
                      ) : null}
                    </View>
                    {campInsight.insider_tip ? (
                      <View style={s.insiderTip}>
                        <Text style={s.insiderLabel}>INSIDER TIP</Text>
                        <Text style={s.insiderText}>{campInsight.insider_tip}</Text>
                      </View>
                    ) : null}
                    {campInsight.best_for ? <Text style={s.aiMeta}>Best for: {campInsight.best_for}</Text> : null}
                    {campInsight.best_season ? <Text style={s.aiMeta}>Best season: {campInsight.best_season}</Text> : null}
                    {campInsight.hazards ? (
                      <View style={s.hazardRow}>
                        <Ionicons name="warning-outline" size={13} color={C.yellow} />
                        <Text style={s.hazardText}>{campInsight.hazards}</Text>
                      </View>
                    ) : null}
                    {campInsight.nearby_highlights?.length ? (
                      <View style={{ marginTop: 8 }}>
                        {campInsight.nearby_highlights.map((h, i) => <Text key={i} style={s.nearbyItem}>• {h}</Text>)}
                      </View>
                    ) : null}
                  </TrailheadCard>
                )}
                {(campDetail.reviews ?? []).length > 0 && (
                  <TrailheadCard style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>REVIEWS</Text>
                    {(campDetail.reviews ?? []).slice(0, 3).map((review, idx) => (
                      <View key={`${review.authorName}-${idx}`} style={s.campReviewCard}>
                        <View style={s.campReviewTop}>
                          <Text style={s.campReviewAuthor} numberOfLines={1}>{review.authorName || 'Review'}</Text>
                          <Text style={s.campReviewRating}>{review.rating ? `${review.rating}/5` : review.source || 'Source'}</Text>
                        </View>
                        {!!review.relativeTime && <Text style={s.campReviewMeta}>{review.relativeTime}</Text>}
                        {!!review.text && <Text style={s.campReviewText} numberOfLines={4}>{review.text}</Text>}
                      </View>
                    ))}
                  </TrailheadCard>
                )}
                <View style={s.detailActions}>
                  <TrailheadButton
                    label={replaceStopId ? 'Replace Camp' : 'Use as Camp'}
                    icon="add-circle-outline"
                    variant="primary"
                    onPress={() => { if (selectedCamp) addCamp(selectedCamp); setShowCampDetail(false); setSelectedCamp(null); }}
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>

      <TrailheadPhotoGallery
        visible={campGalleryIndex !== null}
        photos={campPhotoItems(selectedCamp, campDetail)}
        initialIndex={campGalleryIndex ?? 0}
        title={campDetail?.name || selectedCamp?.name || 'Camp'}
        onClose={() => setCampGalleryIndex(null)}
      />

      <Modal visible={showPlaceFilters} transparent animationType="slide" onRequestClose={() => setShowPlaceFilters(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowPlaceFilters(false)}>
          <TrailheadSheet handle={false} style={s.filterSheet} contentStyle={[s.filterSheetContent, { paddingBottom: bottomSheetPad }]}>
            <View style={s.filterSheetTop}>
              <View>
                <Text style={s.kicker}>ROUTE BUILDER</Text>
                <Text style={s.filterSheetTitle}>Downloaded Places</Text>
              </View>
              <TouchableOpacity style={s.quickCardClose} onPress={() => setShowPlaceFilters(false)}>
                <Ionicons name="close" size={17} color={C.text3} />
              </TouchableOpacity>
            </View>
            <Text style={s.filterHintText}>
              These filters control which downloaded pack points appear on the map and in Places search while building routes offline.
            </Text>
            <View style={s.filterToolbar}>
              <TouchableOpacity style={s.filterSmallBtn} onPress={() => setActivePlaceFilters(DEFAULT_PLACE_FILTERS)}>
                <Text style={s.filterSmallText}>DEFAULT</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.filterSmallBtn} onPress={() => setActivePlaceFilters(PLACE_FILTER_TYPES.map(t => t.id))}>
                <Text style={s.filterSmallText}>ALL</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.filterSmallBtn} onPress={() => setActivePlaceFilters([])}>
                <Text style={s.filterSmallText}>CLEAR</Text>
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[s.filterGrid, { paddingBottom: bottomSheetPad + 16 }]}>
              {PLACE_FILTER_TYPES.map(f => {
                const active = activePlaceFilters.includes(f.id);
                const count = offlinePlaces.filter(p => placeMatchesFilterId(p, f.id)).length;
                return (
                  <TouchableOpacity
                    key={f.id}
                    style={[s.filterChip, active && { backgroundColor: f.color, borderColor: f.color }]}
                    onPress={() => setActivePlaceFilters(prev => (
                      prev.includes(f.id) ? prev.filter(id => id !== f.id) : [...prev, f.id]
                    ))}
                  >
                    <Ionicons name={f.icon as any} size={14} color={active ? '#fff' : f.color} />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.filterChipText, active && { color: '#fff' }]}>{f.label}</Text>
                      <Text style={[s.filterChipSub, active && { color: 'rgba(255,255,255,0.76)' }]}>{count} saved</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </TrailheadSheet>
        </TouchableOpacity>
      </Modal>

      <Modal visible={routeActionSheet !== null} transparent animationType="slide" onRequestClose={() => setRouteActionSheet(null)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setRouteActionSheet(null)}>
          <TrailheadSheet handle={false} style={s.routeActionSheet} contentStyle={[s.routeActionSheetContent, { paddingBottom: bottomSheetPad }]}>
            {routeActionSheet === 'rename' ? (
              <>
                <View style={s.filterSheetTop}>
                  <View>
                    <Text style={s.kicker}>ROUTE BUILDER</Text>
                    <Text style={s.filterSheetTitle}>Rename route</Text>
                  </View>
                  <TouchableOpacity style={s.quickCardClose} onPress={() => setRouteActionSheet(null)}>
                    <Ionicons name="close" size={17} color={C.text3} />
                  </TouchableOpacity>
                </View>
                <View style={s.routeRenameField}>
                  <Text style={s.setupLabel}>ROUTE NAME</Text>
                  <TextInput
                    style={s.routeNameInput}
                    value={routeNameDraft}
                    onChangeText={setRouteNameDraft}
                    placeholder="Name this route"
                    placeholderTextColor={C.text3}
                    returnKeyType="done"
                    onSubmitEditing={applyRouteRename}
                    autoFocus
                  />
                </View>
                <View style={s.routeActionFooter}>
                  <TouchableOpacity style={s.routeActionSecondaryBtn} onPress={() => setRouteActionSheet('actions')} activeOpacity={0.84}>
                    <Text style={s.routeActionSecondaryText}>CANCEL</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.routeActionPrimaryBtn} onPress={applyRouteRename} activeOpacity={0.84}>
                    <Ionicons name="checkmark" size={15} color="#fff" />
                    <Text style={s.routeActionPrimaryText}>DONE</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <View style={s.filterSheetTop}>
                  <View>
                    <Text style={s.kicker}>ROUTE BUILDER</Text>
                    <Text style={s.filterSheetTitle}>Route actions</Text>
                  </View>
                  <TouchableOpacity style={s.quickCardClose} onPress={() => setRouteActionSheet(null)}>
                    <Ionicons name="close" size={17} color={C.text3} />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={s.routeActionRow} onPress={() => saveRouteFromActions(false)} disabled={routeSaving} activeOpacity={0.84}>
                  <Ionicons name="save-outline" size={18} color={C.orange} />
                  <View style={s.routeActionRowText}>
                    <Text style={s.routeActionTitle}>Save</Text>
                    <Text style={s.routeActionSub}>Keep editing this route</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={s.routeActionRow} onPress={saveCloseRouteFromActions} disabled={routeSaving} activeOpacity={0.84}>
                  <Ionicons name="checkmark-done-outline" size={18} color={C.orange} />
                  <View style={s.routeActionRowText}>
                    <Text style={s.routeActionTitle}>Save & close</Text>
                    <Text style={s.routeActionSub}>Save this route and start a new one</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={s.routeActionRow} onPress={() => { setRouteActionSheet(null); exitRouteBuilder(); }} disabled={routeSaving} activeOpacity={0.84}>
                  <Ionicons name="exit-outline" size={18} color={C.orange} />
                  <View style={s.routeActionRowText}>
                    <Text style={s.routeActionTitle}>Exit route builder</Text>
                    <Text style={s.routeActionSub}>Save or discard before returning to the map</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={s.routeActionRow} onPress={openRouteRenameSheet} activeOpacity={0.84}>
                  <Ionicons name="create-outline" size={18} color={C.orange} />
                  <View style={s.routeActionRowText}>
                    <Text style={s.routeActionTitle}>Rename route</Text>
                    <Text style={s.routeActionSub}>{resolvedRouteName()}</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={[s.routeActionRow, s.routeActionDangerRow]} onPress={discardRouteFromActions} activeOpacity={0.84}>
                  <Ionicons name="trash-outline" size={18} color={C.red} />
                  <View style={s.routeActionRowText}>
                    <Text style={[s.routeActionTitle, { color: C.red }]}>Discard route</Text>
                    <Text style={s.routeActionSub}>Close without saving changes</Text>
                  </View>
                </TouchableOpacity>
              </>
            )}
          </TrailheadSheet>
        </TouchableOpacity>
      </Modal>

      <PremiumPlaceSheet
        place={selectedRoutePlace?.place ?? null}
        visible={!!selectedRoutePlace}
        initialStage="full"
        routeContextLabel={selectedRoutePlaceContextLabel(selectedRoutePlace)}
        onClose={() => setSelectedRoutePlace(null)}
        onNavigate={place => fly(place.lat, place.lng, 13)}
        onAddToRoute={() => addSelectedRoutePlace(false)}
        onPromoteToRoute={() => addSelectedRoutePlace(true)}
        addToRoutePrimary
        addToRouteLabel={`Save Day ${selectedRoutePlace?.day ?? activeDay} Side Stop`}
        promoteToRouteLabel="Route through"
        onRichDetailLocked={() => {
          setPaywallCode('category_unlock');
          setPaywallMessage('Photos, contact details, and weekly hours load on demand for 5 credits.');
          setPaywallVisible(true);
        }}
      />

      <PaywallModal visible={paywallVisible} code={paywallCode} message={paywallMessage} onClose={() => setPaywallVisible(false)} />
    </SafeAreaView>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  wizardScreen: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 14, paddingTop: 8 },
  wizardScreenTop: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 6, paddingBottom: 14,
  },
  wizardCompactTop: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingBottom: 8,
  },
  buildingScreen: {
    flex: 1,
    justifyContent: 'center',
    gap: 18,
    paddingBottom: 76,
  },
  buildingVideoScreen: {
    flex: 1,
    backgroundColor: '#050505',
    overflow: 'hidden',
  },
  buildingVideo: {
    ...StyleSheet.absoluteFillObject,
  },
  buildingVideoFallback: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  buildingTerrainBand: {
    position: 'absolute',
    left: '-10%',
    right: '-10%',
    height: 120,
    borderRadius: 90,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.035)',
  },
  buildingTerrainBandOne: {
    top: '18%',
    transform: [{ rotate: '-14deg' }],
  },
  buildingTerrainBandTwo: {
    bottom: '22%',
    transform: [{ rotate: '18deg' }],
  },
  buildingRouteLine: {
    position: 'absolute',
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(249,115,22,0.82)',
    shadowColor: '#f97316',
    shadowOpacity: 0.36,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  buildingRouteLineOne: {
    left: '13%',
    top: '37%',
    width: '36%',
    transform: [{ rotate: '21deg' }],
  },
  buildingRouteLineTwo: {
    left: '38%',
    top: '48%',
    width: '34%',
    backgroundColor: 'rgba(20,184,166,0.78)',
    transform: [{ rotate: '-17deg' }],
  },
  buildingRouteLineThree: {
    right: '10%',
    top: '40%',
    width: '29%',
    backgroundColor: 'rgba(34,197,94,0.74)',
    transform: [{ rotate: '26deg' }],
  },
  buildingRoutePoint: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: '#ffffff',
    backgroundColor: '#f97316',
  },
  buildingRoutePointStart: {
    left: '12%',
    top: '35%',
  },
  buildingRoutePointCamp: {
    left: '54%',
    top: '43%',
    backgroundColor: '#14b8a6',
  },
  buildingRoutePointEnd: {
    right: '11%',
    top: '43%',
    backgroundColor: '#22c55e',
  },
  buildingVideoShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.48)',
  },
  buildingVideoContent: {
    flex: 1,
    paddingHorizontal: 18,
    justifyContent: 'flex-end',
    gap: 18,
  },
  buildingVideoTop: {
    alignItems: 'center',
  },
  buildingLivePill: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    borderRadius: 999,
    backgroundColor: 'rgba(5,5,5,0.46)',
    paddingHorizontal: 12,
  },
  buildingLiveText: { color: '#fff', fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 1 },
  buildingHeroCopy: {
    gap: 8,
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  buildingEyebrow: { color: '#f97316', fontSize: 10, fontFamily: mono, fontWeight: '900', letterSpacing: 1.5 },
  buildingHeadline: { color: '#fff', fontSize: 36, lineHeight: 40, fontWeight: '900', textAlign: 'center' },
  buildingSubtitle: { color: 'rgba(255,255,255,0.82)', fontSize: 15, lineHeight: 21, maxWidth: 340, textAlign: 'center' },
  buildingBottomPanel: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 20,
    backgroundColor: 'rgba(5,5,5,0.38)',
    padding: 10,
    alignSelf: 'stretch',
  },
  buildingChecklist: {
    borderWidth: 1,
    borderColor: C.orange + '36',
    borderRadius: 18,
    backgroundColor: 'rgba(5,5,5,0.32)',
    padding: 14,
    gap: 10,
  },
  buildingChecklistRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  buildingChecklistText: { color: 'rgba(255,255,255,0.86)', fontSize: 11, fontFamily: mono, fontWeight: '800', letterSpacing: 0.5 },
  buildingNote: { color: 'rgba(255,255,255,0.72)', fontSize: 12, lineHeight: 18, textAlign: 'center', paddingHorizontal: 10 },
  workspaceContainer: { flex: 1, backgroundColor: C.bg },
  workspaceTopBar: {
    position: 'absolute', top: 10, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  workspaceSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: C.glassStrong,
    borderTopLeftRadius: 30, borderTopRightRadius: 30,
    borderWidth: 1, borderBottomWidth: 0, borderColor: C.border,
    overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.46, shadowRadius: 34, shadowOffset: { width: 0, height: -16 },
    elevation: 12,
  },
  workspaceSheetFull: { height: '97%' },
  workspaceSheetMid: { height: '55%' },
  workspaceSheetPeek: { height: 92 },
  routeEditorPanel: {
    flex: 1,
    borderRadius: 24,
    marginBottom: 116,
  },
  routeSheetContent: { padding: 14, gap: 13 },
  routeSheetFullContent: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderColor: C.border, backgroundColor: C.glassStrong,
  },
  kicker: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '800', letterSpacing: 1 },
  title: { color: C.text, fontSize: 22, fontWeight: '900', letterSpacing: 0 },
  headerBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border, borderRadius: 19, backgroundColor: C.glassStrong },
  headerBtnText: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '800' },
  nameBar: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderColor: C.border, backgroundColor: C.glassStrong,
  },
  nameInput: {
    flex: 1, color: C.text, fontSize: 14, fontWeight: '700',
    borderWidth: 1, borderColor: C.border, borderRadius: 16,
    backgroundColor: C.s2, paddingHorizontal: 12, paddingVertical: 9,
  },
  body: { flex: 1 },
  bodyContent: { padding: 12, paddingTop: 0, paddingBottom: 150, gap: 14 },
  routeHubContent: { paddingBottom: 120, gap: 14 },
  routeHubHero: {
    minHeight: 220,
    overflow: 'hidden',
    borderWidth: 1, borderColor: C.border, borderRadius: 26,
    backgroundColor: C.glassStrong, padding: 0,
    shadowColor: '#000', shadowOpacity: 0.34, shadowRadius: 28, shadowOffset: { width: 0, height: 14 },
  },
  routeHubHeroImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  routeHubHeroShade: { ...StyleSheet.absoluteFillObject },
  routeHubHeroContent: {
    minHeight: 220,
    justifyContent: 'flex-end',
    padding: 18,
    gap: 12,
  },
  routeHubIcon: {
    width: 48, height: 48, borderRadius: 16,
    borderWidth: 1, borderColor: C.border,
    backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center',
  },
  routeHubTitle: { color: '#fff', fontSize: 34, lineHeight: 38, fontWeight: '900' },
  routeHubText: { color: C.text3, fontSize: 14, lineHeight: 20 },
  routeHubPrimary: {
    minHeight: 52, borderRadius: 16, backgroundColor: C.orange,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderColor: C.orange + '88',
    shadowColor: C.orange, shadowOpacity: 0.22, shadowRadius: 18, shadowOffset: { width: 0, height: 0 },
  },
  routeHubPrimaryText: { color: '#fff', fontSize: 11, fontFamily: mono, fontWeight: '900' },
  routeHubExtremeBtn: {
    minHeight: 46,
    borderRadius: 16,
    backgroundColor: '#f97316',
    borderWidth: 1,
    borderColor: '#fb923c88',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  routeHubExtremeText: { color: '#fff', fontSize: 11, fontFamily: mono, fontWeight: '900', letterSpacing: 0.6 },
  routeHubRig: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: C.border, borderRadius: 18,
    backgroundColor: C.s2, padding: 11,
  },
  routeHubRigReady: { borderColor: C.green + '44', backgroundColor: C.green + '10' },
  routeHubRigIcon: {
    width: 34, height: 34, borderRadius: 12,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.s1,
    alignItems: 'center', justifyContent: 'center',
  },
  routeHubRigTitle: { color: C.text, fontSize: 12, fontWeight: '900' },
  routeHubRigMeta: { color: C.text3, fontSize: 10, lineHeight: 14, marginTop: 2 },
  routeHubSmallBtn: {
    minHeight: 32, borderRadius: 10, borderWidth: 1, borderColor: C.orange + '55',
    backgroundColor: C.orange + '10', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10,
  },
  routeHubSmallText: { color: C.orange, fontSize: 8, fontFamily: mono, fontWeight: '900' },
  routeHubSectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 4 },
  routeHubSectionTitle: { color: C.text, fontSize: 15, fontWeight: '900' },
  routeHubSectionMeta: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '800' },
  routeHubTinyAction: {
    minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderColor: C.orange + '44', borderRadius: 999,
    backgroundColor: C.orange + '10', paddingHorizontal: 10,
  },
  routeHubTinyText: { color: C.orange, fontSize: 8, fontFamily: mono, fontWeight: '900' },
  savedRouteCard: {
    minHeight: 214,
    overflow: 'hidden',
    borderWidth: 1, borderColor: C.border, borderRadius: 22,
    backgroundColor: C.s1, padding: 0,
    shadowColor: '#000', shadowOpacity: 0.24, shadowRadius: 22, shadowOffset: { width: 0, height: 10 },
  },
  savedRouteImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  savedRouteShade: { ...StyleSheet.absoluteFillObject },
  savedRouteOverlay: {
    minHeight: 214,
    justifyContent: 'flex-end',
    padding: 14,
    gap: 8,
  },
  savedTripName: { color: '#fff', fontSize: 22, lineHeight: 26, fontWeight: '900' },
  savedTripMeta: { color: 'rgba(255,255,255,0.86)', fontSize: 12, lineHeight: 17, fontFamily: mono, fontWeight: '800' },
  savedRouteContinue: {
    alignSelf: 'flex-start',
    minHeight: 32,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  savedRouteTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  savedRouteIcon: {
    width: 38, height: 38, borderRadius: 13,
    borderWidth: 1, borderColor: C.border,
    backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center',
  },
  savedRouteName: { color: C.text, fontSize: 15, lineHeight: 20, fontWeight: '900' },
  savedRouteMeta: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 3 },
  savedRouteActions: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  savedRouteStat: {
    width: 68, minHeight: 48, borderWidth: 1, borderColor: C.border,
    borderRadius: 14, backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center',
  },
  savedRouteStatValue: { color: C.text, fontSize: 13, fontFamily: mono, fontWeight: '900' },
  savedRouteStatLabel: { color: C.text3, fontSize: 7, fontFamily: mono, fontWeight: '900', marginTop: 2 },
  savedRouteOpen: {
    flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    borderWidth: 1, borderColor: C.border, borderRadius: 14, backgroundColor: C.s2,
  },
  savedRouteExtreme: {
    width: 48,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#f97316',
    borderWidth: 1,
    borderColor: '#fb923c88',
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedRouteOpenText: { color: '#fff', fontSize: 9, fontFamily: mono, fontWeight: '900' },
  savedTrailCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderWidth: 1,
    borderColor: C.green + '33',
    borderRadius: 18,
    backgroundColor: C.green + '0d',
    padding: 11,
  },
  savedTrailPreview: {
    width: 52,
    height: 52,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: C.green + '55',
    backgroundColor: C.green + '16',
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedTrailActions: {
    alignItems: 'center',
    gap: 8,
  },
  savedTrailDelete: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.red + '44',
    backgroundColor: C.red + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedTrailPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  savedTrailPill: {
    color: C.green,
    fontSize: 8,
    fontFamily: mono,
    fontWeight: '900',
    borderWidth: 1,
    borderColor: C.green + '44',
    backgroundColor: C.green + '12',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  routeHubEmpty: {
    minHeight: 150, borderWidth: 1, borderColor: C.border, borderRadius: 16,
    backgroundColor: C.s1, alignItems: 'center', justifyContent: 'center', padding: 18,
  },
  routeHubEmptyCompact: {
    minHeight: 92,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    backgroundColor: C.s1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
  },
  routeHubEmptyTitle: { color: C.text, fontSize: 15, fontWeight: '900', marginTop: 8 },
  routeHubEmptyText: { color: C.text3, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 5 },
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  confirmCard: {
    width: '100%',
    borderRadius: 24,
  },
  confirmCardContent: { padding: 18, gap: 11 },
  confirmIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.orange + '44',
    backgroundColor: C.orange + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmTitle: { color: C.text, fontSize: 22, lineHeight: 27, fontWeight: '900' },
  confirmText: { color: C.text2, fontSize: 13, lineHeight: 19, marginBottom: 2 },
  confirmPrimary: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: C.bg === '#050505' ? C.silverBright : C.orange,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  confirmPrimaryText: { color: C.bg === '#050505' ? '#050505' : '#fff', fontSize: 10, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8 },
  confirmDanger: {
    minHeight: 46,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: C.orange + '44',
    backgroundColor: C.orange + '10',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  confirmDangerText: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8 },
  confirmCancel: { minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  confirmCancelText: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 0.9 },
  dayTabs: { gap: 8 },
  dayTab: { borderWidth: 1, borderColor: C.border, borderRadius: RADIUS.sm, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.s2 },
  dayTabActive: { borderColor: C.orange, backgroundColor: C.orange + '16' },
  dayTabText: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '800' },
  dayTabTextActive: { color: C.orange },
  dayAdd: { width: 34, height: 34, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: C.orange + '55', alignItems: 'center', justifyContent: 'center' },
  builderHero: { borderWidth: 1, borderColor: C.border, borderRadius: RADIUS.lg, padding: 12, backgroundColor: C.s1, gap: 12 },
  builderHeroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  builderHeroTitle: { color: C.text, fontSize: 19, fontWeight: '900', marginTop: 2 },
  builderHeroText: { color: C.text3, fontSize: 12, lineHeight: 18, marginTop: 4 },
  progressBadge: { width: 62, minHeight: 58, borderRadius: RADIUS.md, borderWidth: 1, borderColor: C.orange + '55', backgroundColor: C.orange + '12', alignItems: 'center', justifyContent: 'center' },
  progressBadgeNum: { color: C.orange, fontSize: 16, fontFamily: mono, fontWeight: '900' },
  progressBadgeText: { color: C.text3, fontSize: 8, fontFamily: mono, fontWeight: '900', marginTop: 2 },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeCard: { flex: 1, minHeight: 78, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderColor: C.border, borderRadius: RADIUS.md, backgroundColor: C.s2, padding: 11 },
  modeCardActive: { borderColor: C.orange, backgroundColor: C.orange + '10' },
  radioDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: C.text3, marginTop: 2 },
  radioDotActive: { borderColor: C.orange, backgroundColor: C.orange },
  modeTitle: { color: C.text, fontSize: 12, fontWeight: '900' },
  modeText: { color: C.text3, fontSize: 10, lineHeight: 14, marginTop: 3 },
  loopChoiceRow: { gap: 8 },
  loopChoice: {
    minHeight: 70, flexDirection: 'row', alignItems: 'flex-start', gap: 9,
    borderWidth: 1, borderColor: C.border, borderRadius: RADIUS.md,
    backgroundColor: C.s2, padding: 11,
  },
  loopChoiceActive: { borderColor: C.orange + '66', backgroundColor: C.orange + '10' },
  loopChoiceTitle: { color: C.text, fontSize: 12, fontWeight: '900' },
  loopChoiceText: { color: C.text3, fontSize: 10, lineHeight: 14, marginTop: 3 },
  wizardCard: {
    borderRadius: 24,
  },
  wizardCardFull: {
    flex: 1,
    borderRadius: 24,
    justifyContent: 'flex-start',
    marginTop: 8,
  },
  wizardStepScroll: { flex: 1, minHeight: 0 },
  wizardStepScrollContent: { flexGrow: 1 },
  wizardAnimatedPane: { minHeight: 0 },
  wizardPane: { gap: 12, minHeight: 218, justifyContent: 'flex-start', marginTop: 18 },
  wizardQuestion: { paddingTop: 2, gap: 5 },
  wizardTitle: { color: C.text, fontSize: 30, fontWeight: '800', lineHeight: 35 },
  wizardHelp: { color: C.text3, fontSize: 14, lineHeight: 20, marginTop: 2 },
  wizardNav: { flexDirection: 'row', gap: 9, marginTop: 16, paddingBottom: 6 },
  wizardNavDock: { marginTop: 'auto', paddingTop: 10, paddingBottom: 0 },
  wizardNavStepOne: { borderTopWidth: 1, borderColor: C.border, paddingTop: 14 },
  wizardNavBtn: { minHeight: 50, minWidth: 96, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: C.border, borderRadius: 16, backgroundColor: C.s2 },
  wizardNavText: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '900' },
  wizardNextBtn: {
    flex: 1,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 17,
    backgroundColor: C.orange,
    shadowColor: C.orange,
    shadowOpacity: 0.22,
    shadowRadius: 16,
  },
  wizardNextText: { color: '#fff', fontSize: 10, fontFamily: mono, fontWeight: '900' },
  premiumModeControl: {
    flexDirection: 'row',
    gap: 7,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    backgroundColor: C.bg === '#050505' ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.68)',
    padding: 5,
  },
  premiumModeBtn: {
    flex: 1,
    minHeight: 56,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  premiumModeBtnActive: {
    backgroundColor: C.orange,
    borderColor: C.orange,
    shadowColor: C.orange,
    shadowOpacity: 0.24,
    shadowRadius: 14,
  },
  premiumModeText: { color: C.text2, fontSize: 11, fontFamily: mono, fontWeight: '900' },
  premiumModeSub: { color: C.text3, fontSize: 8.5, marginTop: 2 },
  campPreferenceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  campPreferenceCard: {
    width: '48%',
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 15,
    backgroundColor: C.s2,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  campPreferenceCardActive: { borderColor: C.orange + '77', backgroundColor: C.orange + '12' },
  campPhotoToggle: {
    marginTop: 8,
    marginBottom: 10,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 15,
    backgroundColor: C.s2,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  campPhotoToggleActive: { borderColor: C.orange + '77', backgroundColor: C.orange + '12' },
  campPreferenceTitle: { color: C.text2, fontSize: 11, fontFamily: mono, fontWeight: '900' },
  campPreferenceSub: { color: C.text3, fontSize: 9, marginTop: 2 },
  routeRenameField: { borderWidth: 1, borderColor: C.border, borderRadius: RADIUS.md, backgroundColor: C.s2, paddingHorizontal: 12, paddingVertical: 8 },
  routeNameInput: { color: C.text, fontSize: 15, fontWeight: '800', paddingVertical: 4 },
  setupGrid: { gap: 8 },
  setupGridPair: { flexDirection: 'row', gap: 8 },
  setupLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  currentLocationBtn: { minWidth: 88, height: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderColor: C.orange + '55', borderRadius: 999, paddingHorizontal: 10, backgroundColor: C.orange + '10', flexShrink: 0 },
  currentLocationText: { color: C.orange, fontSize: 7.5, fontFamily: mono, fontWeight: '900' },
  preferenceBlock: { gap: 7 },
  prefLabel: { color: C.text3, fontSize: 8, fontFamily: mono, fontWeight: '900', letterSpacing: 0.9 },
  segmentRow: { flexDirection: 'row', gap: 7 },
  segmentBtn: { flex: 1, minHeight: 36, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: C.border, backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center' },
  segmentBtnActive: { borderColor: C.green, backgroundColor: C.green },
  segmentText: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '900' },
  routeStatStrip: { flexDirection: 'row', gap: 8 },
  routeStatItem: { flex: 1, minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: C.border, borderRadius: RADIUS.sm, backgroundColor: C.bg },
  routeStatValue: { color: C.text2, fontSize: 10, fontFamily: mono, fontWeight: '900' },
  primaryBuildBtn: { minHeight: 50, borderRadius: 16, backgroundColor: C.bg === '#050505' ? C.silverBright : C.orange, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryBuildText: { color: C.bg === '#050505' ? '#050505' : '#fff', fontSize: 11, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8 },
  frameworkCard: { borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 11, backgroundColor: C.s1, gap: 10 },
  frameworkTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  frameworkTitle: { color: C.text, fontSize: 13, fontWeight: '900' },
  frameworkText: { color: C.text3, fontSize: 11, lineHeight: 16, marginTop: 2 },
  frameworkBuildBtn: { minWidth: 76, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, backgroundColor: C.green, paddingHorizontal: 10 },
  frameworkBuildText: { color: '#fff', fontSize: 10, fontFamily: mono, fontWeight: '900' },
  frameworkInputs: { flexDirection: 'row', gap: 8 },
  routeStyleRow: { flexDirection: 'row', gap: 7 },
  routeStyleChip: { flex: 1, minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: C.border, borderRadius: RADIUS.sm, backgroundColor: C.s2 },
  routeStyleChipActive: { borderColor: C.orange + '77', backgroundColor: C.orange + '12' },
  routeStyleText: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '900' },
  tripSetup: { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  setupToggle: { minWidth: 78, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: C.border, borderRadius: RADIUS.sm, backgroundColor: C.s2, paddingHorizontal: 10, paddingVertical: 8 },
  setupToggleText: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '900' },
  setupInputWrap: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 16, backgroundColor: C.s2, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, minHeight: 76 },
  setupLabel: { color: C.text3, fontSize: 7, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8 },
  setupSearchIcon: { width: 20, height: 38, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  setupInput: {
    color: C.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
    height: 38,
    paddingTop: 0,
    paddingBottom: 0,
    textAlignVertical: 'center',
    includeFontPadding: false,
    overflow: 'hidden',
  },
  setupInputRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, overflow: 'hidden' },
  setupInputInline: { flex: 1, minWidth: 0, flexShrink: 1 },
  tripStats: { flexDirection: 'row', gap: 8 },
  tripStat: { flex: 1, minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: C.border, borderRadius: 10, backgroundColor: C.s1, paddingHorizontal: 7 },
  tripStatText: { color: C.text2, fontSize: 9, fontFamily: mono, fontWeight: '800' },
  flowCard: { borderWidth: 1, borderColor: C.border, borderRadius: 12, backgroundColor: C.s1, padding: 11, gap: 9 },
  flowStep: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  flowDot: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border, backgroundColor: C.s2 },
  flowTitle: { color: C.text, fontSize: 12, fontWeight: '900' },
  flowText: { color: C.text3, fontSize: 10, lineHeight: 14, marginTop: 1 },
  gasSourceStrip: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: C.border, borderRadius: 10, backgroundColor: C.s2, paddingHorizontal: 10, paddingVertical: 8 },
  gasSourceText: { flex: 1, color: C.text3, fontSize: 10, lineHeight: 14, fontFamily: mono, fontWeight: '700' },
  routePlanCard: { borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 10, backgroundColor: C.s1, gap: 9 },
  routePlanTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  routePlanMeta: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 2 },
  routePlanBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  routePlanBadgeWarn: { borderColor: C.yellow + '66', backgroundColor: C.yellow + '12' },
  routePlanBadgeOk: { borderColor: C.green + '66', backgroundColor: C.green + '12' },
  routePlanBadgeText: { fontSize: 8, fontFamily: mono, fontWeight: '900', letterSpacing: 0.6 },
  routeTimelineCard: { borderWidth: 1, borderColor: C.border, borderRadius: 14, backgroundColor: C.s2, padding: 10, gap: 9 },
  routeTimelineList: { gap: 18 },
  routeTimelineTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 2 },
  routeTimelineTitle: { color: C.text, fontSize: 14, fontWeight: '900' },
  routeTimelineSub: { color: C.text3, fontSize: 11, lineHeight: 15, marginTop: 2 },
  routeDayWrap: { gap: 10 },
  inlineEmptyCard: { gap: 8, paddingVertical: 4 },
  inlineEmpty: { color: C.text3, fontSize: 11, lineHeight: 16, paddingVertical: 8 },
  inlineEmptyHint: { color: C.text3, fontSize: 10, lineHeight: 15 },
  inlineEmptyActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: C.orange + '55', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: C.orange + '10' },
  sectionActionText: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '900' },
  discoverTabs: { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  discoverTab: { width: 70, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 9, backgroundColor: C.s2 },
  discoverTabActive: { borderColor: C.orange, backgroundColor: C.orange + '14' },
  discoverTabText: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '800' },
  discoverTabTextActive: { color: C.orange },
  discoverBtn: { flex: 1, minHeight: 40, flexDirection: 'row', gap: 6, borderWidth: 1, borderColor: C.orange + '55', borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.orange + '10', paddingHorizontal: 10 },
  discoverBtnText: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '900' },
  discoverySummary: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: C.green + '44', borderRadius: 10, backgroundColor: C.green + '10', paddingHorizontal: 10, paddingVertical: 8 },
  discoverySummaryText: { flex: 1, color: C.green, fontSize: 11, fontFamily: mono, fontWeight: '800' },
  discoverHint: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 9, backgroundColor: C.s2 },
  discoverHintText: { flex: 1, color: C.text3, fontSize: 11, lineHeight: 16 },
  replaceCancel: { alignSelf: 'flex-start', borderWidth: 1, borderColor: C.orange + '55', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: C.orange + '10' },
  replaceCancelText: { color: C.orange, fontSize: 8, fontFamily: mono, fontWeight: '900' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  filterSheet: {
    maxHeight: '78%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  filterSheetContent: { padding: 16, gap: 12 },
  filterSheetTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  filterSheetTitle: { color: C.text, fontSize: 20, fontWeight: '900' },
  filterHintText: { color: C.text3, fontSize: 12, lineHeight: 18 },
  filterToolbar: { flexDirection: 'row', gap: 8 },
  filterSmallBtn: { borderWidth: 1, borderColor: C.border, backgroundColor: C.s2, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  filterSmallText: { color: C.text2, fontSize: 9, fontFamily: mono, fontWeight: '900' },
  filterGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 10 },
  filterChip: { width: '48%', minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.s2, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 9 },
  filterChipText: { color: C.text2, fontSize: 11, fontFamily: mono, fontWeight: '900' },
  filterChipSub: { color: C.text3, fontSize: 9, fontFamily: mono, marginTop: 2 },
  routeActionSheet: {
    maxHeight: '72%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  routeActionSheetContent: { padding: 16, gap: 10 },
  routeActionRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    backgroundColor: C.s2,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  routeActionDangerRow: {
    borderColor: C.red + '44',
    backgroundColor: C.red + '10',
  },
  routeActionRowText: { flex: 1, minWidth: 0 },
  routeActionTitle: { color: C.text, fontSize: 14, fontWeight: '900' },
  routeActionSub: { color: C.text3, fontSize: 11, lineHeight: 15, marginTop: 2 },
  routeActionFooter: { flexDirection: 'row', gap: 9, alignItems: 'stretch' },
  routeActionSecondaryBtn: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    backgroundColor: C.s2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeActionSecondaryText: { color: C.text2, fontSize: 10, fontFamily: mono, fontWeight: '900' },
  routeActionPrimaryBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: C.orange,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  routeActionPrimaryText: { color: '#fff', fontSize: 10, fontFamily: mono, fontWeight: '900' },
  buildSuccessOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.58)', padding: 24 },
  buildSuccessCard: { width: '100%', borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.border, padding: 18, alignItems: 'center', gap: 12 },
  successIconWrap: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: C.orange + '14', borderWidth: 1, borderColor: C.orange + '55' },
  buildSuccessTitle: { color: C.text, fontSize: 22, fontWeight: '900', textAlign: 'center' },
  buildSuccessText: { color: C.text3, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  successChecks: { flexDirection: 'row', gap: 8 },
  successCheck: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: C.green + '44', borderRadius: 999, backgroundColor: C.green + '10', paddingHorizontal: 9, paddingVertical: 6 },
  successCheckText: { color: C.green, fontSize: 9, fontFamily: mono, fontWeight: '900' },
  successPrimaryBtn: { alignSelf: 'stretch', minHeight: 46, borderRadius: 12, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  successPrimaryText: { color: '#fff', fontSize: 11, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8 },
  quickCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '86%',
  },
  quickCardSheetContent: { padding: 0 },
  quickCardImg: { width: '100%', position: 'relative', overflow: 'hidden' },
  quickCardPhoto: { width: '100%', height: 176, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  quickCardPhotoPlaceholder: {
    width: '100%', height: 142, alignItems: 'center', justifyContent: 'center',
    borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: 5,
  },
  quickPhotoControls: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: 70,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  quickPhotoArrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
  },
  quickPhotoCount: {
    position: 'absolute',
    left: 12,
    top: 12,
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    color: '#fff',
    fontSize: 9,
    fontFamily: mono,
    fontWeight: '900',
  },
  placeholderLand: { fontSize: 9, fontFamily: mono, fontWeight: '800', marginTop: 2 },
  quickCardBody: { padding: 14, paddingBottom: 28, gap: 6 },
  quickCardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  quickCardName: { color: C.text, fontSize: 15, fontWeight: '800', flex: 1, lineHeight: 20 },
  quickCardClose: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: C.s3,
    alignItems: 'center', justifyContent: 'center',
  },
  landBadge: {
    alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6, borderWidth: 1,
  },
  landBadgeText: { fontSize: 9, fontFamily: mono, fontWeight: '800', letterSpacing: 0.5 },
  quickCardTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  qTag: {
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.s2,
  },
  qTagText: { color: C.text2, fontSize: 9, fontFamily: mono, fontWeight: '700' },
  siteRail: { gap: 8, paddingRight: 4, paddingTop: 2 },
  sitePhotoCard: { width: 148, borderWidth: 1, borderColor: C.border, backgroundColor: C.s2, borderRadius: 12, overflow: 'hidden' },
  sitePhoto: { width: '100%', height: 80, backgroundColor: C.s3 },
  sitePlaceholder: { width: '100%', height: 80, alignItems: 'center', justifyContent: 'center', backgroundColor: C.orange + '12', borderBottomWidth: 1, borderBottomColor: C.border },
  siteBody: { padding: 9, gap: 4, minHeight: 62 },
  siteName: { color: C.text, fontSize: 12, lineHeight: 15, fontWeight: '900' },
  siteMeta: { color: C.text3, fontSize: 9, lineHeight: 13, fontFamily: mono },
  quickCardCost: { color: C.green, fontSize: 11, fontFamily: mono, fontWeight: '700' },
  quickCardDesc: { color: C.text2, fontSize: 12, lineHeight: 17 },
  quickCardActions: { flexDirection: 'row', gap: 8, marginTop: 2 },
  quickCardNav: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    backgroundColor: C.green,
  },
  quickCardNavText: { color: '#fff', fontSize: 11, fontFamily: mono, fontWeight: '800' },
  quickCardFull: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, borderRadius: 10,
    borderWidth: 1.5, borderColor: C.orange,
  },
  quickCardFullText: { color: C.orange, fontSize: 11, fontFamily: mono, fontWeight: '800' },
  weatherStrip: { flexDirection: 'row', gap: 8 },
  weatherDay: { alignItems: 'center', flex: 1 },
  weatherHiLo: { fontSize: 9, fontFamily: mono, fontWeight: '700', color: C.text2, marginTop: 1 },
  fullnessBanner: {
    backgroundColor: C.red + '12', borderWidth: 1, borderColor: C.red + '55',
    borderRadius: 8, padding: 8, gap: 6,
  },
  fullnessBannerTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  fullnessBannerText: { flex: 1, color: C.red, fontSize: 10, fontFamily: mono, fontWeight: '800' },
  reportFullBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 7,
    borderWidth: 1, borderColor: C.green + '66', backgroundColor: C.s2,
    alignSelf: 'flex-start',
  },
  reportFullText: { color: C.green, fontSize: 10, fontFamily: mono, fontWeight: '700' },
  detailModal: { flex: 1, backgroundColor: C.bg },
  photoGallery: { height: 260 },
  galleryPhoto: { width: 400, height: 260 },
  galleryPlaceholder: {
    height: 200, backgroundColor: C.s2,
    alignItems: 'center', justifyContent: 'center',
  },
  detailContent: { padding: 20, paddingBottom: 110, backgroundColor: C.bg },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 8 },
  detailName: { color: C.text, fontSize: 25, fontWeight: '800', flex: 1, lineHeight: 31 },
  detailClose: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: C.s2,
    borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  detailTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  detailLandBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  detailLandText: { fontSize: 10, fontFamily: mono, fontWeight: '800', letterSpacing: 0.5 },
  detailMeta: { flexDirection: 'row', gap: 16, marginBottom: 16, alignItems: 'center' },
  detailCost: { color: C.green, fontSize: 14, fontFamily: mono, fontWeight: '800' },
  detailSiteCount: { color: C.text2, fontSize: 13, fontFamily: mono },
  detailSection: { marginBottom: 20 },
  detailSectionTitle: {
    color: C.text2, fontSize: 10, fontFamily: mono, fontWeight: '800',
    letterSpacing: 1.1, marginBottom: 10, borderBottomWidth: 1, borderColor: C.border, paddingBottom: 6,
  },
  detailDesc: { color: C.text, fontSize: 14, lineHeight: 22 },
  campReviewCard: { borderWidth: 1, borderColor: C.border, backgroundColor: C.s2, borderRadius: 12, padding: 11, gap: 5, marginBottom: 8 },
  campReviewTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  campReviewAuthor: { flex: 1, color: C.text, fontSize: 12, fontWeight: '800' },
  campReviewRating: { color: C.gold, fontSize: 10, fontFamily: mono, fontWeight: '900' },
  campReviewMeta: { color: C.text3, fontSize: 10, fontFamily: mono },
  campReviewText: { color: C.text2, fontSize: 12, lineHeight: 17 },
  amenityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  amenityItem: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
    flexDirection: 'row', alignItems: 'center', gap: 5,
  },
  amenityText: { color: C.text, fontSize: 12, fontWeight: '500' },
  detailActivities: { color: C.text2, fontSize: 12, lineHeight: 20 },
  coordText: { color: C.text2, fontSize: 13, fontFamily: mono },
  coordDms: { color: C.text2, fontSize: 11, fontFamily: mono, marginTop: 4 },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aiStars: { color: C.yellow, fontSize: 14, marginBottom: 10 },
  insiderTip: { backgroundColor: C.s2, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 12, marginBottom: 8 },
  insiderLabel: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '800', marginBottom: 4 },
  insiderText: { color: C.text, fontSize: 13, lineHeight: 19 },
  aiMeta: { color: C.text2, fontSize: 12, marginBottom: 3 },
  hazardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 6, backgroundColor: C.yellow + '14', borderRadius: 8, padding: 8 },
  hazardText: { color: C.yellow, fontSize: 12, flex: 1, lineHeight: 17 },
  nearbyItem: { color: C.text2, fontSize: 12, marginBottom: 3 },
  detailActions: { gap: 10, marginTop: 8, marginBottom: 28 },
  detailUseBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 15, borderRadius: 16, backgroundColor: C.bg === '#050505' ? C.silverBright : C.orange,
  },
  detailUseText: { color: C.bg === '#050505' ? '#050505' : '#fff', fontSize: 13, fontFamily: mono, fontWeight: '900', letterSpacing: 0.7 },
});

function weatherIcon(code: number): keyof typeof Ionicons.glyphMap {
  if ([0, 1].includes(code)) return 'sunny-outline';
  if ([2, 3].includes(code)) return 'cloud-outline';
  if ([45, 48].includes(code)) return 'reorder-three-outline';
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return 'rainy-outline';
  if ([71, 73, 75, 85, 86].includes(code)) return 'snow-outline';
  if ([95, 96, 99].includes(code)) return 'thunderstorm-outline';
  return 'cloud-outline';
}
