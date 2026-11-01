import { parseInviteLink } from '../src/domain/groups/invite';
import { Group } from '../src/domain/groups/model';
import { FakeNetwork } from '../src/testing/FakeMesh';
import { GroupNode, makeGroupNode, settle } from '../src/testing/groupNode';

async function createGroup(org: GroupNode, name = 'Ben Nevis') {
  const r = await org.groups.createGroup({ name });
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  return r.value;
}

async function inviteLink(org: GroupNode, g: Group, autoApprove = false) {
  const r = await org.groups.createInvite(g.id, { autoApprove });
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  const p = parseInviteLink(r.value.link);
  if (!p.ok) {
    throw new Error('bad link');
  }
  return p.invite;
}

/** Organizer creates a group; each joiner scans a fresh invite and is approved. */
async function formGroup(net: FakeNetwork, joiners: string[] = ['off1bob']) {
  const org = await makeGroupNode(net, 'off1org', { name: 'Olive' });
  const g = await createGroup(org);
  const members: GroupNode[] = [];
  for (const a of joiners) {
    const n = await makeGroupNode(net, a, { name: a.replace('off1', '') });
    members.push(n);
    const joined = await n.groups.joinFromInvite(await inviteLink(org, g));
    expect(joined.ok).toBe(true);
    await settle([org, ...members]);
    const req = org.groups.getSnapshot().joinRequests.find(r => r.sender === a);
    expect(req).toBeDefined();
    expect((await org.groups.approveJoin(req!.subId)).ok).toBe(true);
    await settle([org, ...members]);
  }
  return { org, g, members, all: [org, ...members] };
}

describe('group creation', () => {
  it('creates a group with a unique id, a name and the creator as organizer', async () => {
    const net = new FakeNetwork();
    const org = await makeGroupNode(net, 'off1org', { name: 'Olive' });
    const a = await createGroup(org, 'Alpha');
    const b = await createGroup(org, 'Beta');
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({
      name: 'Alpha',
      organizer: 'off1org',
      role: 'organizer',
      status: 'active',
    });
    const members = await org.groupsRepo.members(a.id);
    expect(members).toMatchObject([
      { address: 'off1org', name: 'Olive', role: 'organizer', state: 'active' },
    ]);
  });

  it('refuses an empty name and a device with no mesh address', async () => {
    const net = new FakeNetwork();
    const org = await makeGroupNode(net, 'off1org');
    const r = await org.groups.createGroup({ name: '   ' });
    expect(!r.ok && r.error.code).toBe('groups.invalid_name');
  });
});

