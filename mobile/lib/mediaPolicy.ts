const BLOCKED_PAGE_HOSTS = [
  'dailymotion.com',
  'facebook.com',
  'instagram.com',
  'loom.com',
  'tiktok.com',
  'vimeo.com',
  'youtu.be',
  'youtube.com',
] as const;

const BLOCKED_PATH_SUFFIXES = [
  '.avi', '.doc', '.docx', '.htm', '.html', '.m4v', '.mkv', '.mov',
  '.mp3', '.mp4', '.mpeg', '.mpg', '.pdf', '.ppt', '.pptx', '.webm',
] as const;

export type ExploreImageBounds = {
  width: number;
  height: number;
};

export const EXPLORE_IMAGE_BOUNDS = {
  rail: { width: 720, height: 720 },
  card: { width: 960, height: 768 },
  tile: { width: 640, height: 512 },
  trail: { width: 960, height: 640 },
  detail: { width: 1280, height: 960 },
  guidedDetail: { width: 960, height: 720 },
  mapPreview: { width: 1280, height: 1280 },
} as const satisfies Record<string, ExploreImageBounds>;

const IMAGE_DIMENSION_QUERY_KEYS = new Set([
  'w',
  'width',
  'maxwidth',
  'max_width',
  'imwidth',
]);

const IMAGE_HEIGHT_QUERY_KEYS = new Set([
  'h',
  'height',
  'maxheight',
  'max_height',
  'imheight',
]);

const MIN_DERIVATIVE_EDGE = 64;
const MAX_DERIVATIVE_EDGE = 1600;
const WIKIMEDIA_THUMBNAIL_WIDTHS = [60, 120, 250, 330, 500, 960] as const;
const WIKIMEDIA_USER_AGENT = 'Trailhead-Mobile/1.0 (+https://gettrailhead.app/support)';

export function isRenderableImageUrl(value: unknown): value is string {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (!clean) return false;
  if (/^(file:\/\/|content:\/\/|data:image\/)/i.test(clean)) return true;
  if (clean.startsWith('/')) return true;
  if (!/^https?:\/\//i.test(clean)) return false;
  try {
    const parsed = new URL(clean);
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (BLOCKED_PAGE_HOSTS.some(blocked => hostname === blocked || hostname.endsWith(`.${blocked}`))) {
      return false;
    }
    const path = parsed.pathname.toLowerCase().replace(/\/$/, '');
    return !BLOCKED_PATH_SUFFIXES.some(suffix => path.endsWith(suffix));
  } catch {
    return false;
  }
}

/**
 * Returns a provider-backed, bounded derivative suitable for an in-app image.
 *
 * Providers with a supported derivative contract are always clamped. Other
 * valid remote media remains available for content parity and must be rendered
 * with React Native's `resizeMethod="resize"` so Android downsamples it before
 * decode. Feed and detail surfaces should use this function rather than adding
 * one-off provider transformations.
 */
export function boundedExploreImageUrl(
  value: unknown,
  bounds: ExploreImageBounds,
): string {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (!isRenderableImageUrl(clean)) return '';
  if (/^(?:file|content):\/\//i.test(clean) || clean.startsWith('/')) return clean;
  // Inline images have no independent byte budget and can make persisted
  // Explore payloads unbounded. Offline bundles use verified file:// assets.
  if (!/^https?:\/\//i.test(clean)) return '';

  let parsed: URL;
  try {
    parsed = new URL(clean);
  } catch {
    return '';
  }

  const width = clampDerivativeEdge(bounds.width);
  const height = clampDerivativeEdge(bounds.height);
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');

  if (isNpsUpload(hostname, parsed.pathname)) {
    return npsDerivativeUrl(parsed, width, height);
  }

  const commonsThumbnail = wikimediaUploadThumbnailUrl(hostname, parsed, Math.min(width, height, 512));
  if (commonsThumbnail) return commonsThumbnail;
  // Commons redirect pages require request headers React Native Image cannot
  // supply consistently. Let the caller fall through to another licensed
  // candidate instead of rendering a broken or full-resolution response.
  if (hostname === 'commons.wikimedia.org' || hostname === 'www.commons.wikimedia.org') return '';

  // Not every licensed partner exposes a public resize contract. Preserve
  // those images instead of dropping valid campground, trail, or guided-trip
  // media; callers still downsample them through the native Image component.
  return clean;
}

export function boundedExploreImageCandidates(
  values: Array<unknown>,
  bounds: ExploreImageBounds,
): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const value of values) {
    const candidate = boundedExploreImageUrl(value, bounds);
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    candidates.push(candidate);
  }
  return candidates;
}

export function exploreImageSource(value: string) {
  let wikimedia = false;
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/\.$/, '');
    wikimedia = hostname === 'upload.wikimedia.org' || hostname === 'commons.wikimedia.org';
  } catch {
    wikimedia = false;
  }
  return {
    uri: value,
    ...(wikimedia ? { headers: { 'User-Agent': WIKIMEDIA_USER_AGENT } } : {}),
  };
}

