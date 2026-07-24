export type PlanLibraryRefreshMode = 'loading' | 'silent';

export type OfflineManagerReturnContext =
  | Readonly<{ source: 'plan'; section: 'downloads'; scrollY: number }>
  | null;

export type OfflineManagerCloseReason = 'dismiss' | 'open_map';

export function planLibraryRefreshMode(
  loadedOwnerScope: string,
  expectedOwnerScope: string,
): PlanLibraryRefreshMode {
  return loadedOwnerScope === expectedOwnerScope ? 'silent' : 'loading';
}

export function planLibraryRequestIsCurrent(input: Readonly<{
  requestSequence: number;
  currentSequence: number;
  requestOwnerScope: string;
  currentOwnerScope: string;
}>) {
  return input.requestSequence === input.currentSequence
    && input.requestOwnerScope === input.currentOwnerScope;
}

export function planDownloadsReturnRequest(
  context: OfflineManagerReturnContext,
  reason: OfflineManagerCloseReason,
) {
  if (context?.source !== 'plan' || reason !== 'dismiss') return null;
  return Object.freeze({
    pathname: '/(tabs)/trips' as const,
    section: context.section,
    scrollY: Math.max(0, Math.round(context.scrollY)),
  });
}
