import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';

export type MapModePresetId =
  | 'default'
  | 'tonight'
  | 'remoteRoute'
  | 'overland'
  | 'trailDay'
  | 'familyEasy'
  | 'weatherRisk'
  | 'waterFish'
  | 'townReset'
  | 'scenic';

export type MapLegendCategoryId =
  | 'camps'
  | 'trails'
  | 'offroad'
  | 'reports'
  | 'weather'
  | 'water'
  | 'sources';

export type MapLegendGlyph = 'dot' | 'line' | 'dash' | 'dotted' | 'icon';

export type MapLegendItem = {
  label: string;
  detail: string;
  color: string;
  glyph: MapLegendGlyph;
  icon?: ComponentProps<typeof Ionicons>['name'];
};

export type MapLegendCategory = {
  id: MapLegendCategoryId;
  title: string;
  sub: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  color: string;
  items: readonly MapLegendItem[];
  source?: string;
};

export type MapModePreset = {
  id: MapModePresetId;
  title: string;
  purpose: string;
  bestFor: string;
  trust: string;
  icons: readonly ComponentProps<typeof Ionicons>['name'][];
  colors: readonly [string, string, string, string];
  legendFocus: MapLegendCategoryId;
};

export const MAP_MODE_PRESETS: readonly MapModePreset[] = [
  {
    id: 'default',
    title: 'Default',
    purpose: 'Balanced camps, trailheads, water, fuel, and shared notes.',
    bestFor: 'daily scouting',
    trust: 'Saved on device',
    icons: ['map-outline', 'bonfire-outline', 'location-outline'],
    colors: ['#1f2937', '#166534', '#0ea5e9', '#f97316'],
    legendFocus: 'sources',
  },
  {
    id: 'tonight',
    title: 'Tonight',
    purpose: 'Places to stay, water, food, and current notes near the next stop.',
    bestFor: 'last-mile camp choice',
    trust: 'Trusted sources',
    icons: ['moon-outline', 'bonfire-outline', 'restaurant-outline'],
    colors: ['#111827', '#14b8a6', '#f59e0b', '#38bdf8'],
    legendFocus: 'camps',
  },
  {
    id: 'remoteRoute',
    title: 'Remote Route',
    purpose: 'Fuel, water, repair, offline readiness, signal, and hazards.',
    bestFor: 'long gaps',
    trust: 'Route-aware',
    icons: ['navigate-outline', 'flash-outline', 'construct-outline'],
    colors: ['#172554', '#0ea5e9', '#f97316', '#ef4444'],
    legendFocus: 'reports',
  },
  {
    id: 'overland',
    title: 'Overland',
    purpose: 'Public land, MVUM, dispersed camps, 4WD access, and closures.',
    bestFor: 'dirt access',
    trust: 'USFS/BLM context',
    icons: ['car-sport-outline', 'map-outline', 'trail-sign-outline'],
    colors: ['#1c1917', '#22c55e', '#a16207', '#f97316'],
    legendFocus: 'offroad',
  },
  {
    id: 'trailDay',
    title: 'Trail Day',
    purpose: 'Trails, trailheads, parking, restrooms, water, and trail reports.',
    bestFor: 'hike planning',
    trust: 'Open trail sources',
    icons: ['trail-sign-outline', 'walk-outline', 'car-outline'],
    colors: ['#102018', '#22c55e', '#1d8cff', '#111827'],
    legendFocus: 'trails',
  },
  {
    id: 'familyEasy',
    title: 'Family Easy',
    purpose: 'Easy walks, picnic stops, parking, restrooms, centers, short drives.',
    bestFor: 'low-friction days',
    trust: 'Official places',
    icons: ['happy-outline', 'leaf-outline', 'business-outline'],
    colors: ['#0f172a', '#84cc16', '#38bdf8', '#f59e0b'],
    legendFocus: 'trails',
  },
  {
    id: 'weatherRisk',
    title: 'Weather Risk',
    purpose: 'Radar, fire, smoke, wind, snow, flood, and route cautions.',
    bestFor: 'changing conditions',
    trust: 'Live risk feeds',
    icons: ['partly-sunny-outline', 'flame-outline', 'rainy-outline'],
    colors: ['#111827', '#06b6d4', '#ef4444', '#facc15'],
    legendFocus: 'weather',
  },
  {
    id: 'waterFish',
    title: 'Water/Fish',
    purpose: 'Rivers, lakes, launches, gauges, safe water, marinas, hazards.',
    bestFor: 'water access',
    trust: 'NOAA/OSM context',
    icons: ['boat-outline', 'fish-outline', 'water-outline'],
    colors: ['#061a2f', '#0891b2', '#38bdf8', '#22c55e'],
    legendFocus: 'water',
  },
  {
    id: 'townReset',
    title: 'Town Reset',
    purpose: 'Groceries, food, medical, parts, lodging, wifi, dump, water, fuel.',
    bestFor: 'resupply',
    trust: 'Provider search',
    icons: ['cart-outline', 'medical-outline', 'wifi-outline'],
    colors: ['#172554', '#38bdf8', '#f97316', '#6366f1'],
    legendFocus: 'sources',
  },
  {
    id: 'scenic',
    title: 'Scenic',
    purpose: 'Viewpoints, historic places, monuments, photo stops, scenic drives.',
    bestFor: 'slow travel',
    trust: 'Curated + open data',
    icons: ['camera-outline', 'flag-outline', 'business-outline'],
    colors: ['#1e1b4b', '#a855f7', '#f59e0b', '#0ea5e9'],
    legendFocus: 'sources',
  },
];

