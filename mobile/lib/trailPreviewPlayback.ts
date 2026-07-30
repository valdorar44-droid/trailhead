import type { TrailPreviewKeyframe, TrailPreviewManifest } from './api';

export function isFiniteTrailPreviewCoordinate(
  coordinate?: [number, number] | null,
): coordinate is [number, number] {
  return Array.isArray(coordinate)
    && coordinate.length >= 2
    && Number.isFinite(coordinate[0])
    && Number.isFinite(coordinate[1]);
}

export function normalizeTrailPreviewProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress));
}

export function normalizeTrailPreviewKeyframes(
  manifest: TrailPreviewManifest | null,
): TrailPreviewKeyframe[] {
  return (manifest?.keyframes ?? [])
    .filter(frame => Number.isFinite(frame.progress) && isFiniteTrailPreviewCoordinate(frame.coordinate))
    .map(frame => ({ ...frame, progress: normalizeTrailPreviewProgress(frame.progress) }))
    .sort((a, b) => a.progress - b.progress);
}

function interpolateNumber(a: number, b: number, progress: number): number {
  return a + (b - a) * progress;
}

export function interpolateTrailPreviewBearing(a: number, b: number, progress: number): number {
  const start = ((a % 360) + 360) % 360;
  const end = ((b % 360) + 360) % 360;
  const delta = ((end - start + 540) % 360) - 180;
  return (start + delta * normalizeTrailPreviewProgress(progress) + 360) % 360;
}

export function interpolateTrailPreviewFrame(
  frames: TrailPreviewKeyframe[],
  rawProgress: number,
): TrailPreviewKeyframe | null {
  if (!frames.length) return null;
  const progress = normalizeTrailPreviewProgress(rawProgress);
  if (frames.length === 1 || progress <= frames[0].progress) return frames[0];
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const next = frames[index];
    if (progress > next.progress) continue;
    const span = Math.max(0.0001, next.progress - previous.progress);
    const localProgress = normalizeTrailPreviewProgress((progress - previous.progress) / span);
    const previousBearing = Number(previous.bearing ?? next.bearing ?? 0);
    const nextBearing = Number(next.bearing ?? previous.bearing ?? 0);
    return {
      ...next,
      progress,
      coordinate: [
        interpolateNumber(previous.coordinate[0], next.coordinate[0], localProgress),
        interpolateNumber(previous.coordinate[1], next.coordinate[1], localProgress),
      ],
      look_at: isFiniteTrailPreviewCoordinate(previous.look_at) && isFiniteTrailPreviewCoordinate(next.look_at)
        ? [
          interpolateNumber(previous.look_at[0], next.look_at[0], localProgress),
          interpolateNumber(previous.look_at[1], next.look_at[1], localProgress),
        ]
        : next.look_at,
      bearing: interpolateTrailPreviewBearing(previousBearing, nextBearing, localProgress),
      pitch: interpolateNumber(Number(previous.pitch ?? next.pitch ?? 62), Number(next.pitch ?? previous.pitch ?? 62), localProgress),
      zoom: interpolateNumber(Number(previous.zoom ?? next.zoom ?? 15), Number(next.zoom ?? previous.zoom ?? 15), localProgress),
      cumulative_distance_m: Math.round(interpolateNumber(
        Number(previous.cumulative_distance_m ?? 0),
        Number(next.cumulative_distance_m ?? 0),
        localProgress,
      )),
    };
  }
  return frames[frames.length - 1];
}

export function trailPreviewDurationMs(frames: TrailPreviewKeyframe[]): number {
  return Math.max(5200, frames.reduce(
    (total, frame) => total + Math.max(650, Number(frame.duration_ms ?? 1200)),
    0,
  ));
}

export function trailPreviewProgressFromPointer(locationX: number, width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 0;
  return normalizeTrailPreviewProgress(locationX / width);
}

export function trailPreviewFinishCoordinate(
  manifest: TrailPreviewManifest | null,
): [number, number] | null {
  const coordinates = manifest?.coordinates ?? [];
  const finish = coordinates[coordinates.length - 1];
  return isFiniteTrailPreviewCoordinate(finish) ? finish : null;
}

export function trailPreviewClockLabel(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round((Number.isFinite(milliseconds) ? milliseconds : 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function trailPreviewCardinalDirection(bearing?: number | null): string {
  if (!Number.isFinite(Number(bearing))) return 'N';
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return directions[Math.round((((Number(bearing) % 360) + 360) % 360) / 45) % directions.length];
}