function clampDerivativeEdge(value: number) {
  if (!Number.isFinite(value)) return MIN_DERIVATIVE_EDGE;
  return Math.max(MIN_DERIVATIVE_EDGE, Math.min(MAX_DERIVATIVE_EDGE, Math.round(value)));
}

function isNpsUpload(hostname: string, pathname: string) {
  return (hostname === 'nps.gov' || hostname.endsWith('.nps.gov'))
    && /^\/common\/uploads\//i.test(pathname);
}

function npsDerivativeUrl(parsed: URL, width: number, height: number) {
  const existingWidth = queryDimension(parsed, IMAGE_DIMENSION_QUERY_KEYS);
  const existingHeight = queryDimension(parsed, IMAGE_HEIGHT_QUERY_KEYS);
  const derivativeWidth = Math.min(width, existingWidth || width);
  const derivativeHeight = Math.min(height, existingHeight || height);
  removeQueryKeys(parsed, new Set([
    ...IMAGE_DIMENSION_QUERY_KEYS,
    ...IMAGE_HEIGHT_QUERY_KEYS,
    'quality',
    'format',
    'mode',
  ]));
  parsed.searchParams.set('maxWidth', String(derivativeWidth));
  parsed.searchParams.set('maxHeight', String(derivativeHeight));
  parsed.searchParams.set('quality', '78');
  parsed.searchParams.set('format', 'webp');
  return parsed.toString();
}

function wikimediaUploadThumbnailUrl(hostname: string, parsed: URL, requestedWidth: number) {
  if (hostname !== 'upload.wikimedia.org') return '';
  const segments = parsed.pathname.split('/').filter(Boolean).map(safelyDecode);
  const commonsIndex = segments.findIndex(segment => segment.toLowerCase() === 'commons');
  if (commonsIndex < 0) return '';
  const afterCommons = segments.slice(commonsIndex + 1);
  const isThumb = afterCommons[0]?.toLowerCase() === 'thumb';
  const offset = isThumb ? 1 : 0;
  const hashA = afterCommons[offset];
  const hashB = afterCommons[offset + 1];
  const filename = afterCommons[offset + 2];
  if (!/^[0-9a-f]$/i.test(hashA || '') || !/^[0-9a-f]{2}$/i.test(hashB || '') || !filename) return '';
  const existingWidth = existingDerivativeWidth(parsed);
  const maximumWidth = Math.min(requestedWidth, existingWidth || requestedWidth);
  const width = [...WIKIMEDIA_THUMBNAIL_WIDTHS].reverse().find(candidate => candidate <= maximumWidth)
    || WIKIMEDIA_THUMBNAIL_WIDTHS[0];
  const encodedFilename = encodeURIComponent(filename.replace(/ /g, '_'));
  const renderedFilename = /\.svg$/i.test(filename) ? `${encodedFilename}.png` : encodedFilename;
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${hashA}/${hashB}/${encodedFilename}/${width}px-${renderedFilename}`;
}

function safelyDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function existingDerivativeWidth(parsed: URL) {
  const queryWidth = queryDimension(parsed, IMAGE_DIMENSION_QUERY_KEYS);
  if (queryWidth) return queryWidth;
  const pathWidth = parsed.pathname.match(/\/(\d{2,4})px-[^/]+$/i)?.[1];
  return finitePositive(pathWidth);
}

function queryDimension(parsed: URL, keys: Set<string>) {
  let dimension = 0;
  parsed.searchParams.forEach((value, key) => {
    if (!keys.has(key.toLowerCase())) return;
    const parsedValue = finitePositive(value);
    if (parsedValue && (!dimension || parsedValue < dimension)) dimension = parsedValue;
  });
  return dimension;
}

function removeQueryKeys(parsed: URL, keys: Set<string>) {
  const toRemove: string[] = [];
  parsed.searchParams.forEach((_value, key) => {
    if (keys.has(key.toLowerCase())) toRemove.push(key);
  });
  toRemove.forEach(key => parsed.searchParams.delete(key));
}

function finitePositive(value: unknown) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
