import { GROUP_SERVICE_ID, GroupChannel, groupTopic } from '../src/mesh/groupTopics';
import { parseInviteLink } from '../src/domain/groups/invite';
import { FakeNetwork } from '../src/testing/FakeMesh';
import { GroupNode, makeGroupNode, settle } from '../src/testing/groupNode';

async function formGroup(net: FakeNetwork, joiners = ['off1bob', 'off1cat']) {
  const org = await makeGroupNode(net, 'off1org', { name: 'Olive' });
  const created = await org.groups.createGroup({ name: 'Trip' });
  const g = created.ok ? created.value : (undefined as never);
  const members: GroupNode[] = [];
  for (const a of joiners) {
    const n = await makeGroupNode(net, a, { name: a.slice(4) });
    members.push(n);
    const inv = await org.groups.createInvite(g.id, { autoApprove: true });
    const link = inv.ok ? parseInviteLink(inv.value.link) : null;
    await n.groups.joinFromInvite(link && link.ok ? link.invite : (undefined as never));
    await settle([org, ...members]);
  }
  return { org, g, members, all: [org, ...members] };
}

let envCounter = 0;
const envelope = (t: string, a: string, p: Record<string, unknown>) =>
  JSON.stringify({ tm: 1, id: `01FORGED${String(++envCounter).padStart(6, '0')}`, t, a, ts: 1, p });

const pointPayload = (id: string, rev: number, by: string, over: Record<string, unknown> = {}) => ({
  id,
  rev,
  name: `v${rev}`,
  lat: 10,
  lon: 20,
  by,
  createdBy: by,
  createdAt: 1,
  ts: rev,
  ...over,
});

/** Publish a hand-built (possibly forged) envelope from `node`'s own service. */
const raw = (node: GroupNode, topic: string, body: string, key: string) =>
  node.mesh.services.publish(GROUP_SERVICE_ID, topic, body, key);

/** Open a route a normal client would not have, so the receiver's own checks are what is tested. */
async function route(from: GroupNode, to: GroupNode, topic: string) {
  await to.mesh.services.registerService(GROUP_SERVICE_ID, '1');
  await to.mesh.services.setPolicy(GROUP_SERVICE_ID, 'accept_all');
  await from.pubsub.subscribe({
    provider: to.address,
    serviceId: GROUP_SERVICE_ID,
    topic,
    mode: 'latest',
  });
}

