import type { OriginalRouteV1, OriginalStopV1 } from '@/lib/originals/types';

export type OriginalRouteMapProps = {
  route: OriginalRouteV1;
  projectedProgressM: number | null;
  currentStoryTitle?: string;
  nextStop?: OriginalStopV1 | null;
  overview?: boolean;
};
