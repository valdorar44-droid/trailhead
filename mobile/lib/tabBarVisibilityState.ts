export type TabBarHiddenReasons = Record<string, true>;

export function updateTabBarHiddenReasons(
  current: TabBarHiddenReasons,
  reason: string,
  hidden: boolean,
): TabBarHiddenReasons {
  const key = reason.trim() || 'legacy';
  if (hidden) {
    if (current[key]) return current;
    return { ...current, [key]: true };
  }
  if (!current[key]) return current;
  const next = { ...current };
  delete next[key];
  return next;
}

export function tabBarIsHidden(reasons: TabBarHiddenReasons) {
  return Object.keys(reasons).length > 0;
}
