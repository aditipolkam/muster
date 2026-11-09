import { z } from 'zod';
import { parseInviteLink } from '../src/domain/groups/invite';
import {
  canChangeTripArea,
  Group,
  GroupMember,
  welcomeArea,
  WelcomeSchema,
} from '../src/domain/groups/model';
import { areaFromBox, MapArea, toMapAreaWire } from '../src/domain/maps/mapArea';
import { FakeNetwork } from '../src/testing/FakeMesh';
import { GroupNode, makeGroupNode, settle } from '../src/testing/groupNode';

/** The group's trip map travels in the welcome, and is locked once someone has joined. */

const RIDGE: MapArea = areaFromBox([-5.05, 56.77, -4.95, 56.83], 'Ben Nevis');

const group = (over: Partial<Group> = {}): Group => ({
  id: 'g1',
  name: 'Ben Nevis',
  organizer: 'org',
  role: 'organizer',
  status: 'active',
  createdAt: 1,
  joinedAt: 1,
  memberRev: 1,
  ...over,
});
const member = (address: string, over: Partial<GroupMember> = {}): GroupMember => ({
  groupId: 'g1',
  address,
  name: address,
  role: address === 'org' ? 'organizer' : 'member',
  state: 'active',
  rev: 1,
  updatedAt: 1,
  ...over,
});

describe('trip map rules', () => {
  it('the organizer can change it only while nobody else is in the group', () => {
    const me = member('org');
    expect(canChangeTripArea(group(), [me], 'org')).toBe(true);
    expect(canChangeTripArea(group(), [me, member('bob')], 'org')).toBe(false);
    // Everyone who had it left: there is nobody it could be out of step with.
    expect(canChangeTripArea(group(), [me, member('bob', { state: 'left' })], 'org')).toBe(true);
  });

  it('a member, a closed group or another device cannot change it', () => {
    expect(canChangeTripArea(group({ role: 'member' }), [], 'org')).toBe(false);
    expect(canChangeTripArea(group({ status: 'closed' }), [], 'org')).toBe(false);
    expect(canChangeTripArea(group(), [], 'someone-else')).toBe(false);
  });

  it('a welcome without a trip map, or with one that is not valid, still lets the person in', () => {
    const base = { g: 'g1', name: 'Ben Nevis', o: 'org', mrev: 1 };
    const none = WelcomeSchema.parse(base);
    expect(welcomeArea(none)).toBeNull();

    const tooWide = WelcomeSchema.parse({
      ...base,
      rg: { b: [-6, 56, -4, 58], n: 'x', z: [8, 15] },
    });
    expect(welcomeArea(tooWide)).toBeNull();
    const junk = WelcomeSchema.parse({ ...base, rg: 'not an area' });
    expect(welcomeArea(junk)).toBeNull();

    const good = WelcomeSchema.parse({ ...base, rg: toMapAreaWire(RIDGE) });
    expect(welcomeArea(good)).toEqual(RIDGE);
  });

  it('an older app, whose welcome has no trip map, still accepts a welcome that carries one', () => {
    const v1 = z.object({ g: z.string(), name: z.string(), o: z.string(), mrev: z.number() });
    const w = { g: 'g1', name: 'Ben Nevis', o: 'org', mrev: 1, rg: toMapAreaWire(RIDGE) };
    expect(v1.safeParse(w).success).toBe(true);
  });

  it('a welcome with the trip map is still far inside the envelope budget', () => {
    const area = areaFromBox([-5.05, 56.77, -4.95, 56.83], '漢'.repeat(60));
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        g: 'x'.repeat(64),
        name: '漢'.repeat(60),
        o: 'x'.repeat(128),
        mrev: 1,
        rg: toMapAreaWire(area),
      }),
    ).length;
    expect(bytes).toBeLessThan(1024);
  });
});

