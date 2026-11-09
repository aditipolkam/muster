import {
  authorizeInbound,
  authorizeSubscription,
  canPublishPoints,
} from '../src/domain/groups/authorize';
import {
  buildInviteLink,
  checkInvite,
  generateToken,
  hashToken,
  parseInviteLink,
  TOKEN_PATTERN,
} from '../src/domain/groups/invite';
import { compareVersions, mergePoint, nextRev, pointsToResend } from '../src/domain/groups/merge';
import {
  Group,
  GroupMember,
  MeetingPoint,
  PointPayloadSchema,
  POINT_NOTE_MAX,
  POINT_NAME_MAX,
} from '../src/domain/groups/model';
import { createEnvelope, decodeEnvelope, encodeEnvelope } from '../src/mesh/envelope';
import { groupTopic, GroupChannel, parseGroupTopic } from '../src/mesh/groupTopics';
import { isValidTopic } from '../src/mesh/topics';
import { meetingPointsCollection } from '../src/features/map/overlays';
import { ManualClock, testId } from '../src/testing/services';

const point = (over: Partial<MeetingPoint> = {}): MeetingPoint => ({
  groupId: 'G',
  id: 'P',
  rev: 1,
  name: 'n',
  note: null,
  lat: 1,
  lon: 2,
  deleted: false,
  createdBy: 'off1org',
  updatedBy: 'off1org',
  createdAt: 1,
  updatedAt: 1,
  receivedAt: 1,
  ackedRev: 0,
  ackPublished: false,
  ...over,
});

const group = (over: Partial<Group> = {}): Group => ({
  id: 'G',
  name: 'Trip',
  organizer: 'off1org',
  role: 'member',
  status: 'active',
  createdAt: 1,
  joinedAt: 1,
  memberRev: 0,
  ...over,
});
const member = (address: string, over: Partial<GroupMember> = {}): GroupMember => ({
  groupId: 'G',
  address,
  name: address,
  role: 'member',
  state: 'active',
  rev: 1,
  updatedAt: 1,
  ...over,
});

const permutations = <T>(xs: T[]): T[][] =>
  xs.length <= 1
    ? [xs]
    : xs.flatMap((x, i) =>
        permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map(p => [x, ...p]),
      );

describe('meeting point versioning', () => {
  it('orders by revision, then by the greatest author', () => {
    expect(compareVersions({ rev: 2, updatedBy: 'a' }, { rev: 1, updatedBy: 'z' })).toBeGreaterThan(
      0,
    );
    expect(compareVersions({ rev: 1, updatedBy: 'b' }, { rev: 1, updatedBy: 'a' })).toBeGreaterThan(
      0,
    );
    expect(compareVersions({ rev: 1, updatedBy: 'a' }, { rev: 1, updatedBy: 'a' })).toBe(0);
  });

  it('every arrival order of a set of versions converges on the same winner', () => {
    const versions = [
      point({ rev: 1, name: 'one' }),
      point({ rev: 2, name: 'two' }),
      point({ rev: 3, name: 'gone', deleted: true }),
      point({ rev: 3, name: 'tie-b', updatedBy: 'off1zed' }),
      point({ rev: 2, name: 'two-b', updatedBy: 'off1abc' }),
    ];
    const winners = new Set(
      permutations(versions).map(order => {
        let cur: MeetingPoint | null = null;
        for (const v of order) {
          cur = mergePoint(cur, v, 1).next;
        }
        return JSON.stringify([cur?.rev, cur?.updatedBy, cur?.name, cur?.deleted]);
      }),
    );
    expect(winners.size).toBe(1);
    expect([...winners][0]).toBe(JSON.stringify([3, 'off1zed', 'tie-b', false]));
  });

  it('is idempotent: applying a version twice reports no change the second time', () => {
    const v = point({ rev: 4 });
    const first = mergePoint(point({ rev: 2 }), v, 9);
    expect(first.changed).toBe(true);
    expect(mergePoint(first.next, v, 10)).toEqual({ next: first.next, changed: false });
  });

  it('keeps the local acknowledgment when a newer revision arrives', () => {
    const cur = point({ rev: 1, ackedRev: 1, ackPublished: true });
    const out = mergePoint(cur, point({ rev: 2 }), 5);
    expect(out.next).toMatchObject({ rev: 2, ackedRev: 1, ackPublished: true });
  });

  it('next revision is one above anything seen', () => {
    expect(nextRev(null)).toBe(1);
    expect(nextRev(point({ rev: 6 }))).toBe(7);
  });

  it('lists only the points the requester lacks or holds an older revision of', () => {
    const mine = [
      point({ id: 'a', rev: 2 }),
      point({ id: 'b', rev: 1 }),
      point({ id: 'c', rev: 3 }),
    ];
    const out = pointsToResend(mine, [
      { id: 'a', rev: 2 },
      { id: 'c', rev: 1 },
    ]);
    expect(out.map(p => p.id)).toEqual(['b', 'c']);
  });
});

