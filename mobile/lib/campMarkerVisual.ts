import type { CampsitePin } from '@/lib/api';

export type CampMarkerKind =
  | 'camp'
  | 'dispersed'
  | 'rv'
  | 'overnight_parking'
  | 'tent'
  | 'blm'
  | 'usfs'
  | 'nps'
  | 'state'
  | 'corps'
  | 'reservable';

export type CampMarkerVisual = {
  kind: CampMarkerKind;
  code: string;
  color: string;
  label: string;
};

function campText(camp: Partial<CampsitePin> & Record<string, any>): string {
  return [
    camp.name,
    camp.land_type,
    camp.source_badge,
    camp.verified_source,
    camp.source,
    camp.feature_source,
    camp.cost,
    camp.description,
    camp.review_status,
    ...(Array.isArray(camp.tags) ? camp.tags : []),
    ...(Array.isArray(camp.site_types) ? camp.site_types : []),
    ...(Array.isArray(camp.amenities) ? camp.amenities : []),
  ].filter(Boolean).join(' ').toLowerCase();
}

function campFieldText(camp: Partial<CampsitePin> & Record<string, any>, fields: string[]): string {
  const values: string[] = [];
  fields.forEach(field => {
    const value = camp[field];
    if (Array.isArray(value)) {
      values.push(...value.map(item => String(item || '')));
    } else if (value !== undefined && value !== null) {
      values.push(String(value));
    }
  });
  return values.filter(Boolean).join(' ').toLowerCase();
}

const PRIMARY_RV_RE = /\b(?:rv|r\.v\.|caravan|motorhome|motor home|recreational vehicle)\s*(?:park|parks|resort|resorts|camp|campground|campgrounds|site|sites|stay|stays|area|areas)\b|\b(?:park|resort|campground|camp)\s+for\s+(?:rvs?|r\.v\.s?|caravans?|motorhomes?|motor homes?|recreational vehicles?)\b|\b(?:rv|r\.v\.)[-_\s]?(?:park|resort|campground|site|sites)\b|\bcaravan[-_\s]?park\b|\bmotorhome[-_\s]?park\b/i;

export function isPrimaryRvCamp(camp: Partial<CampsitePin> & Record<string, any>): boolean {
  const primaryText = campFieldText(camp, [
    'name',
    'land_type',
    'subtype',
    'type',
    'source_badge',
    'verified_source',
    'feature_source',
    'tags',
    'site_types',
  ]);
  return PRIMARY_RV_RE.test(primaryText);
}

function isPrimaryDispersedCamp(camp: Partial<CampsitePin> & Record<string, any>, raw: string): boolean {
  if (!/\b(dispersed|primitive|boondock|wild camp|informal camp|roadside camp|undeveloped)\b/.test(raw)) {
    return false;
  }
  const developed = Boolean(camp.reservable) || /\b(campgrounds?|group camp|group site|group campsites?|recreation\.gov|reservable|reservation)\b/.test(raw);
  return !developed;
}

export function campMarkerVisual(camp: Partial<CampsitePin> & Record<string, any>): CampMarkerVisual {
  const raw = campText(camp);

  if (/\b(overnight parking|truck stop|rest area|sleep in vehicle|vehicle overnight|vehicle camp|car camp)\b/.test(raw)) {
    return { kind: 'overnight_parking', code: 'P', color: '#d97706', label: 'Overnight parking' };
  }

  if (isPrimaryDispersedCamp(camp, raw)) {
    return { kind: 'dispersed', code: 'D', color: '#8b5a2b', label: 'Dispersed' };
  }

  if (isPrimaryRvCamp(camp)) {
    return { kind: 'rv', code: 'RV', color: '#2563eb', label: 'RV' };
  }

  if (/\b(tent|walk-in|hike-in|backcountry)\b/.test(raw)) {
    return { kind: 'tent', code: 'C', color: '#14b8a6', label: 'Campground' };
  }

  if (/\b(blm|bureau of land management)\b/.test(raw)) {
    return { kind: 'blm', code: 'C', color: '#14b8a6', label: 'Campground' };
  }

  if (/\b(usfs|national forest|forest service)\b/.test(raw)) {
    return { kind: 'usfs', code: 'C', color: '#14b8a6', label: 'Campground' };
  }

  if (/\b(nps|national park)\b/.test(raw)) {
    return { kind: 'nps', code: 'C', color: '#14b8a6', label: 'Campground' };
  }

  if (/\b(state park|state campground|state forest)\b/.test(raw)) {
    return { kind: 'state', code: 'C', color: '#14b8a6', label: 'Campground' };
  }

  if (/\b(corps|army corps|usace)\b/.test(raw)) {
    return { kind: 'corps', code: 'C', color: '#14b8a6', label: 'Campground' };
  }

  if (camp.reservable) {
    return { kind: 'reservable', code: 'C', color: '#14b8a6', label: 'Campground' };
  }

  return { kind: 'camp', code: 'C', color: '#14b8a6', label: 'Campground' };
}