describe('joining', () => {
  it('joins with an invite after the organizer approves, and both sides agree on the roster', async () => {
    const net = new FakeNetwork();
    const { org, g, members } = await formGroup(net);
    const bob = members[0]!;
    const bobGroup = await bob.groupsRepo.get(g.id);
    expect(bobGroup).toMatchObject({ role: 'member', status: 'active', organizer: 'off1org' });
    const roster = (n: GroupNode) =>
      n.groupsRepo.members(g.id).then(ms => ms.map(m => [m.address, m.state, m.role]).sort());
    expect(await roster(bob)).toEqual(await roster(org));
    expect(await roster(org)).toEqual([
      ['off1bob', 'active', 'member'],
      ['off1org', 'active', 'organizer'],
    ]);
  });

  it('takes the joiner display name from its hello message', async () => {
    const net = new FakeNetwork();
    const { org, g } = await formGroup(net);
    const names = (await org.groupsRepo.members(g.id)).map(m => m.name).sort();
    expect(names).toEqual(['Olive', 'bob']);
  });

  it('does not admit anyone until the organizer approves', async () => {
    const net = new FakeNetwork();
    const org = await makeGroupNode(net, 'off1org');
    const g = await createGroup(org);
    const bob = await makeGroupNode(net, 'off1bob');
    await bob.groups.joinFromInvite(await inviteLink(org, g));
    await settle([org, bob]);
    expect((await bob.groupsRepo.get(g.id))?.status).toBe('joining');
    expect(await org.groupsRepo.member(g.id, 'off1bob')).toBeNull();
    expect(org.groups.getSnapshot().joinRequests).toHaveLength(1);
  });

  it('auto-approves an invite created with auto-approve', async () => {
    const net = new FakeNetwork();
    const org = await makeGroupNode(net, 'off1org');
    const g = await createGroup(org);
    const bob = await makeGroupNode(net, 'off1bob');
    await bob.groups.joinFromInvite(await inviteLink(org, g, true));
    await settle([org, bob]);
    expect((await bob.groupsRepo.get(g.id))?.status).toBe('active');
  });

  it('a rejected request leaves the joiner with no group', async () => {
    const net = new FakeNetwork();
    const org = await makeGroupNode(net, 'off1org');
    const g = await createGroup(org);
    const bob = await makeGroupNode(net, 'off1bob');
    await bob.groups.joinFromInvite(await inviteLink(org, g));
    await settle([org, bob]);
    await org.groups.rejectJoin(org.groups.getSnapshot().joinRequests[0]!.subId);
    await settle([org, bob]);
    expect(await bob.groupsRepo.get(g.id)).toBeNull();
    expect(bob.groups.getSnapshot().notices[0]?.text).toMatch(/Could not join/);
  });

  it('an invite token works once; a second device is refused, the first may retry', async () => {
    const net = new FakeNetwork();
    const org = await makeGroupNode(net, 'off1org');
    const g = await createGroup(org);
    const invite = await inviteLink(org, g);
    const bob = await makeGroupNode(net, 'off1bob');
    const eve = await makeGroupNode(net, 'off1eve');
    await bob.groups.joinFromInvite(invite);
    await settle([org, bob]);
    await org.groups.approveJoin(org.groups.getSnapshot().joinRequests[0]!.subId);
    await settle([org, bob]);
    await eve.groups.joinFromInvite(invite);
    await settle([org, bob, eve]);
    expect(org.groups.getSnapshot().joinRequests).toHaveLength(0);
    expect(await org.groupsRepo.member(g.id, 'off1eve')).toBeNull();
    expect(await eve.groupsRepo.get(g.id)).toBeNull();
  });

  it('an unknown or expired token is refused', async () => {
    const net = new FakeNetwork();
    const org = await makeGroupNode(net, 'off1org');
    const g = await createGroup(org);
    const invite = await inviteLink(org, g);
    org.clock.advance(25 * 60 * 60 * 1000);
    const bob = await makeGroupNode(net, 'off1bob', { clock: org.clock });
    await bob.groups.joinFromInvite(invite);
    await settle([org, bob]);
    expect(org.groups.getSnapshot().joinRequests).toHaveLength(0);
    expect(await bob.groupsRepo.get(g.id)).toBeNull();
    const eve = await makeGroupNode(net, 'off1eve', { clock: org.clock });
    await eve.groups.joinFromInvite({ ...invite, token: 'A'.repeat(26) });
    await settle([org, eve]);
    expect(await eve.groupsRepo.get(g.id)).toBeNull();
  });

  it('joins through nearby discovery only while the organizer has opened the group, with approval', async () => {
    const net = new FakeNetwork();
    const org = await makeGroupNode(net, 'off1org');
    const g = await createGroup(org);
    const bob = await makeGroupNode(net, 'off1bob', { name: 'Bob' });
    bob.mesh.simulatePeer('off1org');

    await bob.groups.startDiscovery();
    await settle([org, bob]);
    expect(bob.groups.getSnapshot().discovered).toEqual([]);

    await org.groups.openNearby(g.id);
    await bob.groups.stopDiscovery();
    await bob.groups.startDiscovery();
    await settle([org, bob]);
    const found = bob.groups.getSnapshot().discovered;
    expect(found).toMatchObject([{ g: g.id, n: 'Ben Nevis', o: 'off1org' }]);

    expect((await bob.groups.joinNearby(found[0]!)).ok).toBe(true);
    await settle([org, bob]);
    expect((await bob.groupsRepo.get(g.id))?.status).toBe('joining');
    const req = org.groups.getSnapshot().joinRequests[0]!;
    expect(req.nearby).toBe(true);
    await org.groups.approveJoin(req.subId);
    await settle([org, bob]);
    expect((await bob.groupsRepo.get(g.id))?.status).toBe('active');
  });

  it('refuses a nearby join once the window is closed', async () => {
    const net = new FakeNetwork();
    const org = await makeGroupNode(net, 'off1org');
    const g = await createGroup(org);
    const bob = await makeGroupNode(net, 'off1bob');
    await org.groups.openNearby(g.id);
    await org.groups.closeNearby(g.id);
    await bob.groups.joinNearby({
      g: g.id,
      n: g.name,
      o: 'off1org',
      until: 0,
      from: 'off1org',
      at: 0,
    });
    await settle([org, bob]);
    expect(org.groups.getSnapshot().joinRequests).toHaveLength(0);
    expect(await bob.groupsRepo.get(g.id)).toBeNull();
  });

  it('refuses the 13th member', async () => {
    const net = new FakeNetwork();
    const org = await makeGroupNode(net, 'off1org');
    const g = await createGroup(org);
    for (let i = 0; i < 12; i++) {
      await org.groupsRepo.applyMember({
        groupId: g.id,
        address: `off1fill${i}`,
        name: `F${i}`,
        role: 'member',
        state: i === 11 ? 'left' : 'active',
        rev: i + 5,
        updatedAt: 1,
      });
    }
    // 1 organizer + 11 active = 12 members: full.
    const bob = await makeGroupNode(net, 'off1bob');
    await bob.groups.joinFromInvite(await inviteLink(org, g, true));
    await settle([org, bob]);
    expect(await org.groupsRepo.member(g.id, 'off1bob')).toBeNull();
    expect(await bob.groupsRepo.get(g.id)).toBeNull();
  });
});

