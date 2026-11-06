import { parseInviteLink } from '../src/domain/groups/invite';
import { BEACON_TOPIC } from '../src/mesh/groupTopics';
import { FakeNetwork } from '../src/testing/FakeMesh';
import { GroupNode, makeGroupNode, settle } from '../src/testing/groupNode';

/**
 * Join requests reaching the organizer and staying there until it decides. Each case is a way the
 * request used to vanish or never arrive on a device.
 */
async function setup(net: FakeNetwork, autoApprove = false) {
  const org = await makeGroupNode(net, 'off1org', { name: 'Olive' });
  const bob = await makeGroupNode(net, 'off1bob', { name: 'Bob', clock: org.clock });
  const created = await org.groups.createGroup({ name: 'Ben Nevis' });
  if (!created.ok) {
    throw new Error('group');
  }
  const inv = await org.groups.createInvite(created.value.id, { autoApprove });
  const parsed = inv.ok ? parseInviteLink(inv.value.link) : null;
  if (!parsed || !parsed.ok) {
    throw new Error('invite');
  }
  return { org, bob, g: created.value, invite: parsed.invite, all: [org, bob] as GroupNode[] };
}

const requestFrom = (org: GroupNode, sender: string) =>
  org.groups.getSnapshot().joinRequests.find(r => r.sender === sender);

