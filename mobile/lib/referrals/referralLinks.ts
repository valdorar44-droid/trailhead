const REFERRAL_CODE = /^[a-z0-9][a-z0-9_-]{2,31}$/i;

const TRAILHEAD_HTTPS_HOSTS = new Set(['gettrailhead.app', 'www.gettrailhead.app']);
const APPROVED_CUSTOM_ROUTES = new Set(['referral', 'register']);

function isCleanHttpsUrl(parsed: URL): boolean {
  return parsed.protocol === 'https:'
    && !parsed.username
    && !parsed.password
    && (!parsed.port || parsed.port === '443');
}

function customRoute(parsed: URL): string {
  const hostRoute = parsed.hostname.toLowerCase();
  const pathRoute = parsed.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (hostRoute && pathRoute) return '';
  return hostRoute || pathRoute;
}

function queryReferralCode(parsed: URL): string {
  return normalizeReferralCode(
    parsed.searchParams.get('referral_code') || parsed.searchParams.get('code'),
  );
}

export function normalizeReferralCode(value: unknown): string {
  const code = String(value || '').trim();
  return REFERRAL_CODE.test(code) ? code : '';
}

export function referralCodeFromUrl(
  url: string | null | undefined,
): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'trailhead:') {
      if (parsed.username || parsed.password || parsed.port) return '';
      if (!APPROVED_CUSTOM_ROUTES.has(customRoute(parsed))) return '';
      return queryReferralCode(parsed);
    }
    if (!isCleanHttpsUrl(parsed)) return '';
    if (!TRAILHEAD_HTTPS_HOSTS.has(parsed.hostname.toLowerCase())) return '';
    const match = parsed.pathname.match(/^\/r\/([^/]+)\/?$/i);
    return normalizeReferralCode(match?.[1]);
  } catch {
    // Malformed values fail closed. Regex fallback parsing can turn an
    // attacker-controlled string into a trusted-looking referral path.
    return '';
  }
}

export function canonicalReferralUrl(code: string): string {
  const normalized = normalizeReferralCode(code);
  return normalized
    ? `https://gettrailhead.app/r/${encodeURIComponent(normalized)}`
    : 'https://gettrailhead.app';
}
