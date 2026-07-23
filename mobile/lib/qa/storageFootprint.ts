import * as FileSystem from 'expo-file-system/legacy';

export async function getActiveTripStateFileBytes(): Promise<number> {
  const root = FileSystem.documentDirectory;
  if (!root) return 0;
  const info = await FileSystem.getInfoAsync(`${root}active_trip.json`).catch(() => null);
  if (!info?.exists || !Number.isFinite(info.size) || info.size <= 0) return 0;
  return Math.trunc(info.size);
}
