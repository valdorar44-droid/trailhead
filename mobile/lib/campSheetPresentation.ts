import type { CampsiteDetail, CampsitePin } from './api';

export type CampSheetPhotoV1 = {
  url: string;
  source?: string;
  caption?: string;
  credit?: string;
};

export type CampgroundSheetPresentationV1 = {
  title: string;
  sourceLabel: string;
  meta: string;
  siteType: string;
  inventory: string;
  fee: string;
  photos: CampSheetPhotoV1[];
  summary: string;
  features: string[];
  siteTypes: string[];
  activities: string[];
  tags: string[];
  bookingUrl: string;
  officialUrl: string;
  primaryLinkUrl: string;
  phone: string;
};

type CampRecord = Partial<CampsitePin & CampsiteDetail> & Record<string, unknown>;

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown): string[] {
  return list(value)
    .map(item => String(item ?? '').trim())
    .filter(Boolean);
}

function cleanLabel(value: unknown): string {
  return String(value ?? '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase());
}

function displayName(value: unknown, fallback = 'Campground'): string {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return fallback;
  if (/[a-z]/.test(clean) || clean.length < 4) return clean;
  return clean
    .toLowerCase()
    .split(/(\s+|-|\/)/)
    .map(part => {
      if (/^\s+$|^[-/]$/.test(part)) return part;
      const upper = part.toUpperCase();
      if (['RV', 'BLM', 'USFS', 'NPS', 'OHV', 'KOA'].includes(upper)) return upper;
      return part.replace(/^[a-z]/, char => char.toUpperCase());
    })
    .join('');
}

function sourceLabel(value: unknown): string {
  const raw = String(value ?? '').trim();
  const key = raw.toLowerCase();
  if (/\bridb\b|recreation/.test(key)) return 'Recreation.gov';
  if (/forest service|\busfs\b/.test(key)) return 'US Forest Service';
  if (/national park service|\bnps\b/.test(key)) return 'National Park Service';
  if (/bureau of land management|\bblm\b/.test(key)) return 'BLM';
  if (/openstreetmap|\bosm\b|mapbox|geoapify|source data|cached/.test(key)) return 'Campground';
  return cleanLabel(raw) || 'Campground';
}

function summaryText(camp: CampRecord, detail: CampRecord): string {
  const address = String(detail.address || camp.address || '').trim().toLowerCase();
  const candidates = [
    detail.summary,
    detail.description,
    camp.description,
    detail.access_notes,
  ]
    .map(value => String(value ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter(value => !address || value.toLowerCase() !== address)
    .filter(value => !/check current access,\s*rules,\s*(?:fees,\s*)?road conditions(?:,\s*and stay limits)?/i.test(value))
    .filter(value => !/^[-\d.,\s]+$/.test(value));
  return candidates.find(value => value.length >= 26) ?? candidates[0] ?? '';
}

function uniqueLabels(values: unknown[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const label = cleanLabel(value);
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    output.push(label);
  }
  return output;
}

function meaningfulFeatureLabels(values: unknown[]): string[] {
  return uniqueLabels(values).filter(label => (
    !/^(camp|campground|source data|map data|osm|openstreetmap|recreation\.gov|usfs|nps|blm)$/i.test(label)
  ));
}

function safeUrl(value: unknown): string {
  const text = String(value ?? '').trim();
  return /^https:\/\//i.test(text) ? text : '';
}

function photoItems(
  camp: CampRecord,
  detail: CampRecord,
  normalizeUrl: (value: string) => string,
): CampSheetPhotoV1[] {
  const output: CampSheetPhotoV1[] = [];
  const seen = new Set<string>();
  const fallbackSource = String(
    detail.media_source
    || detail.verified_source
    || camp.verified_source
    || camp.source_badge
    || camp.source
    || 'Trailhead',
  );
  const add = (raw: unknown, inheritedSource?: string) => {
    const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
    const original = typeof raw === 'string' ? raw : String(record?.url ?? '');
    const url = normalizeUrl(original.trim());
    if (!url || seen.has(url)) return;
    seen.add(url);
    output.push({
      url,
      source: String(record?.source || inheritedSource || fallbackSource),
      ...(record?.caption ? { caption: String(record.caption) } : {}),
      ...(record?.credit ? { credit: String(record.credit) } : {}),
    });
  };

  for (const photo of list(detail.photos)) add(photo, String(detail.media_source || detail.verified_source || ''));
  for (const site of list(detail.campsites)) {
    if (!site || typeof site !== 'object') continue;
    const siteRecord = site as Record<string, unknown>;
    const siteSource = String(siteRecord.source_badge || siteRecord.verified_source || 'Recreation.gov');
    for (const photo of list(siteRecord.photos)) add(photo, siteSource);
    add(siteRecord.photo_url, siteSource);
  }
  for (const photo of list(camp.photos)) add(photo, String(camp.verified_source || camp.source_badge || camp.source || ''));
  add(detail.photo_url, String(detail.media_source || detail.verified_source || ''));
  add(camp.photo_url, String(camp.verified_source || camp.source_badge || camp.source || ''));
  return output;
}

export function campgroundSheetPresentationV1(
  selected: CampsitePin,
  storedDetail?: CampsiteDetail | null,
  options: { normalizeMediaUrl?: (value: string) => string } = {},
): CampgroundSheetPresentationV1 {
  const camp = (selected || {}) as CampRecord;
  const detail = (storedDetail || {}) as CampRecord;
  const tags = [...strings(camp.tags), ...strings(detail.tags)];
  const sourceText = `${String(detail.description || '')} ${String(camp.description || '')}`.toLowerCase();
  const rawFeatures: unknown[] = [...strings(camp.amenities), ...strings(detail.amenities)];
  if (camp.ada || detail.ada) rawFeatures.push('ADA accessible');
  if (/\bshade\b|shaded|cottonwood/.test(sourceText)) rawFeatures.push('Good shade');
  if (/drinking water|potable water|water available/.test(sourceText) && !/no potable water/.test(sourceText)) rawFeatures.push('Drinking water');
  if (/vault toilets?|flush toilets?|restrooms?/.test(sourceText) && !/no toilets?/.test(sourceText)) rawFeatures.push('Toilets');
  if (/picnic table/.test(sourceText)) rawFeatures.push('Picnic tables');
  if (/fire rings?|fire pits?/.test(sourceText)) rawFeatures.push('Fire ring');
  if (camp.reservable || detail.reservable) rawFeatures.push('Reservable');

  const identityText = [
    detail.name,
    camp.name,
    detail.description,
    camp.description,
    ...tags,
  ].map(value => String(value ?? '').toLowerCase()).join(' ');
  const sourcedSiteTypes: unknown[] = [];
  if (/\bdispersed\b|\bprimitive camping\b/.test(identityText)) sourcedSiteTypes.push('Dispersed camping');
  if (/\bgroup campground\b|\bgroup camp\b|\bgroup site\b/.test(identityText)) sourcedSiteTypes.push('Group campground');
  if (/\brv park\b|\brv campground\b/.test(identityText)) sourcedSiteTypes.push('RV campground');
  const siteTypes = uniqueLabels([
    ...sourcedSiteTypes,
    ...strings(camp.site_types),
    ...strings(detail.site_types),
  ]);
  if (tags.some(tag => /\brv\b/i.test(tag))) siteTypes.push(...uniqueLabels(['RV sites']));
  if (tags.some(tag => /tent/i.test(tag))) siteTypes.push(...uniqueLabels(['Tent sites']));
  if (
    tags.some(tag => /group/i.test(tag))
    && !siteTypes.some(label => /group/i.test(label))
  ) siteTypes.push(...uniqueLabels(['Group sites']));
  if (
    tags.some(tag => /dispersed|primitive/i.test(tag))
    && !siteTypes.some(label => /dispersed|primitive/i.test(label))
  ) siteTypes.push(...uniqueLabels(['Dispersed camping']));

  const activities = uniqueLabels(strings(detail.activities));
  if (tags.some(tag => /hik/i.test(tag))) activities.push(...uniqueLabels(['Hiking']));
  if (tags.some(tag => /bike|biking/i.test(tag))) activities.push(...uniqueLabels(['Biking']));
  if (tags.some(tag => /ohv|4wd|utv/i.test(tag))) activities.push(...uniqueLabels(['OHV trails']));
  if (tags.some(tag => /fish/i.test(tag))) activities.push(...uniqueLabels(['Fishing']));

  const source = sourceLabel(detail.verified_source || detail.source_badge || detail.source || camp.verified_source || camp.source_badge || camp.source || camp.land_type);
  const address = String(detail.address || camp.address || '').trim();
  const rawCost = String(detail.cost || camp.cost || '').trim();
  const reservable = Boolean(detail.reservable || camp.reservable);
  const fee = rawCost
    ? reservable && !/reservable/i.test(rawCost) ? `Reservable · ${rawCost}` : rawCost
    : reservable ? 'Reservable' : 'Not listed';
  const inventoryCount = Number(detail.campsites_count ?? camp.campsites_count);
  const inventory = Number.isFinite(inventoryCount) && inventoryCount > 0
    ? `${inventoryCount} sites`
    : reservable ? 'Reservable' : 'Not listed';
  const primarySiteType = siteTypes[0]
    || cleanLabel(tags.find(tag => /tent|\brv\b|cabin|walk.?in|group|dispersed/i.test(tag)))
    || cleanLabel(detail.land_type || camp.land_type)
    || 'Campground';
  const bookingUrl = safeUrl(detail.booking_url || camp.booking_url);
  const officialUrl = safeUrl(detail.official_url || camp.official_url || detail.url || camp.url);

  return {
    title: displayName(detail.name || camp.name),
    sourceLabel: source,
    meta: [address, source].filter(Boolean).join(' · '),
    siteType: primarySiteType,
    inventory,
    fee,
    photos: photoItems(camp, detail, options.normalizeMediaUrl || (value => value)),
    summary: summaryText(camp, detail),
    features: meaningfulFeatureLabels(rawFeatures).slice(0, 12),
    siteTypes: uniqueLabels(siteTypes).slice(0, 8),
    activities: uniqueLabels(activities).slice(0, 8),
    tags: uniqueLabels(tags),
    bookingUrl,
    officialUrl,
    primaryLinkUrl: bookingUrl || officialUrl,
    phone: String(detail.phone || camp.phone || '').trim(),
  };
}
