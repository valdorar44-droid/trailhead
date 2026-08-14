import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { createOriginalLocationQueue, type OriginalLocationQueueStorage } from './locationQueue';
import { backgroundLocationStartMessage, requireIosLockedScreenPermission } from './locationPolicy';
import { processHeadlessOriginalLocationSamples } from './headlessRuntime';
import type { OriginalLocationSample, OriginalPermissionState } from './types';

export const ORIGINALS_LOCATION_TASK = 'trailhead-originals-active-tour';

export type OriginalLocationAdapter = {
  capabilities: {
    foreground: boolean;
    backgroundTask: boolean;
    androidForegroundService: boolean;
  };
  start(
    onLocation: (sample: OriginalLocationSample) => void | Promise<void>,
  ): Promise<{ stop: () => Promise<void>; permission: OriginalPermissionState }>;
  /**
   * Admin-only unpublished field review. This is intentionally foreground
   * only: it never starts the persistent task or reads/writes its queue.
   */
  startPrivateForeground(
    onLocation: (sample: OriginalLocationSample) => void | Promise<void>,
  ): Promise<{ stop: () => Promise<void>; permission: OriginalPermissionState }>;
  /** Stops a previously persisted native task even when no JS callback is attached. */
  stopActive(): Promise<void>;
};

let taskLocationHandler: ((sample: OriginalLocationSample) => void | Promise<void>) | null = null;
const LOCATION_QUEUE_ROOT = `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? 'file:///trailhead/'}originals/location-runtime/`;
const LOCATION_QUEUE_PATH = `${LOCATION_QUEUE_ROOT}pending-v1.json`;
const LOCATION_QUEUE_TEMP_PATH = `${LOCATION_QUEUE_ROOT}pending-v1.tmp`;
const LOCATION_QUEUE_BACKUP_PATH = `${LOCATION_QUEUE_ROOT}pending-v1.backup`;
let webQueueValue: string | null = null;

async function readFileIfPresent(path: string) {
  const info = await FileSystem.getInfoAsync(path).catch(() => null);
  if (!info?.exists || info.isDirectory) return null;
  return FileSystem.readAsStringAsync(path).catch(() => null);
}

const expoLocationQueueStorage: OriginalLocationQueueStorage = {
  async read() {
    if (Platform.OS === 'web') return webQueueValue;
    return await readFileIfPresent(LOCATION_QUEUE_PATH)
      ?? await readFileIfPresent(LOCATION_QUEUE_BACKUP_PATH);
  },

  async write(value) {
    if (Platform.OS === 'web') {
      webQueueValue = value;
      return;
    }
    await FileSystem.makeDirectoryAsync(LOCATION_QUEUE_ROOT, { intermediates: true });
    await FileSystem.deleteAsync(LOCATION_QUEUE_TEMP_PATH, { idempotent: true });
    await FileSystem.writeAsStringAsync(LOCATION_QUEUE_TEMP_PATH, value);
    await FileSystem.deleteAsync(LOCATION_QUEUE_BACKUP_PATH, { idempotent: true });
    const current = await FileSystem.getInfoAsync(LOCATION_QUEUE_PATH);
    if (current.exists) {
      await FileSystem.moveAsync({ from: LOCATION_QUEUE_PATH, to: LOCATION_QUEUE_BACKUP_PATH });
    }
    try {
      await FileSystem.moveAsync({ from: LOCATION_QUEUE_TEMP_PATH, to: LOCATION_QUEUE_PATH });
      await FileSystem.deleteAsync(LOCATION_QUEUE_BACKUP_PATH, { idempotent: true });
    } catch (error) {
      const backup = await FileSystem.getInfoAsync(LOCATION_QUEUE_BACKUP_PATH).catch(() => null);
      const main = await FileSystem.getInfoAsync(LOCATION_QUEUE_PATH).catch(() => null);
      if (backup?.exists && !main?.exists) {
        await FileSystem.moveAsync({ from: LOCATION_QUEUE_BACKUP_PATH, to: LOCATION_QUEUE_PATH }).catch(() => {});
      }
      throw error;
    }
  },

  async remove() {
    if (Platform.OS === 'web') {
      webQueueValue = null;
      return;
    }
    await Promise.all([
      FileSystem.deleteAsync(LOCATION_QUEUE_PATH, { idempotent: true }),
      FileSystem.deleteAsync(LOCATION_QUEUE_TEMP_PATH, { idempotent: true }),
      FileSystem.deleteAsync(LOCATION_QUEUE_BACKUP_PATH, { idempotent: true }),
    ]);
  },
};

