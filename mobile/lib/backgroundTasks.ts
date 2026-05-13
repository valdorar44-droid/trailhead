/**
 * Background location task for auto-playing audio guide narrations.
 * This file must be imported at the root _layout.tsx so the task is
 * registered before Expo Router initialises navigation.
 */
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import * as FileSystem from 'expo-file-system';

export const AUDIO_LOCATION_TASK = 'trailhead-audio-watch';

// Minimum interval (ms) between notifications for the same waypoint
const RENOTIFY_INTERVAL_MS = 30 * 60 * 1000;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

TaskManager.defineTask(AUDIO_LOCATION_TASK, async ({ data, error }: any) => {
  if (error) return;
  const { locations } = data;
  const loc = locations?.[0];
  if (!loc) return;

  try {
    await FileSystem.writeAsStringAsync(
      FileSystem.documentDirectory + 'last_background_location.json',
      JSON.stringify({
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        accuracy: loc.coords.accuracy ?? null,
        speed: loc.coords.speed ?? null,
        heading: loc.coords.heading ?? null,
        ts: Date.now(),
      }),
    ).catch(() => {});

    const tripPath = FileSystem.documentDirectory + 'active_trip.json';
    const tripExists = await FileSystem.getInfoAsync(tripPath);
    if (!tripExists.exists) return;

    const tripJson = await FileSystem.readAsStringAsync(tripPath);
    const trip = JSON.parse(tripJson);

    const guidePath = FileSystem.documentDirectory + `guide_${trip.trip_id}.json`;
    const guideExists = await FileSystem.getInfoAsync(guidePath);
    const guide = guideExists.exists
      ? JSON.parse(await FileSystem.readAsStringAsync(guidePath))
      : {};

    // Load notification history to avoid spamming
    const histPath = FileSystem.documentDirectory + 'notified_wps.json';
    const histExists = await FileSystem.getInfoAsync(histPath);
    const notified: Record<string, number> = histExists.exists
      ? JSON.parse(await FileSystem.readAsStringAsync(histPath))
      : {};

    const { latitude, longitude } = loc.coords;
    const wps = (trip.plan?.waypoints ?? []).filter((w: any) => w.lat && w.lng);
    const now = Date.now();

    for (const wp of wps) {
      const dLat = (wp.lat - latitude) * 111;
      const dLng = (wp.lng - longitude) * 111 * Math.cos(latitude * Math.PI / 180);
      const distKm = Math.sqrt(dLat * dLat + dLng * dLng);

      if (distKm < 1.0 && guide[wp.name]) {
        const lastNotified = notified[wp.name] ?? 0;
        if (now - lastNotified > RENOTIFY_INTERVAL_MS) {
          await Notifications.scheduleNotificationAsync({
            content: {
              title: wp.name,
              body: guide[wp.name].slice(0, 180),
              data: { tripId: trip.trip_id, waypointName: wp.name },
            },
            trigger: null,
          });
          notified[wp.name] = now;
          await FileSystem.writeAsStringAsync(histPath, JSON.stringify(notified));
        }
        break;
      }
    }
  } catch {}
});
