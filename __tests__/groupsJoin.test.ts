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
  it('name the joiner on the card, and the roster takes that name on approval', async () => {
    const net = new FakeNetwork();
    const { org, bob, g, invite, all } = await setup(net);
    await bob.groups.joinFromInvite(invite);
    await settle(all);
    const req = requestFrom(org, 'off1bob')!;
    expect(req.name).toBe('Bob');
    // Nothing gets through after approval, so no hello: the roster still says Bob, not a placeholder.
    net.lossRate = 1;
    await org.groups.approveJoin(req.subId);
    expect((await org.groupsRepo.member(g.id, 'off1bob'))?.name).toBe('Bob');
  });

  it('a name the joiner sends that is not valid is ignored', async () => {
    const net = new FakeNetwork();
    const { org, bob, invite, all } = await setup(net);
    await bob.kv.set('profile.name', 'x'.repeat(500));
    await bob.groups.joinFromInvite(invite);
    await settle(all);
    expect(requestFrom(org, 'off1bob')?.name).toBeNull();
  });

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
      JSON.stringify({ name: 'Bob' }),
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

/** The SDK ending the joiner's open join subscription, as its 120 s pending timeout does. */
function endJoinAttempt(bob: GroupNode, reason: string) {
  const sub = bob.pubsub.getSnapshot().subscriptions.find(s => s.topic.includes('/j/'))!;
  (bob.mesh as unknown as { subChanges: { emit(c: object): void } }).subChanges.emit({
    subId: sub.subId,
    role: 'consumer',
    serviceId: sub.serviceId,
    topic: sub.topic,
    peer: 'off1org',
    state: 'ended',
    reason,
  });
  return sub;
}

describe('slow links', () => {
  it('a join that times out before the organizer answers asks again, and still gets in', async () => {
    const net = new FakeNetwork();
    const { org, bob, g, invite, all } = await setup(net);
    await bob.groups.joinFromInvite(invite);
    await settle(all);
    const first = endJoinAttempt(bob, 'no_reply');
    await settle(all);
    expect((await bob.groupsRepo.get(g.id))?.status).toBe('joining');
    const second = bob.pubsub.getSnapshot().subscriptions.find(s => s.topic.includes('/j/'));
    expect(second?.subId).toBeDefined();
    expect(second?.subId).not.toBe(first.subId);
    // One card for Bob, the newest attempt.
    const cards = org.groups.getSnapshot().joinRequests.filter(r => r.sender === 'off1bob');
    expect(cards.map(c => c.subId)).toEqual([second!.subId]);
    await org.groups.approveJoin(cards[0]!.subId);
    await settle(all);
    expect((await bob.groupsRepo.get(g.id))?.status).toBe('active');
  });

  it('a "no" is not retried, and nor is a join older than the retry window', async () => {
    const net = new FakeNetwork();
    const { bob, g, invite, all } = await setup(net);
    await bob.groups.joinFromInvite(invite);
    await settle(all);
    endJoinAttempt(bob, 'rejected');
    await settle(all);
    expect(await bob.groupsRepo.get(g.id)).toBeNull();

    await bob.groups.joinFromInvite(invite);
    await settle(all);
    bob.clock.advance(11 * 60_000);
    endJoinAttempt(bob, 'session_timeout');
    await settle(all);
    expect(await bob.groupsRepo.get(g.id)).toBeNull();
    expect(bob.groups.getSnapshot().notices[0]?.text).toMatch(/could not be reached/);
  });
});

describe('members that are gone', () => {
  it('a member out of range is asked less and less often, and at once when back', async () => {
    const net = new FakeNetwork();
    const { org, bob, g, invite, all } = await setup(net, true);
    await bob.groups.joinFromInvite(invite);
    await settle(all);
    expect((await org.groupsRepo.member(g.id, 'off1bob'))?.state).toBe('active');
    // Bob uninstalls: nothing answers any more, and the SDK ends each attempt (its 120 s
    // pending timeout, or the provider being unreachable).
    net.nodes.delete('off1bob');
    const endBobSubs = async () => {
      for (const s of org.pubsub
        .getSnapshot()
        .subscriptions.filter(x => x.provider === 'off1bob' && x.state !== 'ended')) {
        (org.mesh as unknown as { subChanges: { emit(c: object): void } }).subChanges.emit({
          subId: s.subId,
          role: 'consumer',
          serviceId: s.serviceId,
          topic: s.topic,
          peer: 'off1bob',
          state: 'ended',
          reason: 'no_reply',
        });
      }
      await settle(all);
    };
    await endBobSubs();
    const subscribe = jest.spyOn(org.mesh.services, 'subscribe');
    const bobCalls = () => subscribe.mock.calls.filter(c => c[0] === 'off1bob').length;
    // Polled every minute for 16 minutes. Without the back-off that is 16 rounds of four
    // subscribes; with waits of 1, 2, 4, 8 minutes it is four.
    const counts: number[] = [];
    for (let i = 0; i < 16; i++) {
      org.clock.advance(60_000);
      await org.groups.resumeNow();
      await settle(all);
      counts.push(bobCalls());
      await endBobSubs();
    }
    const rounds = new Set([0, ...counts]).size - 1;
    expect(rounds).toBeGreaterThan(0);
    expect(rounds).toBeLessThanOrEqual(4);
    // Back in range: asked straight away.
    const before = counts[counts.length - 1]!;
    org.mesh.simulatePeer('off1bob');
    await settle(all);
    expect(subscribe.mock.calls.filter(c => c[0] === 'off1bob').length).toBeGreaterThan(before);
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
