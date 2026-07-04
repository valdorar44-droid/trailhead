import { Platform } from 'react-native';

export const TRAILHEAD_PRODUCTION_API_BASE = 'https://api.gettrailhead.app';

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export function getTrailheadApiBase() {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) return stripTrailingSlash(configured);
  if (Platform.OS === 'web') {
    const location = (globalThis as typeof globalThis & { location?: { hostname?: string; origin?: string } }).location;
    const hostname = String(location?.hostname || '').toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost')) {
      return TRAILHEAD_PRODUCTION_API_BASE;
    }
    const origin = String(location?.origin || '');
    if (/^https?:\/\//i.test(origin)) return stripTrailingSlash(origin);
  }
  return TRAILHEAD_PRODUCTION_API_BASE;
}

export const TRAILHEAD_API_BASE = getTrailheadApiBase();
