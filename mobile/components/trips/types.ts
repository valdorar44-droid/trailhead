import type { TripResult } from '@/lib/api';
import type { SavedEntityV1, TripDocumentV2 } from '@/lib/tripRepository';
import type { TripPreviewPin } from './tripPreview';

export type TripLibraryFilter = 'draft' | 'saved' | 'archived';

export type TripLibraryItem = {
  id: string;
  name: string;
  regions: string[];
  days: number;
  miles: number;
  stopCount: number;
  updatedAt: number;
  status: TripLibraryFilter;
  isActive: boolean;
  isOffline: boolean;
  detailAvailable: boolean;
  bookingCount: number;
  alertCount: number | null;
  activeMonitorCount: number;
  monitorState: 'active' | 'attention' | 'inactive' | null;
  noteCount: number | null;
  previewImageUrl?: string;
  previewPins: TripPreviewPin[];
  document: TripDocumentV2;
  compatibilityTrip?: TripResult;
};

export type TripLibrarySnapshot = {
  activeTrip: TripLibraryItem | null;
  trips: TripLibraryItem[];
  savedItems: SavedEntityV1[];
  counts: Record<TripLibraryFilter, number>;
};

export type TripAction =
  | 'open'
  | 'notes'
  | 'duplicate'
  | 'save'
  | 'archive'
  | 'restore'
  | 'export'
  | 'delete';
