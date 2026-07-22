import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { originalAccessStore, originalBundleStore, originalFeedbackStore, originalSessionStore } from './expoStores';
import { stopHeadlessOriginalRuntime } from './headlessRuntime';
import {
  ORIGINALS_LOCATION_TASK,
  clearOriginalLocationRuntimeQueue,
  expoOriginalLocationAdapter,
} from './locationAdapter';
import type { OriginalOwnerScope } from './types';

type RuntimeStopper = () => Promise<void>;
let activeRuntimeStopper: RuntimeStopper | null = null;

export function registerOriginalsAccountDepartureStopper(stopper: RuntimeStopper) {
  activeRuntimeStopper = stopper;
  return () => {
    if (activeRuntimeStopper === stopper) activeRuntimeStopper = null;
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'Unknown Originals cleanup error');
}

/** Stops foreground audio/runtime, headless work, and the persisted OS task. */
export async function stopOriginalsForAccountDeparture() {
  const errors: string[] = [];
  if (activeRuntimeStopper) {
    try { await activeRuntimeStopper(); } catch (error) { errors.push(errorMessage(error)); }
  }
  try { await stopHeadlessOriginalRuntime(); } catch (error) { errors.push(errorMessage(error)); }
  // A cold OS task can persist raw fixes without a mounted React runtime.
  // Always stop the singleton adapter and purge its serialized queue, even
  // when no active runtime stopper was registered.
  try { await expoOriginalLocationAdapter.stopActive(); } catch (error) { errors.push(errorMessage(error)); }
  if (Platform.OS !== 'web') {
    try {
      if (await Location.hasStartedLocationUpdatesAsync(ORIGINALS_LOCATION_TASK)) {
        await Location.stopLocationUpdatesAsync(ORIGINALS_LOCATION_TASK);
      }
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }
  try { await clearOriginalLocationRuntimeQueue(); } catch (error) { errors.push(errorMessage(error)); }
  if (errors.length > 0) throw new Error(errors.join('\n'));
}

/** Erases only account-owned Originals state. Guest-free downloads remain. */
export async function clearOriginalsAccountScope(accountId: string | number) {
  const scope = `account:${String(accountId)}` as OriginalOwnerScope;
  await originalSessionStore.eraseScope(scope);
  await originalBundleStore.eraseScope(scope);
  await originalAccessStore.eraseScope(scope);
  await originalFeedbackStore.eraseSignedIn();

  const [sessions, bundles, access, active] = await Promise.all([
    originalSessionStore.list(scope),
    originalBundleStore.list(scope),
    originalAccessStore.list(scope),
    originalSessionStore.loadActive(),
  ]);
  if (sessions.length || bundles.length || access.length || active?.owner_scope === scope) {
    throw new Error('Trailhead could not verify that account-owned Originals data was removed.');
  }
}