describe('unauthorized updates are never applied', () => {
  it('a non-member cannot publish a meeting point to a member', async () => {
    const net = new FakeNetwork();
    const { g, members, all } = await formGroup(net);
    const bob = members[0]!;
    const eve = await makeGroupNode(net, 'off1eve');
    const topic = groupTopic(g.id, GroupChannel.point);
    await route(bob, eve, topic);
    await raw(eve, topic, envelope('point', 'off1eve', pointPayload('P1', 1, 'off1eve')), 'P1');
    await settle([...all, eve]);
    expect(await bob.points.get(g.id, 'P1')).toBeNull();
  });

  it('another member cannot publish a meeting point either', async () => {
    const net = new FakeNetwork();
    const { g, members, all } = await formGroup(net);
    const [bob, cat] = members as [GroupNode, GroupNode];
    const topic = groupTopic(g.id, GroupChannel.point);
    await route(bob, cat, topic);
    await raw(cat, topic, envelope('point', 'off1cat', pointPayload('P1', 9, 'off1cat')), 'P1');
    await settle(all);
    expect(await bob.points.get(g.id, 'P1')).toBeNull();
  });

  it('an update that claims the organizer as author but arrives from someone else is dropped', async () => {
    const net = new FakeNetwork();
    const { g, members, all } = await formGroup(net);
    const [bob, cat] = members as [GroupNode, GroupNode];
    const topic = groupTopic(g.id, GroupChannel.point);
    await route(bob, cat, topic);
    await raw(cat, topic, envelope('point', 'off1org', pointPayload('P1', 9, 'off1org')), 'P1');
    await settle(all);
    expect(await bob.points.get(g.id, 'P1')).toBeNull();
  });

  it('the organizer itself is refused when the envelope author is not the sender', async () => {
    const net = new FakeNetwork();
    const { org, g, members, all } = await formGroup(net);
    const topic = groupTopic(g.id, GroupChannel.point);
    await raw(org, topic, envelope('point', 'off1cat', pointPayload('P1', 1, 'off1org')), 'P1');
    await settle(all);
    expect(await members[0]!.points.get(g.id, 'P1')).toBeNull();
  });

  it('a point whose author field names someone other than the organizer is dropped', async () => {
    const net = new FakeNetwork();
    const { org, g, members, all } = await formGroup(net);
    const topic = groupTopic(g.id, GroupChannel.point);
    await raw(org, topic, envelope('point', 'off1org', pointPayload('P1', 1, 'off1cat')), 'P1');
    await settle(all);
    expect(await members[0]!.points.get(g.id, 'P1')).toBeNull();
  });

  it('roster events from anyone but the organizer are ignored', async () => {
    const net = new FakeNetwork();
    const { g, members, all } = await formGroup(net);
    const [bob, cat] = members as [GroupNode, GroupNode];
    const topic = groupTopic(g.id, GroupChannel.member);
    await route(bob, cat, topic);
    await raw(
      cat,
      topic,
      envelope('removed', 'off1cat', { addr: 'off1bob', name: 'bob', role: 'member', rev: 99 }),
      'off1bob',
    );
    await settle(all);
    expect((await bob.groupsRepo.get(g.id))?.status).toBe('active');
    expect((await bob.groupsRepo.member(g.id, 'off1bob'))?.state).toBe('active');
  });

  it('the organizer ignores acks, hellos and syncs from a non-member', async () => {
    const net = new FakeNetwork();
    const { org, g, all } = await formGroup(net);
    const p = await org.groups.publishPoint(g.id, { name: 'P', lat: 1, lon: 2 });
    const id = p.ok ? p.value.point.id : '';
    const eve = await makeGroupNode(net, 'off1eve');
    for (const ch of [GroupChannel.ack, GroupChannel.member, GroupChannel.sync]) {
      await route(org, eve, groupTopic(g.id, ch));
    }
    await raw(
      eve,
      groupTopic(g.id, GroupChannel.ack),
      envelope('ack', 'off1eve', { pointId: id, rev: 1 }),
      id,
    );
    await raw(
      eve,
      groupTopic(g.id, GroupChannel.member),
      envelope('hello', 'off1eve', { name: 'Eve', appV: 1 }),
      'off1eve',
    );
    await raw(
      eve,
      groupTopic(g.id, GroupChannel.sync),
      envelope('sync_request', 'off1eve', { mrev: 0, points: [] }),
      'sync',
    );
    await settle([...all, eve]);
    expect(await org.points.acks(g.id, id)).toEqual([]);
    expect(await org.groupsRepo.member(g.id, 'off1eve')).toBeNull();
  });

  it('refuses a subscription to group state from someone who is not in the group', async () => {
    const net = new FakeNetwork();
    const { org, g, all } = await formGroup(net);
    const eve = await makeGroupNode(net, 'off1eve');
    await eve.pubsub.subscribe({
      provider: 'off1org',
      serviceId: GROUP_SERVICE_ID,
      topic: groupTopic(g.id, GroupChannel.point),
      mode: 'latest',
    });
    await settle([...all, eve]);
    await org.groups.publishPoint(g.id, { name: 'Secret', lat: 1, lon: 2 });
    await settle([...all, eve]);
    expect(await eve.points.listAll(g.id)).toEqual([]);
    expect(eve.pubsub.getSnapshot().received).toEqual([]);
  });

  it('a member cannot be followed by anyone but the organizer', async () => {
    const net = new FakeNetwork();
    const { g, members, all } = await formGroup(net);
    const [bob, cat] = members as [GroupNode, GroupNode];
    await cat.pubsub.subscribe({
      provider: bob.address,
      serviceId: GROUP_SERVICE_ID,
      topic: groupTopic(g.id, GroupChannel.ack),
      mode: 'latest',
    });
    await settle(all);
    const sub = cat.pubsub.getSnapshot().subscriptions.find(s => s.provider === 'off1bob');
    expect(sub?.state).not.toBe('active');
  });

  it('malformed or out-of-range payloads are rejected without crashing', async () => {
    const net = new FakeNetwork();
    const { org, g, members, all } = await formGroup(net);
    const topic = groupTopic(g.id, GroupChannel.point);
    await raw(
      org,
      topic,
      envelope('point', 'off1org', pointPayload('P1', 1, 'off1org', { lat: 999 })),
      'P1',
    );
    await raw(org, topic, envelope('point', 'off1org', pointPayload('P2', -4, 'off1org')), 'P2');
    await raw(org, topic, envelope('point', 'off1org', { id: 'P3' }), 'P3');
    await raw(org, topic, 'not json at all', 'P4');
    await raw(
      org,
      topic,
      envelope('point', 'off1org', pointPayload('P5', 1, 'off1org', { name: 'x'.repeat(500) })),
      'P5',
    );
    await settle(all);
    expect(await members[0]!.points.listAll(g.id)).toEqual([]);
    expect(members[0]!.pubsub.getSnapshot().rejected).toBeGreaterThan(0);
  });
});

