export const REPORT_ALERT_PREFERENCES_KEY = 'trailhead_alert_prefs';

export type ReportAlertPreferences = Record<string, boolean>;

type AlertPreferenceStorage = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, epoch?: number) => Promise<unknown>;
};

export function parseReportAlertPreferences(raw: string | null): ReportAlertPreferences {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'),
    );
  } catch {
    return {};
  }
}

export async function loadReportAlertPreferences(
  storage: Pick<AlertPreferenceStorage, 'get'>,
): Promise<ReportAlertPreferences> {
  try {
    return parseReportAlertPreferences(await storage.get(REPORT_ALERT_PREFERENCES_KEY));
  } catch {
    return {};
  }
}

export async function saveReportAlertPreferences(
  storage: Pick<AlertPreferenceStorage, 'set'>,
  preferences: ReportAlertPreferences,
  epoch: number,
): Promise<boolean> {
  try {
    const result = await storage.set(REPORT_ALERT_PREFERENCES_KEY, JSON.stringify(preferences), epoch);
    return result !== false;
  } catch {
    return false;
  }
}
