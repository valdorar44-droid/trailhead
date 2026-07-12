import * as FileSystem from 'expo-file-system/legacy';
import type { TripRepositoryStorage } from './core';

const ROOT = `${FileSystem.documentDirectory ?? ''}trip_repository_v2/`;

function hasWebStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

function safeReason(reason: string): string {
  return reason.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'record';
}

export class NativeFileTripRepositoryStorage implements TripRepositoryStorage {
  private writeCounter = 0;

  private scopeDirectory(ownerScopeKey: string) {
    return `${ROOT}${ownerScopeKey}/`;
  }

  private statePath(ownerScopeKey: string) {
    return `${this.scopeDirectory(ownerScopeKey)}state.json`;
  }

  private async ensureDirectory(path: string) {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) await FileSystem.makeDirectoryAsync(path, { intermediates: true });
  }

  async read(ownerScopeKey: string): Promise<string | null> {
    const directory = this.scopeDirectory(ownerScopeKey);
    await this.ensureDirectory(directory);
    const primary = this.statePath(ownerScopeKey);
    const backup = `${primary}.bak`;
    const primaryInfo = await FileSystem.getInfoAsync(primary);
    if (primaryInfo.exists) return FileSystem.readAsStringAsync(primary);
    const backupInfo = await FileSystem.getInfoAsync(backup);
    if (!backupInfo.exists) return null;
    const value = await FileSystem.readAsStringAsync(backup);
    await FileSystem.copyAsync({ from: backup, to: primary }).catch(() => {});
    return value;
  }

  async write(ownerScopeKey: string, value: string): Promise<void> {
    const directory = this.scopeDirectory(ownerScopeKey);
    await this.ensureDirectory(directory);
    const primary = this.statePath(ownerScopeKey);
    const backup = `${primary}.bak`;
    this.writeCounter += 1;
    const temporary = `${directory}state.${Date.now()}.${this.writeCounter}.tmp`;
    await FileSystem.writeAsStringAsync(temporary, value, { encoding: FileSystem.EncodingType.UTF8 });
    const verification = await FileSystem.readAsStringAsync(temporary);
    JSON.parse(verification);

    await FileSystem.deleteAsync(backup, { idempotent: true }).catch(() => {});
    const primaryInfo = await FileSystem.getInfoAsync(primary);
    if (primaryInfo.exists) await FileSystem.moveAsync({ from: primary, to: backup });
    try {
      await FileSystem.moveAsync({ from: temporary, to: primary });
      await FileSystem.deleteAsync(backup, { idempotent: true }).catch(() => {});
    } catch (error) {
      const backupInfo = await FileSystem.getInfoAsync(backup).catch(() => null);
      if (backupInfo?.exists) await FileSystem.moveAsync({ from: backup, to: primary }).catch(() => {});
      await FileSystem.deleteAsync(temporary, { idempotent: true }).catch(() => {});
      throw error;
    }
  }

  async preserveCorrupt(ownerScopeKey: string, value: string, reason: string): Promise<string> {
    const directory = `${this.scopeDirectory(ownerScopeKey)}corrupt/`;
    await this.ensureDirectory(directory);
    this.writeCounter += 1;
    const path = `${directory}${Date.now()}-${this.writeCounter}-${safeReason(reason)}.json`;
    await FileSystem.writeAsStringAsync(path, value, { encoding: FileSystem.EncodingType.UTF8 });
    return path;
  }

  async erase(ownerScopeKey: string): Promise<void> {
    await FileSystem.deleteAsync(this.scopeDirectory(ownerScopeKey), { idempotent: true });
  }
}

export class WebTripRepositoryStorage implements TripRepositoryStorage {
  private readonly prefix = 'trailhead_trip_repository_v2';
  private corruptCounter = 0;

  private stateKey(ownerScopeKey: string) {
    return `${this.prefix}:${ownerScopeKey}:state`;
  }

  async read(ownerScopeKey: string): Promise<string | null> {
    return window.localStorage.getItem(this.stateKey(ownerScopeKey));
  }

  async write(ownerScopeKey: string, value: string): Promise<void> {
    window.localStorage.setItem(this.stateKey(ownerScopeKey), value);
  }

  async preserveCorrupt(ownerScopeKey: string, value: string, reason: string): Promise<string> {
    this.corruptCounter += 1;
    const key = `${this.prefix}:${ownerScopeKey}:corrupt:${Date.now()}:${this.corruptCounter}:${safeReason(reason)}`;
    window.localStorage.setItem(key, value);
    return key;
  }

  async erase(ownerScopeKey: string): Promise<void> {
    const scopePrefix = `${this.prefix}:${ownerScopeKey}:`;
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(scopePrefix)) keys.push(key);
    }
    keys.forEach(key => window.localStorage.removeItem(key));
  }
}

export function createDefaultTripRepositoryStorage(): TripRepositoryStorage {
  return hasWebStorage() ? new WebTripRepositoryStorage() : new NativeFileTripRepositoryStorage();
}
