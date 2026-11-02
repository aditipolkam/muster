import { distanceM } from '../geo';
import type { Fix } from '../location/fix';
import type { TrackPoint } from './model';

export const TRACK_MAX_ACCURACY_M = 50;
/** Nobody hikes faster than this; a faster implied jump is a GPS glitch, not movement. */
export const TRACK_MAX_SPEED_MPS = 15;
export const TRACK_MIN_STEP_M = 8;
export const TRACK_MAX_POINTS = 20_000;

export type TrackState = { last: TrackPoint | null; distanceM: number; count: number };

export const emptyTrack = (): TrackState => ({ last: null, distanceM: 0, count: 0 });

/**
 * Fold one fix into the recorded route. Distance only grows by steps larger than both a floor
 * and the fix's own error, so standing still (GPS drift) records nothing, and jumps are ignored.
 */
export function appendFix(
  s: TrackState,
  f: Fix,
): { state: TrackState; point: TrackPoint | null; addedM: number } {
  if (!Number.isFinite(f.accM) || f.accM > TRACK_MAX_ACCURACY_M) {
    return { state: s, point: null, addedM: 0 };
  }
  const p: TrackPoint = { lat: f.lat, lon: f.lon, at: f.fixAt, accM: f.accM };
  if (!s.last) {
    return { state: { last: p, distanceM: s.distanceM, count: s.count + 1 }, point: p, addedM: 0 };
  }
  const d = distanceM(s.last, p);
  const dt = (p.at - s.last.at) / 1000;
  if (dt <= 0) {
    return { state: s, point: null, addedM: 0 };
  }
  if (d / dt > TRACK_MAX_SPEED_MPS && d > 30) {
    return { state: s, point: null, addedM: 0 };
  }
  if (d < Math.max(TRACK_MIN_STEP_M, Math.min(f.accM, 25))) {
    return { state: s, point: null, addedM: 0 };
  }
  if (s.count >= TRACK_MAX_POINTS) {
    // Stop storing points, keep counting distance.
    return { state: { ...s, last: p, distanceM: s.distanceM + d }, point: null, addedM: d };
  }
  return {
    state: { last: p, distanceM: s.distanceM + d, count: s.count + 1 },
    point: p,
    addedM: d,
  };
}

/** Evenly thin a route for drawing. Always keeps the first and last point. */
export function thinRoute<T>(points: T[], max: number): T[] {
  if (points.length <= max || max < 2) {
    return points;
  }
  const out: T[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    out.push(points[Math.round(i * step)] as T);
  }
  return out;
}
