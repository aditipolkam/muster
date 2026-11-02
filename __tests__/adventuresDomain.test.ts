import {
  ACHIEVEMENTS,
  AchievementFacts,
  AdventureFact,
  evaluate,
  weekendKey,
} from '../src/domain/adventures/achievements';
import {
  DEFAULT_RADIUS_M,
  accuracyLimit,
  clampRadius,
  proximity,
  stepDwell,
  DwellState,
} from '../src/domain/adventures/arrival';
import { authorizeAdventureInbound, KnownAdventure } from '../src/domain/adventures/authorize';
import {
  actionsFor,
  advanceProgress,
  elapsedMs,
  isAcceptableRemoteStatus,
  isRunning,
  transition,
} from '../src/domain/adventures/lifecycle';
import {
  judgeHeader,
  mergeCheckpoint,
  mergeCompletion,
  mergeParticipant,
} from '../src/domain/adventures/merge';
import {
  ADVENTURE_STATUSES,
  AdventureHeaderSchema,
  Adventure,
  Checkpoint,
  CheckpointWireSchema,
  Completion,
  Participant,
} from '../src/domain/adventures/model';
import {
  buildRecap,
  buildTimeline,
  checkpointStatuses,
  nextCheckpoint,
  progressCounts,
  progressLabel,
  qualifies,
} from '../src/domain/adventures/stats';
import { appendFix, emptyTrack, thinRoute, TRACK_MAX_POINTS } from '../src/domain/adventures/track';
import { destination } from '../src/domain/geo';
import type { Group, GroupMember } from '../src/domain/groups/model';
import { createEnvelope, encodeEnvelope } from '../src/mesh/envelope';

const HERE = { lat: 46.8, lon: 8.2 };
const fix = (p: { lat: number; lon: number }, at: number, accM = 5) => ({ ...p, accM, fixAt: at });

describe('lifecycle', () => {
  it('follows Planned -> Active <-> Paused -> Completed, with cancel from any open state', () => {
    expect(transition('planned', 'start')).toBe('active');
    expect(transition('active', 'pause')).toBe('paused');
    expect(transition('paused', 'resume')).toBe('active');
    expect(transition('active', 'complete')).toBe('completed');
    expect(transition('paused', 'complete')).toBe('completed');
    for (const s of ['planned', 'active', 'paused'] as const) {
      expect(transition(s, 'cancel')).toBe('cancelled');
    }
  });

  it('rejects every move the lifecycle does not have', () => {
    expect(transition('planned', 'complete')).toBeNull();
    expect(transition('planned', 'pause')).toBeNull();
    expect(transition('active', 'start')).toBeNull();
    expect(transition('active', 'resume')).toBeNull();
    expect(transition('completed', 'resume')).toBeNull();
    expect(actionsFor('completed')).toEqual([]);
    expect(actionsFor('cancelled')).toEqual([]);
  });

  it('a remote status may skip steps but never leave a final status or go back to planned', () => {
    expect(isAcceptableRemoteStatus('planned', 'paused')).toBe(true);
    expect(isAcceptableRemoteStatus('planned', 'completed')).toBe(true);
    expect(isAcceptableRemoteStatus('active', 'cancelled')).toBe(true);
    expect(isAcceptableRemoteStatus('paused', 'active')).toBe(true);
    for (const to of ADVENTURE_STATUSES) {
      if (to !== 'completed') {
        expect(isAcceptableRemoteStatus('completed', to)).toBe(false);
      }
      if (to !== 'cancelled') {
        expect(isAcceptableRemoteStatus('cancelled', to)).toBe(false);
      }
    }
    expect(isAcceptableRemoteStatus('active', 'planned')).toBe(false);
  });

  it('pausing and resting never cost time already counted, and only running time counts', () => {
    const p0 = {
      resumedAt: null,
      activeMs: 0,
      distanceM: 0,
      offlineMapsCovered: null,
      networkUsed: false,
      meshExchangeAt: null,
    };
    const running = advanceProgress(p0, false, true, 1_000);
    expect(elapsedMs(running, 61_000)).toBe(60_000);
    const paused = advanceProgress(running, true, false, 61_000);
    expect(paused.activeMs).toBe(60_000);
    // A long break does not change the total.
    expect(elapsedMs(paused, 10_000_000)).toBe(60_000);
    const again = advanceProgress(paused, false, true, 100_000);
    expect(elapsedMs(again, 130_000)).toBe(90_000);
  });

  it('is running only when active AND joined', () => {
    expect(isRunning('active', true)).toBe(true);
    expect(isRunning('active', false)).toBe(false);
    expect(isRunning('paused', true)).toBe(false);
  });
});

