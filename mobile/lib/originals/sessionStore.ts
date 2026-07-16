import {
  joinOriginalPath,
  recoverOriginalPath,
  writeOriginalTextAtomically,
  type OriginalFileAdapter,
} from './fileAdapter';
import { normalizeOriginalSession } from './session';
import type { OriginalOwnerScope, OriginalSessionV1 } from './types';

type SessionIndexV1 = {
  schema_version: 1;
  sessions: Record<string, string[]>;
  active: { owner_scope: OriginalOwnerScope; key: string } | null;
};

export type OriginalSessionStore = ReturnType<typeof createOriginalSessionStore>;

const emptyIndex = (): SessionIndexV1 => ({ schema_version: 1, sessions: {}, active: null });

function sessionKey(packId: string, version: number) {
  return `${encodeURIComponent(packId)}@${version}`;
}

function scopeKey(scope: OriginalOwnerScope) {
  return encodeURIComponent(scope);
}

function mergedGuestSession(
  guest: OriginalSessionV1,
  account: OriginalSessionV1 | null,
  ownerScope: OriginalOwnerScope,
) {
  if (!account) return { ...guest, owner_scope: ownerScope, updated_at_ms: Date.now() };
  const newer = guest.updated_at_ms > account.updated_at_ms ? guest : account;
  const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];
  const guestProgress = guest.last_projected_route_progress_m;
  const accountProgress = account.last_projected_route_progress_m;
  const mergedProgress = guestProgress == null && accountProgress == null
    ? null
    : Math.max(guestProgress ?? 0, accountProgress ?? 0);
  return normalizeOriginalSession({
    ...newer,
    session_id: account.session_id,
    owner_scope: ownerScope,
    triggered_stop_ids: union(guest.triggered_stop_ids, account.triggered_stop_ids),
    completed_stop_ids: union(guest.completed_stop_ids, account.completed_stop_ids),
    skipped_stop_ids: union(guest.skipped_stop_ids, account.skipped_stop_ids),
    missed_stop_ids: union(guest.missed_stop_ids, account.missed_stop_ids),
    last_projected_route_progress_m: mergedProgress,
    updated_at_ms: Date.now(),
  });
}

export function createOriginalSessionStore(
  files: OriginalFileAdapter,
  root = joinOriginalPath(files.documentDirectory, 'originals/sessions'),
) {
  const indexPath = joinOriginalPath(root, '_index.json');
  let operationTail: Promise<unknown> = Promise.resolve();

  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationTail.then(operation, operation);
    operationTail = result.catch(() => undefined);
    return result;
  };

  const pathFor = (scope: OriginalOwnerScope, key: string) => (
    joinOriginalPath(root, scopeKey(scope), `${key}.json`)
  );

  const readIndex = async (): Promise<SessionIndexV1> => {
    try {
      await recoverOriginalPath(files, indexPath);
      const parsed = JSON.parse(await files.readText(indexPath));
      if (parsed?.schema_version !== 1 || !parsed.sessions) return emptyIndex();
      return parsed;
    } catch {
      return emptyIndex();
    }
  };

  const writeIndex = (index: SessionIndexV1) => (
    writeOriginalTextAtomically(files, indexPath, JSON.stringify(index))
  );

  const loadInternal = async (scope: OriginalOwnerScope, key: string): Promise<OriginalSessionV1 | null> => {
    try {
      const path = pathFor(scope, key);
      await recoverOriginalPath(files, path);
      return normalizeOriginalSession(JSON.parse(await files.readText(path)));
    } catch {
      return null;
    }
  };

  const saveInternal = async (session: OriginalSessionV1) => {
    const clean = normalizeOriginalSession(session);
    const key = sessionKey(clean.pack_id, clean.version);
    await writeOriginalTextAtomically(files, pathFor(clean.owner_scope, key), JSON.stringify(clean));
    const index = await readIndex();
    const existing = index.sessions[clean.owner_scope] ?? [];
    index.sessions[clean.owner_scope] = [key, ...existing.filter(value => value !== key)];
    await writeIndex(index);
    return clean;
  };

  return {
    root,

    save(session: OriginalSessionV1) {
      return serialized(() => saveInternal(session));
    },

    load(ownerScope: OriginalOwnerScope, packId: string, version: number) {
      return serialized(() => loadInternal(ownerScope, sessionKey(packId, version)));
    },

    list(ownerScope: OriginalOwnerScope) {
      return serialized(async () => {
        const index = await readIndex();
        const sessions = await Promise.all(
          (index.sessions[ownerScope] ?? []).map(key => loadInternal(ownerScope, key)),
        );
        return sessions.filter(Boolean) as OriginalSessionV1[];
      });
    },

    setActive(session: OriginalSessionV1 | null) {
      return serialized(async () => {
        if (!session) {
          const index = await readIndex();
          index.active = null;
          await writeIndex(index);
          return null;
        }
        const saved = await saveInternal(session);
        const index = await readIndex();
        index.active = {
          owner_scope: saved.owner_scope,
          key: sessionKey(saved.pack_id, saved.version),
        };
        await writeIndex(index);
        return saved;
      });
    },

    loadActive() {
      return serialized(async () => {
        const index = await readIndex();
        if (!index.active) return null;
        return loadInternal(index.active.owner_scope, index.active.key);
      });
    },

    remove(ownerScope: OriginalOwnerScope, packId: string, version: number) {
      return serialized(async () => {
        const key = sessionKey(packId, version);
        await files.remove(pathFor(ownerScope, key)).catch(() => {});
        const index = await readIndex();
        index.sessions[ownerScope] = (index.sessions[ownerScope] ?? []).filter(value => value !== key);
        if (index.active?.owner_scope === ownerScope && index.active.key === key) index.active = null;
        await writeIndex(index);
      });
    },

    eraseScope(ownerScope: OriginalOwnerScope) {
      return serialized(async () => {
        const index = await readIndex();
        await files.remove(joinOriginalPath(root, scopeKey(ownerScope))).catch(() => {});
        delete index.sessions[ownerScope];
        if (index.active?.owner_scope === ownerScope) index.active = null;
        await writeIndex(index);
      });
    },

    migrateGuestToAccount(
      accountId: string | number,
      allowed: Array<{ pack_id: string; version: number }> | null = null,
    ) {
      return serialized(async () => {
        const accountScope = `account:${accountId}` as OriginalOwnerScope;
        const index = await readIndex();
        const allowedKeys = allowed
          ? new Set(allowed.map(value => sessionKey(value.pack_id, value.version)))
          : null;
        const guestKeys = [...(index.sessions.guest ?? [])].filter(key => !allowedKeys || allowedKeys.has(key));
        const migrated: OriginalSessionV1[] = [];
        for (const key of guestKeys) {
          const guest = await loadInternal('guest', key);
          if (!guest) continue;
          const account = await loadInternal(accountScope, key);
          const merged = mergedGuestSession(guest, account, accountScope);
          await writeOriginalTextAtomically(files, pathFor(accountScope, key), JSON.stringify(merged));
          await files.remove(pathFor('guest', key)).catch(() => {});
          migrated.push(merged);
          const accountKeys = index.sessions[accountScope] ?? [];
          index.sessions[accountScope] = [key, ...accountKeys.filter(value => value !== key)];
          if (index.active?.owner_scope === 'guest' && index.active.key === key) {
            index.active = { owner_scope: accountScope, key };
          }
        }
        index.sessions.guest = (index.sessions.guest ?? []).filter(key => !guestKeys.includes(key));
        await writeIndex(index);
        return migrated;
      });
    },
  };
}
