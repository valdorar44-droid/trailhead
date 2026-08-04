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
  /** Short route prompts, kept separate from full narrated stories in V2. */
  cueCount?: number;
  offlineSizeLabel: string;
  priceCredits: number;
  explorerPriceCredits: number;
  explorerIncluded?: boolean;
  permanentPriceCredits?: number;
  access: OriginalAccessState;
  accessKind?: 'guest_free' | 'entitled' | 'explorer_subscription' | 'permanent' | 'admin_preview';
  adminPreview?: boolean;
  featured: boolean;
  heroImageUrl?: string;
  progress?: number;
  downloadState?: OriginalDownloadState;
};

export type OriginalUiChapterSelection = {
  chapterId: string;
  chapterSequence: number;
  chapterTitle: string;
  chapterSummary: string;
  variantId: string;
  variantSequence: number;
  variantTitle: string;
  isDefault: boolean;
  direction: string;
  durationLabel: string;
  distanceLabel: string;
  storyCount: number;
  cueCount: number;
  route?: OriginalRouteV1;
  stories?: OriginalUiStory[];
  surfaceLabel?: string;
  seasonLabel?: string;
  safetyNotes?: string[];
  accessNotes?: string[];
  sources?: OriginalUiSource[];
};

export type OriginalUiDetail = OriginalUiSummary & {
  manifestSchemaVersion: 1 | 2;
  overview: string;
  routeLabel: string;
  route?: OriginalRouteV1;
  chapterSelections?: OriginalUiChapterSelection[];
  defaultChapterId?: string;
  defaultVariantId?: string;
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