async function setup(net: FakeNetwork) {
  const org = await makeGroupNode(net, 'off1org', { name: 'Olive' });
  const bob = await makeGroupNode(net, 'off1bob', { name: 'Bob', clock: org.clock });
  const created = await org.groups.createGroup({ name: 'Ben Nevis' });
  if (!created.ok) {
    throw new Error('group');
  }
  return { org, bob, g: created.value, all: [org, bob] as GroupNode[] };
}

async function invite(org: GroupNode, groupId: string) {
  const inv = await org.groups.createInvite(groupId, { autoApprove: true });
  const parsed = inv.ok ? parseInviteLink(inv.value.link) : null;
  if (!parsed || !parsed.ok) {
    throw new Error('invite');
  }
  return parsed.invite;
}

describe('trip map over the mesh', () => {
  it('reaches the person who joins, with the group', async () => {
    const net = new FakeNetwork();
    const { org, bob, g, all } = await setup(net);
    expect((await org.groups.setTripArea(g.id, RIDGE)).ok).toBe(true);
    await bob.groups.joinFromInvite(await invite(org, g.id));
    await settle(all);
    const joined = await bob.groupsRepo.get(g.id);
    expect(joined?.status).toBe('active');
    expect(joined?.tripArea).toEqual(RIDGE);
  });

  it('a group without a trip map joins as before, with none', async () => {
    const net = new FakeNetwork();
    const { org, bob, g, all } = await setup(net);
    await bob.groups.joinFromInvite(await invite(org, g.id));
    await settle(all);
    expect((await bob.groupsRepo.get(g.id))?.tripArea).toBeNull();
  });

  it('is locked once someone has joined, so nobody holds an old one', async () => {
    const net = new FakeNetwork();
    const { org, bob, g, all } = await setup(net);
    await org.groups.setTripArea(g.id, RIDGE);
    await bob.groups.joinFromInvite(await invite(org, g.id));
    await settle(all);
    const moved = areaFromBox([-5.2, 56.7, -5.1, 56.8], 'Elsewhere');
    const change = await org.groups.setTripArea(g.id, moved);
    expect(change.ok ? null : change.error.code).toBe('groups.trip_area_locked');
    const remove = await org.groups.setTripArea(g.id, null);
    expect(remove.ok).toBe(false);
    expect((await org.groupsRepo.get(g.id))?.tripArea).toEqual(RIDGE);
  });

  it('a member cannot set one', async () => {
    const net = new FakeNetwork();
    const { org, bob, g, all } = await setup(net);
    await bob.groups.joinFromInvite(await invite(org, g.id));
    await settle(all);
    expect((await bob.groups.setTripArea(g.id, RIDGE)).ok).toBe(false);
    expect((await bob.groupsRepo.get(g.id))?.tripArea).toBeNull();
  });

  it('an area larger than one download allows is refused', async () => {
    const net = new FakeNetwork();
    const { org, g } = await setup(net);
    const r = await org.groups.setTripArea(g.id, areaFromBox([-6, 56, -4, 58], 'Too big'));
    expect(r.ok ? null : r.error.code).toBe('groups.invalid_area');
  });
});

describe('trip map storage', () => {
  it('a later save of the group does not drop it', async () => {
    const net = new FakeNetwork();
    const { org, g } = await setup(net);
    await org.groups.setTripArea(g.id, RIDGE);
    const stored = (await org.groupsRepo.get(g.id))!;
    await org.groupsRepo.save({ ...stored, tripArea: undefined, name: 'Renamed' });
    expect((await org.groupsRepo.get(g.id))?.tripArea).toEqual(RIDGE);
  });

  it('a stored value that is not a valid area reads as none', async () => {
    const net = new FakeNetwork();
    const { org, g } = await setup(net);
    await org.db.run('UPDATE groups SET trip_area = ? WHERE id = ?', ['{"b":"nope"}', g.id]);
    expect((await org.groupsRepo.get(g.id))?.tripArea).toBeNull();
    await org.db.run('UPDATE groups SET trip_area = ? WHERE id = ?', ['not json', g.id]);
    expect((await org.groupsRepo.get(g.id))?.tripArea).toBeNull();
  });
});
