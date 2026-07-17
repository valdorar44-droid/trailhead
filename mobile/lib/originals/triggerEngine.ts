import { distanceBetweenLngLatMeters } from '../routeProjection';
import { orderedOriginalStops } from './manifest';
import { angularDifferenceDegrees, projectPointToOriginalRoute } from './routeProjection';
import { originalStopIsTerminal } from './session';
import type {
  OriginalLocationSample,
  OriginalManifestV1,
  OriginalSessionV1,
  OriginalStopV1,
  OriginalTriggerEvaluation,
  OriginalTriggerEvent,
  OriginalTriggerRuntimeStateV1,
} from './types';

export const ORIGINAL_TRIGGER_DEFAULTS = {
  maximum_accuracy_m: 100,
  minimum_inside_samples: 2,
  minimum_inside_duration_ms: 3_000,
  off_route_distance_m: 500,
} as const;

export type OriginalTriggerEngineOptions = Partial<typeof ORIGINAL_TRIGGER_DEFAULTS>;

function resetCandidate(routeInitialized: boolean): OriginalTriggerRuntimeStateV1 {
  return {
    route_initialized: routeInitialized,
    candidate_stop_id: null,
    candidate_entered_at_ms: null,
    candidate_sample_count: 0,
    candidate_last_sample_at_ms: null,
  };
}

function remainingStops(manifest: OriginalManifestV1, session: OriginalSessionV1) {
  return orderedOriginalStops(manifest).filter(stop => (
    !originalStopIsTerminal(session, stop.id)
    && stop.id !== session.current_stop_id
    && stop.id !== session.queued_stop_id
  ));
}

function stopMatchesLocation(stop: OriginalStopV1, sample: OriginalLocationSample, routeProgress: number) {
  const speed = Math.max(0, Number(sample.speed_mps) || 0);
  const leadDistance = speed * Math.max(0, stop.trigger.lead_time_s || 0);
  const start = Math.max(0, stop.trigger.route_progress_start_m - leadDistance);
  const end = stop.trigger.route_progress_end_m;
  if (routeProgress < start || routeProgress > end) return false;
  const distance = distanceBetweenLngLatMeters(
    [sample.lng, sample.lat],
    [stop.coordinates.lng, stop.coordinates.lat],
  );
  if (distance > stop.trigger.enter_radius_m) return false;
  if (stop.trigger.approach_bearing_deg != null) {
    if (!Number.isFinite(sample.heading_deg)) return false;
    const tolerance = stop.trigger.bearing_tolerance_deg ?? 45;
    if (angularDifferenceDegrees(Number(sample.heading_deg), stop.trigger.approach_bearing_deg) > tolerance) {
      return false;
    }
  }
  return true;
}

function beyondHysteresis(stop: OriginalStopV1, sample: OriginalLocationSample) {
  const distance = distanceBetweenLngLatMeters(
    [sample.lng, sample.lat],
    [stop.coordinates.lng, stop.coordinates.lat],
  );
  const exitRadius = Math.max(
    stop.trigger.exit_radius_m,
    stop.trigger.enter_radius_m * 1.5,
    stop.trigger.enter_radius_m + 50,
  );
  return distance > exitRadius;
}

function passedStop(stop: OriginalStopV1, sample: OriginalLocationSample, routeProgress: number) {
  if (routeProgress <= stop.trigger.route_progress_end_m) return false;
  const distance = distanceBetweenLngLatMeters(
    [sample.lng, sample.lat],
    [stop.coordinates.lng, stop.coordinates.lat],
  );
  return distance > stop.trigger.enter_radius_m;
}

function addUnique(values: string[], additions: string[]) {
  return [...new Set([...values, ...additions])];
}

