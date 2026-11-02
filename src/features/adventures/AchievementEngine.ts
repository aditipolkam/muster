import type { AchievementsRepo, AdventuresRepo } from '../../data/repositories/AdventuresRepo';
import {
  ACHIEVEMENTS,
  AchievementFacts,
  AchievementProgress,
  AdventureFact,
  evaluate,
} from '../../domain/adventures/achievements';
import { elapsedMs } from '../../domain/adventures/lifecycle';
import { SOLO_ADDRESS } from '../../domain/adventures/model';
import { qualifies } from '../../domain/adventures/stats';
import type { Clock } from '../../shared/clock';
import { Emitter, Unsubscribe } from '../../shared/emitter';
import { createLogger } from '../../shared/logger';

const log = createLogger('achievements');
const DEBOUNCE_MS = 400;

export type AchievementRuntime = {
  /** Unlocked since the person last looked; the screens reveal and clear these. */
  fresh: string[];
};

/**
 * Decides which achievements are earned from what is stored on this device and records each unlock
 * once. It reads local records only: nothing is fetched, nothing is assumed about delivery.
 */
export class AchievementEngine {
  private readonly changes = new Emitter<void>();
  private rt: AchievementRuntime = { fresh: [] };
  private unsubs: Unsubscribe[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly d: {
      repo: AdventuresRepo;
      unlocks: AchievementsRepo;
      clock: Clock;
      address: () => string | null;
      /** Extra change sources, e.g. meeting point acknowledgments. */
      sources?: Emitter<unknown>[];
    },
  ) {}

  getSnapshot = (): AchievementRuntime => this.rt;
  subscribeChanges = (fn: () => void): Unsubscribe => this.changes.subscribe(fn);

  start(): void {
    if (this.unsubs.length > 0) {
      return;
    }
    const kick = () => this.schedule();
    this.unsubs.push(this.d.repo.changes.subscribe(kick));
    for (const s of this.d.sources ?? []) {
      this.unsubs.push(s.subscribe(kick));
    }
    this.schedule();
  }

  stop(): void {
    this.unsubs.splice(0).forEach(u => u());
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    if (this.timer) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.evaluateNow();
    }, DEBOUNCE_MS);
  }

  dismissFresh(id: string): void {
    this.rt = { fresh: this.rt.fresh.filter(x => x !== id) };
    this.changes.emit();
  }

  /** Collect the facts, evaluate, store new unlocks. Serialised so two runs cannot double-unlock. */
  evaluateNow(): Promise<AchievementProgress[]> {
    const next = this.chain.then(() => this.run());
    this.chain = next.catch(() => undefined);
    return next.catch(e => {
      log.error(`evaluation failed: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    });
  }

  /** Progress towards every achievement, from the facts as they stand now. */
  async progress(): Promise<AchievementProgress[]> {
    return evaluate(await this.facts());
  }

  async facts(): Promise<AchievementFacts> {
    const me = this.d.address();
    const completed: AdventureFact[] = [];
    for (const a of await this.d.repo.list()) {
      if (a.status !== 'completed' || a.endedAt === null) {
        continue;
      }
      const self = a.groupId ? me : SOLO_ADDRESS;
      if (!self) {
        continue;
      }
      const participants = await this.d.repo.participants(a.id);
      if (a.groupId && participants.find(p => p.address === self)?.state !== 'joined') {
        // Someone else's adventure that this person did not take part in.
        continue;
      }
      const kinds = await this.d.repo.myCompletionKinds(a.id, self);
      const activeMs = elapsedMs(a.progress, a.endedAt);
      completed.push({
        id: a.id,
        groupId: a.groupId,
        endedAt: a.endedAt,
        tzOffsetMin: a.tzOffsetMin,
        joinedCount: a.groupId ? participants.filter(p => p.state === 'joined').length : 1,
        qualifying: qualifies({
          myCheckpoints: kinds.length,
          activeMs,
          distanceM: a.progress.distanceM,
        }),
        summitReached: kinds.includes('summit'),
        offlineMapsCovered: a.progress.offlineMapsCovered === true,
        networkUsed: a.progress.networkUsed,
        activeMs,
      });
    }
    return {
      completed,
      distinctCheckpoints:
        (await this.d.repo.distinctCheckpointsReached(SOLO_ADDRESS)) +
        (me ? await this.d.repo.distinctCheckpointsReached(me) : 0),
      meshExchanged: await this.d.repo.anyMeshExchange(),
      rallyPoint: me ? await this.d.repo.hasRallyPoint(me) : false,
    };
  }

  private async run(): Promise<AchievementProgress[]> {
    const progress = evaluate(await this.facts());
    const known = new Set((await this.d.unlocks.list()).map(u => u.id));
    const fresh: string[] = [];
    for (const p of progress) {
      if (p.met && !known.has(p.id) && ACHIEVEMENTS.some(a => a.id === p.id)) {
        if (await this.d.unlocks.unlock(p.id, this.d.clock.now(), p.evidenceAdventureId)) {
          fresh.push(p.id);
        }
      }
    }
    if (fresh.length > 0) {
      this.rt = { fresh: [...this.rt.fresh, ...fresh] };
      this.changes.emit();
    }
    return progress;
  }
}
