const REFERRAL_CODE = /^[a-z0-9][a-z0-9_-]{2,31}$/i;
const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/i;

const TRAILHEAD_HTTPS_HOSTS = new Set(['gettrailhead.app', 'www.gettrailhead.app']);
const DEFAULT_BRANCH_HOSTS = ['go.gettrailhead.app', 'zswub.app.link', 'zswub-alternate.app.link'];
const APPROVED_CUSTOM_ROUTES = new Set(['referral', 'register']);

export type ReferralLinkPolicy = {
  branchDomains?: readonly string[];
};

function configuredBranchDomains(policy?: ReferralLinkPolicy): Set<string> {
  const environmentDomains = [
    process.env.EXPO_PUBLIC_BRANCH_DOMAIN,
    process.env.EXPO_PUBLIC_BRANCH_ALTERNATE_DOMAIN,
    ...String(process.env.EXPO_PUBLIC_BRANCH_PROVIDED_DOMAINS || '').split(','),
  ];
  return new Set(
    [...DEFAULT_BRANCH_HOSTS, ...environmentDomains, ...(policy?.branchDomains || [])]
      .map(value => String(value || '').trim().toLowerCase().replace(/\.$/, ''))
      .filter(value => HOSTNAME.test(value)),
  );
}

function isCleanHttpsUrl(parsed: URL): boolean {
  return parsed.protocol === 'https:'
    && !parsed.username
    && !parsed.password
    && (!parsed.port || parsed.port === '443');
}

function isApprovedBranchUrl(parsed: URL, policy?: ReferralLinkPolicy): boolean {
  return isCleanHttpsUrl(parsed) && configuredBranchDomains(policy).has(parsed.hostname.toLowerCase());
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
  policy?: ReferralLinkPolicy,
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

export function referralCodeFromAttributionParams(
  params: Record<string, unknown> | undefined,
  policy?: ReferralLinkPolicy,
): string {
  if (!params || params['+clicked_branch_link'] !== true) return '';

  const canonicalIdentifier = String(params.$canonical_identifier || '');
  const identifierMatch = canonicalIdentifier.match(/(?:^|\/)referral\/([^/]+)$/i);
  const identifierCode = normalizeReferralCode(identifierMatch?.[1]);

  const sources = [params['~referring_link'], params['+url']]
    .map(value => String(value || '').trim())
    .filter(Boolean);
  let approvedBranchSource = false;
  for (const source of sources) {
    const canonicalCode = referralCodeFromUrl(source, policy);
    if (canonicalCode) return canonicalCode;
    try {
      const parsed = new URL(source);
      if (!isApprovedBranchUrl(parsed, policy)) continue;
      approvedBranchSource = true;
    } catch {
      // Continue to the approved custom deeplink below.
    }
  }

  // Branch metadata is useful only after the attribution event proves it came
  // through an explicitly approved Branch HTTPS domain. A canonical identifier
  // by itself is not a trust boundary and can be supplied by an untrusted URL.
  if (approvedBranchSource) {
    if (identifierCode) return identifierCode;
    const direct = normalizeReferralCode(
      params.referral_code
        || params.referralCode
        || params.$referral_code
        || params.code,
    );
    if (direct) return direct;
  }

  const deeplinkPath = String(params.$deeplink_path || '').trim();
  if (deeplinkPath) {
    return referralCodeFromUrl(`trailhead://${deeplinkPath.replace(/^\/+/, '')}`, policy);
  }
  return '';
}

export function canonicalReferralUrl(code: string): string {
  const normalized = normalizeReferralCode(code);
  return normalized
    ? `https://gettrailhead.app/r/${encodeURIComponent(normalized)}`
    : 'https://gettrailhead.app';
}
