import type { Report, RouteBrief, TripResult, Waypoint } from './api';

export const ROUTE_BRIEF_NOT_CHECKED = 'Not checked';
export const ROUTE_BRIEF_SUMMARY =
  'Current access, fuel, water, signal, fire restrictions, and exit options have not been checked. Review the items below before departure.';

const DEFAULT_ACTIONS = [
  'Check current access and closures with the responsible land manager.',
  'Confirm fuel availability and range for the mapped route.',
  'Download offline maps from your Download List in the app.',
  'Share the trip and an emergency plan with a trusted contact.',
];

const ACTION_PREFIX = /^(?:check|confirm|review|download|save|share|verify|contact|bring|pack)\b/i;
const UNSUPPORTED_ASSERTION = new RegExp(
  [
    '\\b(?:safe|clear|open|passable|ready|usable)\\b',
    '\\b(?:no|zero)\\s+(?:hazards?|closures?|issues?|restrictions?)\\b',
    '\\b\\d+(?:\\.\\d+)?\\s*(?:gal|gallons?)\\b',
    '\\b(?:dead\\s*zones?|reliable\\s+(?:cell|signal|service|coverage))\\b',
    '\\b(?:fire\\s+restrictions?)\\s+(?:are|is|likely|unlikely|possible|in\\s+effect|clear)\\b',
    '\\b(?:bailout|escape\\s+route|emergency\\s+exit)\\b',
    '\\b(?:Gaia\\s+GPS|AllTrails|CalTopo|Maps\\.me|Google\\s+Maps|OnX|iOverlander|Roadtrippers|Campendium|The\\s+Dyrt)\\b',
  ].join('|'),
  'i',
);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function cleanText(value: unknown, maxChars = 180): string {
  const cleaned = String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s*•-]+|[\s*•-]+$/g, '')
    .trim();
  if (cleaned.length <= maxChars) return cleaned;
  const clipped = cleaned.slice(0, maxChars);
  const lastSpace = clipped.lastIndexOf(' ');
  return clipped.slice(0, lastSpace > 80 ? lastSpace : maxChars).replace(/[\s,;:]+$/g, '');
}

export function routeBriefTextHasUnsupportedAssertion(value: unknown): boolean {
  return UNSUPPORTED_ASSERTION.test(cleanText(value));
}

function safeActions(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [];
  const actions: string[] = [];
  for (const item of raw) {
    const text = cleanText(item);
    if (!text || !ACTION_PREFIX.test(text) || routeBriefTextHasUnsupportedAssertion(text)) continue;
    if (!actions.some(existing => existing.toLocaleLowerCase() === text.toLocaleLowerCase())) actions.push(text);
    if (actions.length === 4) break;
  }
  for (const fallback of DEFAULT_ACTIONS) {
    if (actions.length === 4) break;
    if (!actions.some(existing => existing.toLocaleLowerCase() === fallback.toLocaleLowerCase())) actions.push(fallback);
  }
  return actions;
}

function reportContext(report: Partial<Report>): string {
  return `${report.type ?? ''} ${report.subtype ?? ''} ${report.description ?? ''}`.toLocaleLowerCase();
}

function suppliedReportStatus(reports: Partial<Report>[], terms: string[], subject: string): string {
  const count = reports.filter(report => terms.some(term => reportContext(report).includes(term))).length;
  if (!count) return ROUTE_BRIEF_NOT_CHECKED;
  return `Review ${count} supplied ${subject} report${count === 1 ? '' : 's'}; current conditions are not verified.`;
}

function mappedStatus(waypoints: Partial<Waypoint>[], kind: string, subject: string): string {
  const count = waypoints.filter(waypoint => String(waypoint.type ?? '').toLocaleLowerCase() === kind).length;
  if (!count) return ROUTE_BRIEF_NOT_CHECKED;
  return `${count} mapped ${subject} stop${count === 1 ? '' : 's'}; availability is not checked.`;
}

function reportConcerns(reports: Partial<Report>[]): string[] {
  return reports.slice(0, 3).map(report => {
    let kind = cleanText(report.subtype || report.type || 'route', 40)
      .replace(/[_-]+/g, ' ')
      .toLocaleLowerCase();
    if (!kind || routeBriefTextHasUnsupportedAssertion(kind)) kind = 'route';
    const day = Number(report.waypoint_day);
    const nearDay = Number.isInteger(day) && day > 0 ? ` near day ${day}` : '';
    return `Review the supplied ${kind} report${nearDay}; verify its time and source.`;
  });
}

function dailyMappedStops(waypoints: Partial<Waypoint>[]): string[] {
  const byDay = new Map<number, string[]>();
  for (const waypoint of waypoints) {
    const day = Number(waypoint.day);
    let name = cleanText(waypoint.name, 70);
    if (!Number.isInteger(day) || day <= 0 || !name) continue;
    if (routeBriefTextHasUnsupportedAssertion(name)) name = 'Mapped stop';
    const names = byDay.get(day) ?? [];
    if (!names.includes(name) && names.length < 2) names.push(name);
    byDay.set(day, names);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .slice(0, 7)
    .map(([day, names]) => `Day ${day}: ${names.join(', ')}.`);
}

export function localRouteBrief(trip: TripResult, reports: Partial<Report>[] = []): RouteBrief {
  const waypoints = trip.plan.waypoints ?? [];
  return {
    schema_version: 2,
    planning_status: 'Review required',
    top_concerns: reportConcerns(reports),
    must_do_before_leaving: [...DEFAULT_ACTIONS],
    daily_highlights: dailyMappedStops(waypoints),
    fuel_status: mappedStatus(waypoints, 'fuel', 'fuel'),
    water_status: mappedStatus(waypoints, 'water', 'water-related'),
    signal_status: suppliedReportStatus(reports, ['signal', 'cellular', 'cell service', 'coverage'], 'signal'),
    fire_status: suppliedReportStatus(reports, ['fire', 'burn ban', 'burn restriction'], 'fire'),
    exit_options_status: ROUTE_BRIEF_NOT_CHECKED,
    briefing_summary: ROUTE_BRIEF_SUMMARY,
  };
}

export function normalizeRouteBrief(
  brief: unknown,
  trip: TripResult,
  reports: Partial<Report>[] = [],
): RouteBrief {
  const fallback = localRouteBrief(trip, reports);
  const input = record(brief);
  return {
    ...fallback,
    must_do_before_leaving: safeActions(input.must_do_before_leaving),
  };
}
