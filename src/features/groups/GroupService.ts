import { z } from 'zod';
import type { GroupsRepo } from '../../data/repositories/GroupsRepo';
import type { MeetingPointsRepo } from '../../data/repositories/MeetingPointsRepo';
import {
  authorizeInbound,
  authorizeSubscription,
  canPublishPoints,
  InboundKind,
} from '../../domain/groups/authorize';
import {
  buildInviteLink,
  checkInvite,
  generateToken,
  hashToken,
  Invite,
  INVITE_TTL_MS,
  NEARBY_WINDOW_MS,
} from '../../domain/groups/invite';
import {
  nextRev,
  pointsToResend,
  versionFromRemoval,
  versionFromUpdate,
} from '../../domain/groups/merge';
import {
  AckPayloadSchema,
  APP_PROTOCOL,
  Beacon,
  BeaconSchema,
  ClosedEventSchema,
  defaultMemberName,
  Group,
  GroupMember,
  GroupNameSchema,
  HelloPayloadSchema,
  MAX_GROUP_MEMBERS,
  MAX_POINTS_PER_GROUP,
  MAX_SYNC_POINTS,
  MeetingPoint,
  MemberEventSchema,
  MemberNameSchema,
  PointInput,
  PointInputSchema,
  PointPayloadSchema,
  PointRemovedSchema,
  SyncPayloadSchema,
  WelcomeSchema,
  shortAddress,
} from '../../domain/groups/model';
import { createEnvelope, encodeEnvelope, Envelope } from '../../mesh/envelope';
import {
  BEACON_TOPIC,
  GROUP_SERVICE_ID,
  GROUP_SERVICE_VERSION,
  GroupChannel,
  groupTopic,
  MEMBER_CHANNELS,
  NEARBY_TOKEN,
  ORGANIZER_CHANNELS,
  parseGroupTopic,
} from '../../mesh/groupTopics';
import type { PubSub } from '../../mesh/PubSub';
import type { MeshPort, SubscribeRequest, SubscriptionChange } from '../../mesh/types';
import type { Clock } from '../../shared/clock';
import { Emitter, Unsubscribe } from '../../shared/emitter';
import { createLogger } from '../../shared/logger';
import { appError, err, ok, Result } from '../../shared/result';

const log = createLogger('groups');
const RETRY_MS = 60_000;
/** A provider in range that refused or dropped a subscription is asked again at most this often. */
const NEARBY_RETRY_MS = 10_000;
/** The longest a provider out of range waits between attempts (doubling from `RETRY_MS`). */
const MAX_FAR_RETRY_MS = 30 * 60_000;
const POLL_MS = 30_000;
const MAX_DISCOVERY_PEERS = 8;
const STALE_JOINING_MS = 5 * 60_000;
/** How long a joiner keeps asking an organizer that has not answered yet. */
const JOIN_RETRY_WINDOW_MS = 10 * 60_000;
/** SDK reasons meaning "no answer yet", not "no". */
const RETRY_JOIN_REASONS = new Set(['session_timeout', 'no_reply', 'provider_unreachable']);
const NOTICE_CAP = 5;

function withoutKey<T>(o: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
}

/** Why a join attempt ended, from the SDK's `service_subscription_changed` reason. */
function joinEndReason(reason: string): string {
  switch (reason) {
    case 'session_timeout':
    case 'no_reply':
    case 'provider_unreachable':
      return 'the organizer could not be reached. Move closer and try again';
    case 'not_found':
      return "the organizer's mesh is not ready. Ask them to open TrailMesh and try again";
    case 'full':
      return 'the group is full';
    default:
      return 'the organizer did not accept the request';
  }
}

const JoinParamsSchema = z.object({ name: MemberNameSchema });

function nameFromParams(params: string): string | null {
  try {
    const p = JoinParamsSchema.safeParse(JSON.parse(params));
    return p.success ? p.data.name : null;
  } catch {
    return null;
  }
}

export type JoinRequest = {
  subId: string;
  groupId: string;
  groupName: string;
  sender: string;
  /** The name the joiner sent with its request; its claim, shown until its `hello` confirms it. */
  name: string | null;
  nearby: boolean;
  tokenHash: string | null;
  /** The join topic the request came in on; the welcome goes back on it. */
  topic: string;
  at: number;
};

export type DiscoveredGroup = Beacon & { from: string; at: number };

export type Notice = { at: number; text: string };

export type GroupRuntime = {
  joinRequests: JoinRequest[];
  discovered: DiscoveredGroup[];
  /** Organizer: groupId -> when the nearby-join window closes. */
  nearbyUntil: Record<string, number>;
  notices: Notice[];
};

export type GroupServiceDeps = {
  mesh: Pick<MeshPort, 'getSnapshot' | 'subscribe'>;
  pubsub: PubSub;
  groups: GroupsRepo;
  points: MeetingPointsRepo;
  clock: Clock;
  newId: () => string;
  randomBytes: (n: number) => Uint8Array;
  displayName: () => Promise<string>;
};

export type PublishOutcome = { point: MeetingPoint; delivered: boolean };

/**
 * Group management and meeting point sharing over `PubSub` (MESH_PROTOCOL.md section 2.3).
 *
 * Shape: a star around the organizer. Members follow the organizer's `member`, `point` and
 * `point-removed` topics; the organizer follows each member's `member`, `ack` and `sync` topics.
 * Persisted state is canonical; messages are hints. Every inbound message is authorised against
 * local state before it is applied, and applying is idempotent and order independent.
 */
