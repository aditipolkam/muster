import { Fix } from '../domain/location/fix';
import { RawPermission } from '../domain/location/permission';

export type WatchOptions = { minIntervalMs: number; minDistanceM: number };
export type Stop = () => void;

/** ARCHITECTURE.md / MAP_ARCHITECTURE.md section 4. Foreground only in Phase 1. */
export interface LocationPort {
  permission(): Promise<RawPermission>;
  requestPermission(): Promise<RawPermission>;
  openSettings(): Promise<void>;
  getCurrentFix(): Promise<Fix | null>;
  watch(opts: WatchOptions, onFix: (f: Fix) => void, onError: (e: unknown) => void): Promise<Stop>;
  watchHeading(onHeading: (trueOrMagneticDeg: number) => void): Promise<Stop>;
}
