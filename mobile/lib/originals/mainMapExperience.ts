import { originalRouteDisplayModel } from './routeDisplay';
import type {
  OriginalManifestV1,
  OriginalOwnerScope,
  OriginalSessionV1,
} from './types';

export type OriginalMainMapCueState =
  | 'completed'
  | 'current'
  | 'next'
  | 'missed'
  | 'skipped'
  | 'upcoming';

export type OriginalMainMapCue = {
  id: string;
  sequence: number;
  title: string;
  lat: number;
  lng: number;
  state: OriginalMainMapCueState;
};

export type OriginalMainMapExperience = {
  active: boolean;
  packId: string | null;
  version: number | null;
  title: string;
  routeCoords: [number, number][];
  routeProgress: number;
  routeProgressKnown: boolean;
  cues: OriginalMainMapCue[];
};

const EMPTY_EXPERIENCE: OriginalMainMapExperience = {
  active: false,
  packId: null,
  version: null,
  title: '',
  routeCoords: [],
  routeProgress: 0,
  routeProgressKnown: false,
  cues: [],
};

function nextIncompleteStopId(manifest: OriginalManifestV1, session: OriginalSessionV1) {
  const terminal = new Set([
    ...session.completed_stop_ids,
    ...session.skipped_stop_ids,
    ...session.missed_stop_ids,
  ]);
  return manifest.stops
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .find(stop => !terminal.has(stop.id) && stop.id !== session.current_stop_id)?.id ?? null;
}

export function originalMainMapExperience(
  manifest: OriginalManifestV1 | null | undefined,
  session: OriginalSessionV1 | null | undefined,
  ownerScope: OriginalOwnerScope,
  simulation: boolean,
): OriginalMainMapExperience {
  if (
    simulation
    || !manifest
    || !session
    || session.owner_scope !== ownerScope
    || session.pack_id !== manifest.pack_id
    || session.version !== manifest.version
    || session.manifest_id !== manifest.manifest_id
    || session.download_state !== 'ready'
    || session.status === 'stopped'
  ) {
    return EMPTY_EXPERIENCE;
  }

  const route = originalRouteDisplayModel(
    manifest.route.geometry.coordinates,
    manifest.route.distance_m,
    session.last_projected_route_progress_m,
  );
  const completed = new Set(session.completed_stop_ids);
  const skipped = new Set(session.skipped_stop_ids);
  const missed = new Set(session.missed_stop_ids);
  const nextId = session.queued_stop_id ?? nextIncompleteStopId(manifest, session);
  const cues = manifest.stops
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map(stop => {
      let state: OriginalMainMapCueState = 'upcoming';
      if (completed.has(stop.id)) state = 'completed';
      else if (skipped.has(stop.id)) state = 'skipped';
      else if (missed.has(stop.id)) state = 'missed';
      else if (stop.id === session.current_stop_id) state = 'current';
      else if (stop.id === nextId) state = 'next';
      return {
        id: stop.id,
        sequence: stop.sequence,
        title: stop.title,
        lat: stop.coordinates.lat,
        lng: stop.coordinates.lng,
        state,
      };
    });

  return {
    active: route.coordinates.length >= 2,
    packId: manifest.pack_id,
    version: manifest.version,
    title: manifest.title,
    routeCoords: route.coordinates,
    routeProgress: route.progress_ratio,
    routeProgressKnown: route.progress_known,
    cues,
  };
}