export function evaluateOriginalLocation(
  manifest: OriginalManifestV1,
  currentSession: OriginalSessionV1,
  sample: OriginalLocationSample,
  options: OriginalTriggerEngineOptions = {},
): OriginalTriggerEvaluation {
  const settings = { ...ORIGINAL_TRIGGER_DEFAULTS, ...options };
  const events: OriginalTriggerEvent[] = [];
  let session: OriginalSessionV1 = {
    ...currentSession,
    trigger_state: { ...currentSession.trigger_state },
    updated_at_ms: sample.timestamp_ms,
  };

  if (session.status !== 'active' || session.user_paused) {
    return { session, events, projected_route_progress_m: null, distance_from_route_m: null };
  }

  const accuracy = Number(sample.accuracy_m);
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > settings.maximum_accuracy_m) {
    if (session.tracking_state !== 'poor_accuracy') {
      events.push({ type: 'gps_quality_changed', state: 'poor_accuracy' });
    }
    session = {
      ...session,
      tracking_state: 'poor_accuracy',
      trigger_state: resetCandidate(session.trigger_state.route_initialized),
    };
    return { session, events, projected_route_progress_m: null, distance_from_route_m: null };
  }

  const projection = projectPointToOriginalRoute(
    manifest.route.geometry.coordinates,
    [sample.lng, sample.lat],
    {
      previous_route_ratio: currentSession.last_projected_route_progress_m == null
        ? null
        : currentSession.last_projected_route_progress_m / manifest.route.distance_m,
      heading_deg: sample.heading_deg,
      speed_mps: sample.speed_mps,
      accuracy_m: sample.accuracy_m,
    },
  );
  if (!projection) {
    session = { ...session, tracking_state: 'off_route' };
    return { session, events, projected_route_progress_m: null, distance_from_route_m: null };
  }
  // Trigger windows are authored against the manifest's canonical distance.
  // Scale the geometric projection by its route ratio so Valhalla distance and
  // client-side haversine rounding cannot drift cue placement.
  const routeProgress = projection.route_ratio * manifest.route.distance_m;

  if (projection.distance_from_route_m > settings.off_route_distance_m) {
    if (session.tracking_state !== 'off_route') {
      events.push({ type: 'route_state_changed', state: 'off_route', distance_m: projection.distance_from_route_m });
    }
    session = {
      ...session,
      tracking_state: 'off_route',
      last_route_distance_m: projection.distance_from_route_m,
      trigger_state: resetCandidate(session.trigger_state.route_initialized),
    };
    return {
      session,
      events,
      projected_route_progress_m: routeProgress,
      distance_from_route_m: projection.distance_from_route_m,
    };
  }

  if (session.tracking_state === 'off_route') {
    events.push({ type: 'route_state_changed', state: 'on_route', distance_m: projection.distance_from_route_m });
  } else if (session.tracking_state === 'poor_accuracy') {
    events.push({ type: 'gps_quality_changed', state: 'on_route' });
  }
  session = {
    ...session,
    tracking_state: 'on_route',
    last_projected_route_progress_m: routeProgress,
    last_route_distance_m: projection.distance_from_route_m,
  };

  const eligible = remainingStops(manifest, session);
  const missed: string[] = [];
  for (const stop of eligible) {
    if (!passedStop(stop, sample, routeProgress)) break;
    missed.push(stop.id);
  }
  if (missed.length) {
    session = {
      ...session,
      missed_stop_ids: addUnique(session.missed_stop_ids, missed),
      trigger_state: resetCandidate(true),
    };
    events.push({ type: 'stops_missed', stop_ids: missed });
  } else if (!session.trigger_state.route_initialized) {
    session = {
      ...session,
      trigger_state: { ...session.trigger_state, route_initialized: true },
    };
  }

  if (session.queued_stop_id) {
    return {
      session,
      events,
      projected_route_progress_m: routeProgress,
      distance_from_route_m: projection.distance_from_route_m,
    };
  }

  const candidate = remainingStops(manifest, session)[0];
  if (!candidate) {
    const terminalCount = new Set([
      ...session.completed_stop_ids,
      ...session.skipped_stop_ids,
      ...session.missed_stop_ids,
    ]).size;
    if (!session.current_stop_id && terminalCount >= manifest.stops.length && session.status !== 'completed') {
      session = { ...session, status: 'completed', completed_at_ms: sample.timestamp_ms };
      events.push({ type: 'session_completed' });
    }
    return {
      session,
      events,
      projected_route_progress_m: routeProgress,
      distance_from_route_m: projection.distance_from_route_m,
    };
  }

  const matches = stopMatchesLocation(candidate, sample, routeProgress);
  if (!matches) {
    if (
      session.trigger_state.candidate_stop_id !== candidate.id
      || beyondHysteresis(candidate, sample)
    ) {
      session = { ...session, trigger_state: resetCandidate(true) };
    }
    return {
      session,
      events,
      projected_route_progress_m: routeProgress,
      distance_from_route_m: projection.distance_from_route_m,
    };
  }

  const sameCandidate = session.trigger_state.candidate_stop_id === candidate.id;
  const enteredAt = sameCandidate
    ? session.trigger_state.candidate_entered_at_ms ?? sample.timestamp_ms
    : sample.timestamp_ms;
  const sampleCount = sameCandidate ? session.trigger_state.candidate_sample_count + 1 : 1;
  session = {
    ...session,
    trigger_state: {
      route_initialized: true,
      candidate_stop_id: candidate.id,
      candidate_entered_at_ms: enteredAt,
      candidate_sample_count: sampleCount,
      candidate_last_sample_at_ms: sample.timestamp_ms,
    },
  };
  if (!sameCandidate) events.push({ type: 'stop_armed', stop_id: candidate.id });

  if (
    sampleCount < settings.minimum_inside_samples
    || sample.timestamp_ms - enteredAt < settings.minimum_inside_duration_ms
  ) {
    return {
      session,
      events,
      projected_route_progress_m: routeProgress,
      distance_from_route_m: projection.distance_from_route_m,
    };
  }

  const queue = Boolean(session.current_stop_id);
  session = {
    ...session,
    triggered_stop_ids: addUnique(session.triggered_stop_ids, [candidate.id]),
    current_stop_id: queue ? session.current_stop_id : candidate.id,
    queued_stop_id: queue ? candidate.id : session.queued_stop_id,
    current_audio_position_ms: queue ? session.current_audio_position_ms : 0,
    trigger_state: resetCandidate(true),
  };
  events.push({ type: queue ? 'stop_queued' : 'stop_triggered', stop_id: candidate.id });
  return {
    session,
    events,
    projected_route_progress_m: routeProgress,
    distance_from_route_m: projection.distance_from_route_m,
  };
}
