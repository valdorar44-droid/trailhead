import { Platform } from 'react-native';
import * as Location from 'expo-location';
import {
  beginTrailRecording,
  completeActiveTrailRecording,
  getActiveTrailRecording,
  markActiveTrailRecordingFollowEnded,
  pauseActiveTrailRecording,
  resumeActiveTrailRecording,
} from './trailRecordingRepository';

export const TRAIL_RECORDING_LOCATION_TASK = 'trailhead-trail-recording-v1';

async function locationTaskActive() {
  if (Platform.OS === 'web') return false;
  return Location.hasStartedLocationUpdatesAsync(TRAIL_RECORDING_LOCATION_TASK).catch(() => false);
}

export async function startTrailRecordingLocationUpdates() {
  if (Platform.OS === 'web') return;
  const foreground = await Location.getForegroundPermissionsAsync();
  const fg = foreground.status === 'granted'
    ? foreground
    : await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') throw new Error('location_permission_denied');
  if (Platform.OS === 'ios') {
    const background = await Location.getBackgroundPermissionsAsync().catch(() => null);
    if (background?.status !== 'granted') {
      const requested = await Location.requestBackgroundPermissionsAsync().catch(() => null);
      if (requested?.status !== 'granted') throw new Error('background_location_permission_denied');
    }
  }
  if (await locationTaskActive()) return;
  await Location.startLocationUpdatesAsync(TRAIL_RECORDING_LOCATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 1000,
    distanceInterval: 4,
    deferredUpdatesInterval: 5_000,
    deferredUpdatesDistance: 10,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.Fitness,
    showsBackgroundLocationIndicator: Platform.OS === 'ios',
    foregroundService: {
      notificationTitle: 'Recording trail',
      notificationBody: 'Trailhead is saving this track on your device.',
      notificationColor: '#AD5A33',
      killServiceOnDestroy: false,
    },
  });
}

export async function stopTrailRecordingLocationUpdates() {
  if (Platform.OS === 'web') return;
  if (await locationTaskActive()) {
    await Location.stopLocationUpdatesAsync(TRAIL_RECORDING_LOCATION_TASK);
  }
}

export async function startLocalTrailRecording(input: Readonly<{
  trailId: string;
  trailName: string;
  routeRevision?: string | null;
  routeCoordinates?: readonly (readonly [number, number])[];
}>) {
  const session = await beginTrailRecording(input);
  try {
    await startTrailRecordingLocationUpdates();
    return session;
  } catch (error) {
    await completeActiveTrailRecording().catch(() => null);
    throw error;
  }
}

export async function pauseLocalTrailRecording() {
  await stopTrailRecordingLocationUpdates();
  return pauseActiveTrailRecording();
}

export async function resumeLocalTrailRecording() {
  const session = await resumeActiveTrailRecording();
  if (session) await startTrailRecordingLocationUpdates();
  return session;
}

export async function endLocalTrailRecording() {
  await stopTrailRecordingLocationUpdates();
  return completeActiveTrailRecording();
}

export function endTrailFollowWithoutStoppingRecording() {
  return markActiveTrailRecordingFollowEnded();
}

export { getActiveTrailRecording };
