const REFERRAL_CODE = /^[a-z0-9][a-z0-9_-]{2,31}$/i;

export function normalizeReferralCode(value: unknown): string {
  const code = String(value || '').trim();
  return REFERRAL_CODE.test(code) ? code : '';
}

export function referralCodeFromUrl(url: string | null | undefined): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (!['https:', 'trailhead:'].includes(parsed.protocol)) return '';
    const queryCode = normalizeReferralCode(
      parsed.searchParams.get('referral_code') || parsed.searchParams.get('code'),
    );
    if (queryCode) return queryCode;
    const match = parsed.pathname.match(/^\/r\/([^/]+)\/?$/i);
    return normalizeReferralCode(match?.[1]);
  } catch {
    const match = String(url).match(/(?:^|\/)r\/([a-z0-9_-]{3,32})(?:[/?#]|$)/i);
    return normalizeReferralCode(match?.[1]);
  }
}

export function referralCodeFromAttributionParams(
  params: Record<string, unknown> | undefined,
): string {
  if (!params || params['+clicked_branch_link'] !== true) return '';
  const direct = normalizeReferralCode(
    params.referral_code
      || params.referralCode
      || params.$referral_code
      || params.code,
  );
  if (direct) return direct;

  const canonicalIdentifier = String(params.$canonical_identifier || '');
  const identifierMatch = canonicalIdentifier.match(/(?:^|\/)referral\/([^/]+)$/i);
  const identifierCode = normalizeReferralCode(identifierMatch?.[1]);
  if (identifierCode) return identifierCode;

  return referralCodeFromUrl(
    String(params['~referring_link'] || params['+url'] || ''),
  );
}

export function canonicalReferralUrl(code: string): string {
  const normalized = normalizeReferralCode(code);
  return normalized
    ? `https://gettrailhead.app/r/${encodeURIComponent(normalized)}`
    : 'https://gettrailhead.app';
}
