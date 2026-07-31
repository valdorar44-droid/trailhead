import type { CanonicalTrailLineV1, OwnedTrailRouteOriginV1 } from './trailRouteSharing';

export type TrailSubmissionStatusV1 =
  | 'draft'
  | 'submitted'
  | 'changes_requested'
  | 'approved_community'
  | 'rejected'
  | 'withdrawn'
  | 'archived';

export type TrailSubmissionAttestationV1 = Readonly<{
  contributor_attested: boolean;
  photo_rights_confirmed: boolean;
  public_access_note?: string;
}>;

export type TrailSubmissionHistoryEventV1 = Readonly<{
  event: string;
  at: number;
  note?: string | null;
  details?: Record<string, unknown>;
}>;

export type TrailSubmissionSnapshotV1 = Readonly<{
  version: 1;
  route_id: string;
  route_revision: number;
  title: string;
  description?: string | null;
  origin: OwnedTrailRouteOriginV1;
  activity?: string | null;
  route_shape?: string | null;
  geometry: CanonicalTrailLineV1;
  geometry_sha256: string;
  trailheads: readonly Record<string, unknown>[];
  permitted_uses: readonly string[];
  source_evidence: readonly Record<string, unknown>[];
  photos: readonly Record<string, unknown>[];
  attestations: TrailSubmissionAttestationV1;
}>;

export type TrailSubmissionV1 = Readonly<{
  id: string;
  route_id?: string | null;
  route_revision: number;
  geometry_sha256: string;
  submitter_handle?: string | null;
  status: TrailSubmissionStatusV1;
  moderation_note?: string | null;
  duplicate?: Record<string, unknown>;
  access_review?: Record<string, unknown>;
  moderator_history?: readonly TrailSubmissionHistoryEventV1[];
  submitted_at?: number | null;
  updated_at: number;
  moderated_at?: number | null;
  snapshot?: TrailSubmissionSnapshotV1;
  title?: string | null;
}>;

export type CommunityTrailV1 = Readonly<{
  id: string;
  submission_id: string;
  publication_revision: number;
  status: 'active' | 'taken_down' | 'promoted' | 'archived';
  promoted_trail_id?: string | null;
  snapshot: Readonly<{
    public_trail_id: string;
    title: string;
    contributor_handle: string;
    contributor_approved_count: number;
  }> & Record<string, unknown>;
}>;

export type TrailSubmissionDecisionV1 = Readonly<{
  submission: TrailSubmissionV1;
  community_trail?: CommunityTrailV1 | null;
  credits_awarded: boolean;
  credits: number;
  new_balance?: number | null;
}>;

export type TrailSubmissionPresentationV1 = Readonly<{
  eyebrow: string;
  title: string;
  detail: string;
  tone: 'neutral' | 'warning' | 'positive';
}>;

export function trailSubmissionPresentation(
  submission: Pick<TrailSubmissionV1, 'status' | 'moderation_note'>,
): TrailSubmissionPresentationV1 {
  switch (submission.status) {
    case 'submitted':
      return {
        eyebrow: 'UNDER REVIEW',
        title: 'Submission received',
        detail: 'Your private route is unchanged while the submitted revision is reviewed.',
        tone: 'neutral',
      };
    case 'changes_requested':
      return {
        eyebrow: 'CHANGES REQUESTED',
        title: 'Update the route',
        detail: submission.moderation_note || 'Review the requested changes before resubmitting.',
        tone: 'warning',
      };
    case 'approved_community':
      return {
        eyebrow: 'APPROVED',
        title: 'Added to Community routes',
        detail: 'You earned 5 Trailhead credits.',
        tone: 'positive',
      };
    case 'rejected':
      return {
        eyebrow: 'NOT APPROVED',
        title: 'Submission closed',
        detail: submission.moderation_note || 'This revision was not added to Community routes.',
        tone: 'neutral',
      };
    case 'withdrawn':
      return {
        eyebrow: 'WITHDRAWN',
        title: 'Submission withdrawn',
        detail: 'Your owned route remains private.',
        tone: 'neutral',
      };
    case 'archived':
      return {
        eyebrow: 'ARCHIVED',
        title: 'Earlier revision',
        detail: 'A newer revision replaced this submission.',
        tone: 'neutral',
      };
    default:
      return {
        eyebrow: 'DRAFT',
        title: 'Review submission',
        detail: 'This route has not been submitted.',
        tone: 'neutral',
      };
  }
}

export function latestTrailSubmissionForRoute(
  submissions: readonly TrailSubmissionV1[],
  routeId: string | null | undefined,
): TrailSubmissionV1 | null {
  if (!routeId) return null;
  return submissions
    .filter(item => item.route_id === routeId)
    .sort((left, right) => (right.updated_at - left.updated_at) || right.id.localeCompare(left.id))[0]
    ?? null;
}

export function trailSubmissionCanWithdraw(status: TrailSubmissionStatusV1): boolean {
  return status === 'submitted' || status === 'changes_requested';
}

export function trailSubmissionNeedsNewRevision(status: TrailSubmissionStatusV1): boolean {
  return status === 'changes_requested';
}