describe('authorization', () => {
  const base = { from: 'off1org', claimedAuthor: 'off1org' };

  it('accepts group state only from the recorded organizer', () => {
    const ok = authorizeInbound({
      ...base,
      kind: 'point',
      group: group(),
      members: [],
      actor: 'off1org',
    });
    expect(ok).toEqual({ ok: true });
    for (const kind of ['point', 'point_removed', 'member_event'] as const) {
      const bad = authorizeInbound({
        kind,
        group: group(),
        members: [member('off1bob')],
        from: 'off1bob',
        claimedAuthor: 'off1bob',
      });
      expect(bad.ok).toBe(false);
    }
  });

  it('refuses unknown groups, mismatched authors and groups that are not active', () => {
    expect(authorizeInbound({ ...base, kind: 'point', group: null, members: [] }).ok).toBe(false);
    expect(
      authorizeInbound({
        ...base,
        claimedAuthor: 'off1bob',
        kind: 'point',
        group: group(),
        members: [],
      }).ok,
    ).toBe(false);
    expect(
      authorizeInbound({ ...base, kind: 'point', group: group({ status: 'closed' }), members: [] })
        .ok,
    ).toBe(false);
    expect(
      authorizeInbound({ ...base, kind: 'point', group: group({ status: 'joining' }), members: [] })
        .ok,
    ).toBe(false);
  });

  it('a welcome is accepted only while joining', () => {
    expect(
      authorizeInbound({
        ...base,
        kind: 'welcome',
        group: group({ status: 'joining' }),
        members: [],
      }).ok,
    ).toBe(true);
    expect(authorizeInbound({ ...base, kind: 'welcome', group: group(), members: [] }).ok).toBe(
      false,
    );
  });

  it('the organizer accepts member messages only from active roster members', () => {
    const org = group({ role: 'organizer' });
    const members = [member('off1bob'), member('off1gone', { state: 'left' })];
    const as = (from: string) =>
      authorizeInbound({ kind: 'ack', group: org, members, from, claimedAuthor: from }).ok;
    expect(as('off1bob')).toBe(true);
    expect(as('off1gone')).toBe(false);
    expect(as('off1eve')).toBe(false);
  });

  it('a member never accepts member messages, an organizer never accepts organizer messages', () => {
    expect(
      authorizeInbound({
        kind: 'ack',
        group: group(),
        members: [member('off1bob')],
        from: 'off1bob',
        claimedAuthor: 'off1bob',
      }).ok,
    ).toBe(false);
    expect(
      authorizeInbound({ ...base, kind: 'point', group: group({ role: 'organizer' }), members: [] })
        .ok,
    ).toBe(false);
  });

  it('only the organizer of an active group may publish points', () => {
    expect(canPublishPoints(group({ role: 'organizer' }), 'off1org')).toBe(true);
    expect(canPublishPoints(group({ role: 'member' }), 'off1org')).toBe(false);
    expect(canPublishPoints(group({ role: 'organizer', status: 'closed' }), 'off1org')).toBe(false);
    expect(canPublishPoints(group({ role: 'organizer' }), 'off1bob')).toBe(false);
    expect(canPublishPoints(null, 'off1org')).toBe(false);
  });

  it('subscriptions: organizer serves active members, members serve only the organizer', () => {
    const org = group({ role: 'organizer' });
    const members = [member('off1bob'), member('off1gone', { state: 'removed' })];
    const ask = (g: Group, channel: string, sender: string, ms = members) =>
      authorizeSubscription({ channel, group: g, members: ms, sender }).ok;
    expect(ask(org, 'point', 'off1bob')).toBe(true);
    expect(ask(org, 'point', 'off1gone')).toBe(false);
    expect(ask(org, 'point', 'off1eve')).toBe(false);
    expect(ask(org, 'ack', 'off1bob')).toBe(false);
    expect(ask(group(), 'ack', 'off1org')).toBe(true);
    expect(ask(group(), 'ack', 'off1bob')).toBe(false);
    expect(ask(group(), 'point', 'off1org')).toBe(false);
  });
});

