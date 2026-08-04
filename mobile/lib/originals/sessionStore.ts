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

function hash32(value: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function selectionDigest(
  packId: string,
  version: number,
  selection: NonNullable<OriginalSessionV1['chapter_selection']>,
) {
  const identity = [
    packId,
    String(version),
    selection.validation_selection_id,
    selection.chapter_id,
    selection.variant_id,
  ].join('\u0000');
  return [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
    .map(seed => hash32(identity, seed))
    .join('');
}

function sessionKey(
  packId: string,
  version: number,
  chapterSelection?: OriginalSessionV1['chapter_selection'],
) {
  const base = `${encodeURIComponent(packId)}@${version}`;
  return chapterSelection
    ? `v2~${selectionDigest(packId, version, chapterSelection)}`
    : base;
}

function keyForSession(session: OriginalSessionV1) {
  return sessionKey(session.pack_id, session.version, session.chapter_selection);
}

function scopeKey(scope: OriginalOwnerScope) {
  return encodeURIComponent(scope);
}

function mergedGuestSession(
  guest: OriginalSessionV1,
  account: OriginalSessionV1 | null,
  ownerScope: OriginalOwnerScope,
) {
  const guestSelection = JSON.stringify(guest.chapter_selection ?? null);
  const accountSelection = JSON.stringify(account?.chapter_selection ?? null);
  if (account && guestSelection !== accountSelection) {
    throw new Error('Original chapter progress cannot be merged across selections.');
  }
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
    const key = keyForSession(clean);
    const colliding = await loadInternal(clean.owner_scope, key);
    if (
      colliding
      && JSON.stringify({
        pack_id: colliding.pack_id,
        version: colliding.version,
        selection: colliding.chapter_selection ?? null,
      }) !== JSON.stringify({
        pack_id: clean.pack_id,
        version: clean.version,
        selection: clean.chapter_selection ?? null,
      })
    ) {
      throw new Error('Original chapter session identity collision.');
    }
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

    load(
      ownerScope: OriginalOwnerScope,
      packId: string,
      version: number,
      chapterSelection?: OriginalSessionV1['chapter_selection'],
    ) {
      return serialized(() => loadInternal(ownerScope, sessionKey(packId, version, chapterSelection)));
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
          key: keyForSession(saved),
        };
        await writeIndex(index);
        return saved;
      });
    },

    setActiveIfCurrent(expectedSessionId: string, session: OriginalSessionV1) {
      return serialized(async () => {
        const clean = normalizeOriginalSession(session);
        if (!expectedSessionId || clean.session_id !== expectedSessionId) return null;
        const key = keyForSession(clean);
        const index = await readIndex();
        if (
          !index.active
          || index.active.owner_scope !== clean.owner_scope
          || index.active.key !== key
        ) return null;
        const current = await loadInternal(index.active.owner_scope, index.active.key);
        if (
          !current
          || current.session_id !== expectedSessionId
          || current.status !== 'active'
          || current.user_paused
        ) return null;

        await writeOriginalTextAtomically(files, pathFor(clean.owner_scope, key), JSON.stringify(clean));
        const existing = index.sessions[clean.owner_scope] ?? [];
        index.sessions[clean.owner_scope] = [key, ...existing.filter(value => value !== key)];
        index.active = { owner_scope: clean.owner_scope, key };
        await writeIndex(index);
        return clean;
      });
    },

    loadActive() {
      return serialized(async () => {
        const index = await readIndex();
        if (!index.active) return null;
        return loadInternal(index.active.owner_scope, index.active.key);
      });
    },

    remove(
      ownerScope: OriginalOwnerScope,
      packId: string,
      version: number,
      chapterSelection?: OriginalSessionV1['chapter_selection'],
    ) {
      return serialized(async () => {
        const key = sessionKey(packId, version, chapterSelection);
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
        const scopePath = joinOriginalPath(root, scopeKey(ownerScope));
        await files.remove(scopePath);
        if ((await files.info(scopePath)).exists) {
          throw new Error('The account-owned Original sessions could not be removed.');
        }
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
        const guestKeys: string[] = [];
        for (const candidateKey of index.sessions.guest ?? []) {
          if (!allowedKeys) {
            guestKeys.push(candidateKey);
            continue;
          }
          const candidate = await loadInternal('guest', candidateKey);
          if (candidate && allowedKeys.has(sessionKey(candidate.pack_id, candidate.version))) {
            guestKeys.push(candidateKey);
          }
        }
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
