import type { AdventuresRepo } from '../../data/repositories/AdventuresRepo';
import {
  proximity,
  stepDwell,
  DwellState,
  DEFAULT_RADIUS_M,
} from '../../domain/adventures/arrival';
import { Adventure, Checkpoint } from '../../domain/adventures/model';
import { appendFix, emptyTrack, TrackState } from '../../domain/adventures/track';
import type { Fix } from '../../domain/location/fix';
import type { Clock } from '../../shared/clock';
import { Unsubscribe } from '../../shared/emitter';
import { createLogger } from '../../shared/logger';
import type { AdventureService, NearbyHint } from './AdventureService';

const log = createLogger('adventure-tracker');
/** A fix this old is a cached last-known position, not where the person is now. */
const TRACK_MAX_FIX_AGE_MS = 30_000;

export type FixSource = (listener: (fix: Fix | null) => void) => Unsubscribe;

type Running = { adv: Adventure; self: string; cps: Checkpoint[]; done: Set<string> };

/**
 * Turns location fixes into the route, the distance and arrival detection for every adventure
 * whose clock is running. It only reads the fix stream: it starts no extra GPS work, so battery use
 * is whatever the map already costs. Nothing here touches the network, and positions are never
 * logged.
 */
export class AdventureTracker {
  private running: Running[] = [];
  private stale = true;
  private readonly tracks = new Map<string, TrackState>();
  private readonly dwell = new Map<string, DwellState>();
  private unsubs: Unsubscribe[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  private radiusM = DEFAULT_RADIUS_M;

  constructor(
    private readonly d: {
      service: AdventureService;
      repo: AdventuresRepo;
      clock: Clock;
      fixes: FixSource;
      radiusM: () => Promise<number>;
      /** Fires when the radius setting changes. */
      onRadiusChange?: (fn: () => void) => Unsubscribe;
    },
  ) {}

  start(): void {
    if (this.unsubs.length > 0) {
      return;
    }
    this.unsubs.push(
      this.d.repo.changes.subscribe(() => {
        this.stale = true;
      }),
      this.d.fixes(fix => {
        if (fix) {
          void this.onFix(fix);
        }
      }),
    );
    if (this.d.onRadiusChange) {
      this.unsubs.push(this.d.onRadiusChange(() => void this.loadRadius()));
    }
    void this.loadRadius();
  }

  stop(): void {
    this.unsubs.splice(0).forEach(u => u());
  }

  private async loadRadius(): Promise<void> {
    this.radiusM = await this.d.radiusM();
  }

  /** Resolves when the fix has been processed. Fixes are handled strictly one after another. */
  onFix(fix: Fix): Promise<void> {
    const next = this.chain
      .then(() => this.process(fix))
      .catch(e => {
        log.error(`fix failed: ${e instanceof Error ? e.message : String(e)}`);
      });
    this.chain = next;
    return next;
  }

  private async refresh(): Promise<void> {
    if (!this.stale) {
      return;
    }
    this.stale = false;
    const out: Running[] = [];
    for (const adv of await this.d.service.runningAdventures()) {
      const self = this.d.service.selfFor(adv);
      if (!self) {
        continue;
      }
      const cps = await this.d.repo.checkpoints(adv.id);
      const done = new Set(
        (await this.d.repo.completions(adv.id))
          .filter(c => c.address === self)
          .map(c => c.checkpointId),
      );
      out.push({ adv, self, cps, done });
    }
    this.running = out;
    const live = new Set(out.map(r => r.adv.id));
    for (const id of [...this.tracks.keys()]) {
      if (!live.has(id)) {
        // Paused or finished: the next segment starts a fresh leg instead of joining the gap.
        this.tracks.delete(id);
      }
    }
  }

  private async process(fix: Fix): Promise<void> {
    await this.refresh();
    const now = this.d.clock.now();
    let hint: NearbyHint | null = null;
    for (const r of this.running) {
      if (now - fix.fixAt <= TRACK_MAX_FIX_AGE_MS) {
        let prev = this.tracks.get(r.adv.id) ?? emptyTrack();
        // A new running segment starts a new leg, so the time off the clock never becomes a line.
        if (
          prev.last &&
          r.adv.progress.resumedAt !== null &&
          prev.last.at <= r.adv.progress.resumedAt
        ) {
          prev = emptyTrack();
        }
        const res = appendFix(prev, fix);
        this.tracks.set(r.adv.id, res.state);
        if (res.point) {
          await this.d.repo.appendTrack(r.adv.id, res.point);
        }
        if (res.addedM > 0) {
          await this.d.repo.addDistance(r.adv.id, res.addedM);
        }
      }
      for (const cp of r.cps) {
        if (r.done.has(cp.id)) {
          continue;
        }
        const key = `${r.adv.id}:${cp.id}`;
        const prox = proximity({ fix, target: cp, radiusM: this.radiusM, now });
        const step = stepDwell(this.dwell.get(key) ?? null, prox, now);
        if (step.next) {
          this.dwell.set(key, step.next);
        } else {
          this.dwell.delete(key);
        }
        if (step.confirmed) {
          const res = await this.d.service.confirmArrival(r.adv.id, cp.id, 'auto');
          if (res.ok) {
            r.done.add(cp.id);
            this.dwell.delete(key);
          }
          continue;
        }
        if (prox.state === 'approaching' || prox.state === 'inside' || prox.state === 'uncertain') {
          if (!hint || prox.distM < hint.distM) {
            hint = {
              adventureId: r.adv.id,
              checkpointId: cp.id,
              name: cp.name,
              distM: prox.distM,
              state: prox.state === 'uncertain' ? 'uncertain' : 'approaching',
            };
          }
        }
      }
    }
    this.d.service.setHint(hint);
  }
}