describe('arrival detection', () => {
  const target = HERE;
  const NOW = 1_000_000;

  it('a good fix inside the radius is inside; outside is approaching, then far', () => {
    expect(proximity({ fix: fix(target, NOW), target, radiusM: 30, now: NOW }).state).toBe(
      'inside',
    );
    const near = destination(target, 90, 80);
    expect(proximity({ fix: fix(near, NOW), target, radiusM: 30, now: NOW }).state).toBe(
      'approaching',
    );
    const far = destination(target, 90, 500);
    expect(proximity({ fix: fix(far, NOW), target, radiusM: 30, now: NOW }).state).toBe('far');
  });

  it('a poor fix never counts as inside, even right on top of the checkpoint', () => {
    const p = proximity({ fix: fix(target, NOW, 80), target, radiusM: 30, now: NOW });
    expect(p.state).toBe('uncertain');
    expect(accuracyLimit(30)).toBe(30);
    expect(accuracyLimit(15)).toBe(20);
    expect(accuracyLimit(500)).toBe(100);
  });

  it('a poor fix far from the checkpoint is simply far', () => {
    const far = destination(target, 0, 2000);
    expect(proximity({ fix: fix(far, NOW, 80), target, radiusM: 30, now: NOW }).state).toBe('far');
  });

  it('a stale, missing, non-finite or future fix says nothing', () => {
    expect(proximity({ fix: null, target, radiusM: 30, now: NOW }).state).toBe('no_fix');
    expect(proximity({ fix: fix(target, NOW - 60_000), target, radiusM: 30, now: NOW }).state).toBe(
      'no_fix',
    );
    expect(proximity({ fix: fix(target, NOW, NaN), target, radiusM: 30, now: NOW }).state).toBe(
      'no_fix',
    );
    expect(proximity({ fix: fix(target, NOW + 60_000), target, radiusM: 30, now: NOW }).state).toBe(
      'no_fix',
    );
  });

  it('the radius is configurable and clamped', () => {
    expect(clampRadius(5)).toBe(15);
    expect(clampRadius(5000)).toBe(150);
    expect(clampRadius(NaN)).toBe(DEFAULT_RADIUS_M);
    const edge = destination(target, 0, 60);
    expect(proximity({ fix: fix(edge, NOW), target, radiusM: 30, now: NOW }).state).toBe(
      'approaching',
    );
    expect(proximity({ fix: fix(edge, NOW), target, radiusM: 80, now: NOW }).state).toBe('inside');
  });

  it('needs two inside readings spread over time: one spike never confirms', () => {
    const inside = { state: 'inside', distM: 3 } as const;
    let s: DwellState = null;
    let r = stepDwell(s, inside, 0);
    expect(r.confirmed).toBe(false);
    s = r.next;
    r = stepDwell(s, inside, 1_000); // two readings but only 1 s apart
    expect(r.confirmed).toBe(false);
    r = stepDwell(r.next, inside, 4_000);
    expect(r.confirmed).toBe(true);
  });

  it('any reading that is not inside resets the streak', () => {
    const inside = { state: 'inside', distM: 3 } as const;
    let r = stepDwell(null, inside, 0);
    r = stepDwell(r.next, { state: 'uncertain', distM: 3 }, 2_000);
    expect(r.next).toBeNull();
    r = stepDwell(r.next, inside, 4_000);
    expect(r.confirmed).toBe(false);
    r = stepDwell(null, { state: 'no_fix' }, 5_000);
    expect(r.next).toBeNull();
  });
});

