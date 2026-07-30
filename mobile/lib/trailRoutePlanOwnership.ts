export type TrailRoutePlanIdentity = Readonly<{
  trailId?: string | null;
  geometryRevision?: string | null;
}>;

export type TrailIdentity = Readonly<{
  id: string;
  geometry_revision?: string | null;
}>;

export function trailRoutePlanMatchesOwner(
  plan: TrailRoutePlanIdentity | null | undefined,
  trail: TrailIdentity,
): boolean {
  if (!plan?.trailId || plan.trailId !== trail.id) return false;
  if (plan.geometryRevision && trail.geometry_revision) {
    return plan.geometryRevision === trail.geometry_revision;
  }
  return true;
}