export class GroupService {
  private readonly changes = new Emitter<void>();
  private rt: GroupRuntime = { joinRequests: [], discovered: [], nearbyUntil: {}, notices: [] };
  private chain: Promise<unknown> = Promise.resolve();
  private readonly unsubs: Unsubscribe[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly lastAttempt = new Map<string, number>();
  /**
   * Out-of-range attempts per provider and topic that never became active. Each doubles the wait
   * before the next, so a member that is gone for good (an uninstalled app is a new identity) is
   * not sent four subscribe frames a minute forever; every one the SDK retries and offers to each
   * neighbor. Cleared when the provider is in range or a subscription to it turns active.
   */
  private readonly misses = new Map<string, number>();
  private discovering = false;
  private reconciling = false;
  private dirty = false;
  /** The resume waiting in the queue, if any. Triggers that arrive meanwhile share it. */
  private queuedResume: Promise<void> | null = null;
  /** What resume depends on in the mesh snapshot; other snapshot changes do not schedule one. */
  private lastMeshKey = '';
  /**
   * Organizer: join subscriptions the SDK has admitted and the organizer has not decided on.
   * The SDK admits a valid join request at once, so it cannot expire under its 60 s approval
   * timeout while the card is on screen; the approval itself is this app's (the welcome).
   */
  private readonly held = new Map<string, JoinRequest>();

  constructor(private readonly d: GroupServiceDeps) {}

  getSnapshot = (): GroupRuntime => this.rt;
  subscribeChanges = (fn: () => void): Unsubscribe => this.changes.subscribe(fn);

  private get me(): string | null {
    return this.d.mesh.getSnapshot().localAddress;
  }
  private get running(): boolean {
    return this.d.mesh.getSnapshot().lifecycle === 'running';
  }

  // ---- lifecycle -----------------------------------------------------------------------------

  async start(opts: { poll?: boolean } = {}): Promise<void> {
    if (this.unsubs.length > 0) {
      return;
    }
    this.unsubs.push(
      this.d.pubsub.onMessage('tm/1/*', (env, meta) =>
        this.enqueue(() => this.handleInbound(env, meta.topic, meta.from)),
      ),
      this.d.pubsub.onRequest(r => this.enqueue(() => this.handleRequest(r))),
      this.d.pubsub.onSubscriptionEvent(c => this.enqueue(() => this.handleSubEvent(c))),
      this.d.mesh.subscribe(() => {
        // The snapshot changes on every SDK diagnostic, RSSI reading and link refresh. A resume
        // per change queued them faster than they ran, and a join request waited behind them
        // for longer than the SDK holds it.
        const key = this.meshKey();
        if (key !== this.lastMeshKey) {
          this.lastMeshKey = key;
          if (this.running) {
            void this.scheduleResume();
          }
        }
      }),
    );
    this.lastMeshKey = this.meshKey();
    // A join that never completed before the app was closed cannot be resumed (the token is gone).
    const now = this.d.clock.now();
    for (const g of await this.d.groups.list()) {
      if (g.status === 'joining' && now - g.createdAt > STALE_JOINING_MS) {
        await this.d.groups.purge(g.id);
      }
    }
    if (opts.poll !== false) {
      this.timer = setInterval(() => void this.scheduleResume(), POLL_MS);
    }
    if (this.running) {
      await this.scheduleResume();
    }
  }

  private meshKey(): string {
    const s = this.d.mesh.getSnapshot();
    const nearby = s.peers
      .filter(p => p.state === 'nearby')
      .map(p => p.address)
      .sort()
      .join(',');
    return `${s.lifecycle}|${s.localAddress ?? ''}|${nearby}`;
  }

  /** Queues one resume; triggers that arrive before it starts are folded into it. */
  private scheduleResume(): Promise<void> {
    this.queuedResume ??= this.enqueue(async () => {
      this.queuedResume = null;
      await this.resume();
    }).then(() => undefined);
    return this.queuedResume;
  }

  stop(): void {
    this.unsubs.splice(0).forEach(u => u());
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Resolves when everything queued so far has been handled. Used by tests and shutdown. */
  idle(): Promise<void> {
    return this.enqueue(async () => undefined);
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T | undefined> {
    const next = this.chain.then(job, job).catch(e => {
      log.error(`job failed: ${e instanceof Error ? e.message : String(e)}`);
      return undefined;
    });
    this.chain = next;
    return next as Promise<T | undefined>;
  }

  /** Re-check subscriptions now (also run on every mesh change and on a timer). */
  resumeNow(): Promise<void> {
    return this.scheduleResume();
  }

  /** Ensure the service is provided and every group has its subscriptions. Safe to repeat. */
  private async resume(): Promise<void> {
    if (!this.running) {
      return;
    }
    await this.ensureProviding();
    await this.reconcile();
  }

  private async ensureProviding(): Promise<boolean> {
    if (this.d.pubsub.getSnapshot().providing?.serviceId === GROUP_SERVICE_ID) {
      return true;
    }
    const r = await this.d.pubsub.provide(GROUP_SERVICE_ID, GROUP_SERVICE_VERSION, 'restricted');
    return r.ok;
  }

  // ---- group creation ------------------------------------------------------------------------

  async createGroup(input: { name: string; yourName?: string }): Promise<Result<Group>> {
    const name = GroupNameSchema.safeParse(input.name);
    if (!name.success) {
      return err(appError('groups.invalid_name', 'Give the group a name (up to 60 characters).'));
    }
    const me = this.me;
    if (!me) {
      return err(
        appError('groups.no_identity', 'Start the mesh first so this device has an address.'),
      );
    }
    const yourName = MemberNameSchema.safeParse(input.yourName ?? (await this.d.displayName()));
    if (!yourName.success) {
      return err(appError('groups.invalid_name', 'Enter your name (up to 40 characters).'));
    }
    const now = this.d.clock.now();
    const group: Group = {
      id: this.d.newId(),
      name: name.data,
      organizer: me,
      role: 'organizer',
      status: 'active',
      createdAt: now,
      joinedAt: now,
      memberRev: 0,
    };
    await this.d.groups.save(group);
    const rev = await this.d.groups.nextMemberRev(group.id);
    await this.d.groups.applyMember({
      groupId: group.id,
      address: me,
      name: yourName.data,
      role: 'organizer',
      state: 'active',
      rev,
      updatedAt: now,
    });
    await this.scheduleResume();
    return ok((await this.d.groups.get(group.id)) ?? group);
  }

  // ---- invitations (organizer) ---------------------------------------------------------------

  async createInvite(
    groupId: string,
    opts: { autoApprove?: boolean } = {},
  ): Promise<Result<{ link: string; token: string; expiresAt: number }>> {
    const group = await this.d.groups.get(groupId);
    if (!group || group.role !== 'organizer' || group.status !== 'active' || !this.me) {
      return err(appError('groups.not_organizer', 'Only the organizer can invite people.'));
    }
    const token = generateToken(this.d.randomBytes);
    const now = this.d.clock.now();
    const expiresAt = now + INVITE_TTL_MS;
    await this.d.groups.saveInvite(hashToken(token), groupId, expiresAt, !!opts.autoApprove, now);
    const link = buildInviteLink({
      groupId,
      organizer: group.organizer,
      token,
      groupName: group.name,
    });
    return ok({ link, token, expiresAt });
  }

  async revokeInvites(groupId: string): Promise<void> {
    await this.d.groups.revokeInvites(groupId);
  }

  /** Organizer: let people in range find this group and ask to join. Always needs approval. */
  async openNearby(groupId: string): Promise<Result<number>> {
    const group = await this.d.groups.get(groupId);
    if (!group || group.role !== 'organizer' || group.status !== 'active') {
      return err(appError('groups.not_organizer', 'Only the organizer can open the group.'));
    }
    const until = this.d.clock.now() + NEARBY_WINDOW_MS;
    this.setRt({ nearbyUntil: { ...this.rt.nearbyUntil, [groupId]: until } });
    await this.enqueue(() => this.publishBeacon(group, until));
    return ok(until);
  }

  async closeNearby(groupId: string): Promise<void> {
    const group = await this.d.groups.get(groupId);
    const rest = withoutKey(this.rt.nearbyUntil, groupId);
    this.setRt({ nearbyUntil: rest });
    if (group) {
      await this.enqueue(() => this.publishBeacon(group, this.d.clock.now()));
    }
  }

  private nearbyOpen(groupId: string): boolean {
    return (this.rt.nearbyUntil[groupId] ?? 0) > this.d.clock.now();
  }

  private async publishBeacon(group: Group, until: number): Promise<void> {
    if (!this.running || !this.me) {
      return;
    }
    await this.publish(BEACON_TOPIC, 'beacon', 'beacon', {
      g: group.id,
      n: group.name,
      o: this.me,
      until,
    });
  }

  // ---- joining -------------------------------------------------------------------------------

  async joinFromInvite(invite: Invite): Promise<Result<Group>> {
    return this.startJoin(invite.groupId, invite.groupName, invite.organizer, invite.token);
  }

  async joinNearby(found: DiscoveredGroup): Promise<Result<Group>> {
    return this.startJoin(found.g, found.n, found.o, NEARBY_TOKEN);
  }

  private async startJoin(
    groupId: string,
    groupName: string,
    organizer: string,
    token: string,
  ): Promise<Result<Group>> {
    const me = this.me;
    if (!me || !this.running) {
      return err(appError('groups.mesh_off', 'Start the mesh before joining a group.'));
    }
    if (organizer === me) {
      return err(appError('groups.own_group', 'This is your own group.'));
    }
    if (await this.d.groups.get(groupId)) {
      return err(appError('groups.already_joined', 'You are already in this group.'));
    }
    if (!(await this.ensureProviding())) {
      return err(appError('groups.not_ready', 'The mesh is not ready. Try again.'));
    }
    const group: Group = {
      id: groupId,
      name: groupName,
      organizer,
      role: 'member',
      status: 'joining',
      createdAt: this.d.clock.now(),
      joinedAt: null,
      memberRev: 0,
    };
    await this.d.groups.save(group);
    const sub = await this.d.pubsub.subscribe({
      provider: organizer,
      serviceId: GROUP_SERVICE_ID,
      topic: groupTopic(groupId, GroupChannel.join, token),
      mode: 'latest',
      params: await this.joinParams(),
    });
    if (!sub.ok) {
      await this.d.groups.purge(groupId);
      return err(
        appError('groups.join_failed', 'Could not reach the organizer. Move closer and try again.'),
      );
    }
    this.lastAttempt.set(`${organizer}|${groupId}`, this.d.clock.now());
    return ok(group);
  }

  /**
   * The joiner's name, sent with the join request so the organizer's card can say who is asking.
   * Before this the card showed an address until the joiner's `hello` arrived, after admission.
   */
  private async joinParams(): Promise<string> {
    const name = MemberNameSchema.safeParse(await this.d.displayName());
    return name.success ? JSON.stringify({ name: name.data }) : '';
  }

  /** Joiner: look for groups that organizers have opened to people nearby. */
  async startDiscovery(): Promise<void> {
    this.discovering = true;
    await this.enqueue(() => this.scanBeacons());
  }

  async stopDiscovery(): Promise<void> {
    this.discovering = false;
    for (const s of this.d.pubsub.getSnapshot().subscriptions) {
      if (s.topic === BEACON_TOPIC) {
        await this.d.pubsub.unsubscribe(s.subId);
      }
    }
    this.setRt({ discovered: [] });
  }

  private async scanBeacons(): Promise<void> {
    if (!this.discovering || !this.running) {
      return;
    }
    await this.ensureProviding();
    const peers = this.d.mesh
      .getSnapshot()
      .peers.filter(p => p.state === 'nearby')
      .slice(0, MAX_DISCOVERY_PEERS);
    for (const p of peers) {
      await this.ensureSub(p.address, BEACON_TOPIC);
    }
  }

  // ---- approval (organizer) ------------------------------------------------------------------

  async approveJoin(subId: string): Promise<Result<void>> {
    const req = this.rt.joinRequests.find(r => r.subId === subId);
    if (!req) {
      return err(appError('groups.no_request', 'That request is no longer pending.'));
    }
    this.setRt({ joinRequests: this.rt.joinRequests.filter(r => r.subId !== subId) });
    return (await this.enqueue(() => this.admit(req))) ?? ok(undefined);
  }

  async rejectJoin(subId: string): Promise<void> {
    const req = this.rt.joinRequests.find(r => r.subId === subId);
    this.setRt({ joinRequests: this.rt.joinRequests.filter(r => r.subId !== subId) });
    if (req) {
      await this.enqueue(() => this.refuseHeld(req, 'declined'));
    }
  }

  /** Ends a join subscription the SDK already admitted; the joiner is told it ended. */
  private async refuseHeld(req: JoinRequest, reason: string): Promise<void> {
    this.held.delete(req.subId);
    await this.d.pubsub.endSubscriber(req.subId, reason);
  }

  private async admit(req: JoinRequest): Promise<Result<void>> {
    if (!this.held.has(req.subId)) {
      // The joiner cancelled, walked out of range for good, or the organizer's app restarted.
      this.notice(
        `The request from ${shortAddress(req.sender)} is no longer open. Ask them to try again.`,
      );
      return err(
        appError(
          'groups.request_expired',
          'That request is no longer open. Ask them to try again.',
        ),
      );
    }
    const group = await this.d.groups.get(req.groupId);
    if (!group || group.role !== 'organizer' || group.status !== 'active') {
      await this.refuseHeld(req, 'group closed');
      return err(appError('groups.not_organizer', 'This group is no longer open.'));
    }
    const members = await this.d.groups.members(group.id);
    const existing = members.find(m => m.address === req.sender);
    const active = members.filter(m => m.state === 'active').length;
    if (existing?.state !== 'active' && active >= MAX_GROUP_MEMBERS) {
      await this.refuseHeld(req, 'full');
      return err(appError('groups.full', `A group can have at most ${MAX_GROUP_MEMBERS} members.`));
    }
    this.held.delete(req.subId);
    if (existing?.state !== 'active') {
      const rev = await this.d.groups.nextMemberRev(group.id);
      const m: GroupMember = {
        groupId: group.id,
        address: req.sender,
        name: existing?.name ?? req.name ?? defaultMemberName(req.sender),
        role: 'member',
        state: 'active',
        rev,
        updatedAt: this.d.clock.now(),
      };
      await this.d.groups.applyMember(m);
      await this.publishMember(m);
    }
    if (req.tokenHash) {
      await this.d.groups.markInviteUsed(req.tokenHash, req.sender);
    }
    // The subscription is already admitted, so the welcome reaches the joiner live, or on the
    // reliable ladder; a renewal that has not seen it is sent it again by the SDK.
    await this.publishWelcome(group, req.topic);
    await this.reconcile();
    return ok(undefined);
  }

  private publishWelcome(group: Group, topic: string): Promise<boolean> {
    return this.publish(topic, 'welcome', 'welcome', {
      g: group.id,
      name: group.name,
      o: group.organizer,
      mrev: group.memberRev,
    });
  }

  // ---- leaving / removing --------------------------------------------------------------------

  async leaveGroup(groupId: string): Promise<Result<void>> {
    const group = await this.d.groups.get(groupId);
    if (!group) {
      return ok(undefined);
    }
    await this.enqueue(async () => {
      if (group.role === 'organizer') {
        const rev = await this.d.groups.nextMemberRev(groupId);
        await this.publish(groupTopic(groupId, GroupChannel.member), 'closed', '_group', { rev });
      } else if (this.me && group.status === 'active') {
        await this.publish(groupTopic(groupId, GroupChannel.member), 'leave', this.me, {
          addr: this.me,
        });
      }
      await this.teardown(groupId);
    });
    return ok(undefined);
  }

  async removeMember(groupId: string, address: string): Promise<Result<void>> {
    const group = await this.d.groups.get(groupId);
    if (!group || group.role !== 'organizer' || address === this.me) {
      return err(appError('groups.not_organizer', 'Only the organizer can remove members.'));
    }
    await this.enqueue(async () => {
      const cur = await this.d.groups.member(groupId, address);
      if (!cur || cur.state !== 'active') {
        return;
      }
      const m: GroupMember = {
        ...cur,
        state: 'removed',
        rev: await this.d.groups.nextMemberRev(groupId),
        updatedAt: this.d.clock.now(),
      };
      await this.d.groups.applyMember(m);
      // Tell the removed device first (it still follows us), then cut it off.
      await this.publishMember(m);
      await this.dropMemberSubs(groupId, address);
    });
    return ok(undefined);
  }

  private async teardown(groupId: string): Promise<void> {
    const ps = this.d.pubsub.getSnapshot();
    for (const s of ps.subscriptions) {
      if (s.topic.startsWith(`tm/1/${groupId}/`)) {
        await this.d.pubsub.unsubscribe(s.subId);
      }
    }
    for (const s of ps.subscribers) {
      if (s.topic.startsWith(`tm/1/${groupId}/`)) {
        await this.d.pubsub.endSubscriber(s.subId);
      }
    }
    const rest = withoutKey(this.rt.nearbyUntil, groupId);
    this.setRt({
      nearbyUntil: rest,
      joinRequests: this.rt.joinRequests.filter(r => r.groupId !== groupId),
    });
    await this.d.groups.purge(groupId);
  }

  private async dropMemberSubs(groupId: string, address: string): Promise<void> {
    const ps = this.d.pubsub.getSnapshot();
    for (const s of ps.subscriptions) {
      if (s.provider === address && s.topic.startsWith(`tm/1/${groupId}/`)) {
        await this.d.pubsub.unsubscribe(s.subId);
      }
    }
    for (const s of ps.subscribers) {
      if (s.subscriber === address && s.topic.startsWith(`tm/1/${groupId}/`)) {
        await this.d.pubsub.endSubscriber(s.subId);
      }
    }
  }

  // ---- meeting points (organizer) ------------------------------------------------------------

  async publishPoint(
    groupId: string,
    input: PointInput,
    existingId?: string,
  ): Promise<Result<PublishOutcome>> {
    const group = await this.d.groups.get(groupId);
    const me = this.me;
    if (!me || !canPublishPoints(group, me)) {
      return err(
        appError('groups.not_organizer', 'Only the group organizer can share meeting points.'),
      );
    }
    const parsed = PointInputSchema.safeParse(input);
    if (!parsed.success) {
      return err(appError('groups.invalid_point', 'Check the name, note and position.'));
    }
    const cur = existingId ? await this.d.points.get(groupId, existingId) : null;
    if (existingId && (!cur || cur.deleted)) {
      return err(appError('groups.no_point', 'That meeting point no longer exists.'));
    }
    if (!cur && (await this.d.points.list(groupId)).length >= MAX_POINTS_PER_GROUP) {
      return err(
        appError(
          'groups.too_many_points',
          `A group can have at most ${MAX_POINTS_PER_GROUP} meeting points.`,
        ),
      );
    }
    const now = this.d.clock.now();
    const version = {
      groupId,
      id: cur?.id ?? this.d.newId(),
      rev: nextRev(cur),
      name: parsed.data.name,
      note: parsed.data.note?.length ? parsed.data.note : null,
      lat: parsed.data.lat,
      lon: parsed.data.lon,
      deleted: false,
      createdBy: cur?.createdBy ?? me,
      updatedBy: me,
      createdAt: cur?.createdAt ?? now,
      updatedAt: now,
    };
    const payload = this.pointPayload(version);
    if (!this.fits('point', payload)) {
      return err(appError('groups.point_too_large', 'The name and note are too long to send.'));
    }
    const { point } = await this.d.points.apply(version, now);
    const delivered = (await this.enqueue(() => this.publishPointVersion(point))) ?? false;
    return ok({ point, delivered });
  }

  async removePoint(groupId: string, pointId: string): Promise<Result<PublishOutcome>> {
    const group = await this.d.groups.get(groupId);
    const me = this.me;
    if (!me || !canPublishPoints(group, me)) {
      return err(
        appError('groups.not_organizer', 'Only the group organizer can remove meeting points.'),
      );
    }
    const cur = await this.d.points.get(groupId, pointId);
    if (!cur || cur.deleted) {
      return err(appError('groups.no_point', 'That meeting point no longer exists.'));
    }
    const now = this.d.clock.now();
    const { point } = await this.d.points.apply(
      versionFromRemoval(groupId, { id: pointId, rev: nextRev(cur), by: me, ts: now }, cur),
      now,
    );
    const delivered = (await this.enqueue(() => this.publishPointVersion(point))) ?? false;
    return ok({ point, delivered });
  }

  private pointPayload(p: {
    id: string;
    rev: number;
    name: string;
    note: string | null;
    lat: number;
    lon: number;
    updatedBy: string;
    createdBy: string;
    createdAt: number;
    updatedAt: number;
  }) {
    return {
      id: p.id,
      rev: p.rev,
      name: p.name,
      note: p.note,
      lat: p.lat,
      lon: p.lon,
      by: p.updatedBy,
      createdBy: p.createdBy,
      createdAt: p.createdAt,
      ts: p.updatedAt,
    };
  }

  private fits(type: string, payload: Record<string, unknown>): boolean {
    const env = createEnvelope(
      { type, author: this.me ?? '', payload },
      { clock: this.d.clock, newId: this.d.newId },
    );
    return encodeEnvelope(env).ok;
  }

  private async publishPointVersion(p: MeetingPoint): Promise<boolean> {
    if (p.deleted) {
      return this.publish(groupTopic(p.groupId, GroupChannel.pointRemoved), 'point_removed', p.id, {
        id: p.id,
        rev: p.rev,
        by: p.updatedBy,
        ts: p.updatedAt,
      });
    }
    return this.publish(
      groupTopic(p.groupId, GroupChannel.point),
      'point',
      p.id,
      this.pointPayload(p),
    );
  }

  // ---- acknowledgments and sync (member) -----------------------------------------------------

  async acknowledge(groupId: string, pointId: string): Promise<Result<boolean>> {
    const group = await this.d.groups.get(groupId);
    const p = await this.d.points.get(groupId, pointId);
    if (!group || group.role !== 'member' || !p || p.deleted) {
      return err(appError('groups.no_point', 'That meeting point is not available.'));
    }
    await this.d.points.acknowledge(groupId, pointId, p.rev);
    const sent = (await this.enqueue(() => this.publishAck(groupId, pointId))) ?? false;
    return ok(sent);
  }

  private async publishAck(groupId: string, pointId: string): Promise<boolean> {
    const p = await this.d.points.get(groupId, pointId);
    if (!p || p.ackedRev === 0) {
      return false;
    }
    const sent = await this.publish(groupTopic(groupId, GroupChannel.ack), 'ack', pointId, {
      pointId,
      rev: p.ackedRev,
    });
    if (sent) {
      await this.d.points.markAckPublished(groupId, pointId, p.ackedRev);
    }
    return sent;
  }

  /** Member: ask the organizer for anything this device is missing. Never required for correctness. */
  async requestSync(groupId: string): Promise<boolean> {
    return (await this.enqueue(() => this.publishSync(groupId))) ?? false;
  }

  private async publishSync(groupId: string): Promise<boolean> {
    const group = await this.d.groups.get(groupId);
    if (!group || group.role !== 'member') {
      return false;
    }
    const mine = (await this.d.points.listAll(groupId)).slice(0, MAX_SYNC_POINTS);
    return this.publish(groupTopic(groupId, GroupChannel.sync), 'sync_request', 'sync', {
      mrev: group.memberRev,
      points: mine.map(p => ({ id: p.id, rev: p.rev })),
    });
  }

  // ---- publishing helpers --------------------------------------------------------------------

  /** Resolves true when at least one live subscriber was handed the update. */
  private async publish(
    topic: string,
    type: string,
    key: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    if (!this.running || !(await this.ensureProviding())) {
      return false;
    }
    const r = await this.d.pubsub.publish({ topic, type, key, payload });
    return r.ok && r.value.state === 'sent';
  }

  private publishMember(m: GroupMember): Promise<boolean> {
    return this.publish(
      groupTopic(m.groupId, GroupChannel.member),
      m.state === 'active' ? 'joined' : m.state,
      m.address,
      { addr: m.address, name: m.name, role: m.role, rev: m.rev },
    );
  }

  // ---- inbound -------------------------------------------------------------------------------

  private async handleInbound(env: Envelope, topic: string, from: string): Promise<void> {
    const parsed = parseGroupTopic(topic);
    if (!parsed) {
      return;
    }
    if (parsed.kind === 'beacon') {
      return this.onBeacon(env, from);
    }
    const group = await this.d.groups.get(parsed.groupId);
    const members = group ? await this.d.groups.members(group.id) : [];
    const reject = (reason: string) =>
      log.warn(`rejected ${env.t} on ${parsed.channel} from ${shortAddress(from)}: ${reason}`);
    const gate = (kind: InboundKind, actor?: string) => {
      const d = authorizeInbound({
        kind,
        group,
        members,
        from,
        claimedAuthor: env.a,
        actor,
      });
      if (!d.ok) {
        reject(d.reason);
      }
      return d.ok;
    };
    const now = this.d.clock.now();
    if (!group) {
      return reject('unknown group');
    }

    switch (parsed.channel) {
      case GroupChannel.join: {
        const w = WelcomeSchema.safeParse(env.p);
        if (env.t !== 'welcome' || !w.success || w.data.g !== group.id || w.data.o !== from) {
          return reject('malformed welcome');
        }
        if (group.status !== 'joining') {
          return; // a repeated welcome: already in
        }
        if (!gate('welcome')) {
          return;
        }
        await this.d.groups.save({
          ...group,
          name: w.data.name,
          status: 'active',
          joinedAt: now,
        });
        this.notice(`You joined "${w.data.name}"`);
        // The join topic has done its job; the group's own topics take over.
        await this.dropJoinSubs(group.id);
        await this.reconcile();
        return;
      }
      case GroupChannel.member:
        return group.role === 'organizer'
          ? this.onMemberMessage(env, group, members, from, gate)
          : this.onRosterEvent(env, group, from, gate);
      case GroupChannel.point: {
        const p = PointPayloadSchema.safeParse(env.p);
        if (env.t !== 'point' || !p.success) {
          return reject('malformed point');
        }
        if (!gate('point', p.data.by) || p.data.createdBy !== from) {
          return;
        }
        const { changed, point } = await this.d.points.apply(
          versionFromUpdate(group.id, p.data),
          now,
        );
        if (changed && !point.deleted) {
          this.notice(`Meeting point "${point.name}" ${point.rev > 1 ? 'updated' : 'shared'}`);
        }
        return;
      }
      case GroupChannel.pointRemoved: {
        const r = PointRemovedSchema.safeParse(env.p);
        if (env.t !== 'point_removed' || !r.success) {
          return reject('malformed removal');
        }
        if (!gate('point_removed', r.data.by)) {
          return;
        }
        const cur = await this.d.points.get(group.id, r.data.id);
        const { changed } = await this.d.points.apply(
          versionFromRemoval(group.id, r.data, cur),
          now,
        );
        if (changed && cur && !cur.deleted) {
          this.notice(`Meeting point "${cur.name}" removed`);
        }
        return;
      }
      case GroupChannel.ack: {
        const a = AckPayloadSchema.safeParse(env.p);
        if (env.t !== 'ack' || !a.success) {
          return reject('malformed ack');
        }
        if (!gate('ack')) {
          return;
        }
        const p = await this.d.points.get(group.id, a.data.pointId);
        if (!p || a.data.rev > p.rev) {
          return reject('ack for an unknown point or revision');
        }
        await this.d.points.recordAck({
          groupId: group.id,
          pointId: p.id,
          address: from,
          rev: a.data.rev,
          at: now,
        });
        return;
      }
      case GroupChannel.sync: {
        const s = SyncPayloadSchema.safeParse(env.p);
        if (env.t !== 'sync_request' || !s.success) {
          return reject('malformed sync request');
        }
        if (!gate('sync')) {
          return;
        }
        await this.answerSync(group, members, s.data);
        return;
      }
      default:
        // Unknown channel from a newer app: stored in the inbox by PubSub, otherwise ignored.
        return;
    }
  }

  /** Member: roster events from the organizer. */
  private async onRosterEvent(
    env: Envelope,
    group: Group,
    from: string,
    gate: (k: InboundKind, actor?: string) => boolean,
  ): Promise<void> {
    if (!gate('member_event')) {
      return;
    }
    const now = this.d.clock.now();
    if (env.t === 'closed') {
      const c = ClosedEventSchema.safeParse(env.p);
      if (!c.success) {
        return;
      }
      await this.d.groups.setStatus(group.id, 'closed');
      this.notice(`"${group.name}" was ended by the organizer`);
      await this.dropOrganizerSubs(group);
      return;
    }
    const state =
      env.t === 'joined' ? 'active' : env.t === 'left' || env.t === 'removed' ? env.t : null;
    const e = MemberEventSchema.safeParse(env.p);
    if (!state || !e.success) {
      return;
    }
    if (e.data.role === 'organizer' && e.data.addr !== from) {
      return;
    }
    await this.d.groups.applyMember({
      groupId: group.id,
      address: e.data.addr,
      name: e.data.name,
      role: e.data.role,
      state,
      rev: e.data.rev,
      updatedAt: now,
    });
    if (e.data.addr === this.me && state === 'removed') {
      this.notice(`You were removed from "${group.name}"`);
      await this.teardown(group.id);
    }
  }

  private async dropJoinSubs(groupId: string): Promise<void> {
    for (const s of this.d.pubsub.getSnapshot().subscriptions) {
      if (s.topic.startsWith(`tm/1/${groupId}/${GroupChannel.join}/`)) {
        await this.d.pubsub.unsubscribe(s.subId);
      }
    }
  }

  private async dropOrganizerSubs(group: Group): Promise<void> {
    for (const s of this.d.pubsub.getSnapshot().subscriptions) {
      if (s.provider === group.organizer && s.topic.startsWith(`tm/1/${group.id}/`)) {
        await this.d.pubsub.unsubscribe(s.subId);
      }
    }
  }

  /** Organizer: hello / leave from members. */
  private async onMemberMessage(
    env: Envelope,
    group: Group,
    members: GroupMember[],
    from: string,
    gate: (k: InboundKind, actor?: string) => boolean,
  ): Promise<void> {
    const now = this.d.clock.now();
    const cur = members.find(m => m.address === from);
    if (env.t === 'hello') {
      const h = HelloPayloadSchema.safeParse(env.p);
      if (!h.success || !gate('hello', from) || !cur) {
        return;
      }
      if (cur.name !== h.data.name) {
        const m = {
          ...cur,
          name: h.data.name,
          rev: await this.d.groups.nextMemberRev(group.id),
          updatedAt: now,
        };
        await this.d.groups.applyMember(m);
        await this.publishMember(m);
      }
      return;
    }
    if (env.t === 'leave') {
      if (!gate('leave', from) || !cur) {
        return;
      }
      const m: GroupMember = {
        ...cur,
        state: 'left',
        rev: await this.d.groups.nextMemberRev(group.id),
        updatedAt: now,
      };
      await this.d.groups.applyMember(m);
      await this.publishMember(m);
      await this.dropMemberSubs(group.id, from);
      this.notice(`${cur.name} left "${group.name}"`);
    }
  }

  /** Reply to a sync request by re-publishing what the requester lacks. */
  private async answerSync(
    group: Group,
    members: GroupMember[],
    req: { mrev: number; points: { id: string; rev: number }[] },
  ): Promise<void> {
    for (const m of members.filter(x => x.rev > req.mrev)) {
      await this.publishMember(m);
    }
    const all = await this.d.points.listAll(group.id);
    for (const p of pointsToResend(all, req.points)) {
      await this.publishPointVersion(p);
    }
  }

  private async onBeacon(env: Envelope, from: string): Promise<void> {
    const b = BeaconSchema.safeParse(env.p);
    if (env.t !== 'beacon' || !b.success || b.data.o !== from || env.a !== from) {
      return;
    }
    const now = this.d.clock.now();
    const others = this.rt.discovered.filter(x => x.g !== b.data.g);
    const known = await this.d.groups.get(b.data.g);
    const open = b.data.until > now && !known && b.data.o !== this.me;
    this.setRt({ discovered: open ? [...others, { ...b.data, from, at: now }] : others });
  }

  // ---- subscription requests (this device is the provider) -----------------------------------

  private async handleRequest(r: SubscribeRequest): Promise<void> {
    const parsed = parseGroupTopic(r.topic);
    if (!parsed) {
      await this.d.pubsub.rejectRequest(r.subId);
      return;
    }
    if (parsed.kind === 'beacon') {
      // Always admitted: a beacon is only published while a group is open, so a follower learns
      // nothing until then, and hears the beacon the moment the organizer opens. Refusing it made
      // every joiner nearby subscribe again on each reconcile, crowding the link a join needs.
      await this.d.pubsub.acceptRequest(r.subId);
      return;
    }
    const group = await this.d.groups.get(parsed.groupId);
    if (parsed.channel === GroupChannel.join) {
      return this.handleJoinRequest(r, group, parsed.detail);
    }
    const d = authorizeSubscription({
      channel: parsed.channel,
      group,
      members: group ? await this.d.groups.members(group.id) : [],
      sender: r.sender,
    });
    if (!d.ok) {
      log.warn(
        `refused ${parsed.channel} subscription from ${shortAddress(r.sender)}: ${d.reason}`,
      );
    }
    await (d.ok ? this.d.pubsub.acceptRequest(r.subId) : this.d.pubsub.rejectRequest(r.subId));
  }

  private async handleJoinRequest(
    r: SubscribeRequest,
    group: Group | null,
    token: string | null,
  ): Promise<void> {
    const refuse = async (why: string) => {
      log.warn(`refused join from ${shortAddress(r.sender)}: ${why}`);
      await this.d.pubsub.rejectRequest(r.subId);
    };
    if (!group || group.role !== 'organizer' || group.status !== 'active' || !token) {
      return refuse('not an open group');
    }
    const now = this.d.clock.now();
    let tokenHash: string | null = null;
    let autoApprove = false;
    if (token === NEARBY_TOKEN) {
      if (!this.nearbyOpen(group.id)) {
        return refuse('group is not open to nearby joins');
      }
    } else {
      tokenHash = hashToken(token);
      const invite = await this.d.groups.invite(tokenHash);
      const check = checkInvite(invite, group.id, r.sender, now);
      if (!check.ok) {
        return refuse(`invite ${check.reason}`);
      }
      autoApprove = !!invite?.autoApprove || check.rejoin;
    }
    // Admit the subscription now and decide on the person afterwards. Left with the SDK, the
    // request is rejected after 60 s (approval_timeout), often before the organizer has seen it.
    // Admission gives the joiner nothing: only the welcome is ever published on this topic.
    const accepted = await this.d.pubsub.acceptRequest(r.subId);
    if (!accepted.ok) {
      log.warn(`join request from ${shortAddress(r.sender)} could not be admitted`);
      return;
    }
    const existing = await this.d.groups.member(group.id, r.sender);
    const req: JoinRequest = {
      subId: r.subId,
      groupId: group.id,
      groupName: group.name,
      sender: r.sender,
      name: nameFromParams(r.params),
      nearby: token === NEARBY_TOKEN,
      tokenHash,
      topic: r.topic,
      at: now,
    };
    this.held.set(r.subId, req);
    if (autoApprove || existing?.state === 'active') {
      await this.admit(req);
      return;
    }
    // One card per person: a retried attempt replaces the one it follows, whose subscription the
    // joiner has already given up (its lease lapses on its own).
    const older = this.rt.joinRequests.filter(
      x => x.groupId === req.groupId && x.sender === req.sender && x.subId !== r.subId,
    );
    older.forEach(x => this.held.delete(x.subId));
    this.setRt({
      joinRequests: [
        ...this.rt.joinRequests.filter(x => x.subId !== r.subId && !older.includes(x)),
        req,
      ],
    });
  }

  // ---- subscription lifecycle ----------------------------------------------------------------

  private async handleSubEvent(c: SubscriptionChange): Promise<void> {
    const parsed = parseGroupTopic(c.topic);
    if (!parsed) {
      return;
    }
    if (c.role === 'provider') {
      if (c.state === 'active') {
        await this.pushCurrent(parsed, c);
      } else if (c.state === 'ended') {
        this.held.delete(c.subId);
        this.setRt({ joinRequests: this.rt.joinRequests.filter(r => r.subId !== c.subId) });
      }
      return;
    }
    if (c.state === 'active') {
      const sub = this.d.pubsub.getSnapshot().subscriptions.find(s => s.subId === c.subId);
      this.misses.delete(`${sub?.provider ?? c.peer}|${c.topic}`);
    }
    if (parsed.kind !== 'group') {
      return;
    }
    if (parsed.channel === GroupChannel.join && c.state === 'ended') {
      // Only the attempt still open counts: a cancelled one can report its end after a retry.
      if (!this.d.pubsub.getSnapshot().subscriptions.some(s => s.subId === c.subId)) {
        return;
      }
      await this.d.pubsub.unsubscribe(c.subId);
      const group = await this.d.groups.get(parsed.groupId);
      if (
        group?.status === 'joining' &&
        RETRY_JOIN_REASONS.has(c.reason) &&
        this.d.clock.now() - group.createdAt < JOIN_RETRY_WINDOW_MS
      ) {
        // The SDK gives a subscription 120 s to be answered. Over a slow link (Android replying to
        // an iPhone took 3-4 minutes on devices) the first secure-session handshake alone takes
        // longer, so the attempt ends just before the organizer would see it. The session it
        // started survives, so asking again is a small frame that gets through quickly.
        log.info(`join attempt ended (${c.reason}); asking ${shortAddress(group.organizer)} again`);
        const again = await this.d.pubsub.subscribe({
          provider: group.organizer,
          serviceId: GROUP_SERVICE_ID,
          topic: c.topic,
          mode: 'latest',
          params: await this.joinParams(),
        });
        if (again.ok) {
          return;
        }
      }
      if (group?.status === 'joining') {
        await this.d.groups.purge(group.id);
        this.notice(`Could not join "${group.name}": ${joinEndReason(c.reason)}`);
      }
      return;
    }
    if (c.state === 'active' && parsed.channel === GroupChannel.member) {
      const group = await this.d.groups.get(parsed.groupId);
      if (group?.role === 'member') {
        await this.publishSync(group.id);
      }
      return;
    }
    // Other endings are retried by `reconcile`, rate limited, on the next mesh change or poll.
  }

  /**
   * A follower just became active: hand it the current state. The SDK may send a snapshot of
   * `latest` topics on its own, but nothing here depends on it (replay is unverified on devices).
   */
  private async pushCurrent(
    parsed: NonNullable<ReturnType<typeof parseGroupTopic>>,
    c: SubscriptionChange,
  ): Promise<void> {
    if (parsed.kind === 'beacon') {
      const group = (await this.d.groups.list()).find(g => this.nearbyOpen(g.id));
      if (group) {
        await this.publishBeacon(group, this.rt.nearbyUntil[group.id] ?? 0);
      }
      return;
    }
    const group = await this.d.groups.get(parsed.groupId);
    if (!group) {
      return;
    }
    if (parsed.channel === GroupChannel.join) {
      const members = await this.d.groups.members(group.id);
      if (
        group.role === 'organizer' &&
        members.some(m => m.address === c.peer && m.state === 'active')
      ) {
        await this.publishWelcome(
          group,
          groupTopic(group.id, GroupChannel.join, parsed.detail ?? undefined),
        );
      }
      return;
    }
    if (group.role === 'organizer') {
      if (parsed.channel === GroupChannel.member) {
        for (const m of await this.d.groups.members(group.id)) {
          await this.publishMember(m);
        }
      } else if (
        parsed.channel === GroupChannel.point ||
        parsed.channel === GroupChannel.pointRemoved
      ) {
        for (const p of await this.d.points.listAll(group.id)) {
          if (p.deleted === (parsed.channel === GroupChannel.pointRemoved)) {
            await this.publishPointVersion(p);
          }
        }
      }
      return;
    }
    if (parsed.channel === GroupChannel.member && this.me) {
      await this.publish(groupTopic(group.id, GroupChannel.member), 'hello', this.me, {
        name: await this.d.displayName(),
        appV: APP_PROTOCOL,
      });
    } else if (parsed.channel === GroupChannel.ack) {
      for (const p of await this.d.points.unpublishedAcks(group.id)) {
        await this.publishAck(group.id, p.id);
      }
    }
  }

  // ---- reconciliation ------------------------------------------------------------------------

  /** Make sure each group has the subscriptions it needs. Idempotent; retries are rate limited. */
  private async reconcile(): Promise<void> {
    if (this.reconciling) {
      this.dirty = true;
      return;
    }
    this.reconciling = true;
    try {
      do {
        this.dirty = false;
        if (!this.running || !this.me) {
          return;
        }
        await this.scanBeacons();
        for (const g of await this.d.groups.list()) {
          if (g.status === 'closed') {
            continue;
          }
          if (g.role === 'member' && g.status === 'active') {
            for (const ch of ORGANIZER_CHANNELS) {
              await this.ensureSub(g.organizer, groupTopic(g.id, ch));
            }
          }
          if (g.role === 'organizer') {
            for (const m of await this.d.groups.members(g.id)) {
              if (m.state !== 'active' || m.address === this.me) {
                continue;
              }
              for (const ch of MEMBER_CHANNELS) {
                await this.ensureSub(m.address, groupTopic(g.id, ch));
              }
            }
          }
        }
      } while (this.dirty);
    } finally {
      this.reconciling = false;
    }
  }

  private async ensureSub(provider: string, topic: string): Promise<void> {
    const tracked = this.d.pubsub
      .getSnapshot()
      .subscriptions.find(s => s.provider === provider && s.topic === topic);
    if (tracked && tracked.state !== 'ended') {
      return;
    }
    const key = `${provider}|${topic}`;
    const now = this.d.clock.now();
    const nearby = this.d.mesh
      .getSnapshot()
      .peers.some(p => p.address === provider && p.state === 'nearby');
    // A provider that is not in range may still be reachable over several hops, so try anyway,
    // but not more than once a minute (a pending subscription times out after 120 s). One in range
    // is asked at once the first time; after it ended one (refused, dropped), not straight away
    // again, or every reconcile sends it another subscribe over the same Bluetooth link.
    if (nearby) {
      this.misses.delete(key);
    }
    const missed = this.misses.get(key) ?? 0;
    const wait = !nearby
      ? Math.min(RETRY_MS * 2 ** missed, MAX_FAR_RETRY_MS)
      : tracked
      ? NEARBY_RETRY_MS
      : 0;
    if (now - (this.lastAttempt.get(key) ?? -Infinity) < wait) {
      return;
    }
    this.lastAttempt.set(key, now);
    if (!nearby && tracked) {
      this.misses.set(key, missed + 1);
    }
    if (tracked) {
      await this.d.pubsub.unsubscribe(tracked.subId);
    }
    await this.d.pubsub.subscribe({
      provider,
      serviceId: GROUP_SERVICE_ID,
      topic,
      mode: 'latest',
    });
  }

  // ---- misc ----------------------------------------------------------------------------------

  private notice(text: string): void {
    this.setRt({
      notices: [{ at: this.d.clock.now(), text }, ...this.rt.notices].slice(0, NOTICE_CAP),
    });
  }

  dismissNotices(): void {
    this.setRt({ notices: [] });
  }

  private setRt(patch: Partial<GroupRuntime>): void {
    this.rt = { ...this.rt, ...patch };
    this.changes.emit();
  }
}