describe('route recording', () => {
  it('records movement, ignores GPS drift while standing still', () => {
    let s = emptyTrack();
    let total = 0;
    for (let i = 0; i < 20; i++) {
      const jitter = destination(HERE, (i * 77) % 360, 3); // 3 m of drift
      const r = appendFix(s, fix(jitter, i * 5_000, 8));
      s = r.state;
      total += r.addedM;
    }
    expect(total).toBe(0);
    expect(s.distanceM).toBe(0);
  });

  it('adds real steps and sums them', () => {
    let s = emptyTrack();
    let p = HERE;
    for (let i = 0; i < 10; i++) {
      p = destination(p, 45, 20);
      s = appendFix(s, fix(p, i * 10_000, 5)).state;
    }
    expect(s.distanceM).toBeGreaterThan(170);
    expect(s.distanceM).toBeLessThan(185);
  });

  it('drops fixes with poor accuracy and impossible jumps', () => {
    let s = appendFix(emptyTrack(), fix(HERE, 0)).state;
    const bad = appendFix(s, fix(destination(HERE, 0, 100), 10_000, 120));
    expect(bad.point).toBeNull();
    const jump = appendFix(s, fix(destination(HERE, 0, 5000), 5_000, 5)); // 1 km/s
    expect(jump.point).toBeNull();
    expect(jump.addedM).toBe(0);
    expect(appendFix(s, fix(HERE, 0, 5)).point).toBeNull(); // same timestamp
  });

  it('keeps counting distance but stops storing points at the cap', () => {
    const s = {
      last: { lat: HERE.lat, lon: HERE.lon, at: 0, accM: 5 },
      distanceM: 0,
      count: TRACK_MAX_POINTS,
    };
    const r = appendFix(s, fix(destination(HERE, 0, 50), 60_000));
    expect(r.point).toBeNull();
    expect(r.addedM).toBeGreaterThan(40);
  });

  it('thins a route and keeps both ends', () => {
    const pts = Array.from({ length: 1000 }, (_, i) => i);
    const t = thinRoute(pts, 50);
    expect(t).toHaveLength(50);
    expect(t[0]).toBe(0);
    expect(t[49]).toBe(999);
    expect(thinRoute([1, 2, 3], 50)).toEqual([1, 2, 3]);
  });
});

describe('merge rules', () => {
  const header = (rev: number, status: Adventure['status']) =>
    AdventureHeaderSchema.parse({ id: 'a', rev, name: 'N', status, ca: 1, ts: 1 });

  it('the highest header revision wins; equal and lower are stale', () => {
    const cur = { rev: 3, status: 'active' as const, groupId: 'g' };
    expect(judgeHeader(cur, header(4, 'paused'), 'g')).toEqual({ accept: true });
    expect(judgeHeader(cur, header(3, 'paused'), 'g')).toEqual({ accept: false, reason: 'stale' });
    expect(judgeHeader(cur, header(2, 'paused'), 'g')).toEqual({ accept: false, reason: 'stale' });
  });

  it('refuses a higher revision that leaves a final status, and a header for another group', () => {
    const done = { rev: 5, status: 'completed' as const, groupId: 'g' };
    expect(judgeHeader(done, header(6, 'active'), 'g')).toEqual({
      accept: false,
      reason: 'illegal_transition',
    });
    expect(judgeHeader({ ...done, status: 'active' }, header(6, 'active'), 'other')).toEqual({
      accept: false,
      reason: 'wrong_group',
    });
  });

  it("the owner's updates converge to the latest in every one of the 120 arrival orders, and never leave a final status", () => {
    const history: Adventure['status'][] = ['planned', 'active', 'paused', 'active', 'completed'];
    const headers = history.map((status, i) => header(i + 1, status));
    const permutations = (xs: number[]): number[][] =>
      xs.length <= 1
        ? [xs]
        : xs.flatMap((x, i) =>
            permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map(r => [x, ...r]),
          );
    for (const order of permutations([0, 1, 2, 3, 4])) {
      let cur: { rev: number; status: Adventure['status']; groupId: string } | null = null;
      for (const i of order) {
        const h = headers[i]!;
        if (judgeHeader(cur, h, 'g').accept) {
          // Once final, it must stay final.
          expect(cur?.status === 'completed').toBe(false);
          cur = { rev: h.rev, status: h.status, groupId: 'g' };
        }
      }
      expect(cur).toEqual({ rev: 5, status: 'completed', groupId: 'g' });
    }
  });

  it('completions: the earliest report wins in every arrival order', () => {
    const a = { id: 'a', at: 100 };
    const b = { id: 'b', at: 90 };
    const c = { id: 'c', at: 100 };
    const perms = [
      [a, b, c],
      [a, c, b],
      [b, a, c],
      [b, c, a],
      [c, a, b],
      [c, b, a],
    ];
    for (const order of perms) {
      let cur: { id: string; at: number } | null = null;
      for (const x of order) {
        if (mergeCompletion(cur, x)) {
          cur = x;
        }
      }
      expect(cur).toEqual(b);
    }
    expect(mergeCompletion(a, a)).toBe(false); // idempotent
  });

  it('checkpoints and participants: highest revision / sequence wins, repeats are no-ops', () => {
    expect(mergeCheckpoint({ rev: 2 }, { rev: 3 })).toBe(true);
    expect(mergeCheckpoint({ rev: 2 }, { rev: 2 })).toBe(false);
    expect(mergeCheckpoint(null, { rev: 1 })).toBe(true);
    expect(mergeParticipant({ seq: 2 }, { seq: 1 })).toBe(false);
    expect(mergeParticipant({ seq: 2 }, { seq: 3 })).toBe(true);
  });
});

