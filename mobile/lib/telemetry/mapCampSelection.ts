import * as Sentry from '@sentry/react-native';
import * as Updates from 'expo-updates';

import { useStore } from '../store';
import {
  currentMapCampSelectionPhaseV1,
  mapCampSelectionDiagnosticAllowedV1,
  mapCampSelectionErrorCodeV1,
} from './mapCampSelectionCore';

export function captureMapCampSelectionErrorV1(error: unknown): string | undefined {
  const auth = useStore.getState();
  if (!mapCampSelectionDiagnosticAllowedV1({
    channel: Updates.channel,
    authenticated: Boolean(auth.token),
    isAdmin: Boolean(auth.user?.is_admin),
  })) return undefined;

  const errorCode = mapCampSelectionErrorCodeV1(currentMapCampSelectionPhaseV1());
  let eventId: string | undefined;
  Sentry.withScope(scope => {
    scope.setTag('error_code', errorCode);
    const captured = error instanceof Error ? error : new Error('trailhead.map.camp.render');
    eventId = Sentry.captureException(captured);
  });
  return eventId;
}