export const MAP_LEGEND_CATEGORIES: readonly MapLegendCategory[] = [
  {
    id: 'camps',
    title: 'Camps and Stays',
    sub: 'Pin color explains stay type and review state.',
    icon: 'bonfire-outline',
    color: '#14b8a6',
    source: 'Camp pins can combine official campground data, public-land candidates, private stays, and Trailhead review status.',
    items: [
      { label: 'Public/developed camp', detail: 'Official or known campground.', color: '#16a34a', glyph: 'icon', icon: 'bonfire-outline' },
      { label: 'Dispersed candidate', detail: 'Public-land stay that still needs local access judgment.', color: '#14b8a6', glyph: 'icon', icon: 'flame-outline' },
      { label: 'Private stay / glamping', detail: 'Partner, private, or lodging-style stay.', color: '#8b5cf6', glyph: 'icon', icon: 'home-outline' },
      { label: 'RV park', detail: 'RV-focused services or hookups.', color: '#94a3b8', glyph: 'icon', icon: 'car-outline' },
      { label: 'Needs review', detail: 'Legal, access, or freshness confidence is not strong yet.', color: '#f59e0b', glyph: 'icon', icon: 'alert-circle-outline' },
    ],
  },
  {
    id: 'trails',
    title: 'Trails',
    sub: 'Trail lines favor simple difficulty and confidence cues.',
    icon: 'trail-sign-outline',
    color: '#22c55e',
    source: 'Trail geometry can come from official/open sources, OSM, imported GPX, and Trailhead-generated profiles.',
    items: [
      { label: 'Easy', detail: 'Lower effort or family-friendly route.', color: '#22c55e', glyph: 'line' },
      { label: 'Moderate', detail: 'More distance, grade, exposure, or route-finding.', color: '#1d8cff', glyph: 'line' },
      { label: 'Hard', detail: 'Steep, long, exposed, technical, or remote.', color: '#111827', glyph: 'line' },
      { label: 'Closed / high risk', detail: 'Closure, access block, or serious condition report.', color: '#ef4444', glyph: 'line' },
      { label: 'Imported / uncertain', detail: 'Community or imported geometry with lower confidence.', color: '#f59e0b', glyph: 'dash' },
      { label: 'Snap unavailable', detail: 'Displayed as reference; not routable yet.', color: '#94a3b8', glyph: 'dotted' },
    ],
  },
  {
    id: 'offroad',
    title: 'Offroad and Access',
    sub: 'Access lines focus on surface, vehicle fit, and legal use.',
    icon: 'car-sport-outline',
    color: '#f97316',
    source: 'MVUM is a legal-access reference, not live gate status. Always check posted closures.',
    items: [
      { label: 'Dirt / forest road', detail: 'Unpaved or backroad access.', color: '#92400e', glyph: 'line' },
      { label: '4WD / high clearance likely', detail: 'Rougher access or technical section.', color: '#f97316', glyph: 'line' },
      { label: 'Closed / blocked', detail: 'Closure, gate, or motorized restriction.', color: '#ef4444', glyph: 'line' },
      { label: 'Seasonal access', detail: 'Calendar-dependent road or trail.', color: '#f59e0b', glyph: 'icon', icon: 'calendar-outline' },
      { label: 'Gate / check access', detail: 'Physical or administrative access point.', color: '#d97706', glyph: 'icon', icon: 'lock-closed-outline' },
      { label: 'Technical section', detail: 'Rig fit deserves extra review.', color: '#fb923c', glyph: 'icon', icon: 'car-sport-outline' },
    ],
  },
  {
    id: 'reports',
    title: 'Reports',
    sub: 'Community reports fade unless confirmed.',
    icon: 'people-outline',
    color: '#38bdf8',
    source: 'Trailhead reports should show confirmations, freshness, and expiry when available.',
    items: [
      { label: 'Hazard / blocker', detail: 'Avoid or inspect before committing.', color: '#ef4444', glyph: 'dot' },
      { label: 'Caution', detail: 'Useful warning, not necessarily a blocker.', color: '#f97316', glyph: 'dot' },
      { label: 'Information', detail: 'Helpful note, condition, or service detail.', color: '#38bdf8', glyph: 'dot' },
      { label: 'Confirmed good', detail: 'Recently checked and marked passable/open.', color: '#22c55e', glyph: 'dot' },
      { label: 'Expired / unconfirmed', detail: 'Older report with low current confidence.', color: '#64748b', glyph: 'dot' },
    ],
  },
  {
    id: 'weather',
    title: 'Weather and Risk',
    sub: 'Weather layers are timing-sensitive and should be treated as live risk context.',
    icon: 'partly-sunny-outline',
    color: '#f59e0b',
    source: 'Weather, fire, smoke, air, and water risk feeds can be delayed or unavailable in sparse regions.',
    items: [
      { label: 'Fire hotspot / perimeter', detail: 'Active fire context or perimeter layer.', color: '#ef4444', glyph: 'icon', icon: 'flame-outline' },
      { label: 'Smoke / air risk', detail: 'Reduced visibility or health concern.', color: '#64748b', glyph: 'icon', icon: 'cloud-outline' },
      { label: 'High wind', detail: 'Driving, camp, or ridge exposure concern.', color: '#38bdf8', glyph: 'icon', icon: 'flag-outline' },
      { label: 'Snow / ice', detail: 'Winter travel or trail condition risk.', color: '#93c5fd', glyph: 'icon', icon: 'snow-outline' },
      { label: 'Flood / water risk', detail: 'Flooding, high water, wash, or gauge issue.', color: '#0891b2', glyph: 'icon', icon: 'water-outline' },
      { label: 'Severe storm', detail: 'Lightning or high-impact storm risk.', color: '#facc15', glyph: 'icon', icon: 'flash-outline' },
    ],
  },
  {
    id: 'water',
    title: 'Water and Fish',
    sub: 'Water mode separates access, hazards, and chart-like context.',
    icon: 'boat-outline',
    color: '#0891b2',
    source: 'Water layers are informational and are not certified chartplotter data.',
    items: [
      { label: 'Shallow structure', detail: '0-10 ft structure or shallow zone where available.', color: '#f97316', glyph: 'line' },
      { label: 'Contour / depth line', detail: 'Open hydro contour or estimated bathymetry.', color: '#bae6fd', glyph: 'line' },
      { label: 'Recommended track', detail: 'Open follow line or recommended water route context.', color: '#38bdf8', glyph: 'line' },
      { label: 'Marked channel', detail: 'Channel, fairway, buoy, or navigation marker.', color: '#22c55e', glyph: 'dash' },
      { label: 'Hazard', detail: 'Rock, wreck, shoal, obstruction, or caution marker.', color: '#ef4444', glyph: 'icon', icon: 'warning-outline' },
      { label: 'Launch / shore access', detail: 'Ramp, paddle launch, marina, dock, or shore access.', color: '#1d4ed8', glyph: 'icon', icon: 'boat-outline' },
    ],
  },
  {
    id: 'sources',
    title: 'Sources and Trust',
    sub: 'Every major result should say where it came from and how fresh it is.',
    icon: 'shield-checkmark-outline',
    color: '#94a3b8',
    source: 'Source lines help separate official data, open data, inferred geometry, live feeds, and community reports.',
    items: [
      { label: 'Official source', detail: 'NPS, USFS, BLM, state, local, NOAA, or other agency data.', color: '#22c55e', glyph: 'icon', icon: 'shield-checkmark-outline' },
      { label: 'Open map/source', detail: 'OSM, public datasets, or open provider context.', color: '#38bdf8', glyph: 'icon', icon: 'map-outline' },
      { label: 'Trailhead report', detail: 'Community contribution with confirmations and expiry when available.', color: '#f97316', glyph: 'icon', icon: 'people-outline' },
      { label: 'Inferred', detail: 'Trailhead-derived category, difficulty, route fit, or legal-stay confidence.', color: '#f59e0b', glyph: 'icon', icon: 'sparkles-outline' },
      { label: 'Partner/live', detail: 'Provider search, bookable activity, or live availability handoff.', color: '#8b5cf6', glyph: 'icon', icon: 'briefcase-outline' },
    ],
  },
];

export function legendCategoryForPreset(presetId?: MapModePresetId | null): MapLegendCategoryId {
  return MAP_MODE_PRESETS.find(preset => preset.id === presetId)?.legendFocus ?? 'sources';
}

export function mapModePresetTitle(presetId?: MapModePresetId | null) {
  return MAP_MODE_PRESETS.find(preset => preset.id === presetId)?.title ?? 'Default';
}