describe('authorization on the adv channel', () => {
  const group = (role: 'organizer' | 'member', status: Group['status'] = 'active'): Group => ({
    id: 'g',
    name: 'G',
    organizer: 'off1org',
    role,
    status,
    createdAt: 0,
    joinedAt: 0,
    memberRev: 1,
  });
  const member = (address: string, state: GroupMember['state'] = 'active'): GroupMember => ({
    groupId: 'g',
    address,
    name: address,
    role: address === 'off1org' ? 'organizer' : 'member',
    state,
    rev: 1,
    updatedAt: 0,
  });
  const members = [member('off1org'), member('off1bob'), member('off1gone', 'removed')];
  const adv = (over: Partial<KnownAdventure> = {}): KnownAdventure => ({
    groupId: 'g',
    owner: 'off1org',
    status: 'active',
    liveCheckpointIds: ['cp1'],
    senderState: null,
    ...over,
  });
  const run = (
    kind: Parameters<typeof authorizeAdventureInbound>[0]['kind'],
    over: Partial<Parameters<typeof authorizeAdventureInbound>[0]> = {},
  ) =>
    authorizeAdventureInbound({
      kind,
      group: group('member'),
      members,
      from: 'off1org',
      claimedAuthor: 'off1org',
      ...over,
    });

  it('members accept shared state only from the recorded organizer', () => {
    for (const kind of ['adventure', 'checkpoint', 'milestone'] as const) {
      expect(run(kind).ok).toBe(true);
      expect(run(kind, { from: 'off1bob', claimedAuthor: 'off1bob' }).ok).toBe(false);
    }
    expect(run('adventure', { claimedAuthor: 'off1bob' }).ok).toBe(false); // forged author
    expect(run('adventure', { group: group('member', 'closed') }).ok).toBe(false);
    expect(run('adventure', { group: null }).ok).toBe(false);
    expect(run('adventure', { group: group('organizer') }).ok).toBe(false);
  });

  it('a relay must say whose arrival it is', () => {
    expect(run('relay_reached', { actor: 'off1bob' }).ok).toBe(true);
    expect(run('relay_reached').ok).toBe(false);
    expect(run('relay_participant').ok).toBe(false);
  });

  const asOrg = (kind: Parameters<typeof authorizeAdventureInbound>[0]['kind'], over = {}) =>
    run(kind, {
      group: group('organizer'),
      from: 'off1bob',
      claimedAuthor: 'off1bob',
      ...over,
    });

  it('the organizer accepts member messages only from active members naming themselves', () => {
    expect(asOrg('adv_sync').ok).toBe(true);
    expect(asOrg('adv_sync', { from: 'off1gone', claimedAuthor: 'off1gone' }).ok).toBe(false);
    expect(asOrg('adv_sync', { from: 'off1zed', claimedAuthor: 'off1zed' }).ok).toBe(false);
    expect(asOrg('participant', { adventure: adv(), actor: 'off1cat' }).ok).toBe(false);
    expect(asOrg('participant', { adventure: adv(), actor: 'off1bob' }).ok).toBe(true);
  });

  it('arrivals need a live checkpoint of an adventure that is running or over, and that the sender has not left', () => {
    const ok = { adventure: adv(), checkpointId: 'cp1' };
    expect(asOrg('reached', ok).ok).toBe(true);
    expect(asOrg('reached', { adventure: adv(), checkpointId: 'nope' }).ok).toBe(false);
    expect(
      asOrg('reached', { adventure: adv({ status: 'planned' }), checkpointId: 'cp1' }).ok,
    ).toBe(false);
    expect(
      asOrg('reached', { adventure: adv({ status: 'cancelled' }), checkpointId: 'cp1' }).ok,
    ).toBe(false);
    expect(
      asOrg('reached', { adventure: adv({ status: 'completed' }), checkpointId: 'cp1' }).ok,
    ).toBe(true);
    expect(
      asOrg('reached', { adventure: adv({ senderState: 'left' }), checkpointId: 'cp1' }).ok,
    ).toBe(false);
    expect(asOrg('reached', { adventure: adv({ groupId: 'other' }), checkpointId: 'cp1' }).ok).toBe(
      false,
    );
    expect(asOrg('reached', { adventure: adv({ owner: 'off1bob' }), checkpointId: 'cp1' }).ok).toBe(
      false,
    );
    expect(asOrg('reached', { adventure: null, checkpointId: 'cp1' }).ok).toBe(false);
  });

  it('a member device ignores member messages (only the organizer takes them)', () => {
    expect(
      run('reached', {
        from: 'off1bob',
        claimedAuthor: 'off1bob',
        adventure: adv(),
        checkpointId: 'cp1',
      }).ok,
    ).toBe(false);
  });
});

