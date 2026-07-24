import type { PackingList } from './api';

export const PACKING_SECTIONS = [
  'essentials',
  'recovery_gear',
  'water_food',
  'navigation',
  'shelter',
  'tools_spares',
  'optional_nice_to_have',
  'leave_at_home',
] as const;

export type PackingSection = typeof PACKING_SECTIONS[number];

export function packingItemKey(section: PackingSection, item: string) {
  return `${section}:${String(item || '').trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

export function addPackingItem(
  list: PackingList,
  section: PackingSection,
  item: string,
): PackingList {
  const clean = String(item || '').trim().replace(/\s+/g, ' ');
  if (!clean) return list;
  const current = list[section] ?? [];
  if (current.some(value => value.trim().toLowerCase() === clean.toLowerCase())) return list;
  return { ...list, [section]: [...current, clean] };
}

export function removePackingItem(
  list: PackingList,
  section: PackingSection,
  item: string,
): PackingList {
  const key = packingItemKey(section, item);
  return {
    ...list,
    [section]: (list[section] ?? []).filter(value => packingItemKey(section, value) !== key),
    checked_items: (list.checked_items ?? []).filter(value => value !== key),
  };
}

export function togglePackingItem(
  list: PackingList,
  section: PackingSection,
  item: string,
): PackingList {
  const key = packingItemKey(section, item);
  const checked = new Set(list.checked_items ?? []);
  if (checked.has(key)) checked.delete(key);
  else checked.add(key);
  return { ...list, checked_items: [...checked].sort() };
}

export function mergePackingProgress(previous: PackingList | null, next: PackingList): PackingList {
  if (!previous?.checked_items?.length) return next;
  const valid = new Set(
    PACKING_SECTIONS.flatMap(section => (next[section] ?? []).map(item => packingItemKey(section, item))),
  );
  return {
    ...next,
    checked_items: previous.checked_items.filter(key => valid.has(key)),
  };
}