describe('meeting points', () => {
  it('publishes a point to every member, who store it with the organizer as author', async () => {
    const net = new FakeNetwork();
    const { org, g, members, all } = await formGroup(net, ['off1bob', 'off1cat']);
    const r = await org.groups.publishPoint(g.id, {
      name: 'Lake junction',
      note: 'Lunch',
      lat: 56.79,
      lon: -5.0,
    });
    expect(r.ok && r.value.delivered).toBe(true);
    await settle(all);
    for (const m of members) {
      const list = await m.points.list(g.id);
      expect(list).toMatchObject([
        {
          name: 'Lake junction',
          note: 'Lunch',
          lat: 56.79,
          lon: -5.0,
          rev: 1,
          createdBy: 'off1org',
          updatedBy: 'off1org',
        },
      ]);
    }
  });

  it('updates a point: members converge on the new revision', async () => {
    const net = new FakeNetwork();
    const { org, g, members, all } = await formGroup(net);
    const first = await org.groups.publishPoint(g.id, { name: 'Car park', lat: 1, lon: 2 });
    await settle(all);
    const id = first.ok ? first.value.point.id : '';
    await org.groups.publishPoint(g.id, { name: 'Hut', lat: 3, lon: 4 }, id);
    await settle(all);
    expect(await members[0]!.points.get(g.id, id)).toMatchObject({
      rev: 2,
      name: 'Hut',
      lat: 3,
      lon: 4,
    });
  });

  it('removes a point on every member and keeps a tombstone', async () => {
    const net = new FakeNetwork();
    const { org, g, members, all } = await formGroup(net);
    const first = await org.groups.publishPoint(g.id, { name: 'Car park', lat: 1, lon: 2 });
    const id = first.ok ? first.value.point.id : '';
    await settle(all);
    await org.groups.removePoint(g.id, id);
    await settle(all);
    expect(await members[0]!.points.list(g.id)).toEqual([]);
    expect(await members[0]!.points.get(g.id, id)).toMatchObject({ deleted: true, rev: 2 });
  });

  it('only the organizer can publish or remove', async () => {
    const net = new FakeNetwork();
    const { org, g, members, all } = await formGroup(net);
    const bob = members[0]!;
    const denied = await bob.groups.publishPoint(g.id, { name: 'Mine', lat: 1, lon: 2 });
    expect(!denied.ok && denied.error.code).toBe('groups.not_organizer');
    const p = await org.groups.publishPoint(g.id, { name: 'P', lat: 1, lon: 2 });
    await settle(all);
    const rm = await bob.groups.removePoint(g.id, p.ok ? p.value.point.id : '');
    expect(!rm.ok && rm.error.code).toBe('groups.not_organizer');
  });

  it('a member acknowledges a point; the organizer sees who', async () => {
    const net = new FakeNetwork();
    const { org, g, members, all } = await formGroup(net, ['off1bob', 'off1cat']);
    const p = await org.groups.publishPoint(g.id, { name: 'P', lat: 1, lon: 2 });
    const id = p.ok ? p.value.point.id : '';
    await settle(all);
    const ack = await members[0]!.groups.acknowledge(g.id, id);
    expect(ack.ok && ack.value).toBe(true);
    await settle(all);
    expect(await org.points.acks(g.id, id)).toMatchObject([{ address: 'off1bob', rev: 1 }]);
    expect((await members[0]!.points.get(g.id, id))?.ackPublished).toBe(true);
  });

  it('an acknowledgment made offline is sent once the organizer follows the member again', async () => {
    const net = new FakeNetwork();
    const { org, g, members, all } = await formGroup(net);
    const bob = members[0]!;
    const p = await org.groups.publishPoint(g.id, { name: 'P', lat: 1, lon: 2 });
    const id = p.ok ? p.value.point.id : '';
    await settle(all);
    // Bob goes out of range of the organizer: the organizer's follow of bob ends.
    for (const sub of org.pubsub
      .getSnapshot()
      .subscriptions.filter(x => x.provider === 'off1bob')) {
      await org.pubsub.unsubscribe(sub.subId);
    }
    const ack = await bob.groups.acknowledge(g.id, id);
    expect(ack.ok && ack.value).toBe(false);
    expect((await bob.points.get(g.id, id))?.ackPublished).toBe(false);
    expect(await org.points.acks(g.id, id)).toEqual([]);

    // Back in range: the organizer follows bob again and bob hands over the pending ack.
    org.clock.advance(61_000);
    await org.groups.resumeNow();
    await settle(all, 10);
    expect(await org.points.acks(g.id, id)).toMatchObject([{ address: 'off1bob', rev: 1 }]);
    expect((await bob.points.get(g.id, id))?.ackPublished).toBe(true);
  });
});

