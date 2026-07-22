/**
 * Downloaded place packs are user-visible storage. Never silently evict one
 * while saving another; removal belongs to the explicit Downloads UI.
 */
export function nextOfflinePlacePackIndex(
  current: readonly string[],
  incoming: string,
  preserve: readonly string[] = [],
) {
  const ordered = [incoming, ...preserve, ...current].filter(Boolean);
  return [...new Set(ordered)];
}