describe('duplicates and ordering', () => {
  it('a duplicated delivery is applied once and recorded as a duplicate', async () => {
    const net = new FakeNetwork();
    const { org, g, members, all } = await formGroup(net);
    net.duplicate = true;
    const p = await org.groups.publishPoint(g.id, { name: 'Once', lat: 1, lon: 2 });
    await settle(all);
    const bob = members[0]!;
    expect(await bob.points.list(g.id)).toHaveLength(1);
    expect(bob.pubsub.getSnapshot().duplicates).toBeGreaterThan(0);
    const rows = await bob.db.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM events WHERE type = 'point' AND group_id = ?",
      [g.id],
    );
    expect(rows[0]?.n).toBe(1);
    expect(p.ok).toBe(true);
  });

  it('re-sending the same version under a new envelope changes nothing', async () => {
    const net = new FakeNetwork();
    const { org, g, members, all } = await formGroup(net);
    const bob = members[0]!;
    const p = await org.groups.publishPoint(g.id, { name: 'Same', lat: 1, lon: 2 });
    const id = p.ok ? p.value.point.id : '';
    await settle(all);
    const before = await bob.points.get(g.id, id);
    const topic = groupTopic(g.id, GroupChannel.point);
    const payload = pointPayload(id, 1, 'off1org', {
      name: 'Same',
      lat: 1,
      lon: 2,
      ts: before!.updatedAt,
      createdAt: before!.createdAt,
    });
    await raw(org, topic, envelope('point', 'off1org', payload), id);
    await settle(all);
    expect(await bob.points.get(g.id, id)).toEqual(before);
  });

  it('out-of-order updates and a removal leave the highest revision in place', async () => {
    const net = new FakeNetwork();
    const { org, g, members, all } = await formGroup(net);
    const bob = members[0]!;
    const topic = groupTopic(g.id, GroupChannel.point);
    const gone = groupTopic(g.id, GroupChannel.pointRemoved);
    await raw(org, topic, envelope('point', 'off1org', pointPayload('P1', 3, 'off1org')), 'P1');
    await raw(org, topic, envelope('point', 'off1org', pointPayload('P1', 2, 'off1org')), 'P1');
    await settle(all);
    expect(await bob.points.get(g.id, 'P1')).toMatchObject({ rev: 3, name: 'v3', deleted: false });
    await raw(
      org,
      gone,
      envelope('point_removed', 'off1org', { id: 'P1', rev: 5, by: 'off1org', ts: 5 }),
      'P1',
    );
    await raw(org, topic, envelope('point', 'off1org', pointPayload('P1', 4, 'off1org')), 'P1');
    await settle(all);
    expect(await bob.points.get(g.id, 'P1')).toMatchObject({ rev: 5, deleted: true });
    expect(await bob.points.list(g.id)).toEqual([]);
  });

  it('a removal that arrives before the point keeps the point removed', async () => {
    const net = new FakeNetwork();
    const { org, g, members, all } = await formGroup(net);
    const bob = members[0]!;
    await raw(
      org,
      groupTopic(g.id, GroupChannel.pointRemoved),
      envelope('point_removed', 'off1org', { id: 'P9', rev: 4, by: 'off1org', ts: 4 }),
      'P9',
    );
    await raw(
      org,
      groupTopic(g.id, GroupChannel.point),
      envelope('point', 'off1org', pointPayload('P9', 2, 'off1org')),
      'P9',
    );
    await settle(all);
    expect(await bob.points.list(g.id)).toEqual([]);
    expect(await bob.points.get(g.id, 'P9')).toMatchObject({ deleted: true, rev: 4 });
  });
});

describe('synchronisation request', () => {
  it('a member that lost its copy asks the organizer and gets the point back', async () => {
    const net = new FakeNetwork();
    const { org, g, members, all } = await formGroup(net);
    const bob = members[0]!;
    const p = await org.groups.publishPoint(g.id, { name: 'Again', lat: 1, lon: 2 });
    const id = p.ok ? p.value.point.id : '';
    await settle(all);
    await bob.db.run('DELETE FROM meeting_points');
    expect(await bob.points.get(g.id, id)).toBeNull();
    expect(await bob.groups.requestSync(g.id)).toBe(true);
    await settle(all);
    expect(await bob.points.get(g.id, id)).toMatchObject({ name: 'Again', rev: 1 });
  });

  it('a stale member learns the new roster from a sync reply', async () => {
    const net = new FakeNetwork();
    const { g, members, all } = await formGroup(net);
    const bob = members[0]!;
    await bob.db.run("DELETE FROM group_members WHERE address = 'off1cat'");
    await bob.db.run('UPDATE groups SET member_rev = 0');
    await bob.groups.requestSync(g.id);
    await settle(all);
    expect((await bob.groupsRepo.member(g.id, 'off1cat'))?.state).toBe('active');
  });
});