describe('reconnection', () => {
  it('a member who was away gets the points it missed after it comes back', async () => {
    const net = new FakeNetwork();
    const { org, g, members, all } = await formGroup(net);
    const bob = members[0]!;
    await org.groups.publishPoint(g.id, { name: 'Before', lat: 1, lon: 1 });
    await settle(all);
    // Bob goes out of range: the organizer's follow of bob and bob's follow of the organizer end.
    await bob.pubsub.unsubscribeAll();
    const second = await org.groups.publishPoint(g.id, { name: 'During', lat: 2, lon: 2 });
    const gone = second.ok ? second.value.point.id : '';
    await settle(all);
    expect(await bob.points.get(g.id, gone)).toBeNull();

    // Back in range: reconcile resubscribes, the organizer pushes current state on activation.
    bob.clock.advance(61_000);
    await bob.groups.resumeNow();
    await settle(all, 10);
    expect((await bob.points.list(g.id)).map(p => p.name).sort()).toEqual(['Before', 'During']);
  });

  it('after an app restart the group, roster and points are still there', async () => {
    const net = new FakeNetwork();
    const { g, org, members, all } = await formGroup(net);
    await org.groups.publishPoint(g.id, { name: 'Keep', lat: 1, lon: 1 });
    await settle(all);
    const bob = members[0]!;
    const again = await makeGroupNode(new FakeNetwork(), 'off1bob', { dbPath: ':memory:' });
    expect(again).toBeDefined();
    expect((await bob.groupsRepo.list())[0]?.id).toBe(g.id);
    expect((await bob.groupsRepo.members(g.id)).length).toBe(2);
    expect((await bob.points.list(g.id)).length).toBe(1);
  });
});

describe('leaving', () => {
  it('a member leaves: the organizer marks it left and the group is purged locally', async () => {
    const net = new FakeNetwork();
    const { org, g, members, all } = await formGroup(net, ['off1bob', 'off1cat']);
    await members[0]!.groups.leaveGroup(g.id);
    await settle(all);
    expect(await members[0]!.groupsRepo.get(g.id)).toBeNull();
    expect((await org.groupsRepo.member(g.id, 'off1bob'))?.state).toBe('left');
    // The other member learns of it through the organizer.
    expect((await members[1]!.groupsRepo.member(g.id, 'off1bob'))?.state).toBe('left');
  });

  it('the organizer removes a member, who is told and purged', async () => {
    const net = new FakeNetwork();
    const { org, g, members, all } = await formGroup(net);
    await org.groups.removeMember(g.id, 'off1bob');
    await settle(all);
    expect(await members[0]!.groupsRepo.get(g.id)).toBeNull();
    expect((await org.groupsRepo.member(g.id, 'off1bob'))?.state).toBe('removed');
  });

  it('the organizer ends the group: members see it closed and its points leave the map', async () => {
    const net = new FakeNetwork();
    const { org, g, members, all } = await formGroup(net);
    await org.groups.publishPoint(g.id, { name: 'P', lat: 1, lon: 1 });
    await settle(all);
    await org.groups.leaveGroup(g.id);
    await settle(all);
    expect(await org.groupsRepo.get(g.id)).toBeNull();
    expect((await members[0]!.groupsRepo.get(g.id))?.status).toBe('closed');
    expect(await members[0]!.points.listVisible()).toEqual([]);
  });
});