describe('progress, timeline and recap come only from recorded data', () => {
  const cp = (
    id: string,
    ord: number,
    kind: Checkpoint['kind'] = 'other',
    deleted = false,
  ): Checkpoint => ({
    adventureId: 'a',
    id,
    rev: 1,
    ord,
    name: id,
    description: null,
    kind,
    lat: 0,
    lon: 0,
    deleted,
  });
  const done = (cpId: string, address: string, at: number): Completion => ({
    adventureId: 'a',
    checkpointId: cpId,
    address,
    id: `${cpId}-${address}`,
    at,
    method: 'auto',
    published: true,
    receivedAt: at,
  });
  const part = (address: string, state: Participant['state'] = 'joined'): Participant => ({
    adventureId: 'a',
    address,
    name: address,
    state,
    seq: 1,
    pid: address,
    updatedAt: 5,
    published: true,
  });
  const cps = [cp('c1', 0), cp('c2', 1), cp('c3', 2), cp('gone', 3, 'other', true)];

  it('counts individual and group progress separately and ignores removed checkpoints', () => {
    const comps = [done('c1', 'me', 10), done('c1', 'bob', 12), done('c2', 'bob', 15)];
    const st = checkpointStatuses(cps, comps, [part('me'), part('bob')], 'me');
    const c = progressCounts(st, 'me');
    expect(c).toEqual({ total: 3, mine: 1, remaining: 2, everyone: 1, byOthers: 2 });
    expect(progressLabel(c)).toBe('1 of 3 checkpoints explored');
    expect(nextCheckpoint(st)?.id).toBe('c2');
  });

  it('a participant who left does not hold back "everyone"', () => {
    const comps = [done('c1', 'me', 10)];
    const st = checkpointStatuses(cps, comps, [part('me'), part('bob', 'left')], 'me');
    expect(st[0]?.everyone).toBe(true);
  });

  it('starting and finishing without doing anything does not qualify', () => {
    expect(qualifies({ myCheckpoints: 0, activeMs: 5_000, distanceM: 0 })).toBe(false);
    expect(qualifies({ myCheckpoints: 1, activeMs: 0, distanceM: 0 })).toBe(true);
    expect(qualifies({ myCheckpoints: 0, activeMs: 30 * 60_000, distanceM: 1500 })).toBe(true);
    expect(qualifies({ myCheckpoints: 0, activeMs: 30 * 60_000, distanceM: 50 })).toBe(false);
  });

  const adventure: Adventure = {
    id: 'a',
    groupId: 'g',
    owner: 'org',
    name: 'Ridge',
    description: null,
    status: 'completed',
    rev: 4,
    startLat: null,
    startLon: null,
    startLabel: null,
    createdAt: 1,
    startedAt: 2,
    endedAt: 100,
    tzOffsetMin: 0,
    progress: {
      resumedAt: null,
      activeMs: 60_000,
      distanceM: 0,
      offlineMapsCovered: null,
      networkUsed: false,
      meshExchangeAt: null,
    },
  };

  it('the timeline is built from stored state in a stable order and flags relayed arrivals', () => {
    const t = buildTimeline({
      adventure,
      log: [{ adventureId: 'a', rev: 2, status: 'active', at: 5 }],
      completions: [done('c1', 'me', 10), done('c1', 'bob', 12)],
      participants: [part('me'), part('bob')],
      checkpoints: cps,
      me: 'me',
    });
    expect(t.map(e => e.kind)).toEqual([
      'created',
      'joined',
      'joined',
      'status',
      'reached',
      'all_reached',
      'reached',
    ]);
    expect(t.find(e => e.kind === 'reached' && e.address === 'bob')?.relayed).toBe(true);
    expect(t.find(e => e.kind === 'reached' && e.address === 'me')?.relayed).toBe(false);
  });

  it('the recap never invents distance or a route', () => {
    const bare = buildRecap({
      adventure,
      checkpoints: cps,
      completions: [],
      participants: [],
      track: [],
      unlockedIds: [],
      me: 'me',
      now: 200,
    });
    expect(bare.distanceM).toBeNull();
    expect(bare.route).toEqual([]);
    expect(bare.durationMs).toBe(60_000);
    const withData = buildRecap({
      adventure: { ...adventure, progress: { ...adventure.progress, distanceM: 1234 } },
      checkpoints: cps,
      completions: [done('c1', 'me', 10)],
      participants: [part('me')],
      track: [
        { lat: 1, lon: 1, at: 1, accM: 5 },
        { lat: 1.001, lon: 1, at: 2, accM: 5 },
      ],
      unlockedIds: ['first_adventure'],
      me: 'me',
      now: 200,
    });
    expect(withData.distanceM).toBe(1234);
    expect(withData.route).toHaveLength(2);
    expect(withData.checkpointsDone.map(x => x.checkpoint.id)).toEqual(['c1']);
    expect(withData.checkpointsTotal).toBe(3);
  });
});

