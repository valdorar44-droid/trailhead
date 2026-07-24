export type PlanTabRouteName = 'plan' | 'route-builder' | 'trips';

export function isPlanTabRouteName(routeName: string | undefined): routeName is PlanTabRouteName {
  return routeName === 'plan' || routeName === 'route-builder' || routeName === 'trips';
}

export function resolvePlanTabPress(
  activeRouteName: string | undefined,
  lastPlanRouteName: PlanTabRouteName,
): PlanTabRouteName | null {
  if (isPlanTabRouteName(activeRouteName)) return null;
  return lastPlanRouteName;
}
