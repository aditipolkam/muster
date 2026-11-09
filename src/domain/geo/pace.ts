/** Hiking pace and ETA. Flat-ground estimate: no elevation data exists offline yet. */

export const DEFAULT_PACE_KMH = 4;
export const MIN_PACE_KMH = 1;
export const MAX_PACE_KMH = 8;

export function clampPace(kmh: number): number {
  return Number.isFinite(kmh)
    ? Math.min(MAX_PACE_KMH, Math.max(MIN_PACE_KMH, kmh))
    : DEFAULT_PACE_KMH;
}

/** Whole minutes, at least 1; null when the distance is unknown. */
export function etaMinutes(distanceM: number | null, paceKmh: number): number | null {
  if (distanceM === null || !Number.isFinite(distanceM)) {
    return null;
  }
  return Math.max(1, Math.round((distanceM / 1000 / clampPace(paceKmh)) * 60));
}

export function formatEta(min: number | null): string {
  if (min === null) {
    return '-';
  }
  if (min < 60) {
    return `${min} min`;
  }
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export type Units = 'metric' | 'imperial';

const FT_PER_M = 3.28084;
const MI_PER_M = 1 / 1609.344;

export function formatDistanceIn(m: number, units: Units): string {
  if (!Number.isFinite(m)) {
    return '-';
  }
  if (units === 'metric') {
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
  }
  const mi = m * MI_PER_M;
  return mi < 0.1 ? `${Math.round(m * FT_PER_M)} ft` : `${mi.toFixed(mi < 10 ? 2 : 1)} mi`;
}

export function cardinalOf(deg: number): string {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}

/** 16-point compass name ("NNW"), for the navigation instruction. */
export function cardinal16Of(deg: number): string {
  const names = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  return names[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]!;
}

/**
 * Which way to turn from where you face to the target, in plain words. `delta` is the target
 * bearing minus your heading. Within 10° counts as straight ahead.
 */
export function turnHint(delta: number): string {
  const d = ((((delta + 180) % 360) + 360) % 360) - 180;
  const a = Math.round(Math.abs(d) / 5) * 5;
  if (Math.abs(d) <= 10) {
    return 'Straight ahead';
  }
  if (Math.abs(d) >= 170) {
    return 'Turn around';
  }
  return `Turn ${d > 0 ? 'right' : 'left'} about ${a}°`;
}
