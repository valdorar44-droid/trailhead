import type { WeatherUnitMode } from '@/lib/api';

export type ResolvedUnitMode = 'imperial' | 'metric';

export function resolveUnitMode(mode: WeatherUnitMode | undefined | null): ResolvedUnitMode {
  return mode === 'metric' ? 'metric' : 'imperial';
}

export function milesToDisplay(mi: number, mode: WeatherUnitMode | undefined | null) {
  return resolveUnitMode(mode) === 'metric' ? mi * 1.609344 : mi;
}

export function displayToMiles(value: string, mode: WeatherUnitMode | undefined | null) {
  const n = Number(String(value ?? '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return '';
  return resolveUnitMode(mode) === 'metric' ? String(Math.round(n / 1.609344)) : String(Math.round(n));
}

export function fmtDistance(mi: number, mode: WeatherUnitMode | undefined | null) {
  if (!Number.isFinite(mi)) return '-';
  if (resolveUnitMode(mode) === 'metric') {
    const km = mi * 1.609344;
    return km < 16 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
  }
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

export function mpgToDisplayConsumption(mpg: number, mode: WeatherUnitMode | undefined | null) {
  if (!Number.isFinite(mpg) || mpg <= 0) return '';
  if (resolveUnitMode(mode) === 'metric') return (235.214583 / mpg).toFixed(1);
  return String(Math.round(mpg * 10) / 10);
}

export function displayConsumptionToMpg(value: string, mode: WeatherUnitMode | undefined | null) {
  const n = Number(String(value ?? '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return '';
  if (resolveUnitMode(mode) === 'metric') return String(Math.round((235.214583 / n) * 10) / 10);
  return String(Math.round(n * 10) / 10);
}

export function fmtFuelVolumeFromMiles(mi: number, mpg: number, mode: WeatherUnitMode | undefined | null) {
  const gallons = mpg > 0 ? mi / mpg : 0;
  if (resolveUnitMode(mode) === 'metric') {
    const liters = gallons * 3.785411784;
    return `${liters < 10 ? liters.toFixed(1) : Math.round(liters)} L`;
  }
  return `${gallons < 1 ? gallons.toFixed(1) : Math.round(gallons)} gal`;
}

export function routeUnitsParam(mode: WeatherUnitMode | undefined | null) {
  return resolveUnitMode(mode) === 'metric' ? 'kilometers' : 'miles';
}
