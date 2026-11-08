import type { AdventuresRepo } from '../../data/repositories/AdventuresRepo';
import type { GroupsRepo } from '../../data/repositories/GroupsRepo';
import { z } from 'zod';
import {
  authorizeAdventureInbound,
  canEditAdventure,
  canPlanGroupAdventure,
  AdventureInboundKind,
  KnownAdventure,
} from '../../domain/adventures/authorize';
import {
  AdventureAction,
  advanceProgress,
  isFinal,
  isRunning,
  transition,
} from '../../domain/adventures/lifecycle';
import { judgeHeader } from '../../domain/adventures/merge';
import {
  Adventure,
  AdventureHeader,
  AdventureHeaderSchema,
  AdventureInput,
  AdventureInputSchema,
  AdventureStatus,
  AdvSyncSchema,
  ArrivalMethod,
  Checkpoint,
  CheckpointInput,
  CheckpointInputSchema,
  CheckpointWire,
  CheckpointWireSchema,
  Completion,
  MAX_CHECKPOINTS,
  MapArea,
  MapAreaWireSchema,
  MAX_COMPLETIONS_PER_ADVENTURE,
  MilestoneSchema,
  Participant,
  ParticipantSchema,
  ParticipantState,
  PersonalProgress,
  placeOf,
  ReachedSchema,
  SOLO_ADDRESS,
  toMapArea,
  toMapAreaWire,
} from '../../domain/adventures/model';
import { areaForBoxes, boxAround } from '../../domain/adventures/area';
import { isPhaseUnlocked, phaseProgress } from '../../domain/adventures/phases';
import { checkpointStatuses } from '../../domain/adventures/stats';
import type { CoverageRegion } from '../../domain/maps/coverage';
import { covers } from '../../domain/maps/coverage';
import { shortAddress } from '../../domain/groups/model';
import { createEnvelope, encodeEnvelope, Envelope } from '../../mesh/envelope';
import {
  GROUP_SERVICE_ID,
  GROUP_SERVICE_VERSION,
  GroupChannel,
  groupTopic,
  parseGroupTopic,
} from '../../mesh/groupTopics';
import type { PubSub } from '../../mesh/PubSub';
import type { MeshPort, SubscriptionChange } from '../../mesh/types';
import type { Clock } from '../../shared/clock';
import { Emitter, Unsubscribe } from '../../shared/emitter';
import { createLogger } from '../../shared/logger';
import { appError, err, ok, Result } from '../../shared/result';

const log = createLogger('adventures');
const POLL_MS = 30_000;
const NOTICE_CAP = 6;
/** Finished adventures newer than this are still pushed to a returning member. */
const RECENT_MS = 7 * 86_400_000;

export type AdventureNotice = { at: number; text: string };

export type CelebrationKind = 'checkpoint' | 'all_checkpoints' | 'adventure_complete';
export type Celebration = {
  id: string;
  kind: CelebrationKind;
  adventureId: string;
  checkpointId?: string;
  at: number;
};

/** The one checkpoint the person is closest to, for a quiet hint on the map. */
export type NearbyHint = {
  adventureId: string;
  checkpointId: string;
  name: string;
  distM: number;
  state: 'approaching' | 'uncertain';
};

export type AdventureRuntime = {
  notices: AdventureNotice[];
  celebrations: Celebration[];
  hint: NearbyHint | null;
};

export type AdventureServiceDeps = {
  repo: AdventuresRepo;
  groups: GroupsRepo;
  mesh: Pick<MeshPort, 'getSnapshot' | 'subscribe'>;
  pubsub: PubSub;
  clock: Clock;
  newId: () => string;
  displayName: () => Promise<string>;
  installedRegions: () => Promise<CoverageRegion[]>;
  /** Minutes behind UTC (Date#getTimezoneOffset). */
  tzOffsetMin: () => number;
};

type Gate = (
  kind: AdventureInboundKind,
  extra?: { actor?: string; adventure?: KnownAdventure | null; checkpointId?: string },
) => boolean;

const defaultProgress = (): PersonalProgress => ({
  resumedAt: null,
  activeMs: 0,
  distanceM: 0,
  offlineMapsCovered: null,
  networkUsed: false,
  meshExchangeAt: null,
  finishedAt: null,
});

/**
 * Adventures: lifecycle, checkpoints, arrivals and, for group adventures, their replication on the
 * `adv` channel of the group service (MESH_PROTOCOL.md "Adventures").
 *
 * Same rules as meeting points. Persisted state is canonical, messages are hints. The group
 * organizer is the single writer of shared state (header, checkpoints); every member writes only
 * their own arrivals and participation, and the organizer relays them. Every inbound message is
 * authorised against local state and applied idempotently, independent of arrival order.
 */
