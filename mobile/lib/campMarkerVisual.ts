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

export function campMarkerVisual(camp: Partial<CampsitePin> & Record<string, any>): CampMarkerVisual {
  const raw = campText(camp);

  if (/\b(rv|caravan|motorhome|hookups?|dump station|electric hookup|full hookup)\b/.test(raw)) {
    return { kind: 'rv', code: 'RV', color: '#2563eb', label: 'RV' };
  }

  if (/\b(overnight parking|truck stop|rest area|sleep in vehicle|vehicle overnight|vehicle camp|car camp)\b/.test(raw)) {
    return { kind: 'overnight_parking', code: 'P', color: '#d97706', label: 'Overnight parking' };
  }

  if (/\b(dispersed|primitive|boondock|wild camp|informal camp|roadside camp|undeveloped)\b/.test(raw)) {
    return { kind: 'dispersed', code: 'D', color: '#8b5a2b', label: 'Dispersed' };
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