const headlessLocationQueue = createOriginalLocationQueue(expoLocationQueueStorage);

/** Account-departure barrier for raw fixes persisted by a cold native task. */
export async function clearOriginalLocationRuntimeQueue() {
  taskLocationHandler = null;
  await headlessLocationQueue.clear();
  if (await headlessLocationQueue.count()) {
    throw new Error('Trailhead could not verify that queued Original locations were removed.');
  }
}

function locationSample(location: Location.LocationObject): OriginalLocationSample {
  return {
    lat: location.coords.latitude,
    lng: location.coords.longitude,
    accuracy_m: location.coords.accuracy ?? null,
    heading_deg: location.coords.heading ?? null,
    speed_mps: location.coords.speed ?? null,
    timestamp_ms: Number(location.timestamp) || Date.now(),
  };
}

async function deliverOrQueueLocationSamples(samples: OriginalLocationSample[]) {
  if (!samples.length) return;
  const handler = taskLocationHandler;
  if (!handler) {
    const handled = await processHeadlessOriginalLocationSamples(samples, async () => {
      const active = await Location.hasStartedLocationUpdatesAsync(ORIGINALS_LOCATION_TASK).catch(() => false);
      if (active) await Location.stopLocationUpdatesAsync(ORIGINALS_LOCATION_TASK).catch(() => {});
    }).catch(() => false);
    if (!handled) await headlessLocationQueue.enqueue(samples);
    return;
  }
  for (let index = 0; index < samples.length; index += 1) {
    try {
      await handler(samples[index]);
    } catch (error) {
      await headlessLocationQueue.enqueue(samples.slice(index));
      throw error;
    }
  }
}

if (Platform.OS !== 'web' && !TaskManager.isTaskDefined(ORIGINALS_LOCATION_TASK)) {
  TaskManager.defineTask(ORIGINALS_LOCATION_TASK, async ({ data, error }) => {
    if (error) throw new Error(`Trailhead Originals background location task failed: ${error.message}`);
    const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations ?? [];
    await deliverOrQueueLocationSamples(locations.map(locationSample));
  });
}

