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
}>): Promise<T | undefined> {
  try {
    await input.create();
  } catch (creationError) {
    const recovered = await input.reload().catch(() => undefined);
    if (!recovered) throw creationError;
    await recovered.resume();
    return recovered;
  }
  return input.reload();
}