describe('join requests', () => {
  it('survive the SDK approval timeout: the organizer can approve minutes later', async () => {
    const net = new FakeNetwork();
    const { org, bob, g, invite, all } = await setup(net);
    await bob.groups.joinFromInvite(invite);
    await settle(all);
    expect(requestFrom(org, 'off1bob')).toBeDefined();
    // 60 s pass with the card on screen. The SDK rejects anything it is still asking about.
    org.mesh.expireUnanswered();
    await settle(all);
    expect(requestFrom(org, 'off1bob')).toBeDefined();
    expect((await bob.groupsRepo.get(g.id))?.status).toBe('joining');
    const req = requestFrom(org, 'off1bob')!;
    expect((await org.groups.approveJoin(req.subId)).ok).toBe(true);
    await settle(all);
    expect((await bob.groupsRepo.get(g.id))?.status).toBe('active');
    expect((await org.groupsRepo.member(g.id, 'off1bob'))?.state).toBe('active');
  });

  it('a joiner can ask again after a request ended, and the organizer sees the new one', async () => {
    const net = new FakeNetwork();
    const { org, bob, g, invite, all } = await setup(net);
    await bob.groups.joinFromInvite(invite);
    await settle(all);
    await org.groups.rejectJoin(requestFrom(org, 'off1bob')!.subId);
    await settle(all);
    expect(await bob.groupsRepo.get(g.id)).toBeNull();

    const subscribe = jest.spyOn(bob.mesh.services, 'subscribe');
    expect((await bob.groups.joinFromInvite(invite)).ok).toBe(true);
    await settle(all);
    // A new subscription reached the SDK, not the id of the one that ended.
    expect(subscribe).toHaveBeenCalledWith(
      'off1org',
      expect.any(String),
      expect.stringContaining('/j/'),
      'latest',
    );
    const req = requestFrom(org, 'off1bob');
    expect(req).toBeDefined();
    await org.groups.approveJoin(req!.subId);
    await settle(all);
    expect((await bob.groupsRepo.get(g.id))?.status).toBe('active');
  });

  it('a request cancelled by the joiner leaves the organizer, and approving it adds no one', async () => {
    const net = new FakeNetwork();
    const { org, bob, g, invite, all } = await setup(net);
    await bob.groups.joinFromInvite(invite);
    await settle(all);
    const req = requestFrom(org, 'off1bob')!;
    await bob.groups.leaveGroup(g.id);
    await settle(all);
    expect(requestFrom(org, 'off1bob')).toBeUndefined();
    // A card still on screen when the organizer presses Approve.
    (org.groups as unknown as { setRt(p: object): void }).setRt({ joinRequests: [req] });
    const r = await org.groups.approveJoin(req.subId);
    expect(!r.ok && r.error.code).toBe('groups.request_expired');
    expect(await org.groupsRepo.member(g.id, 'off1bob')).toBeNull();
  });

  it('a declined joiner is told why, and holds no subscription to the organizer', async () => {
    const net = new FakeNetwork();
    const { org, bob, g, invite, all } = await setup(net);
    await bob.groups.joinFromInvite(invite);
    await settle(all);
    await org.groups.rejectJoin(requestFrom(org, 'off1bob')!.subId);
    await settle(all);
    expect(await bob.groupsRepo.get(g.id)).toBeNull();
    expect(bob.groups.getSnapshot().notices[0]?.text).toMatch(/did not accept/);
    expect(bob.pubsub.getSnapshot().subscriptions.filter(s => s.topic.includes('/j/'))).toEqual([]);
  });

  it('once in, the joiner drops the join topic and follows the group topics', async () => {
    const net = new FakeNetwork();
    const { bob, g, invite, all } = await setup(net, true);
    await bob.groups.joinFromInvite(invite);
    await settle(all);
    expect((await bob.groupsRepo.get(g.id))?.status).toBe('active');
    const topics = bob.pubsub.getSnapshot().subscriptions.map(s => s.topic);
    expect(topics.some(t => t.includes('/j/'))).toBe(false);
    expect(topics).toContain(`tm/1/${g.id}/member`);
    expect(
      bob.groups.getSnapshot().notices.filter(n => n.text.startsWith('You joined')),
    ).toHaveLength(1);
  });

  it('mesh noise (diagnostics, signal readings) does not queue work ahead of a request', async () => {
    const net = new FakeNetwork();
    const { org, all } = await setup(net);
    org.mesh.simulatePeer('off1bob');
    await settle(all);
    const list = jest.spyOn(org.groupsRepo, 'list');
    for (let i = 0; i < 200; i++) {
      org.mesh.simulatePeer('off1bob', { rssi: -40 - (i % 30) });
    }
    await settle(all);
    expect(list).not.toHaveBeenCalled();
    // A real change still triggers one resume.
    org.mesh.simulatePeer('off1eve');
    await settle(all);
    expect(list).toHaveBeenCalled();
  });

  it('a burst of real changes runs resume once, not once per change', async () => {
    const net = new FakeNetwork();
    const { org, all } = await setup(net);
    await settle(all);
    const list = jest.spyOn(org.groupsRepo, 'list');
    for (let i = 0; i < 50; i++) {
      org.mesh.simulatePeer(`off1p${i}`);
    }
    await settle(all);
    expect(list.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe('nearby discovery', () => {
  it('follows a nearby phone once, and hears its beacon the moment its group opens', async () => {
    const net = new FakeNetwork();
    const { org, bob, g, all } = await setup(net);
    bob.mesh.simulatePeer('off1org');
    const subscribe = jest.spyOn(bob.mesh.services, 'subscribe');
    await bob.groups.startDiscovery();
    for (let i = 0; i < 10; i++) {
      await bob.groups.resumeNow();
      await settle(all);
    }
    const beaconSubs = () => subscribe.mock.calls.filter(c => c[2] === BEACON_TOPIC).length;
    expect(beaconSubs()).toBe(1);
    expect(bob.groups.getSnapshot().discovered).toEqual([]);

    await org.groups.openNearby(g.id);
    await settle(all);
    expect(bob.groups.getSnapshot().discovered).toMatchObject([{ g: g.id, o: 'off1org' }]);
    expect(beaconSubs()).toBe(1);

    await org.groups.closeNearby(g.id);
    await settle(all);
    expect(bob.groups.getSnapshot().discovered).toEqual([]);
  });

  it('a nearby request needs approval and is refused once the window closes', async () => {
    const net = new FakeNetwork();
    const { org, bob, g, all } = await setup(net);
    await org.groups.openNearby(g.id);
    const found = { g: g.id, n: g.name, o: 'off1org', until: 0, from: 'off1org', at: 0 };
    await bob.groups.joinNearby(found);
    await settle(all);
    expect(requestFrom(org, 'off1bob')?.nearby).toBe(true);
    await bob.groups.leaveGroup(g.id);
    await org.groups.closeNearby(g.id);
    await settle(all);
    await bob.groups.joinNearby(found);
    await settle(all);
    expect(requestFrom(org, 'off1bob')).toBeUndefined();
    expect(await bob.groupsRepo.get(g.id)).toBeNull();
  });
});
