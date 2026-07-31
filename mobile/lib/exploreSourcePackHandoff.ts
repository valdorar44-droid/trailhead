import type { CampsitePin, ExploreSourcePackItem } from './api';

const CAMP_CATEGORIES = new Set([
  'camp',
  'campground',
  'developed_campground',
  'dispersed_camp',
  'rv_park',
  'overnight_parking',
]);

function key(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function sourcePackItemCampPin(item: ExploreSourcePackItem): CampsitePin | null {
  const category = key(item.category);
  const kind = key(item.kind);
  if (!CAMP_CATEGORIES.has(category) && !CAMP_CATEGORIES.has(kind)) return null;
  const lat = Number(item.lat);
  const lng = Number(item.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const sourceId = String(item.source_id || '').trim();
  const name = String(item.title || '').trim();
  if (!sourceId || !name) return null;
  const imageUrl = String(item.image_url || '').trim();
  const source = String(item.source || item.source_label || '').trim();
  const siteType = kind || category;
  const amenities = (item.amenities ?? []).map(String).filter(Boolean);

  return {
    id: sourceId,
    place_id: sourceId,
    provider_place_id: sourceId,
    name,
    lat,
    lng,
    tags: (item.tags ?? []).map(String).filter(Boolean),
    land_type: category === 'dispersed_camp' || kind === 'dispersed_camp' ? 'dispersed' : source,
    description: String(item.description || '').trim(),
    amenities,
    site_types: siteType ? [siteType] : [],
    photos: imageUrl ? [{
      url: imageUrl,
      source: item.source_label || item.source,
      caption: item.image_caption,
      credit: item.image_credit,
    }] : [],
    photo_url: imageUrl || undefined,
    reservable: Boolean(item.reservation_url),
    url: String(item.url || '').trim(),
    official_url: String(item.url || '').trim(),
    booking_url: String(item.reservation_url || '').trim() || undefined,
    source,
    source_badge: String(item.source_label || item.source || '').trim(),
    ada: amenities.some(value => /accessib|\bada\b/i.test(value)),
  };
}