describe('achievements', () => {
  const fact = (id: string, over: Partial<AdventureFact> = {}): AdventureFact => ({
    id,
    groupId: null,
    endedAt: Date.UTC(2026, 0, 7, 12),
    tzOffsetMin: 0,
    joinedCount: 1,
    qualifying: true,
    summitReached: false,
    offlineMapsCovered: false,
    networkUsed: false,
    activeMs: 10 * 60_000,
    ...over,
  });
  const facts = (
    completed: AdventureFact[],
    over: Partial<AchievementFacts> = {},
  ): AchievementFacts => ({
    completed,
    distinctCheckpoints: 0,
    meshExchanged: false,
    rallyPoint: false,
    ...over,
  });
  const met = (f: AchievementFacts) =>
    evaluate(f)
      .filter(p => p.met)
      .map(p => p.id);

  it('has a unique id, name, requirement and icon for each of the thirteen badges', () => {
    expect(new Set(ACHIEVEMENTS.map(a => a.id)).size).toBe(ACHIEVEMENTS.length);
    expect(ACHIEVEMENTS).toHaveLength(13);
    for (const a of ACHIEVEMENTS) {
      expect(a.name && a.description && a.requirement && a.icon).toBeTruthy();
    }
    expect(
      evaluate(facts([]))
        .map(p => p.id)
        .sort(),
    ).toEqual(ACHIEVEMENTS.map(a => a.id).sort());
  });

  it('nothing is earned from nothing', () => {
    expect(met(facts([]))).toEqual([]);
  });

  it('counts adventures: 1, 3 and 10', () => {
    expect(met(facts([fact('1')]))).toEqual(['first_adventure']);
    expect(met(facts([fact('1'), fact('2'), fact('3')]))).toEqual([
      'first_adventure',
      'trail_starter',
    ]);
    const ten = Array.from({ length: 10 }, (_, i) => fact(String(i)));
    expect(met(facts(ten))).toEqual(['first_adventure', 'trail_starter', 'explorer']);
    const p = evaluate(facts([fact('1'), fact('2')])).find(x => x.id === 'trail_starter');
    expect(p).toMatchObject({ met: false, current: 2, target: 3 });
  });

  it('an adventure that does not qualify counts for nothing', () => {
    expect(met(facts([fact('1', { qualifying: false })]))).toEqual([]);
  });

  it('first summit needs a reached summit checkpoint in a completed adventure', () => {
    expect(met(facts([fact('1', { summitReached: true })]))).toContain('first_summit');
    expect(met(facts([fact('1')]))).not.toContain('first_summit');
  });

  it('trail collector counts distinct checkpoints', () => {
    expect(met(facts([], { distinctCheckpoints: 9 }))).not.toContain('trail_collector');
    expect(met(facts([], { distinctCheckpoints: 10 }))).toContain('trail_collector');
  });

  it('weekend wanderer needs three different weekends and ignores weekdays', () => {
    const sat = (d: number) => Date.UTC(2026, 0, d, 12);
    // 2026-01-03 and 04 are one weekend; 10 and 17 are others; 07 is a Wednesday.
    expect(
      met(
        facts([
          fact('a', { endedAt: sat(3) }),
          fact('b', { endedAt: sat(4) }),
          fact('c', { endedAt: sat(10) }),
        ]),
      ),
    ).not.toContain('weekend_wanderer');
    expect(
      met(
        facts([
          fact('a', { endedAt: sat(3) }),
          fact('b', { endedAt: sat(10) }),
          fact('c', { endedAt: sat(18) }),
        ]),
      ),
    ).toContain('weekend_wanderer');
    expect(
      met(
        facts([
          fact('a', { endedAt: sat(7) }),
          fact('b', { endedAt: sat(14) }),
          fact('c', { endedAt: sat(21) }),
        ]),
      ),
    ).not.toContain('weekend_wanderer');
  });

  it('weekend keys use the local day, so a Saturday night west of UTC is still Saturday', () => {
    const lateSatLocal = Date.UTC(2026, 0, 4, 3); // 03:00 UTC Sunday = 22:00 Saturday at UTC-5
    expect(weekendKey(lateSatLocal, 300)).toBe('2026-01-03');
    expect(weekendKey(lateSatLocal, 0)).toBe('2026-01-03'); // Sunday belongs to the Saturday before
    expect(weekendKey(Date.UTC(2026, 0, 5, 12), 0)).toBeNull(); // Monday
  });

  it('group badges need other people: a solo trip is not an expedition', () => {
    expect(met(facts([fact('1', { groupId: 'g', joinedCount: 1 })]))).not.toContain(
      'first_expedition',
    );
    expect(met(facts([fact('1', { groupId: 'g', joinedCount: 3 })]))).toContain('first_expedition');
    const five = Array.from({ length: 5 }, (_, i) =>
      fact(`e${i}`, { groupId: `g${i}`, joinedCount: 2 }),
    );
    expect(met(facts(five))).toContain('together_we_go');
    expect(met(facts(five))).not.toContain('trail_companions');
  });

  it('trail companions needs two adventures with the same group', () => {
    const two = [
      fact('1', { groupId: 'g', joinedCount: 2 }),
      fact('2', { groupId: 'g', joinedCount: 2 }),
    ];
    expect(met(facts(two))).toContain('trail_companions');
    const split = [
      fact('1', { groupId: 'g', joinedCount: 2 }),
      fact('2', { groupId: 'h', joinedCount: 2 }),
    ];
    expect(met(facts(split))).not.toContain('trail_companions');
  });

  it('rally point and mesh connected come only from recorded facts', () => {
    expect(met(facts([], { rallyPoint: true }))).toEqual(['rally_point']);
    expect(met(facts([], { meshExchanged: true }))).toEqual(['mesh_connected']);
  });

  it('off the grid needs saved maps, no network use and a real stretch of time; local explorer only the maps', () => {
    const base = { offlineMapsCovered: true, activeMs: 31 * 60_000 };
    expect(met(facts([fact('1', base)]))).toEqual(
      expect.arrayContaining(['off_the_grid', 'local_explorer']),
    );
    expect(met(facts([fact('1', { ...base, networkUsed: true })]))).not.toContain('off_the_grid');
    expect(met(facts([fact('1', { ...base, networkUsed: true })]))).toContain('local_explorer');
    expect(met(facts([fact('1', { ...base, activeMs: 10 * 60_000 })]))).not.toContain(
      'off_the_grid',
    );
    expect(met(facts([fact('1', { offlineMapsCovered: false, activeMs: 31 * 60_000 })]))).toEqual([
      'first_adventure',
    ]);
  });
});

