import { LatLon } from '../geo';
import { PermissionState, canTrackLocation } from './permission';

export type Fix = {
  lat: number;
  lon: number;
  accM: number;
  altM?: number;
  speedMps?: number;
  headingDeg?: number;
  fixAt: number;
};

export const GPS_LOST_AFTER_MS = 15_000;
export const POOR_ACCURACY_M = 100;

export type GpsStatus =
  | 'unavailable' // no permission / services off
  | 'acquiring' // permitted, no fix yet
  | 'ok'
  | 'poor' // fix exists but accuracy > 100 m
  | 'lost'; // last fix older than 15 s

export function gpsStatus(
  now: number,
  last: Fix | null,
  permission: PermissionState,
  watchingSince: number | null,
): GpsStatus {
  if (!canTrackLocation(permission)) {
    return 'unavailable';
  }
  if (!last) {
    return 'acquiring';
  }
  if (now - last.fixAt > GPS_LOST_AFTER_MS) {
    return 'lost';
  }
  void watchingSince;
  return last.accM > POOR_ACCURACY_M ? 'poor' : 'ok';
}

export function fixToLatLon(f: Fix): LatLon {
  return { lat: f.lat, lon: f.lon };
}

export function describeAccuracy(accM: number): string {
  if (!Number.isFinite(accM)) {
    return 'unknown';
  }
  return `±${Math.round(accM)} m`;
}

/** Heading is only trustworthy when the sensor reports a non-negative value. */
export function usableHeading(h: number | null | undefined): number | undefined {
  return typeof h === 'number' && Number.isFinite(h) && h >= 0 ? h % 360 : undefined;
}
