const BLOCKED_TRAIL_SUMMARY = /mapped trail|nearby support context|check (?:current )?access|local rules|scouting lead|trailhead generated/i;
const FACT_ONLY_TRAIL_SUMMARY_PART = /^(?:\d+(?:\.\d+)?\s*(?:mi|miles?|km|kilomet(?:er|re)s?)|loop|out\s*(?:and|&)\s*back|point(?:\s|-)*to(?:\s|-)*point|easy|moderate|hard|(?:hiking|walking|biking|cycling|horseback|equestrian|ohv|4wd|mixed(?:\s|-)*use)(?:\s+trail)?)$/i;

/**
 * Trail facts already have dedicated metric rows. Keep only genuine editorial
 * description here so a generated fact sentence is never repeated as prose.
 */
export function trailSummaryForDisplay(value: unknown): string {
  const summary = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!summary || BLOCKED_TRAIL_SUMMARY.test(summary)) return '';
  const parts = summary
    .split(/[·•]+|[.](?=\s|$)/)
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length > 0 && parts.every(part => FACT_ONLY_TRAIL_SUMMARY_PART.test(part))) return '';
  return summary;
}