describe('invites', () => {
  const rng = (seed: number) => (n: number) =>
    Uint8Array.from({ length: n }, (_, i) => (seed + i * 17) % 256);

  it('generates 26-character topic-safe tokens that differ', () => {
    const a = generateToken(rng(1));
    const b = generateToken(rng(2));
    expect(a).toMatch(TOKEN_PATTERN);
    expect(a).not.toBe(b);
    expect(
      isValidTopic(groupTopic('01ARZ3NDEKTSV4RRFFQ69G5FAV', GroupChannel.join, a), false),
    ).toBe(true);
  });

  it('refuses a random source of the wrong length', () => {
    expect(() => generateToken(() => new Uint8Array(3))).toThrow();
  });

  it('stores a hash, never the token', () => {
    const t = generateToken(rng(3));
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toContain(t);
    expect(hashToken(t)).toBe(hashToken(t));
  });

  it('round-trips a link, including names with spaces and symbols', () => {
    const invite = {
      groupId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      organizer: 'off1abcdef',
      token: generateToken(rng(4)),
      groupName: 'Ben & Nevis / "Tuesday"',
    };
    const parsed = parseInviteLink(buildInviteLink(invite));
    expect(parsed).toEqual({ ok: true, invite });
  });

  it('makes muster:// links and still reads invitations from before the rename', () => {
    const invite = {
      groupId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      organizer: 'off1abcdef',
      token: generateToken(rng(4)),
      groupName: 'Ridge walk',
    };
    const link = buildInviteLink(invite);
    expect(link.startsWith('muster://join?')).toBe(true);
    const legacy = link.replace('muster://', 'trailmesh://');
    expect(parseInviteLink(legacy)).toEqual({ ok: true, invite });
  });

  it('rejects text that is not a valid invite', () => {
    expect(parseInviteLink('https://example.com')).toEqual({ ok: false, error: 'not_an_invite' });
    expect(parseInviteLink('muster://join?v=2&g=a&o=b&t=c&n=d')).toEqual({
      ok: false,
      error: 'unsupported_version',
    });
    expect(parseInviteLink('muster://join?v=1&g=a&o=b&t=short&n=d')).toEqual({
      ok: false,
      error: 'malformed',
    });
    expect(parseInviteLink('muster://join?v=1&g=%E0%A4%A&o=b&t=c&n=d')).toEqual({
      ok: false,
      error: 'malformed',
    });
    expect(parseInviteLink('muster://join?garbage')).toEqual({ ok: false, error: 'malformed' });
  });

  it('checks expiry, revocation, group and single use', () => {
    const inv = { groupId: 'G', expiresAt: 100, status: 'open' as const, usedBy: null };
    expect(checkInvite(inv, 'G', 'x', 50)).toEqual({ ok: true, rejoin: false });
    expect(checkInvite(inv, 'G', 'x', 101)).toEqual({ ok: false, reason: 'expired' });
    expect(checkInvite(inv, 'H', 'x', 50)).toEqual({ ok: false, reason: 'wrong_group' });
    expect(checkInvite({ ...inv, status: 'revoked' }, 'G', 'x', 50)).toEqual({
      ok: false,
      reason: 'revoked',
    });
    expect(checkInvite(null, 'G', 'x', 50)).toEqual({ ok: false, reason: 'unknown' });
    const used = { ...inv, status: 'used' as const, usedBy: 'x' };
    expect(checkInvite(used, 'G', 'x', 50)).toEqual({ ok: true, rejoin: true });
    expect(checkInvite(used, 'G', 'y', 50)).toEqual({ ok: false, reason: 'used' });
  });
});

describe('topics', () => {
  const gid = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

  it('builds and parses group topics without wildcards', () => {
    for (const ch of Object.values(GroupChannel)) {
      const t = groupTopic(gid, ch);
      expect(t).toBe(`tm/1/${gid}/${ch}`);
      expect(t).not.toContain('*');
      expect(isValidTopic(t, false)).toBe(true);
      expect(parseGroupTopic(t)).toEqual({
        kind: 'group',
        groupId: gid,
        channel: ch,
        detail: null,
      });
    }
    expect(parseGroupTopic(`tm/1/${gid}/j/TOKEN`)).toMatchObject({ channel: 'j', detail: 'TOKEN' });
    expect(parseGroupTopic('tm/1/beacon')).toEqual({ kind: 'beacon' });
  });

  it('refuses topics that are not ours', () => {
    expect(parseGroupTopic('tm/2/x/point')).toBeNull();
    expect(parseGroupTopic(`tm/1/${gid}`)).toBeNull();
    expect(parseGroupTopic(`tm/1/${gid}/a/b/c`)).toBeNull();
    expect(() => groupTopic('bad id', GroupChannel.point)).toThrow();
  });
});

