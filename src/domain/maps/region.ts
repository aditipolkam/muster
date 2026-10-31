import { BBox } from '../geo';

export type RegionState =
  | 'available'
  | 'downloading'
  | 'paused'
  | 'verifying'
  | 'installed'
  | 'failed';

export type RegionSource = 'catalog' | 'import';

export type RegionRecord = {
  id: string;
  name: string;
  bbox: BBox;
  minZoom: number;
  maxZoom: number;
  bytes: number;
  sha256: string | null;
  osmDataDate: string | null;
  schemaV: number;
  state: RegionState;
  progressBytes: number;
  filePath: string | null;
  installedAt: number | null;
  source: RegionSource;
  /** Stable machine code of the last failure, if state === 'failed'. */
  errorCode: string | null;
  sourceUrl: string | null;
};

export type RegionEvent =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'progress' }
  | { type: 'downloaded' }
  | { type: 'verified' }
  | { type: 'fail' }
  | { type: 'retry' }
  | { type: 'interrupted' };

/**
 * available -> downloading -> verifying -> installed | failed
 * downloading <-> paused; failed -> downloading (retry/resume). Invalid transitions return the
 * current state so callers can detect a no-op.
 */
export function nextRegionState(state: RegionState, event: RegionEvent): RegionState {
  switch (state) {
    case 'available':
      return event.type === 'start' ? 'downloading' : state;
    case 'downloading':
      switch (event.type) {
        case 'pause':
          return 'paused';
        case 'downloaded':
          return 'verifying';
        case 'fail':
          return 'failed';
        case 'interrupted':
          return 'paused';
        default:
          return state;
      }
    case 'paused':
      return event.type === 'resume' || event.type === 'start'
        ? 'downloading'
        : event.type === 'fail'
        ? 'failed'
        : state;
    case 'verifying':
      return event.type === 'verified' ? 'installed' : event.type === 'fail' ? 'failed' : state;
    case 'failed':
      return event.type === 'retry' || event.type === 'start' ? 'downloading' : state;
    case 'installed':
      return state;
  }
}

/** Space we must have free before downloading `remainingBytes` (docs/MAP_ARCHITECTURE.md 3.1). */
export function requiredFreeBytes(remainingBytes: number): number {
  return Math.ceil(remainingBytes * 1.2);
}

export function hasEnoughSpace(freeBytes: number, remainingBytes: number): boolean {
  return freeBytes >= requiredFreeBytes(remainingBytes);
}
