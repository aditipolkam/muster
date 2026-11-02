import { distanceM, LatLon } from '../geo';
import { Fix, GPS_LOST_AFTER_MS } from '../location/fix';

export const DEFAULT_RADIUS_M = 30;
export const MIN_RADIUS_M = 15;
export const MAX_RADIUS_M = 150;
/** Show a quiet "getting close" hint inside this many radii. Never a prompt to hurry. */
export const APPROACH_FACTOR = 4;
/** Consecutive qualifying fixes, at least this far apart in time, before an arrival is believed. */
export const CONFIRM_FIXES = 2;
export const CONFIRM_MIN_SPAN_MS = 3_000;

export const clampRadius = (m: number): number =>
  Number.isFinite(m)
    ? Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, Math.round(m)))
    : DEFAULT_RADIUS_M;

/** A fix has to be at least as precise as the radius it is judged against (and never worse than 100 m). */
export const accuracyLimit = (radiusM: number): number => Math.min(100, Math.max(radiusM, 20));

export type Proximity =
  /** No usable fix, or the fix is too old to say anything. */
  | { state: 'no_fix' }
  /** A fix exists but its error is larger than the radius: could be anywhere near. */
  | { state: 'uncertain'; distM: number }
  | { state: 'far'; distM: number }
  | { state: 'approaching'; distM: number }
  | { state: 'inside'; distM: number };

export function proximity(input: {
  fix: Fix | null;
  target: LatLon;
  radiusM: number;
  now: number;
}): Proximity {
  const { fix, target, now } = input;
  if (
    !fix ||
    !Number.isFinite(fix.accM) ||
    now - fix.fixAt > GPS_LOST_AFTER_MS ||
    fix.fixAt > now + 5_000
  ) {
    return { state: 'no_fix' };
  }
  const radiusM = clampRadius(input.radiusM);
  const d = distanceM(fix, target);
  // A fix whose error circle is larger than the radius cannot tell "here" from "nearby".
  if (fix.accM > accuracyLimit(radiusM)) {
    return d <= radiusM + fix.accM ? { state: 'uncertain', distM: d } : { state: 'far', distM: d };
  }
  if (d <= radiusM) {
    return { state: 'inside', distM: d };
  }
  return d <= radiusM * APPROACH_FACTOR
    ? { state: 'approaching', distM: d }
    : { state: 'far', distM: d };
}

/** Per-checkpoint debounce: remembers the first and the count of consecutive `inside` readings. */
export type DwellState = { firstAt: number; count: number } | null;

export function stepDwell(
  prev: DwellState,
  p: Proximity,
  at: number,
): { next: DwellState; confirmed: boolean } {
  if (p.state !== 'inside') {
    // Anything else (including a missing fix) breaks the streak: no arrival from scattered spikes.
    return { next: null, confirmed: false };
  }
  const next: DwellState = prev
    ? { firstAt: prev.firstAt, count: prev.count + 1 }
    : { firstAt: at, count: 1 };
  return {
    next,
    confirmed: next.count >= CONFIRM_FIXES && at - next.firstAt >= CONFIRM_MIN_SPAN_MS,
  };
}