export class AdventureService {
  private readonly changes = new Emitter<void>();
  private rt: AdventureRuntime = { notices: [], celebrations: [], hint: null };
  private chain: Promise<unknown> = Promise.resolve();
  private readonly unsubs: Unsubscribe[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly announced = new Set<string>();

  constructor(private readonly d: AdventureServiceDeps) {}

  getSnapshot = (): AdventureRuntime => this.rt;
  subscribeChanges = (fn: () => void): Unsubscribe => this.changes.subscribe(fn);

  private get me(): string | null {
    return this.d.mesh.getSnapshot().localAddress;
  }
  private get running(): boolean {
    return this.d.mesh.getSnapshot().lifecycle === 'running';
  }

  /** The address that stands for this device inside `adv`. */
  selfFor(adv: Pick<Adventure, 'groupId'>): string | null {
    return adv.groupId ? this.me : SOLO_ADDRESS;
  }

  // ---- lifecycle of the service ----------------------------------------------------------------

  start(opts: { poll?: boolean } = {}): void {
    if (this.unsubs.length > 0) {
      return;
    }
    this.unsubs.push(
      this.d.pubsub.onMessage('tm/1/*', (env, meta) =>
        this.enqueue(() => this.handleInbound(env, meta.topic, meta.from, meta.key)),
      ),
      this.d.pubsub.onSubscriptionEvent(c => this.enqueue(() => this.handleSubEvent(c))),
      this.d.mesh.subscribe(() => {
        if (this.running) {
          void this.enqueue(() => this.flush());
        }
      }),
      this.d.groups.changes.subscribe(() => void this.enqueue(() => this.closeOrphans())),
    );
    void this.enqueue(() => this.closeOrphans());
    if (opts.poll !== false) {
      this.timer = setInterval(() => void this.enqueue(() => this.flush()), POLL_MS);
    }
  }

  stop(): void {
    this.unsubs.splice(0).forEach(u => u());
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Re-send whatever the group owner has not confirmed (also run on mesh changes and a timer). */
  resumeNow(): Promise<void> {
    return this.enqueue(() => this.flush()).then(() => undefined);
  }

  idle(): Promise<void> {
    return this.enqueue(async () => undefined).then(() => undefined);
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T | undefined> {
    const next = this.chain.then(job, job).catch(e => {
      log.error(`job failed: ${e instanceof Error ? e.message : String(e)}`);
      return undefined;
    });
    this.chain = next;
    return next as Promise<T | undefined>;
  }

  // ---- reading helpers -----------------------------------------------------------------------

  async isJoined(adv: Adventure): Promise<boolean> {
    if (!adv.groupId) {
      return true;
    }
    const me = this.me;
    if (!me) {
      return false;
    }
    return (await this.d.repo.participant(adv.id, me))?.state === 'joined';
  }

  /** Adventures whose clock is running for this person right now. */
  async runningAdventures(): Promise<Adventure[]> {
    const out: Adventure[] = [];
    for (const a of await this.d.repo.list()) {
      if (a.status === 'active' && (await this.isJoined(a))) {
        out.push(a);
      }
    }
    return out;
  }

  // ---- creating and editing (shared state) -----------------------------------------------------

  async createAdventure(
    input: AdventureInput,
    opts: {
      groupId?: string;
      /** Plan a group activity as an unpublished draft (organizer only). */
      draft?: boolean;
      ordered?: boolean;
      region?: MapArea | null;
    } = {},
  ): Promise<Result<Adventure>> {
    const parsed = AdventureInputSchema.safeParse(input);
    if (!parsed.success) {
      return err(
        appError('adventures.invalid', 'Give the adventure a name of up to 60 characters.'),
      );
    }
    const me = this.me;
    if (opts.groupId) {
      const group = await this.d.groups.get(opts.groupId);
      if (!canPlanGroupAdventure(group, me)) {
        return err(
          appError(
            'adventures.not_organizer',
            'Only the group organizer plans a group adventure. You can plan your own.',
          ),
        );
      }
    }
    if (opts.draft && !opts.groupId) {
      return err(appError('adventures.solo', 'Activities belong to a group.'));
    }
    if (opts.region && !MapAreaWireSchema.safeParse(toMapAreaWire(opts.region)).success) {
      return err(appError('adventures.invalid_area', 'That map area is too large or empty.'));
    }
    const now = this.d.clock.now();
    const start = parsed.data.start;
    const draft = opts.draft === true;
    const adv: Adventure = {
      id: this.d.newId(),
      groupId: opts.groupId ?? null,
      owner: opts.groupId ? me : null,
      name: parsed.data.name,
      description: parsed.data.description,
      // A draft is revision 0: nothing has been shared yet. Publishing writes revision 1.
      status: draft ? 'draft' : 'planned',
      rev: draft ? 0 : 1,
      activity: draft,
      ordered: draft && opts.ordered === true,
      region: draft ? opts.region ?? null : null,
      startLat: start?.lat ?? null,
      startLon: start?.lon ?? null,
      startLabel: start?.label ?? null,
      createdAt: now,
      startedAt: null,
      endedAt: null,
      tzOffsetMin: this.d.tzOffsetMin(),
      progress: defaultProgress(),
    };
    if (!this.fitsHeader(adv, now)) {
      return err(
        appError('adventures.too_large', 'The name and description are too long to send.'),
      );
    }
    await this.d.repo.save(adv);
    if (draft) {
      return ok(adv); // private: no log entry, no participation, nothing sent
    }
    await this.d.repo.addLog({ adventureId: adv.id, rev: 1, status: 'planned', at: now });
    if (adv.groupId && me) {
      // The organizer who plans it takes part by default; everyone else chooses for themselves.
      await this.d.repo.applyParticipant({
        adventureId: adv.id,
        address: me,
        name: await this.d.displayName(),
        state: 'joined',
        seq: 1,
        pid: this.d.newId(),
        updatedAt: now,
        published: true,
      });
      void this.enqueue(() => this.publishAll(adv.groupId as string, adv.id));
    }
    return ok(adv);
  }

  async updateAdventure(
    id: string,
    input: AdventureInput,
    extra: { ordered?: boolean; region?: MapArea | null } = {},
  ): Promise<Result<Adventure>> {
    const adv = await this.d.repo.get(id);
    const parsed = AdventureInputSchema.safeParse(input);
    if (!adv || isFinal(adv.status)) {
      return err(appError('adventures.closed', 'This adventure can no longer be changed.'));
    }
    if (!parsed.success) {
      return err(
        appError('adventures.invalid', 'Give the adventure a name of up to 60 characters.'),
      );
    }
    if (!(await this.canEdit(adv))) {
      return err(
        appError('adventures.not_organizer', 'Only the organizer can change this adventure.'),
      );
    }
    if (this.isLockedActivity(adv)) {
      return err(this.lockedError());
    }
    if (extra.region && !MapAreaWireSchema.safeParse(toMapAreaWire(extra.region)).success) {
      return err(appError('adventures.invalid_area', 'That map area is too large or empty.'));
    }
    const start = parsed.data.start;
    const draft = adv.status === 'draft';
    const next: Adventure = {
      ...adv,
      name: parsed.data.name,
      description: parsed.data.description,
      startLat: start?.lat ?? null,
      startLon: start?.lon ?? null,
      startLabel: start?.label ?? null,
      ...(draft && extra.ordered !== undefined ? { ordered: extra.ordered } : {}),
      ...(draft && extra.region !== undefined ? { region: extra.region } : {}),
      // A draft has not been shared, so editing it does not make a new revision.
      rev: draft ? adv.rev : adv.rev + 1,
    };
    if (!this.fitsHeader(next, this.d.clock.now())) {
      return err(
        appError('adventures.too_large', 'The name and description are too long to send.'),
      );
    }
    await this.d.repo.save(next);
    if (draft) {
      return ok(next);
    }
    await this.d.repo.addLog({
      adventureId: id,
      rev: next.rev,
      status: next.status,
      at: this.d.clock.now(),
    });
    if (next.groupId) {
      void this.enqueue(() => this.publishHeader(next));
    }
    return ok(next);
  }

  /** A published activity cannot be edited: cancel it and publish a new one. */
  private isLockedActivity(adv: Adventure): boolean {
    return adv.activity === true && adv.status !== 'draft';
  }

  private lockedError() {
    return appError(
      'adventures.published',
      'A published activity cannot be changed. Cancel it and publish a new one.',
    );
  }

  /** Is this adventure's shared state something other devices should hear about? */
  private isShared(adv: Adventure): boolean {
    return adv.groupId !== null && adv.status !== 'draft';
  }

  private async canEdit(adv: Adventure): Promise<boolean> {
    const group = adv.groupId ? await this.d.groups.get(adv.groupId) : null;
    return canEditAdventure(adv, group, this.me);
  }

  async deleteAdventure(id: string): Promise<Result<void>> {
    const adv = await this.d.repo.get(id);
    if (!adv) {
      return ok(undefined);
    }
    if (!isFinal(adv.status) && adv.status !== 'planned' && adv.status !== 'draft') {
      return err(appError('adventures.running', 'Finish or cancel the adventure first.'));
    }
    await this.d.repo.delete(id);
    return ok(undefined);
  }

  // ---- checkpoints -----------------------------------------------------------------------------

  async addCheckpoint(adventureId: string, input: CheckpointInput): Promise<Result<Checkpoint>> {
    const adv = await this.d.repo.get(adventureId);
    const parsed = CheckpointInputSchema.safeParse(input);
    if (!adv || isFinal(adv.status)) {
      return err(appError('adventures.closed', 'This adventure can no longer be changed.'));
    }
    if (!parsed.success) {
      return err(appError('adventures.invalid_checkpoint', 'Check the name and position.'));
    }
    if (!(await this.canEdit(adv))) {
      return err(appError('adventures.not_organizer', 'Only the organizer can add checkpoints.'));
    }
    if (this.isLockedActivity(adv)) {
      return err(this.lockedError());
    }
    if ((await this.d.repo.checkpoints(adventureId)).length >= MAX_CHECKPOINTS) {
      return err(
        appError(
          'adventures.too_many',
          `An adventure can have at most ${MAX_CHECKPOINTS} checkpoints.`,
        ),
      );
    }
    const cp: Checkpoint = {
      adventureId,
      id: this.d.newId(),
      rev: 1,
      ord: await this.d.repo.nextOrd(adventureId),
      name: parsed.data.name,
      description: parsed.data.description,
      kind: parsed.data.kind,
      lat: parsed.data.lat ?? null,
      lon: parsed.data.lon ?? null,
      task: parsed.data.task,
      ...this.phaseOptions(parsed.data),
      deleted: false,
    };
    await this.d.repo.applyCheckpoint(cp);
    if (this.isShared(adv)) {
      void this.enqueue(() => this.publishCheckpoint(adv.groupId as string, cp));
    }
    return ok(cp);
  }

  /** The type, radius, photo rule and map region of a phase from validated input. */
  private phaseOptions(
    d: z.output<typeof CheckpointInputSchema>,
  ): Pick<Checkpoint, 'type' | 'radiusM' | 'requirePhoto' | 'region'> {
    const hasPlace = d.lat != null && d.lon != null;
    return {
      type: d.type,
      radiusM: d.radiusM ?? null,
      // A photo phase is its photo: it cannot be switched off.
      requirePhoto: d.requirePhoto || d.type === 'photo',
      // No region key means "use the default box round the place"; null means "none".
      region: !hasPlace
        ? null
        : d.region === undefined
        ? boxAround({ lat: d.lat as number, lon: d.lon as number })
        : d.region,
    };
  }

  async updateCheckpoint(
    adventureId: string,
    id: string,
    input: CheckpointInput,
  ): Promise<Result<Checkpoint>> {
    const adv = await this.d.repo.get(adventureId);
    const cur = await this.d.repo.checkpoint(adventureId, id);
    const parsed = CheckpointInputSchema.safeParse(input);
    if (!adv || !cur || cur.deleted || isFinal(adv.status)) {
      return err(appError('adventures.closed', 'This checkpoint can no longer be changed.'));
    }
    if (!parsed.success) {
      return err(appError('adventures.invalid_checkpoint', 'Check the name and position.'));
    }
    if (!(await this.canEdit(adv))) {
      return err(
        appError('adventures.not_organizer', 'Only the organizer can change checkpoints.'),
      );
    }
    if (this.isLockedActivity(adv)) {
      return err(this.lockedError());
    }
    const next: Checkpoint = {
      ...cur,
      rev: cur.rev + 1,
      name: parsed.data.name,
      description: parsed.data.description,
      kind: parsed.data.kind,
      lat: parsed.data.lat ?? null,
      lon: parsed.data.lon ?? null,
      task: parsed.data.task,
      ...this.phaseOptions(parsed.data),
    };
    await this.d.repo.applyCheckpoint(next);
    if (this.isShared(adv)) {
      void this.enqueue(() => this.publishCheckpoint(adv.groupId as string, next));
    }
    return ok(next);
  }

  /** Swap a draft phase with its neighbour. Only the organizer's private draft can be reordered. */
  async movePhase(adventureId: string, id: string, direction: -1 | 1): Promise<Result<void>> {
    const adv = await this.d.repo.get(adventureId);
    if (!adv || adv.status !== 'draft') {
      return err(this.lockedError());
    }
    if (!(await this.canEdit(adv))) {
      return err(appError('adventures.not_organizer', 'Only the organizer can reorder phases.'));
    }
    const list = await this.d.repo.checkpoints(adventureId);
    const i = list.findIndex(c => c.id === id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= list.length) {
      return ok(undefined);
    }
    const [a, b] = [list[i] as Checkpoint, list[j] as Checkpoint];
    await this.d.repo.applyCheckpoint({ ...a, ord: b.ord, rev: a.rev + 1 });
    await this.d.repo.applyCheckpoint({ ...b, ord: a.ord, rev: b.rev + 1 });
    return ok(undefined);
  }

  async removeCheckpoint(adventureId: string, id: string): Promise<Result<void>> {
    const adv = await this.d.repo.get(adventureId);
    const cur = await this.d.repo.checkpoint(adventureId, id);
    if (!adv || !cur || cur.deleted || isFinal(adv.status)) {
      return err(appError('adventures.closed', 'This checkpoint can no longer be changed.'));
    }
    if (!(await this.canEdit(adv))) {
      return err(
        appError('adventures.not_organizer', 'Only the organizer can remove checkpoints.'),
      );
    }
    if (this.isLockedActivity(adv)) {
      return err(this.lockedError());
    }
    const next = { ...cur, rev: cur.rev + 1, deleted: true };
    await this.d.repo.applyCheckpoint(next);
    if (this.isShared(adv)) {
      void this.enqueue(() => this.publishCheckpoint(adv.groupId as string, next));
    }
    return ok(undefined);
  }

  // ---- lifecycle -------------------------------------------------------------------------------

  async act(id: string, action: AdventureAction): Promise<Result<Adventure>> {
    let adv = await this.d.repo.get(id);
    if (!adv) {
      return err(appError('adventures.missing', 'That adventure no longer exists.'));
    }
    if (!(await this.canEdit(adv))) {
      return err(
        appError(
          'adventures.not_organizer',
          'The organizer controls the group adventure. You can leave it at any time.',
        ),
      );
    }
    const next = transition(adv.status, action);
    if (!next) {
      return err(
        appError(
          'adventures.bad_transition',
          `You cannot ${action} an adventure that is ${adv.status}.`,
        ),
      );
    }
    if (action === 'publish') {
      const live = await this.d.repo.checkpoints(id);
      if (live.length === 0) {
        return err(appError('adventures.no_phases', 'Add at least one phase before publishing.'));
      }
      // One download for the whole activity: every phase's map region merged.
      const boxes = live.flatMap(c => (c.region ? [c.region] : []));
      if (boxes.length > 0) {
        const area = areaForBoxes(boxes, adv.name);
        if (!area.ok) {
          return err(
            appError(
              'adventures.region_too_wide',
              'The map regions are too far apart for one download. Remove the map region from some phases.',
            ),
          );
        }
        adv = { ...adv, region: area.area };
      }
      if (!(await this.fitsPublished(adv, live))) {
        return err(appError('adventures.too_large', 'Some text is too long to send to the group.'));
      }
      const group = adv.groupId ? await this.d.groups.get(adv.groupId) : null;
      if (!group || group.status !== 'active') {
        return err(appError('adventures.group_closed', 'This group is no longer active.'));
      }
    }
    if (action === 'start' && adv.groupId === null) {
      const others = await this.runningAdventures();
      if (others.some(o => o.groupId === null)) {
        return err(
          appError('adventures.already_running', 'Pause or finish your other adventure first.'),
        );
      }
    }
    const now = this.d.clock.now();
    const joined = await this.isJoined(adv);
    const wasDraft = adv.status === 'draft';
    let updated: Adventure = {
      ...adv,
      status: next,
      // Publishing writes revision 1. Cancelling a draft shares nothing, so no revision either.
      rev: wasDraft ? (action === 'publish' ? 1 : adv.rev) : adv.rev + 1,
      startedAt: adv.startedAt ?? (next === 'active' ? now : null),
      endedAt: isFinal(next) ? now : adv.endedAt,
      progress: advanceProgress(
        adv.progress,
        isRunning(adv.status, joined),
        isRunning(next, joined),
        now,
      ),
    };
    if (isFinal(next)) {
      updated = await this.finalize(updated, joined);
    }
    await this.d.repo.save(updated);
    if (wasDraft && action !== 'publish') {
      return ok(updated); // a cancelled draft was never shared
    }
    await this.d.repo.addLog({ adventureId: id, rev: updated.rev, status: next, at: now });
    if (next === 'completed' && joined) {
      this.celebrate({ kind: 'adventure_complete', adventureId: id });
    }
    if (updated.groupId) {
      const groupId = updated.groupId;
      void this.enqueue(async () => {
        if (action === 'publish') {
          await this.publishAll(groupId, id);
        } else {
          await this.publishHeader(updated);
        }
      });
    }
    return ok(updated);
  }

  /** Would the published header and every phase fit in an envelope? */
  private async fitsPublished(adv: Adventure, phases: Checkpoint[]): Promise<boolean> {
    const now = this.d.clock.now();
    if (!this.fitsHeader({ ...adv, rev: 1, status: 'active' }, now)) {
      return false;
    }
    return phases.every(
      cp =>
        encodeEnvelope(
          createEnvelope(
            { type: 'checkpoint', author: this.me ?? '', payload: this.checkpointPayload(cp) },
            { clock: this.d.clock, newId: this.d.newId },
          ),
        ).ok,
    );
  }

  /** Settle what can only be decided at the end: where the trip ended, and map coverage. */
  private async finalize(adv: Adventure, joined: boolean): Promise<Adventure> {
    // A person who already finished keeps the time zone they finished in.
    const out: Adventure = {
      ...adv,
      tzOffsetMin: adv.progress.finishedAt != null ? adv.tzOffsetMin : this.d.tzOffsetMin(),
    };
    if (joined && adv.status !== 'cancelled') {
      const regions = await this.d.installedRegions();
      const cps = (await this.d.repo.checkpoints(adv.id)).flatMap(c => placeOf(c) ?? []);
      const places =
        adv.startLat !== null && adv.startLon !== null
          ? [{ lat: adv.startLat, lon: adv.startLon }, ...cps]
          : cps;
      out.progress = {
        ...out.progress,
        offlineMapsCovered: places.length > 0 && places.every(p => covers(regions, p)),
      };
    }
    return out;
  }

  // ---- participation (group adventures) --------------------------------------------------------

  async join(id: string): Promise<Result<void>> {
    return this.setParticipation(id, 'joined');
  }

  async leave(id: string): Promise<Result<void>> {
    return this.setParticipation(id, 'left');
  }

  private async setParticipation(id: string, state: ParticipantState): Promise<Result<void>> {
    const adv = await this.d.repo.get(id);
    const me = this.me;
    if (!adv || !adv.groupId || !me) {
      return err(appError('adventures.solo', 'Only group adventures have participants.'));
    }
    if (isFinal(adv.status)) {
      return err(appError('adventures.closed', 'This adventure is over.'));
    }
    if (adv.status === 'draft') {
      return err(appError('adventures.draft', 'Publish the activity before starting it.'));
    }
    const cur = await this.d.repo.participant(id, me);
    if (cur?.state === state) {
      return ok(undefined);
    }
    if (cur?.state === 'done') {
      return err(appError('adventures.finished', 'You already finished this activity.'));
    }
    const now = this.d.clock.now();
    const isOwner = adv.owner === me;
    const p: Participant = {
      adventureId: id,
      address: me,
      name: await this.d.displayName(),
      state,
      seq: (cur?.seq ?? 0) + 1,
      pid: cur?.pid ?? this.d.newId(),
      updatedAt: now,
      published: isOwner,
    };
    await this.d.repo.applyParticipant(p);
    const wasJoined = cur?.state === 'joined';
    await this.d.repo.saveProgress(
      id,
      advanceProgress(
        adv.progress,
        isRunning(adv.status, wasJoined),
        isRunning(adv.status, state === 'joined'),
        now,
      ),
    );
    void this.enqueue(() => this.publishParticipant(adv.groupId as string, p));
    return ok(undefined);
  }

  // ---- arrivals --------------------------------------------------------------------------------

  /**
   * Record that this person reached a checkpoint. Idempotent. Only while the clock is running for
   * them: a paused or finished adventure does not collect arrivals.
   */
  async confirmArrival(
    adventureId: string,
    checkpointId: string,
    method: ArrivalMethod,
  ): Promise<Result<Completion>> {
    const adv = await this.d.repo.get(adventureId);
    const cp = await this.d.repo.checkpoint(adventureId, checkpointId);
    const self = adv ? this.selfFor(adv) : null;
    if (!adv || !cp || cp.deleted || !self) {
      return err(appError('adventures.missing', 'That checkpoint is not available.'));
    }
    const existing = await this.d.repo.completion(adventureId, checkpointId, self);
    if (existing) {
      return ok(existing);
    }
    if (adv.status !== 'active') {
      return err(
        appError('adventures.not_running', 'Start or resume the adventure to mark checkpoints.'),
      );
    }
    if (!(await this.isJoined(adv))) {
      return err(appError('adventures.not_joined', 'Join the adventure to mark checkpoints.'));
    }
    if (cp.requirePhoto && !(await this.d.repo.phaseRecord(adventureId, checkpointId))?.photoUri) {
      return err(appError('adventures.photo_required', 'Add a photo to complete this phase.'));
    }
    if (adv.ordered) {
      const mine = new Set(
        (await this.d.repo.completions(adventureId))
          .filter(x => x.address === self)
          .map(x => x.checkpointId),
      );
      if (!isPhaseUnlocked(true, await this.d.repo.checkpoints(adventureId), mine, checkpointId)) {
        return err(appError('adventures.locked', 'Finish the earlier phases first.'));
      }
    }
    const now = this.d.clock.now();
    const isOwner = !adv.groupId || adv.owner === self;
    const c: Completion = {
      adventureId,
      checkpointId,
      address: self,
      id: this.d.newId(),
      at: now,
      method,
      published: isOwner,
      receivedAt: now,
    };
    await this.d.repo.applyCompletion(c);
    this.setHint(null);
    const statuses = checkpointStatuses(
      await this.d.repo.checkpoints(adventureId),
      await this.d.repo.completions(adventureId),
      await this.d.repo.participants(adventureId),
      self,
    );
    const allMine = statuses.length > 0 && statuses.every(s => s.mine);
    this.celebrate({
      kind: allMine ? 'all_checkpoints' : 'checkpoint',
      adventureId,
      checkpointId,
    });
    if (adv.groupId) {
      void this.enqueue(async () => {
        await this.publishReached(adv.groupId as string, c, adv.owner === self ? self : undefined);
        if (adv.owner === self) {
          await this.maybeAnnounceAll(adv.groupId as string, adventureId, checkpointId);
        }
      });
    }
    if (adv.activity && adv.groupId) {
      await this.finishIfDone(adv, self);
    }
    return ok(c);
  }

  /** What this address last said about taking part (joined, left, done), or null. */
  async participantState(adventureId: string, address: string): Promise<ParticipantState | null> {
    return (await this.d.repo.participant(adventureId, address))?.state ?? null;
  }

  /** This person's own note on a phase. Stays on this phone. */
  async setPhaseNote(adventureId: string, checkpointId: string, note: string): Promise<void> {
    const text = note.trim().slice(0, 280);
    await this.d.repo.savePhaseRecord(
      adventureId,
      checkpointId,
      { note: text.length > 0 ? text : null },
      this.d.clock.now(),
    );
  }

  /** Attach (or remove, with null) this person's photo of a phase. Stays on this phone. */
  async setPhasePhoto(
    adventureId: string,
    checkpointId: string,
    photoUri: string | null,
  ): Promise<void> {
    await this.d.repo.savePhaseRecord(adventureId, checkpointId, { photoUri }, this.d.clock.now());
  }

  /** Activities: the last phase stops this person's own clock and tells the group. */
  private async finishIfDone(adv: Adventure, self: string): Promise<void> {
    const mine = new Set(
      (await this.d.repo.completions(adv.id))
        .filter(x => x.address === self)
        .map(x => x.checkpointId),
    );
    if (!phaseProgress(await this.d.repo.checkpoints(adv.id), mine).finished) {
      return;
    }
    const r = await this.setParticipation(adv.id, 'done');
    if (!r.ok) {
      return;
    }
    // This person's own completion: it counts for their journal, recap and badges whatever the
    // organizer does to the shared activity later.
    const fresh = await this.d.repo.get(adv.id);
    if (fresh) {
      const now = this.d.clock.now();
      const settled = await this.finalize({ ...fresh, status: 'completed' }, true);
      await this.d.repo.save({
        ...fresh,
        tzOffsetMin: settled.tzOffsetMin,
        progress: { ...settled.progress, finishedAt: now },
      });
    }
    this.celebrate({ kind: 'adventure_complete', adventureId: adv.id });
  }

  // ---- signals from the rest of the app --------------------------------------------------------

  /** App code used the network. Any adventure running right now no longer counts as offline. */
  async noteNetworkUse(): Promise<void> {
    const ids = (await this.runningAdventures())
      .filter(a => !a.progress.networkUsed)
      .map(a => a.id);
    await this.d.repo.markNetworkUsed(ids);
  }

  setHint(hint: NearbyHint | null): void {
    const cur = this.rt.hint;
    if (
      cur?.checkpointId === hint?.checkpointId &&
      cur?.state === hint?.state &&
      Math.round((cur?.distM ?? 0) / 10) === Math.round((hint?.distM ?? 0) / 10)
    ) {
      return;
    }
    this.setRt({ hint });
  }

  dismissCelebration(id: string): void {
    this.setRt({ celebrations: this.rt.celebrations.filter(c => c.id !== id) });
  }

  dismissNotices(): void {
    this.setRt({ notices: [] });
  }

  private celebrate(c: Omit<Celebration, 'id' | 'at'>): void {
    const now = this.d.clock.now();
    this.setRt({
      celebrations: [...this.rt.celebrations, { ...c, id: this.d.newId(), at: now }].slice(-5),
    });
  }

  private notice(text: string): void {
    if (this.rt.notices.some(n => n.text === text)) {
      return;
    }
    this.setRt({
      notices: [{ at: this.d.clock.now(), text }, ...this.rt.notices].slice(0, NOTICE_CAP),
    });
  }

  private setRt(patch: Partial<AdventureRuntime>): void {
    this.rt = { ...this.rt, ...patch };
    this.changes.emit();
  }

  // ---- publishing ------------------------------------------------------------------------------

  private async send(
    groupId: string,
    type: string,
    key: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    if (!this.running) {
      return false;
    }
    if (this.d.pubsub.getSnapshot().providing?.serviceId !== GROUP_SERVICE_ID) {
      const p = await this.d.pubsub.provide(GROUP_SERVICE_ID, GROUP_SERVICE_VERSION, 'restricted');
      if (!p.ok) {
        return false;
      }
    }
    const r = await this.d.pubsub.publish({
      topic: groupTopic(groupId, GroupChannel.adv),
      type,
      key,
      payload,
    });
    return r.ok && r.value.state === 'sent';
  }

  private fitsHeader(adv: Adventure, ts: number): boolean {
    const env = createEnvelope(
      { type: 'adventure', author: this.me ?? '', payload: this.headerPayload(adv, ts) },
      { clock: this.d.clock, newId: this.d.newId },
    );
    return encodeEnvelope(env).ok;
  }

  private headerPayload(adv: Adventure, ts: number): Record<string, unknown> {
    return {
      id: adv.id,
      rev: adv.rev,
      name: adv.name,
      desc: adv.description,
      status: adv.status,
      act: adv.activity ? 1 : undefined,
      ord: adv.ordered ? 1 : undefined,
      rg: adv.region ? toMapAreaWire(adv.region) : undefined,
      st:
        adv.startLat !== null && adv.startLon !== null
          ? { lat: adv.startLat, lon: adv.startLon, n: adv.startLabel }
          : null,
      ca: adv.createdAt,
      sa: adv.startedAt,
      ea: adv.endedAt,
      ts,
    };
  }

  private async lastStatusAt(adv: Adventure): Promise<number> {
    const log_ = await this.d.repo.log(adv.id);
    return log_.find(l => l.rev === adv.rev)?.at ?? log_[log_.length - 1]?.at ?? adv.createdAt;
  }

  private async publishHeader(adv: Adventure): Promise<boolean> {
    if (!adv.groupId || adv.owner !== this.me || adv.status === 'draft') {
      return false;
    }
    return this.send(
      adv.groupId,
      'adventure',
      `a-${adv.id}`,
      this.headerPayload(adv, await this.lastStatusAt(adv)),
    );
  }

  private async publishCheckpoint(groupId: string, cp: Checkpoint): Promise<boolean> {
    return this.send(groupId, 'checkpoint', `c-${cp.id}`, this.checkpointPayload(cp));
  }

  private checkpointPayload(cp: Checkpoint): Record<string, unknown> {
    return {
      adv: cp.adventureId,
      id: cp.id,
      rev: cp.rev,
      ord: cp.ord,
      name: cp.name,
      desc: cp.description,
      kind: cp.kind,
      lat: cp.lat ?? undefined,
      lon: cp.lon ?? undefined,
      tx: cp.task ?? undefined,
      ty: cp.type === 'checkpoint' ? undefined : cp.type,
      rd: cp.radiusM ?? undefined,
      rp: cp.requirePhoto ? 1 : undefined,
      del: cp.deleted || undefined,
      ts: this.d.clock.now(),
    };
  }

  /** Member: own arrival to the organizer. Organizer: relay of an arrival (its own or a member's). */
  private async publishReached(
    groupId: string,
    c: Completion,
    relayFor?: string,
  ): Promise<boolean> {
    return this.send(groupId, 'reached', `r-${c.id}`, {
      adv: c.adventureId,
      cp: c.checkpointId,
      id: c.id,
      at: c.at,
      m: c.method,
      addr: relayFor,
    });
  }

  private async publishParticipant(
    groupId: string,
    p: Participant,
    relay = false,
  ): Promise<boolean> {
    const isOwnerSide = relay || (await this.isOrganizerOf(groupId));
    return this.send(groupId, 'participant', `p-${p.pid}`, {
      adv: p.adventureId,
      pid: p.pid,
      state: p.state,
      seq: p.seq,
      ts: p.updatedAt,
      addr: isOwnerSide ? p.address : undefined,
      name: isOwnerSide ? p.name : undefined,
    });
  }

  private async isOrganizerOf(groupId: string): Promise<boolean> {
    const g = await this.d.groups.get(groupId);
    return g?.role === 'organizer';
  }

  /** Organizer: send one adventure's complete shared state. */
  private async publishAll(groupId: string, adventureId: string): Promise<void> {
    const adv = await this.d.repo.get(adventureId);
    if (!adv || adv.owner !== this.me || adv.status === 'draft') {
      return;
    }
    await this.publishHeader(adv);
    // An activity is immutable once published, so a removed phase was a draft-time removal that
    // nobody ever saw: no tombstone needed.
    for (const cp of await this.d.repo.checkpoints(adventureId, !adv.activity)) {
      await this.publishCheckpoint(groupId, cp);
    }
    for (const p of await this.d.repo.participants(adventureId)) {
      await this.publishParticipant(groupId, p, true);
    }
    for (const c of await this.d.repo.completions(adventureId)) {
      await this.publishReached(groupId, c, c.address);
    }
  }

  private async maybeAnnounceAll(groupId: string, adventureId: string, checkpointId: string) {
    const statuses = checkpointStatuses(
      await this.d.repo.checkpoints(adventureId),
      await this.d.repo.completions(adventureId),
      await this.d.repo.participants(adventureId),
      this.me,
    );
    const s = statuses.find(x => x.checkpoint.id === checkpointId);
    if (
      !s?.everyone ||
      s.reachedBy.length < 2 ||
      this.announced.has(`${adventureId}:${checkpointId}`)
    ) {
      return;
    }
    this.announced.add(`${adventureId}:${checkpointId}`);
    await this.send(groupId, 'milestone', `m-${checkpointId}`, {
      adv: adventureId,
      key: 'all_reached',
      cp: checkpointId,
      ts: this.d.clock.now(),
    });
    this.notice(`Everyone has reached ${s.checkpoint.name}`);
  }

  /** Re-send whatever the group owner has not confirmed, and ask for what this device lacks. */
  private async flush(): Promise<void> {
    await this.closeOrphans();
    if (!this.running || !this.me) {
      return;
    }
    for (const g of await this.d.groups.list()) {
      if (g.status !== 'active') {
        continue;
      }
      if (g.role === 'member') {
        await this.resendOwn(g.id);
      }
    }
  }

  /**
   * A group adventure whose group has ended or been left has no owner to run it any more. Close it
   * on this device so the clock stops and nothing is left "active" forever. What was recorded stays.
   */
  private async closeOrphans(): Promise<void> {
    const now = this.d.clock.now();
    for (const a of await this.d.repo.list()) {
      if (!a.groupId || isFinal(a.status)) {
        continue;
      }
      const g = await this.d.groups.get(a.groupId);
      if (g && g.status !== 'closed') {
        continue;
      }
      const joined = await this.isJoined(a);
      const closed: Adventure = {
        ...a,
        status: 'cancelled',
        endedAt: now,
        progress: advanceProgress(a.progress, isRunning(a.status, joined), false, now),
      };
      await this.d.repo.save(closed);
      this.notice(`"${a.name}" was closed because the group ended`);
    }
  }

  private async resendOwn(groupId: string): Promise<void> {
    const me = this.me;
    if (!me) {
      return;
    }
    for (const a of await this.d.repo.list()) {
      if (a.groupId !== groupId || !this.isRecent(a)) {
        continue;
      }
      const p = await this.d.repo.participant(a.id, me);
      if (p && !p.published) {
        await this.publishParticipant(groupId, p);
      }
      for (const c of await this.d.repo.unpublishedCompletions(a.id, me)) {
        await this.publishReached(groupId, c);
      }
    }
  }

  private async requestSync(groupId: string): Promise<void> {
    const advs = (await this.d.repo.list())
      .filter(a => a.groupId === groupId && a.status !== 'draft')
      .slice(0, 6);
    const items = [];
    for (const a of advs) {
      items.push({ id: a.id, rev: a.rev, cc: await this.d.repo.countCompletions(a.id) });
    }
    await this.send(groupId, 'adv_sync', 'sync', { advs: items });
  }

  // ---- subscription events ---------------------------------------------------------------------

  private async handleSubEvent(c: SubscriptionChange): Promise<void> {
    const parsed = parseGroupTopic(c.topic);
    if (
      !parsed ||
      parsed.kind !== 'group' ||
      parsed.channel !== GroupChannel.adv ||
      c.state !== 'active'
    ) {
      return;
    }
    const group = await this.d.groups.get(parsed.groupId);
    if (!group || group.status !== 'active') {
      return;
    }
    if (c.role === 'provider' && group.role === 'organizer') {
      // A member just started following us: hand them the current shared state.
      for (const a of await this.d.repo.list()) {
        if (a.groupId === group.id && a.owner === this.me && this.isRecent(a)) {
          await this.publishAll(group.id, a.id);
        }
      }
    } else if (c.role === 'provider' && group.role === 'member') {
      // The organizer started following us: send what they have not confirmed.
      await this.resendOwn(group.id);
    } else if (c.role === 'consumer' && group.role === 'member') {
      await this.requestSync(group.id);
    }
  }

  private isRecent(a: Adventure): boolean {
    return (
      a.status !== 'draft' &&
      (!isFinal(a.status) || (a.endedAt !== null && this.d.clock.now() - a.endedAt < RECENT_MS))
    );
  }

  // ---- inbound ---------------------------------------------------------------------------------

  /** A group member's message reached this device while an adventure was running. */
  private async noteMeshMessage(groupId: string, from: string): Promise<void> {
    const me = this.me;
    if (!me || from === me) {
      return;
    }
    const sender = await this.d.groups.member(groupId, from);
    const group = await this.d.groups.get(groupId);
    const known = sender?.state === 'active' || group?.organizer === from;
    if (!known || group?.status !== 'active') {
      return;
    }
    const now = this.d.clock.now();
    for (const a of await this.runningAdventures()) {
      if (a.groupId === groupId && (await this.d.repo.markMeshExchange(a.id, now))) {
        this.notice('A message from your group reached you over the mesh');
      }
    }
  }

  private async handleInbound(
    env: Envelope,
    topic: string,
    from: string,
    key: string | null,
  ): Promise<void> {
    const parsed = parseGroupTopic(topic);
    if (!parsed || parsed.kind !== 'group') {
      return;
    }
    await this.noteMeshMessage(parsed.groupId, from);
    if (parsed.channel !== GroupChannel.adv) {
      return;
    }
    const group = await this.d.groups.get(parsed.groupId);
    const members = group ? await this.d.groups.members(group.id) : [];
    const reject = (reason: string) =>
      log.warn(`rejected ${env.t} from ${shortAddress(from)}: ${reason}`);
    const gate: Gate = (kind, extra = {}) => {
      const d = authorizeAdventureInbound({
        kind,
        group,
        members,
        from,
        claimedAuthor: env.a,
        ...extra,
      });
      if (!d.ok) {
        reject(d.reason);
      }
      return d.ok;
    };
    if (!group) {
      return reject('unknown group');
    }
    const keyIs = (expected: string) => {
      if (key !== null && key !== expected) {
        reject('key does not match the payload');
        return false;
      }
      return true;
    };
    if (group.role === 'organizer') {
      return this.onMemberMessage(env, group.id, from, gate, keyIs);
    }
    return this.onOwnerMessage(env, group.id, gate, keyIs);
  }

  /** Member side: shared state and relays from the organizer. */
  private async onOwnerMessage(
    env: Envelope,
    groupId: string,
    gate: Gate,
    keyIs: (k: string) => boolean,
  ): Promise<void> {
    const now = this.d.clock.now();
    switch (env.t) {
      case 'adventure': {
        const h = AdventureHeaderSchema.safeParse(env.p);
        if (!h.success || !keyIs(`a-${h.data.id}`) || !gate('adventure')) {
          return;
        }
        await this.applyHeader(groupId, h.data, now);
        return;
      }
      case 'checkpoint': {
        const w = CheckpointWireSchema.safeParse(env.p);
        if (!w.success || !keyIs(`c-${w.data.id}`) || !gate('checkpoint')) {
          return;
        }
        const existing = await this.d.repo.checkpoints(w.data.adv, true);
        if (existing.length >= MAX_CHECKPOINTS * 2 && !existing.some(c => c.id === w.data.id)) {
          return;
        }
        await this.d.repo.applyCheckpoint(toCheckpoint(w.data));
        return;
      }
      case 'reached': {
        const r = ReachedSchema.safeParse(env.p);
        if (
          !r.success ||
          !keyIs(`r-${r.data.id}`) ||
          !gate('relay_reached', { actor: r.data.addr })
        ) {
          return;
        }
        if ((await this.d.repo.countCompletions(r.data.adv)) >= MAX_COMPLETIONS_PER_ADVENTURE) {
          return;
        }
        const changed = await this.d.repo.applyCompletion({
          adventureId: r.data.adv,
          checkpointId: r.data.cp,
          address: r.data.addr as string,
          id: r.data.id,
          at: r.data.at,
          method: r.data.m,
          // Seen on the organizer's own topic, so for our own arrival this is the confirmation.
          published: true,
          receivedAt: now,
        });
        if (changed && r.data.addr !== this.me) {
          const cp = await this.d.repo.checkpoint(r.data.adv, r.data.cp);
          const who =
            (await this.d.groups.member(groupId, r.data.addr as string))?.name ?? 'Someone';
          if (cp) {
            this.notice(`${who} reached ${cp.name}`);
          }
        }
        return;
      }
      case 'participant': {
        const p = ParticipantSchema.safeParse(env.p);
        if (
          !p.success ||
          !keyIs(`p-${p.data.pid}`) ||
          !gate('relay_participant', { actor: p.data.addr })
        ) {
          return;
        }
        await this.applyRemoteParticipant(p.data, now);
        return;
      }
      case 'milestone': {
        const m = MilestoneSchema.safeParse(env.p);
        if (!m.success || !keyIs(`m-${m.data.cp}`) || !gate('milestone')) {
          return;
        }
        const cp = await this.d.repo.checkpoint(m.data.adv, m.data.cp);
        if (cp) {
          this.notice(`Everyone has reached ${cp.name}`);
        }
        return;
      }
      default:
        // Unknown types from a newer app are stored in the inbox by PubSub and otherwise ignored.
        return;
    }
  }

  /** Organizer side: members' own arrivals, participation and sync requests. */
  private async onMemberMessage(
    env: Envelope,
    groupId: string,
    from: string,
    gate: Gate,
    keyIs: (k: string) => boolean,
  ): Promise<void> {
    const now = this.d.clock.now();
    switch (env.t) {
      case 'reached': {
        const r = ReachedSchema.safeParse(env.p);
        if (!r.success || !keyIs(`r-${r.data.id}`)) {
          return;
        }
        const known = await this.known(r.data.adv, from);
        if (!gate('reached', { actor: r.data.addr, adventure: known, checkpointId: r.data.cp })) {
          return;
        }
        if ((await this.d.repo.countCompletions(r.data.adv)) >= MAX_COMPLETIONS_PER_ADVENTURE) {
          return;
        }
        // Reaching a checkpoint means taking part: record it if the join message has not arrived.
        if (!(await this.d.repo.participant(r.data.adv, from))) {
          const name = (await this.d.groups.member(groupId, from))?.name ?? shortAddress(from);
          await this.d.repo.applyParticipant({
            adventureId: r.data.adv,
            address: from,
            name,
            state: 'joined',
            seq: 1,
            pid: `implicit-${r.data.id}`,
            updatedAt: now,
            published: true,
          });
        }
        const c: Completion = {
          adventureId: r.data.adv,
          checkpointId: r.data.cp,
          address: from,
          id: r.data.id,
          // Never trust a member's clock to put an arrival in the future.
          at: Math.min(r.data.at, now),
          method: r.data.m,
          published: true,
          receivedAt: now,
        };
        const changed = await this.d.repo.applyCompletion(c);
        // Relay even a repeat: the relay is also the sender's confirmation that we have it.
        await this.publishReached(
          groupId,
          (await this.d.repo.completion(c.adventureId, c.checkpointId, from)) ?? c,
          from,
        );
        if (changed) {
          const cp = await this.d.repo.checkpoint(c.adventureId, c.checkpointId);
          const who = (await this.d.groups.member(groupId, from))?.name ?? 'Someone';
          if (cp) {
            this.notice(`${who} reached ${cp.name}`);
          }
          await this.maybeAnnounceAll(groupId, c.adventureId, c.checkpointId);
        }
        return;
      }
      case 'participant': {
        const p = ParticipantSchema.safeParse(env.p);
        if (!p.success || !keyIs(`p-${p.data.pid}`)) {
          return;
        }
        const known = await this.known(p.data.adv, from);
        if (!gate('participant', { actor: p.data.addr, adventure: known })) {
          return;
        }
        const name = (await this.d.groups.member(groupId, from))?.name ?? shortAddress(from);
        const row: Participant = {
          adventureId: p.data.adv,
          address: from,
          name,
          state: p.data.state,
          seq: p.data.seq,
          pid: p.data.pid,
          updatedAt: Math.min(p.data.ts, now),
          published: true,
        };
        const changed = await this.d.repo.applyParticipant(row);
        const cur = (await this.d.repo.participant(p.data.adv, from)) ?? row;
        await this.publishParticipant(groupId, cur, true);
        if (changed) {
          this.notice(`${name} ${p.data.state === 'joined' ? 'joined' : 'left'} the adventure`);
        }
        return;
      }
      case 'adv_sync': {
        const s = AdvSyncSchema.safeParse(env.p);
        if (!s.success || !keyIs('sync') || !gate('adv_sync')) {
          return;
        }
        await this.answerSync(groupId, s.data.advs);
        return;
      }
      default:
        return;
    }
  }

  private async known(adventureId: string, sender: string): Promise<KnownAdventure | null> {
    const a = await this.d.repo.get(adventureId);
    if (!a) {
      return null;
    }
    const live = await this.d.repo.checkpoints(adventureId);
    return {
      groupId: a.groupId,
      owner: a.owner,
      status: a.status,
      liveCheckpointIds: live.map(c => c.id),
      senderState: (await this.d.repo.participant(adventureId, sender))?.state ?? null,
      ordered: a.ordered === true,
      liveCheckpoints: live.map(c => ({ id: c.id, ord: c.ord })),
      senderDoneCheckpointIds: (await this.d.repo.completions(adventureId))
        .filter(c => c.address === sender)
        .map(c => c.checkpointId),
    };
  }

  /** Organizer: answer a returning member with whatever they are missing. */
  private async answerSync(
    groupId: string,
    have: { id: string; rev: number; cc: number }[],
  ): Promise<void> {
    for (const a of await this.d.repo.list()) {
      if (a.groupId !== groupId || a.owner !== this.me || !this.isRecent(a)) {
        continue;
      }
      const theirs = have.find(h => h.id === a.id);
      const same =
        theirs && theirs.rev === a.rev && theirs.cc === (await this.d.repo.countCompletions(a.id));
      if (!same) {
        await this.publishAll(groupId, a.id);
      }
    }
  }

  // ---- applying remote state -------------------------------------------------------------------

  private async applyHeader(groupId: string, h: AdventureHeader, now: number): Promise<void> {
    const cur = await this.d.repo.get(h.id);
    const verdict = judgeHeader(cur, h, groupId);
    if (!verdict.accept) {
      if (verdict.reason !== 'stale') {
        log.warn(`refused adventure update: ${verdict.reason}`);
      }
      return;
    }
    const group = await this.d.groups.get(groupId);
    const joined = cur ? await this.isJoined(cur) : false;
    const status: AdventureStatus = h.status;
    const base = cur ?? {
      id: h.id,
      groupId,
      owner: group?.organizer ?? null,
      createdAt: h.ca,
      tzOffsetMin: this.d.tzOffsetMin(),
      progress: defaultProgress(),
    };
    let progress = base.progress;
    if (cur) {
      const wasRunning = isRunning(cur.status, joined);
      const nowRunning = isRunning(status, joined);
      // Opening a segment starts when this device learned of it; closing is clamped so a late
      // message cannot add time that passed while the adventure was already stopped.
      const at = nowRunning ? now : Math.min(now, Math.max(h.ts, cur.progress.resumedAt ?? h.ts));
      progress = advanceProgress(cur.progress, wasRunning, nowRunning, at);
    }
    let next: Adventure = {
      id: h.id,
      groupId,
      owner: base.owner,
      name: h.name,
      description: h.desc ?? null,
      status,
      rev: h.rev,
      startLat: h.st?.lat ?? null,
      startLon: h.st?.lon ?? null,
      startLabel: h.st?.n ?? null,
      activity: h.act === 1,
      ordered: h.ord === 1,
      region: h.rg ? toMapArea(h.rg) : null,
      createdAt: base.createdAt,
      startedAt: h.sa ?? null,
      endedAt: h.ea ?? null,
      tzOffsetMin: base.tzOffsetMin,
      progress,
    };
    if (isFinal(status)) {
      next = await this.finalize(next, joined);
    }
    await this.d.repo.save(next);
    await this.d.repo.addLog({ adventureId: h.id, rev: h.rev, status, at: h.ts });
    if (!cur) {
      this.notice(`New group adventure: ${h.name}`);
    } else if (cur.status !== status) {
      this.notice(`"${h.name}" is now ${status}`);
      if (status === 'completed' && joined) {
        this.celebrate({ kind: 'adventure_complete', adventureId: h.id });
      }
    }
  }

  private async applyRemoteParticipant(
    p: {
      adv: string;
      pid: string;
      state: ParticipantState;
      seq: number;
      ts: number;
      addr?: string;
      name?: string;
    },
    now: number,
  ): Promise<void> {
    const address = p.addr as string;
    const cur = await this.d.repo.participant(p.adv, address);
    const changed = await this.d.repo.applyParticipant({
      adventureId: p.adv,
      address,
      name: p.name ?? shortAddress(address),
      state: p.state,
      seq: p.seq,
      pid: p.pid,
      updatedAt: Math.min(p.ts, now),
      published: true,
    });
    if (changed && address === this.me) {
      // Our own participation restored from the organizer (e.g. after a reinstall).
      const adv = await this.d.repo.get(p.adv);
      if (adv) {
        await this.d.repo.saveProgress(
          adv.id,
          advanceProgress(
            adv.progress,
            isRunning(adv.status, cur?.state === 'joined'),
            isRunning(adv.status, p.state === 'joined'),
            now,
          ),
        );
      }
    }
  }
}

function toCheckpoint(w: CheckpointWire): Checkpoint {
  return {
    adventureId: w.adv,
    id: w.id,
    rev: w.rev,
    ord: w.ord,
    name: w.name,
    description: w.desc ?? null,
    kind: w.kind,
    lat: w.lat ?? null,
    lon: w.lon ?? null,
    task: w.tx ?? null,
    type: w.ty ?? 'checkpoint',
    radiusM: w.rd ?? null,
    requirePhoto: w.rp === 1,
    region: null,
    deleted: w.del === true,
  };
}
