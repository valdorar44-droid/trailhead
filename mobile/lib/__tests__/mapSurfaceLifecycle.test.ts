import { mapLoadFailureIsFatal } from '../mapSurfaceLifecycle';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`map surface lifecycle failed: ${message}`);
}

assert(mapLoadFailureIsFatal(false), 'an initial renderer failure must use the fallback surface');
assert(!mapLoadFailureIsFatal(true), 'a late style or source error must not replace a map that is already visible');

console.log('map surface lifecycle tests passed');