export function createExpoOriginalLocationAdapter(): OriginalLocationAdapter {
  let foregroundSubscription: Location.LocationSubscription | null = null;
  let privateForegroundSubscription: {
    generation: number;
    subscription: Location.LocationSubscription;
  } | null = null;
  let generation = 0;
  let privateGeneration = 0;

  const stopPrivateForeground = async () => {
    privateGeneration += 1;
    const active = privateForegroundSubscription;
    privateForegroundSubscription = null;
    active?.subscription.remove();
  };

  const stopExactPrivateForeground = (
    activeGeneration: number,
    subscription: Location.LocationSubscription,
  ) => async () => {
    if (
      privateForegroundSubscription?.generation === activeGeneration
      && privateForegroundSubscription.subscription === subscription
    ) {
      privateGeneration += 1;
      privateForegroundSubscription = null;
    }
    // Removing this captured subscription is safe and idempotent even after a
    // newer start has replaced it; never dereference the shared current slot.
    subscription.remove();
  };

  const stopInternal = async (clearQueuedSamples: boolean) => {
    generation += 1;
    await stopPrivateForeground();
    foregroundSubscription?.remove();
    foregroundSubscription = null;
    if (Platform.OS !== 'web') {
      const active = await Location.hasStartedLocationUpdatesAsync(ORIGINALS_LOCATION_TASK).catch(() => false);
      if (active) await Location.stopLocationUpdatesAsync(ORIGINALS_LOCATION_TASK).catch(() => {});
    }
    taskLocationHandler = null;
    if (clearQueuedSamples) await headlessLocationQueue.clear();
  };

  const stop = () => stopInternal(true);

  return {
    capabilities: {
      foreground: true,
      backgroundTask: Platform.OS !== 'web',
      androidForegroundService: Platform.OS === 'android',
    },

    stopActive: stop,

    async startPrivateForeground(onLocation) {
      await stopPrivateForeground();
      const activeGeneration = privateGeneration;
      if (foregroundSubscription || taskLocationHandler) {
        throw new Error('End the active Original before starting a private field review.');
      }
      if (Platform.OS !== 'web') {
        const backgroundActive = await Location.hasStartedLocationUpdatesAsync(
          ORIGINALS_LOCATION_TASK,
        ).catch(() => true);
        if (backgroundActive) {
          throw new Error('End the active Original before starting a private field review.');
        }
      }
      const existing = await Location.getForegroundPermissionsAsync();
      const foreground = existing.status === 'granted'
        ? existing
        : await Location.requestForegroundPermissionsAsync();
      if (foreground.status !== 'granted') {
        return { stop: async () => {}, permission: 'denied' };
      }
      let subscription: Location.LocationSubscription;
      try {
        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 1_000,
            distanceInterval: 10,
            mayShowUserSettingsDialog: true,
          },
          value => {
            if (activeGeneration !== privateGeneration) return;
            void Promise.resolve(onLocation(locationSample(value))).catch(() => {});
          },
        );
      } catch (error) { throw error; }
      if (activeGeneration !== privateGeneration) {
        subscription.remove();
        throw new Error('Private field location start was cancelled.');
      }
      privateForegroundSubscription = { generation: activeGeneration, subscription };
      return {
        stop: stopExactPrivateForeground(activeGeneration, subscription),
        permission: 'foreground',
      };
    },

    async start(onLocation) {
      // Preserve samples written by a cold/headless task until the callback is
      // reattached, while still replacing any stale native subscription.
      await stopInternal(false);
      const activeGeneration = generation;
      const existing = await Location.getForegroundPermissionsAsync();
      const foreground = existing.status === 'granted'
        ? existing
        : await Location.requestForegroundPermissionsAsync();
      if (foreground.status !== 'granted') {
        await headlessLocationQueue.clear();
        return { stop, permission: 'denied' };
      }

      let permission: OriginalPermissionState = 'foreground';
      if (Platform.OS === 'ios') {
        const existingBackground = await Location.getBackgroundPermissionsAsync().catch(() => null);
        const background = existingBackground?.status === 'granted'
          ? existingBackground
          : await Location.requestBackgroundPermissionsAsync().catch(() => null);
        try {
          requireIosLockedScreenPermission(Platform.OS, background?.status === 'granted');
        } catch (error) {
          await headlessLocationQueue.clear();
          throw error;
        }
        permission = 'background';
      }

      taskLocationHandler = onLocation;
      try {
        await headlessLocationQueue.drain(sample => {
          if (activeGeneration !== generation) throw new Error('Location tracking changed while queued fixes were restoring.');
          return onLocation(sample);
        });
        foregroundSubscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 1_000,
            distanceInterval: 10,
            mayShowUserSettingsDialog: true,
          },
          value => {
            if (activeGeneration !== generation) return;
            void deliverOrQueueLocationSamples([locationSample(value)]).catch(() => {});
          },
        );
      } catch (error) {
        await stopInternal(false);
        throw error;
      }

      if (Platform.OS !== 'web') {
        try {
          await Location.startLocationUpdatesAsync(ORIGINALS_LOCATION_TASK, {
            accuracy: Location.Accuracy.BestForNavigation,
            activityType: Location.ActivityType.AutomotiveNavigation,
            timeInterval: 1_000,
            distanceInterval: 10,
            deferredUpdatesDistance: 20,
            deferredUpdatesInterval: 1_000,
            pausesUpdatesAutomatically: false,
            showsBackgroundLocationIndicator: Platform.OS === 'ios',
            foregroundService: Platform.OS === 'android' ? {
              notificationTitle: 'Trailhead Original active',
              notificationBody: 'GPS stories are ready along your drive.',
              notificationColor: '#e67e22',
              killServiceOnDestroy: false,
            } : undefined,
          });
          permission = 'background';
        } catch (error) {
          await stopInternal(true);
          throw new Error(backgroundLocationStartMessage(Platform.OS), { cause: error });
        }
      }

      return { stop, permission };
    },
  };
}

export const expoOriginalLocationAdapter = createExpoOriginalLocationAdapter();
