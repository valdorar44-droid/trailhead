type TimelinePhoto = {
  url?: string;
  source?: string;
  credit?: string;
};

type TimelinePlaceMedia = {
  photos?: Array<string | TimelinePhoto>;
  photo_url?: string | null;
  photo_status?: string | null;
  verified_source?: string | null;
  source_badge?: string | null;
  source?: string | null;
};

const OFFICIAL_MEDIA_SOURCE = /^(nps|national park service|blm|bureau of land management|usfs|u\.s\. forest service|recreation\.gov)$/i;

export function trustedTripTimelinePhotoUrl(place: TimelinePlaceMedia | null | undefined): string {
  if (!place) return '';
  const attributed = (place.photos ?? []).find(photo => (
    photo
    && typeof photo === 'object'
    && typeof photo.url === 'string'
    && photo.url.trim()
    && Boolean(photo.source || photo.credit)
  ));
  if (attributed && typeof attributed === 'object') return attributed.url?.trim() ?? '';
  const source = String(place.verified_source || place.source_badge || place.source || '').trim();
  if (
    place.photo_status === 'official'
    && OFFICIAL_MEDIA_SOURCE.test(source)
    && String(place.photo_url ?? '').trim()
  ) {
    return String(place.photo_url).trim();
  }
  return '';
}
