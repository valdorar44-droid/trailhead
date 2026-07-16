export const ORIGINAL_AUDIO_PRIORITIES = {
  ui: 10,
  copilot: 20,
  originals: 30,
  navigation: 40,
  hazard: 50,
} as const;

export type OriginalAudioPriorityName = keyof typeof ORIGINAL_AUDIO_PRIORITIES;

export type OriginalAudioFocusRequest = {
  owner: string;
  priority: OriginalAudioPriorityName | number;
  pause: () => Promise<void> | void;
  resume: () => Promise<void> | void;
  canAutoResume?: () => boolean;
};

export type OriginalAudioFocusLease = {
  owner: string;
  release: () => Promise<void>;
};

type FocusEntry = OriginalAudioFocusRequest & {
  numericPriority: number;
  sequence: number;
  suspended: boolean;
};

export function createOriginalAudioCoordinator() {
  let sequence = 0;
  let operationTail: Promise<unknown> = Promise.resolve();
  const entries = new Map<string, FocusEntry>();

  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationTail.then(operation, operation);
    operationTail = result.catch(() => undefined);
    return result;
  };

  const priorityValue = (priority: OriginalAudioFocusRequest['priority']) => (
    typeof priority === 'number' ? priority : ORIGINAL_AUDIO_PRIORITIES[priority]
  );

  const topEntry = () => [...entries.values()].sort((a, b) => (
    b.numericPriority - a.numericPriority || b.sequence - a.sequence
  ))[0] ?? null;

  return {
    acquire(request: OriginalAudioFocusRequest): Promise<OriginalAudioFocusLease> {
      return serialized(async () => {
        const previousTop = topEntry();
        const entry: FocusEntry = {
          ...request,
          numericPriority: priorityValue(request.priority),
          sequence: ++sequence,
          suspended: false,
        };
        entries.set(request.owner, entry);
        const nextTop = topEntry();
        if (nextTop?.owner !== entry.owner) entry.suspended = true;
        if (previousTop && nextTop?.owner !== previousTop.owner && !previousTop.suspended) {
          previousTop.suspended = true;
          await previousTop.pause();
        }
        if (nextTop?.owner === entry.owner && entry.suspended) {
          entry.suspended = false;
          await entry.resume();
        }
        let released = false;
        return {
          owner: request.owner,
          release: () => serialized(async () => {
            if (released) return;
            released = true;
            const wasTop = topEntry()?.owner === request.owner;
            entries.delete(request.owner);
            if (!wasTop) return;
            const resume = topEntry();
            if (resume?.suspended && (resume.canAutoResume?.() ?? true)) {
              resume.suspended = false;
              await resume.resume();
            }
          }),
        };
      });
    },

    release(owner: string) {
      return serialized(async () => {
        const wasTop = topEntry()?.owner === owner;
        entries.delete(owner);
        if (!wasTop) return;
        const resume = topEntry();
        if (resume?.suspended && (resume.canAutoResume?.() ?? true)) {
          resume.suspended = false;
          await resume.resume();
        }
      });
    },

    activeOwner() {
      return topEntry()?.owner ?? null;
    },

    reset() {
      entries.clear();
      sequence = 0;
    },
  };
}

export const originalAudioCoordinator = createOriginalAudioCoordinator();
