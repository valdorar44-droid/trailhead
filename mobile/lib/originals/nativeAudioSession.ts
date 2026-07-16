export type NativeAudioSessionMutation = () => Promise<void>;

export function createNativeAudioSessionQueue() {
  let tail: Promise<void> = Promise.resolve();
  return (mutation: NativeAudioSessionMutation) => {
    const result = tail.then(mutation, mutation);
    tail = result.catch(() => {});
    return result;
  };
}

// expo-av and expo-audio both configure the same native audio session. Keep
// their mutations ordered even though the playback adapters are separate.
export const applyNativeAudioSessionMode = createNativeAudioSessionQueue();