describe('wire format', () => {
  it('a worst-case header and checkpoint (4-byte characters) still fit one envelope', () => {
    const four = '😀';
    const header = {
      id: '01J'.padEnd(26, 'X'),
      rev: 99,
      name: four.repeat(60),
      desc: four.repeat(200),
      status: 'active',
      st: { lat: 46.123456, lon: 8.123456, n: four.repeat(60) },
      ca: 1761830000000,
      sa: 1761830000000,
      ea: 1761830000000,
      ts: 1761830000000,
    };
    const clock = { now: () => 1761830000000 };
    const newId = () => '01J'.padEnd(26, 'Y');
    const env = createEnvelope(
      { type: 'adventure', author: 'off1' + 'a'.repeat(60), payload: header },
      { clock, newId },
    );
    expect(encodeEnvelope(env).ok).toBe(true);
    expect(AdventureHeaderSchema.safeParse(header).success).toBe(true);
    const cp = {
      adv: '01J'.padEnd(26, 'X'),
      id: '01J'.padEnd(26, 'Z'),
      rev: 9,
      ord: 19,
      name: four.repeat(60),
      desc: four.repeat(140),
      kind: 'summit',
      lat: 46.1,
      lon: 8.1,
      del: true,
      ts: 1761830000000,
    };
    const env2 = createEnvelope(
      { type: 'checkpoint', author: 'off1' + 'a'.repeat(60), payload: cp },
      { clock, newId },
    );
    expect(encodeEnvelope(env2).ok).toBe(true);
    expect(CheckpointWireSchema.safeParse(cp).success).toBe(true);
  });

  it('rejects malformed or out-of-range payloads', () => {
    expect(
      CheckpointWireSchema.safeParse({
        adv: 'a',
        id: 'b',
        rev: 1,
        ord: 0,
        name: 'x',
        kind: 'summit',
        lat: 91,
        lon: 0,
        ts: 1,
      }).success,
    ).toBe(false);
    expect(
      CheckpointWireSchema.safeParse({
        adv: 'a',
        id: 'b',
        rev: 1,
        ord: 0,
        name: 'x',
        kind: 'volcano',
        lat: 1,
        lon: 0,
        ts: 1,
      }).success,
    ).toBe(false);
    expect(
      AdventureHeaderSchema.safeParse({
        id: 'a',
        rev: 0,
        name: 'x',
        status: 'active',
        ca: 1,
        ts: 1,
      }).success,
    ).toBe(false);
    expect(
      AdventureHeaderSchema.safeParse({
        id: 'a',
        rev: 1,
        name: 'x',
        status: 'flying',
        ca: 1,
        ts: 1,
      }).success,
    ).toBe(false);
  });
});
