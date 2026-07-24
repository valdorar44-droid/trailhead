export const PROFILE_SECTIONS = [
  { id: 'account', label: 'Account', icon: 'person-circle-outline' },
  { id: 'trips', label: 'Trips & Saved', icon: 'albums-outline' },
  { id: 'rig', label: 'Rig', icon: 'car-sport-outline' },
  { id: 'community', label: 'Community', icon: 'people-outline' },
  { id: 'support', label: 'Support', icon: 'help-buoy-outline' },
  { id: 'settings', label: 'Settings', icon: 'settings-outline' },
] as const;

export type ProfileSectionId = typeof PROFILE_SECTIONS[number]['id'];

export function profileSectionScrollOffset(sectionId: ProfileSectionId): number {
  const index = PROFILE_SECTIONS.findIndex(section => section.id === sectionId);
  return Math.max(0, index * 104 - 40);
}

export type ContestAwardPresentation = {
  label: string;
  detail: string;
  canOpenMessage: boolean;
};

export function contestAwardPresentation(status: string | null | undefined): ContestAwardPresentation {
  switch (String(status || '').trim().toLowerCase()) {
    case 'selected':
      return {
        label: 'Winner selected',
        detail: 'Trailhead will send a private prize message.',
        canOpenMessage: false,
      };
    case 'notified':
      return {
        label: 'Payout coordination',
        detail: 'Choose Cash App, PayPal, or bank deposit in your private prize message.',
        canOpenMessage: true,
      };
    case 'paid':
      return {
        label: 'Paid',
        detail: 'This prize has been marked paid.',
        canOpenMessage: true,
      };
    case 'void':
      return {
        label: 'Closed',
        detail: 'This prize is no longer active. Open the private message for details.',
        canOpenMessage: true,
      };
    default:
      return {
        label: 'Status pending',
        detail: 'Open your prize message for the latest update.',
        canOpenMessage: true,
      };
  }
}

export function contestAwardPeriodLabel(
  periodMonth: string | null | undefined,
  periodYear: string | null | undefined,
): string {
  const month = String(periodMonth || '').trim().match(/^(\d{4})-(\d{2})$/);
  if (month) {
    const date = new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1));
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    }
  }
  return String(periodYear || '').trim();
}

export function supportThreadIdForContestAward(
  threads: ReadonlyArray<{ id: number; contest_award_id?: number | null }>,
  awardId: number,
): number | null {
  const match = threads.find(thread => Number(thread.contest_award_id) === Number(awardId));
  return match ? Number(match.id) : null;
}
