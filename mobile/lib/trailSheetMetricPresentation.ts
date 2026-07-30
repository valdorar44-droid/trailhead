export function trailSheetMetricDisplayValue(label: string, value: string): string {
  const clean = String(value || '').trim();
  if (!clean) return '';
  if (String(label || '').trim().toLowerCase() === 'surface') {
    return clean.replace(/\s+surface$/i, '').trim();
  }
  return clean;
}