describe('meeting point serialization', () => {
  const deps = { clock: new ManualClock(), newId: testId };
  const payload = (over: Record<string, unknown> = {}) => ({
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    rev: 3,
    name: 'Lake junction',
    note: 'Bring water',
    lat: 56.796849,
    lon: -5.003508,
    by: 'off1org',
    createdBy: 'off1org',
    createdAt: 1_761_830_000_000,
    ts: 1_761_830_100_000,
    ...over,
  });

  it('survives encode, decode and schema parse with coordinates intact', () => {
    const env = createEnvelope({ type: 'point', author: 'off1org', payload: payload() }, deps);
    const wire = encodeEnvelope(env);
    expect(wire.ok).toBe(true);
    const back = decodeEnvelope(wire.ok ? wire.value : '');
    const parsed = back.ok ? PointPayloadSchema.safeParse(back.value.p) : null;
    expect(parsed?.success && parsed.data).toEqual(payload());
  });

  it('keeps full coordinate precision', () => {
    const p = payload({ lat: -33.865143123456, lon: 151.209900123456 });
    const env = createEnvelope({ type: 'point', author: 'off1org', payload: p }, deps);
    const wire = encodeEnvelope(env);
    const back = decodeEnvelope(wire.ok ? wire.value : '');
    expect(back.ok && back.value.p).toMatchObject({ lat: -33.865143123456, lon: 151.209900123456 });
  });

  it('a maximum-length ASCII point fits the 2 KB envelope', () => {
    const p = payload({ name: 'n'.repeat(POINT_NAME_MAX), note: 'x'.repeat(POINT_NOTE_MAX) });
    const env = createEnvelope(
      { type: 'point', author: `off1${'a'.repeat(60)}`, payload: p },
      deps,
    );
    expect(encodeEnvelope(env).ok).toBe(true);
  });

  it('a worst-case multi-byte point with a long author address still fits', () => {
    const p = payload({ note: '😀'.repeat(POINT_NOTE_MAX), name: '😀'.repeat(POINT_NAME_MAX) });
    const env = createEnvelope(
      { type: 'point', author: `off1${'a'.repeat(100)}`, payload: p },
      deps,
    );
    expect(encodeEnvelope(env).ok).toBe(true);
  });

  it('an envelope over the budget is refused at encode time, not truncated', () => {
    const env = createEnvelope(
      { type: 'point', author: 'off1org', payload: payload({ note: 'x'.repeat(2100) }) },
      deps,
    );
    const wire = encodeEnvelope(env);
    expect(!wire.ok && wire.error.code).toBe('envelope.too_large');
  });

  it('rejects out-of-range coordinates and a zero revision', () => {
    expect(PointPayloadSchema.safeParse(payload({ lat: 91 })).success).toBe(false);
    expect(PointPayloadSchema.safeParse(payload({ lon: -181 })).success).toBe(false);
    expect(PointPayloadSchema.safeParse(payload({ rev: 0 })).success).toBe(false);
    expect(PointPayloadSchema.safeParse(payload({ lat: Number.NaN })).success).toBe(false);
  });
});

describe('rendering received coordinates as map markers', () => {
  it('turns each live point into a GeoJSON point at [lon, lat] and drops tombstones', () => {
    const fc = meetingPointsCollection([
      point({ id: 'a', name: 'Camp', lat: 56.8, lon: -5.1 }),
      point({ id: 'b', deleted: true }),
      point({ id: 'c', groupId: 'H', name: 'Hut', lat: -33.9, lon: 151.2, ackedRev: 1, rev: 1 }),
    ]);
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0]).toMatchObject({
      id: 'G:a',
      properties: { id: 'G:a', name: 'Camp', acked: false },
      geometry: { type: 'Point', coordinates: [-5.1, 56.8] },
    });
    expect(fc.features[1]).toMatchObject({
      id: 'H:c',
      properties: { acked: true },
      geometry: { coordinates: [151.2, -33.9] },
    });
  });

  it('keeps the same point id in two groups apart', () => {
    const fc = meetingPointsCollection([point({ groupId: 'G1' }), point({ groupId: 'G2' })]);
    expect(new Set(fc.features.map(f => f.id)).size).toBe(2);
  });
});
