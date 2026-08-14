import { distanceBetweenLngLatMeters } from '../routeProjection';
import { orderedOriginalStops } from './manifest';
import { angularDifferenceDegrees, projectPointToOriginalRoute } from './routeProjection';
import {
  enqueueOriginalPendingStop,
  originalPendingStopIds,
  originalStopIsTerminal,
  withOriginalPendingStops,
} from './session';
import type {
  OriginalLocationSample,
  OriginalManifestV1,
  OriginalSessionV1,
  OriginalStopV1,
  OriginalTriggerDecisionCode,
  OriginalTriggerDecisionDiagnostic,
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

const MINIMUM_ROUTE_DIRECTION_SPEED_MPS = 2;
const OPPOSITE_ROUTE_DIRECTION_DEG = 120;
const MAXIMUM_REVERSE_CONFIRMATION_FIX_GAP_MS = 10_000;

const ORIGINAL_VIRTUAL_DRIVE_CUE_FAILURE_CODES = new Set<OriginalTriggerDecisionCode>([
  'after_window',
  'outside_radius',
  'missing_bearing',
  'wrong_bearing',
]);

export function originalVirtualDriveCueResultOutcome(
  code: OriginalTriggerDecisionCode,
): 'passed' | 'failed' | null {
  if (code === 'triggered' || code === 'queued') return 'passed';
  return ORIGINAL_VIRTUAL_DRIVE_CUE_FAILURE_CODES.has(code) ? 'failed' : null;
}

export type OriginalTriggerEngineOptions = {
  [Key in keyof typeof ORIGINAL_TRIGGER_DEFAULTS]?: number;
};

function resetCandidate(routeInitialized: boolean): OriginalTriggerRuntimeStateV1 {
  return {
    route_initialized: routeInitialized,
    candidate_stop_id: null,
    candidate_entered_at_ms: null,
    candidate_sample_count: 0,
    candidate_last_sample_at_ms: null,
    reverse_candidate_entered_at_ms: null,
    reverse_candidate_sample_count: 0,
    reverse_candidate_last_sample_at_ms: null,
  };
}

export function remainingOriginalTriggerStops(
  manifest: OriginalManifestV1,
  session: OriginalSessionV1,
) {
  const pending = new Set(originalPendingStopIds(session));
  return orderedOriginalStops(manifest).filter(stop => (
    !originalStopIsTerminal(session, stop.id)
    && stop.id !== session.current_stop_id
    && !pending.has(stop.id)
  ));
}

type StopLocationGateCode = Extract<
  OriginalTriggerDecisionCode,
  'before_window' | 'after_window' | 'outside_radius' | 'missing_bearing' | 'wrong_bearing'
>;

type StopLocationGate = {
  code: StopLocationGateCode | null;
  window: NonNullable<OriginalTriggerDecisionDiagnostic['window']>;
  radius: OriginalTriggerDecisionDiagnostic['radius'];
  bearing: OriginalTriggerDecisionDiagnostic['bearing'];
};

function effectiveExitRadius(stop: OriginalStopV1) {
  return Math.max(
    stop.trigger.exit_radius_m,
    stop.trigger.enter_radius_m * 1.5,
    stop.trigger.enter_radius_m + 50,
  );
}

function evaluateStopLocation(
  stop: OriginalStopV1,
  sample: OriginalLocationSample,
  routeProgress: number,
): StopLocationGate {
  const speed = Math.max(0, Number(sample.speed_mps) || 0);
  const leadDistance = speed * Math.max(0, stop.trigger.lead_time_s || 0);
  const start = Math.max(0, stop.trigger.route_progress_start_m - leadDistance);
  const end = stop.trigger.route_progress_end_m;
  const window = {
    authored_start_m: stop.trigger.route_progress_start_m,
    effective_start_m: start,
    end_m: end,
  };
  if (routeProgress < start) return { code: 'before_window', window, radius: null, bearing: null };
  if (routeProgress > end) return { code: 'after_window', window, radius: null, bearing: null };
  const distance = distanceBetweenLngLatMeters(
    [sample.lng, sample.lat],
    [stop.coordinates.lng, stop.coordinates.lat],
  );
  const radius = {
    distance_to_stop_m: distance,
    enter_radius_m: stop.trigger.enter_radius_m,
    exit_radius_m: effectiveExitRadius(stop),
  };
  if (distance > stop.trigger.enter_radius_m) {
    return { code: 'outside_radius', window, radius, bearing: null };
  }
  if (stop.trigger.approach_bearing_deg != null) {
    const actualBearing = Number.isFinite(sample.heading_deg) ? Number(sample.heading_deg) : null;
    const tolerance = stop.trigger.bearing_tolerance_deg ?? 45;
    const difference = actualBearing == null
      ? null
      : angularDifferenceDegrees(actualBearing, stop.trigger.approach_bearing_deg);
    const bearing = {
      actual_deg: actualBearing,
      required_deg: stop.trigger.approach_bearing_deg,
      tolerance_deg: tolerance,
      difference_deg: difference,
    };
    if (actualBearing == null) {
      return { code: 'missing_bearing', window, radius, bearing };
    }
    if (difference! > tolerance) {
      return { code: 'wrong_bearing', window, radius, bearing };
    }
    return { code: null, window, radius, bearing };
  }
  return { code: null, window, radius, bearing: null };
}

function beyondHysteresis(stop: OriginalStopV1, sample: OriginalLocationSample) {
  const distance = distanceBetweenLngLatMeters(
    [sample.lng, sample.lat],
    [stop.coordinates.lng, stop.coordinates.lat],
  );
  return distance > effectiveExitRadius(stop);
}

function passedStop(stop: OriginalStopV1, sample: OriginalLocationSample, routeProgress: number) {
  if (routeProgress <= stop.trigger.route_progress_end_m) return false;
  const distance = distanceBetweenLngLatMeters(
    [sample.lng, sample.lat],
    [stop.coordinates.lng, stop.coordinates.lat],
  );
  return distance > stop.trigger.enter_radius_m;
}

function oppositeAuthoredRouteDirection(
  sample: OriginalLocationSample,
  routeBearingDeg: number | null,
) {
  if (typeof sample.heading_deg !== 'number' || !Number.isFinite(sample.heading_deg)) return false;
  const heading = sample.heading_deg;
  const speed = Number(sample.speed_mps);
  return routeBearingDeg != null
    && Number.isFinite(heading)
    && heading >= 0
    && heading < 360
    && Number.isFinite(speed)
    && speed >= MINIMUM_ROUTE_DIRECTION_SPEED_MPS
    && angularDifferenceDegrees(heading, routeBearingDeg) >= OPPOSITE_ROUTE_DIRECTION_DEG;
}

function applyOppositeRouteDirectionGate(
  gate: StopLocationGate,
  sample: OriginalLocationSample,
  routeBearingDeg: number | null,
  oppositeRouteDirection: boolean,
) {
  if (gate.code != null || !oppositeRouteDirection || routeBearingDeg == null) return gate;
  const actualBearing = Number(sample.heading_deg);
  return {
    ...gate,
    code: 'wrong_bearing' as const,
    bearing: {
      actual_deg: actualBearing,
      required_deg: routeBearingDeg,
      tolerance_deg: OPPOSITE_ROUTE_DIRECTION_DEG - 1,
      difference_deg: angularDifferenceDegrees(actualBearing, routeBearingDeg),
    },
  };
}

function addUnique(values: string[], additions: string[]) {
  return [...new Set([...values, ...additions])];
}

type TriggerWaitDiagnostic = NonNullable<OriginalTriggerDecisionDiagnostic['wait']>;

type TriggerDecisionDetails = {
  stop?: OriginalStopV1 | null;
  stop_id?: string | null;
  gate?: StopLocationGate | null;
  wait?: TriggerWaitDiagnostic | null;
  missed_stop_ids?: readonly string[];
};

function triggerDecisionMessage(
  code: OriginalTriggerDecisionCode,
  details: TriggerDecisionDetails,
) {
  const title = details.stop?.title || 'Next story';
  const gate = details.gate ?? null;
  const wait = details.wait ?? null;
  const missedCount = details.missed_stop_ids?.length ?? 0;
  switch (code) {
    case 'inactive': return 'Tour is not active.';
    case 'user_paused': return 'Automatic story triggers are paused by the listener.';
    case 'stale_fix': return 'This delayed location fix was ignored because a newer fix was already processed.';
    case 'poor_accuracy': return 'GPS accuracy does not meet the trigger requirement.';
    case 'route_unavailable': return 'The authored route cannot be projected from this location.';
    case 'off_route': return 'Location is too far from the authored route.';
    case 'no_remaining_stops': return 'No incomplete story is available to arm right now.';
    case 'complete': return 'All stories in this Original are complete.';
    case 'before_window': return `${title} is ahead of its route-progress window.`;
    case 'after_window': return `${title} is behind its route-progress window.`;
    case 'outside_radius': return `${title} is ${Math.round(gate?.radius?.distance_to_stop_m ?? 0)} meters away, outside its ${Math.round(gate?.radius?.enter_radius_m ?? 0)} meter trigger radius.`;
    case 'missing_bearing': return `${title} requires a direction of travel, but this fix has no usable heading.`;
    case 'wrong_bearing': return `${title} requires an approach near ${Math.round(gate?.bearing?.required_deg ?? 0)} degrees; this fix is headed ${Math.round(gate?.bearing?.actual_deg ?? 0)} degrees.`;
    case 'armed': return `${title} is armed; waiting for another reliable fix over at least ${Math.ceil((wait?.required_elapsed_ms ?? 0) / 1_000)} seconds.`;
    case 'waiting_for_fixes': return `${title} is waiting for ${Math.max(0, (wait?.required_sample_count ?? 0) - (wait?.sample_count ?? 0))} more reliable location fix.`;
    case 'waiting_for_dwell': return `${title} is waiting ${Math.max(0, Math.ceil(((wait?.required_elapsed_ms ?? 0) - (wait?.elapsed_ms ?? 0)) / 1_000))} more seconds inside the trigger area.`;
    case 'triggered': return `${title} triggered and is ready to play.`;
    case 'queued': return `${title} triggered and was queued behind the current story.`;
    case 'missed': return `${missedCount || 1} ${missedCount === 1 ? 'story was' : 'stories were'} passed and marked missed.`;
  }
}

export function evaluateOriginalLocation(
  manifest: OriginalManifestV1,
  currentSession: OriginalSessionV1,
  sample: OriginalLocationSample,
  options: OriginalTriggerEngineOptions = {},
): OriginalTriggerEvaluation {
  const settings = { ...ORIGINAL_TRIGGER_DEFAULTS, ...options };
  const events: OriginalTriggerEvent[] = [];
  let missedStopIds: string[] = [];
  let session: OriginalSessionV1 = {
    ...currentSession,
    trigger_state: { ...currentSession.trigger_state },
    updated_at_ms: sample.timestamp_ms,
  };

  const finish = (
    code: OriginalTriggerDecisionCode,
    projectedRouteProgressM: number | null = null,
    distanceFromRouteM: number | null = null,
    details: TriggerDecisionDetails = {},
  ): OriginalTriggerEvaluation => {
    const actualAccuracy = Number(sample.accuracy_m);
    const gate = details.gate ?? null;
    return {
      session,
      events,
      projected_route_progress_m: projectedRouteProgressM,
      distance_from_route_m: distanceFromRouteM,
      decision: {
        code,
        message: triggerDecisionMessage(code, {
          ...details,
          missed_stop_ids: details.missed_stop_ids ?? missedStopIds,
        }),
        stop_id: details.stop_id !== undefined
          ? details.stop_id
          : details.stop?.id ?? null,
        missed_stop_ids: [...(details.missed_stop_ids ?? missedStopIds)],
        session_status: session.status,
        accuracy: {
          actual_m: Number.isFinite(actualAccuracy) ? actualAccuracy : null,
          maximum_m: settings.maximum_accuracy_m,
        },
        route: {
          projected_progress_m: projectedRouteProgressM,
          distance_from_route_m: distanceFromRouteM,
          maximum_distance_from_route_m: settings.off_route_distance_m,
        },
        window: gate?.window ?? null,
        radius: gate?.radius ?? null,
        bearing: gate?.bearing ?? null,
        wait: details.wait ?? null,
      },
    };
  };

  const lastLocationTimestamp = Number(currentSession.last_location_timestamp_ms);
  if (
    Number.isFinite(lastLocationTimestamp)
    && sample.timestamp_ms <= lastLocationTimestamp
  ) {
    session = {
      ...currentSession,
      trigger_state: { ...currentSession.trigger_state },
    };
    return finish('stale_fix');
  }
  session.last_location_timestamp_ms = sample.timestamp_ms;

  if (session.status === 'completed') {
    return finish('complete');
  }
  if (session.user_paused) {
    session = {
      ...session,
      trigger_state: resetCandidate(session.trigger_state.route_initialized),
    };
    return finish('user_paused');
  }
  if (session.status !== 'active') {
    session = {
      ...session,
      trigger_state: resetCandidate(session.trigger_state.route_initialized),
    };
    return finish('inactive');
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
    return finish('poor_accuracy');
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
    session = {
      ...session,
      tracking_state: 'off_route',
      trigger_state: resetCandidate(session.trigger_state.route_initialized),
    };
    return finish('route_unavailable');
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
    return finish('off_route', routeProgress, projection.distance_from_route_m);
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

  const eligible = remainingOriginalTriggerStops(manifest, session);
  const oppositeRouteDirection = oppositeAuthoredRouteDirection(
    sample,
    projection.segment_bearing_deg,
  );
  const pendingInitialReverseEntry = (
    Math.max(0, Number(currentSession.trigger_state.reverse_candidate_sample_count) || 0) > 0
    && currentSession.trigger_state.reverse_candidate_entered_at_ms != null
  );
  const initialReverseEntry = oppositeRouteDirection && (
    pendingInitialReverseEntry
    || (
      !currentSession.trigger_state.route_initialized
      && currentSession.last_projected_route_progress_m == null
    )
  );
  let confirmedInitialReverseEntry = false;
  if (initialReverseEntry) {
    const storedReverseCount = Math.max(
      0,
      Number(currentSession.trigger_state.reverse_candidate_sample_count) || 0,
    );
    const previousAcceptedAt = Number(
      currentSession.trigger_state.reverse_candidate_last_sample_at_ms,
    );
    const reverseFixesAreContinuous = storedReverseCount > 0
      && Number.isFinite(previousAcceptedAt)
      && sample.timestamp_ms - previousAcceptedAt <= MAXIMUM_REVERSE_CONFIRMATION_FIX_GAP_MS;
    const priorReverseCount = reverseFixesAreContinuous ? storedReverseCount : 0;
    const reverseEnteredAt = priorReverseCount > 0
      ? currentSession.trigger_state.reverse_candidate_entered_at_ms ?? sample.timestamp_ms
      : sample.timestamp_ms;
    const reverseSampleCount = priorReverseCount + 1;
    const reverseElapsedMs = Math.max(0, sample.timestamp_ms - reverseEnteredAt);
    confirmedInitialReverseEntry = reverseSampleCount >= settings.minimum_inside_samples
      && reverseElapsedMs >= settings.minimum_inside_duration_ms;
    session = {
      ...session,
      trigger_state: {
        ...resetCandidate(false),
        reverse_candidate_entered_at_ms: reverseEnteredAt,
        reverse_candidate_sample_count: reverseSampleCount,
        reverse_candidate_last_sample_at_ms: sample.timestamp_ms,
      },
    };
    if (!confirmedInitialReverseEntry) {
      const candidate = eligible[0] ?? null;
      const tolerance = OPPOSITE_ROUTE_DIRECTION_DEG - 1;
      const actualBearing = Number(sample.heading_deg);
      // oppositeAuthoredRouteDirection can only return true when the projected
      // segment exposes a finite authored bearing.
      const requiredBearing = projection.segment_bearing_deg!;
      const gate: StopLocationGate = {
        code: 'wrong_bearing',
        window: candidate
          ? {
              authored_start_m: candidate.trigger.route_progress_start_m,
              effective_start_m: candidate.trigger.route_progress_start_m,
              end_m: candidate.trigger.route_progress_end_m,
            }
          : { authored_start_m: 0, effective_start_m: 0, end_m: manifest.route.distance_m },
        radius: null,
        bearing: {
          actual_deg: actualBearing,
          required_deg: requiredBearing,
          tolerance_deg: tolerance,
          difference_deg: angularDifferenceDegrees(actualBearing, requiredBearing),
        },
      };
      return finish('wrong_bearing', routeProgress, projection.distance_from_route_m, {
        stop: candidate,
        gate,
        wait: {
          sample_count: reverseSampleCount,
          required_sample_count: settings.minimum_inside_samples,
          elapsed_ms: reverseElapsedMs,
          required_elapsed_ms: settings.minimum_inside_duration_ms,
        },
      });
    }
  }
  const missed: string[] = [];
  if (confirmedInitialReverseEntry) {
    missed.push(...eligible.map(stop => stop.id));
  } else if (!oppositeRouteDirection) {
    for (const stop of eligible) {
      if (!passedStop(stop, sample, routeProgress)) break;
      missed.push(stop.id);
    }
  }
  if (missed.length) {
    missedStopIds = missed;
    session = {
      ...session,
      missed_stop_ids: addUnique(session.missed_stop_ids, missed),
      trigger_state: resetCandidate(true),
    };
    events.push({ type: 'stops_missed', stop_ids: missed });
  } else if (!session.trigger_state.route_initialized) {
    session = {
      ...session,
      trigger_state: resetCandidate(true),
    };
  }

  const candidate = remainingOriginalTriggerStops(manifest, session)[0];
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
    return finish(
      missedStopIds.length ? 'missed' : session.status === 'completed' ? 'complete' : 'no_remaining_stops',
      routeProgress,
      projection.distance_from_route_m,
      { stop_id: missedStopIds[0] ?? null },
    );
  }

  const gate = applyOppositeRouteDirectionGate(
    evaluateStopLocation(candidate, sample, routeProgress),
    sample,
    projection.segment_bearing_deg,
    oppositeRouteDirection,
  );
  if (gate.code) {
    if (
      session.trigger_state.candidate_stop_id !== candidate.id
      || beyondHysteresis(candidate, sample)
      || oppositeRouteDirection
    ) {
      session = { ...session, trigger_state: resetCandidate(true) };
    }
    return finish(gate.code, routeProgress, projection.distance_from_route_m, { stop: candidate, gate });
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

  const wait: TriggerWaitDiagnostic = {
    sample_count: sampleCount,
    required_sample_count: settings.minimum_inside_samples,
    elapsed_ms: Math.max(0, sample.timestamp_ms - enteredAt),
    required_elapsed_ms: settings.minimum_inside_duration_ms,
  };

  if (
    sampleCount < settings.minimum_inside_samples
    || sample.timestamp_ms - enteredAt < settings.minimum_inside_duration_ms
  ) {
    const code: OriginalTriggerDecisionCode = !sameCandidate
      ? 'armed'
      : sampleCount < settings.minimum_inside_samples
        ? 'waiting_for_fixes'
        : 'waiting_for_dwell';
    return finish(code, routeProgress, projection.distance_from_route_m, { stop: candidate, gate, wait });
  }

  const queue = Boolean(session.current_stop_id);
  const updatedSession: OriginalSessionV1 = {
    ...session,
    triggered_stop_ids: addUnique(session.triggered_stop_ids, [candidate.id]),
    current_stop_id: queue ? session.current_stop_id : candidate.id,
    current_audio_position_ms: queue ? session.current_audio_position_ms : 0,
    trigger_state: resetCandidate(true),
  };
  session = queue
    ? enqueueOriginalPendingStop(updatedSession, candidate.id)
    : withOriginalPendingStops(updatedSession, originalPendingStopIds(session));
  events.push({ type: queue ? 'stop_queued' : 'stop_triggered', stop_id: candidate.id });
  return finish(queue ? 'queued' : 'triggered', routeProgress, projection.distance_from_route_m, {
    stop: candidate,
    gate,
    wait,
  });
}
