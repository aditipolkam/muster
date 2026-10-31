import { Fix } from '../domain/location/fix';
import {
  PermissionState,
  canTrackLocation,
  derivePermissionState,
} from '../domain/location/permission';
import { Clock } from '../shared/clock';
import { createLogger } from '../shared/logger';
import { LocationPort, Stop } from './LocationPort';
import { useLocationStore } from './locationStore';

const log = createLogger('location');
const HEADING_MIN_INTERVAL_MS = 200; // ~5 Hz
const HEADING_MIN_DELTA_DEG = 2;

/** Owns the watch lifecycle and writes the result into the location store. */
export class LocationService {
  private stopFix: Stop | null = null;
  private stopHeading: Stop | null = null;
  private lastHeadingAt = 0;
  private starting: Promise<void> | null = null;

  constructor(private readonly port: LocationPort, private readonly clock: Clock) {}

  private set = useLocationStore.getState().set;

  async refreshPermission(): Promise<PermissionState> {
    const state = derivePermissionState(await this.port.permission());
    this.set({ permission: state });
    return state;
  }

  async requestPermission(): Promise<PermissionState> {
    const state = derivePermissionState(await this.port.requestPermission());
    this.set({ permission: state });
    if (canTrackLocation(state)) {
      await this.start();
    }
    return state;
  }

  openSettings(): Promise<void> {
    return this.port.openSettings();
  }

  /** Idempotent. Starts watching if permission allows; otherwise only refreshes permission. */
  start(): Promise<void> {
    if (this.starting) {
      return this.starting;
    }
    this.starting = this.doStart().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async doStart(): Promise<void> {
    const state = await this.refreshPermission();
    if (!canTrackLocation(state)) {
      this.stop();
      return;
    }
    if (this.stopFix) {
      return;
    }
    this.set({ watchingSince: this.clock.now(), lastError: null });
    try {
      const last = await this.port.getCurrentFix();
      if (last && !useLocationStore.getState().fix) {
        this.set({ fix: last });
      }
      this.stopFix = await this.port.watch(
        { minIntervalMs: 2000, minDistanceM: 1 },
        (f: Fix) => this.set({ fix: f }),
        e => {
          log.warn(`watch error: ${String(e)}`);
          this.set({ lastError: String(e) });
        },
      );
    } catch (e) {
      log.warn(`could not start location watch: ${String(e)}`);
      this.set({ lastError: String(e), watchingSince: null });
    }
    try {
      this.stopHeading = await this.port.watchHeading(deg => {
        const now = this.clock.now();
        const prev = useLocationStore.getState().headingDeg;
        const delta = prev === null ? 360 : Math.abs(((deg - prev + 540) % 360) - 180);
        if (now - this.lastHeadingAt >= HEADING_MIN_INTERVAL_MS && delta >= HEADING_MIN_DELTA_DEG) {
          this.lastHeadingAt = now;
          this.set({ headingDeg: deg });
        }
      });
    } catch (e) {
      log.warn(`heading unavailable: ${String(e)}`);
    }
  }

  stop(): void {
    this.stopFix?.();
    this.stopHeading?.();
    this.stopFix = null;
    this.stopHeading = null;
    this.set({ watchingSince: null });
  }
}
