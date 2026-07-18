export type OriginalAccessState = 'free' | 'paid' | 'owned';

export type OriginalDownloadState =
  | 'not_downloaded'
  | 'downloading'
  | 'ready'
  | 'update_available'
  | 'error';

export type OriginalSessionStatus =
  | 'idle'
  | 'ready'
  | 'active'
  | 'paused'
  | 'off_route'
  | 'location_unavailable'
  | 'completed';

export type OriginalUiSource = {
  label: string;
  url?: string;
  role: 'story' | 'operational';
  authority?: 'official' | 'authoritative';
  scope: string[];
};

export type OriginalUiStory = {
  id: string;
  sequence: number;
  title: string;
  transcript: string;
  durationLabel: string;
  completed?: boolean;
  skipped?: boolean;
  missed?: boolean;
  replayable?: boolean;
};

export type OriginalUiSummary = {
  id: string;
  slug: string;
  version: number;
  title: string;
  region: string;
  summary: string;
  durationLabel: string;
  distanceLabel: string;
  surfaceLabel: string;
  seasonLabel: string;
  storyCount: number;
  offlineSizeLabel: string;
  priceCredits: number;
  explorerPriceCredits: number;
  access: OriginalAccessState;
  adminPreview?: boolean;
  featured: boolean;
  heroImageUrl?: string;
  progress?: number;
  downloadState?: OriginalDownloadState;
};

export type OriginalUiDetail = OriginalUiSummary & {
  overview: string;
  routeLabel: string;
  route: OriginalRouteV1;
  previewStory?: OriginalUiStory;
  stories: OriginalUiStory[];
  highlights: string[];
  safetyNotes: string[];
  accessNotes: string[];
  sources: OriginalUiSource[];
};

export type OriginalUiBundleState = {
  state: OriginalDownloadState;
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  installedVersion?: number;
  error?: string;
};

export type OriginalUiSession = {
  status: OriginalSessionStatus;
  originalId: string;
  version: number;
  currentStory?: OriginalUiStory;
  nextStory?: OriginalUiStory;
  playedCount: number;
  missedCount: number;
  totalCount: number;
  progress: number;
  audioPosition: number;
  audioDuration: number;
  muted: boolean;
  userPaused: boolean;
  message?: string;
};

export type OriginalUiAcquireResult = {
  access: OriginalAccessState;
  alreadyOwned: boolean;
  creditBalance?: number;
};
import type { OriginalRouteV1 } from '@/lib/originals/types';
