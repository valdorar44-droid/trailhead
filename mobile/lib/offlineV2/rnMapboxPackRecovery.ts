export type RecoverableRnMapboxPack = Readonly<{
  resume(): Promise<void>;
}>;

/**
 * RNMapbox can persist a native tile region before its createPack promise
 * rejects. Refreshing the manager registry exposes that region, allowing the
 * same immutable download to continue without an app restart.
 */
export async function createOrRecoverRnMapboxPack<T extends RecoverableRnMapboxPack>(input: Readonly<{
  create(): Promise<void>;
  reload(): Promise<T | undefined>;
  onPackReady?(): void;
  reloadDelaysMs?: readonly number[];
  sleep?(milliseconds: number): Promise<void>;
}>): Promise<T | undefined> {
  const reload = async () => {
    const delays = input.reloadDelaysMs ?? [0, 100, 250, 500, 1_000];
    for (const delay of delays) {
      if (delay > 0) {
        await (input.sleep ?? (milliseconds => new Promise<void>(resolve => {
          setTimeout(resolve, milliseconds);
        })))(delay);
      }
      const pack = await input.reload().catch(() => undefined);
      if (pack) {
        input.onPackReady?.();
        return pack;
      }
    }
    return undefined;
  };

  try {
    await input.create();
  } catch (creationError) {
    const recovered = await reload();
    if (!recovered) throw creationError;
    await recovered.resume();
    return recovered;
  }
  return reload();
}
