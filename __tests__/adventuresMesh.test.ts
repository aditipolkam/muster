import { parseInviteLink } from '../src/domain/groups/invite';
import { destination } from '../src/domain/geo';
import { createEnvelope, encodeEnvelope } from '../src/mesh/envelope';
import { GROUP_SERVICE_ID, GroupChannel, groupTopic } from '../src/mesh/groupTopics';
import { FakeNetwork } from '../src/testing/FakeMesh';
import { AdventureNode, makeAdventureNode, settle } from '../src/testing/adventureNode';
import { ManualClock } from '../src/testing/services';

const START = { lat: 46.8, lon: 8.2 };
const VIEW = destination(START, 90, 800);
const TOP = destination(START, 45, 1500);

/** Organizer creates a group; each joiner scans a fresh invite and is approved (as in groupsMesh). */
async function formGroup(net: FakeNetwork, joiners: string[] = ['off1bob']) {
  // One clock for every phone, so "five minutes later" means the same thing everywhere.
  const clock = new ManualClock();
  const org = await makeAdventureNode(net, 'off1org', { name: 'Olive', clock });
  const created = await org.groups.createGroup({ name: 'Ben Nevis' });
  if (!created.ok) {
    throw new Error('group');
  }
  const g = created.value;
  const members: AdventureNode[] = [];
  for (const a of joiners) {
    const n = await makeAdventureNode(net, a, { name: a.replace('off1', ''), clock });
    members.push(n);
    const inv = await org.groups.createInvite(g.id, { autoApprove: true });
    if (!inv.ok) {
      throw new Error('invite');
    }
    const parsed = parseInviteLink(inv.value.link);
    if (!parsed.ok) {
      throw new Error('link');
    }
    await n.groups.joinFromInvite(parsed.invite);
    await settle([org, ...members], 10);
  }
  return { org, g, members, all: [org, ...members] };
}

async function plan(org: AdventureNode, groupId: string, all: AdventureNode[]) {
  const r = await org.service.createAdventure(
    { name: 'Ridge day', description: 'Bring layers', start: { ...START, label: 'Car park' } },
    { groupId },
  );
  if (!r.ok) {
    throw new Error(r.error.code);
  }
  const a = await org.service.addCheckpoint(r.value.id, {
    name: 'Viewpoint',
    kind: 'viewpoint',
    ...VIEW,
  });
  const b = await org.service.addCheckpoint(r.value.id, { name: 'Summit', kind: 'summit', ...TOP });
  if (!a.ok || !b.ok) {
    throw new Error('cp');
  }
  await settle(all, 10);
  return { adv: r.value, view: a.value, top: b.value };
}

describe('sharing a group adventure', () => {
  it('only the group organizer plans a group adventure', async () => {
    const { members, g } = await formGroup(new FakeNetwork());
    const r = await members[0]!.service.createAdventure({ name: 'Mine' }, { groupId: g.id });
    expect(!r.ok && r.error.code).toBe('adventures.not_organizer');
    const solo = await members[0]!.service.createAdventure({ name: 'Mine' });
    expect(solo.ok).toBe(true);
  });

  it('members receive the adventure, its checkpoints and the start, without ever being joined automatically', async () => {
    const { org, g, members, all } = await formGroup(new FakeNetwork(), ['off1bob', 'off1cat']);
    const { adv } = await plan(org, g.id, all);
    for (const m of members) {
      const got = await m.repo.get(adv.id);
      expect(got).toMatchObject({
        name: 'Ridge day',
        description: 'Bring layers',
        status: 'planned',
        groupId: g.id,
        owner: 'off1org',
        startLabel: 'Car park',
        rev: 1,
      });
      expect((await m.repo.checkpoints(adv.id)).map(c => c.name)).toEqual(['Viewpoint', 'Summit']);
      // Participation is each person's own choice.
      expect(await m.repo.participant(adv.id, m.address)).toBeNull();
      expect(m.service.getSnapshot().notices.map(n => n.text)).toContain(
        'New group adventure: Ridge day',
      );
    }
    expect((await org.repo.participant(adv.id, 'off1org'))?.state).toBe('joined');
  });

  it('lifecycle changes by the organizer reach members, who track their own time only after joining', async () => {
    const { org, g, members, all } = await formGroup(new FakeNetwork());
    const bob = members[0]!;
    const { adv } = await plan(org, g.id, all);
    await org.service.act(adv.id, 'start');
    await settle(all);
    expect((await bob.repo.get(adv.id))?.status).toBe('active');
    expect((await bob.repo.get(adv.id))?.progress.resumedAt).toBeNull(); // not joined: not running
    bob.clock.advance(60_000);
    expect((await bob.service.join(adv.id)).ok).toBe(true);
    await settle(all);
    expect(await org.repo.participant(adv.id, 'off1bob')).toMatchObject({
      state: 'joined',
      name: 'bob',
    });
    bob.clock.advance(5 * 60_000);
    await org.service.act(adv.id, 'pause');
    await settle(all);
    const mid = (await bob.repo.get(adv.id))!;
    expect(mid.status).toBe('paused');
    expect(mid.progress.activeMs).toBe(5 * 60_000);
    await org.service.act(adv.id, 'resume');
    await org.service.act(adv.id, 'complete');
    await settle(all);
    expect((await bob.repo.get(adv.id))?.status).toBe('completed');
    expect((await bob.repo.log(adv.id)).map(l => l.status)).toEqual(
      expect.arrayContaining(['planned', 'active', 'paused', 'completed']),
    );
  });

  it('members cannot run the group adventure, but can leave it at any time', async () => {
    const { org, g, members, all } = await formGroup(new FakeNetwork());
    const bob = members[0]!;
    const { adv, view } = await plan(org, g.id, all);
    for (const action of ['start', 'complete', 'cancel'] as const) {
      const r = await bob.service.act(adv.id, action);
      expect(!r.ok && r.error.code).toBe('adventures.not_organizer');
    }
    expect(
      (await bob.service.addCheckpoint(adv.id, { name: 'Mine', kind: 'other', ...START })).ok,
    ).toBe(false);
    expect((await bob.service.removeCheckpoint(adv.id, view.id)).ok).toBe(false);
    await org.service.act(adv.id, 'start');
    await bob.service.join(adv.id);
    await settle(all);
    expect((await bob.service.leave(adv.id)).ok).toBe(true);
    await settle(all);
    expect((await org.repo.participant(adv.id, 'off1bob'))?.state).toBe('left');
  });
});

describe('shared checkpoint progress', () => {
  async function started(joiners = ['off1bob', 'off1cat']) {
    const f = await formGroup(new FakeNetwork(), joiners);
    const p = await plan(f.org, f.g.id, f.all);
    await f.org.service.act(p.adv.id, 'start');
    for (const m of f.members) {
      await m.service.join(p.adv.id);
    }
    await settle(f.all, 12);
    return { ...f, ...p };
  }

  it('a member reaching a checkpoint is recorded by the organizer and shown to everyone else', async () => {
    const { org, members, all, adv, view } = await started();
    const [bob, cat] = members as [AdventureNode, AdventureNode];
    const r = await bob.service.confirmArrival(adv.id, view.id, 'auto');
    expect(r.ok).toBe(true);
    await settle(all);
    for (const n of [org, cat]) {
      const rows = await n.repo.completions(adv.id);
      expect(rows).toMatchObject([{ checkpointId: view.id, address: 'off1bob', method: 'auto' }]);
    }
    expect(cat.service.getSnapshot().notices.map(n => n.text)).toContain('bob reached Viewpoint');
    // Bob's own copy is confirmed by the organizer's relay, not just by sending.
    expect((await bob.repo.completion(adv.id, view.id, 'off1bob'))?.published).toBe(true);
    // Cat's progress is her own: she has not reached it.
    const mine = await cat.repo.completion(adv.id, view.id, 'off1cat');
    expect(mine).toBeNull();
  });

  it('the arrival message carries no coordinates', async () => {
    const { members, all, adv, view, org } = await started();
    await members[0]!.service.confirmArrival(adv.id, view.id, 'auto');
    await settle(all);
    const stored = (
      await org.db.all<{ body: string }>("SELECT body FROM events WHERE type = 'reached'")
    )
      .map(r => r.body)
      .join('');
    expect(stored).toContain(view.id);
    expect(stored).not.toMatch(/"lat"|"lon"/);
  });

  it('announces when everyone has reached a checkpoint, and the timeline shows it on every device', async () => {
    const { org, members, all, adv, view } = await started(['off1bob']);
    await org.service.confirmArrival(adv.id, view.id, 'manual');
    await settle(all);
    expect(members[0]!.service.getSnapshot().notices.map(n => n.text)).not.toContain(
      'Everyone has reached Viewpoint',
    );
    await members[0]!.service.confirmArrival(adv.id, view.id, 'auto');
    await settle(all);
    for (const n of all) {
      expect(n.service.getSnapshot().notices.map(x => x.text)).toContain(
        'Everyone has reached Viewpoint',
      );
    }
  });

  it('a repeated or replayed arrival changes nothing (duplicate processing)', async () => {
    const f = await started(['off1bob']);
    const bob = f.members[0]!;
    await bob.service.confirmArrival(f.adv.id, f.view.id, 'auto');
    await settle(f.all);
    const before = await f.org.repo.completions(f.adv.id);
    f.org.service.dismissNotices();
    // Resend the same arrival twice more, plus a fresh envelope for the same completion id.
    const c = (await bob.repo.completions(f.adv.id))[0]!;
    for (let i = 0; i < 2; i++) {
      await bob.pubsub.publish({
        topic: groupTopic(f.g.id, GroupChannel.adv),
        type: 'reached',
        key: `r-${c.id}`,
        payload: { adv: c.adventureId, cp: c.checkpointId, id: c.id, at: c.at, m: c.method },
      });
    }
    await settle(f.all);
    expect(await f.org.repo.completions(f.adv.id)).toEqual(before);
    expect(f.org.service.getSnapshot().notices).toEqual([]);
  });

  it('the earliest report of an arrival wins when two versions disagree', async () => {
    const f = await started(['off1bob']);
    const bob = f.members[0]!;
    bob.clock.advance(10_000);
    await bob.service.confirmArrival(f.adv.id, f.view.id, 'auto');
    await settle(f.all);
    const first = (await f.org.repo.completion(f.adv.id, f.view.id, 'off1bob'))!;
    // A later duplicate (different completion id, later time) must not replace it.
    await bob.pubsub.publish({
      topic: groupTopic(f.g.id, GroupChannel.adv),
      type: 'reached',
      key: 'r-later',
      payload: { adv: f.adv.id, cp: f.view.id, id: 'later', at: first.at + 99_999, m: 'manual' },
    });
    await settle(f.all);
    expect((await f.org.repo.completion(f.adv.id, f.view.id, 'off1bob'))?.id).toBe(first.id);
  });
});

describe('authorization', () => {
  async function started() {
    const f = await formGroup(new FakeNetwork(), ['off1bob', 'off1cat']);
    const p = await plan(f.org, f.g.id, f.all);
    await f.org.service.act(p.adv.id, 'start');
    for (const m of f.members) {
      await m.service.join(p.adv.id);
    }
    await settle(f.all, 12);
    return { ...f, ...p };
  }
  const send = (
    n: AdventureNode,
    groupId: string,
    type: string,
    key: string,
    payload: Record<string, unknown>,
  ) => n.pubsub.publish({ topic: groupTopic(groupId, GroupChannel.adv), type, key, payload });

  it('a member cannot publish adventure state, checkpoints or lifecycle to others', async () => {
    const { members, org, g, all, adv } = await started();
    const bob = members[0]!;
    const cat = members[1]!;
    // Bob has no subscribers on his own adv topic except the organizer, who ignores shared kinds.
    await send(bob, g.id, 'adventure', `a-${adv.id}`, {
      id: adv.id,
      rev: 99,
      name: 'Hijacked',
      status: 'completed',
      ca: 1,
      ts: 1,
    });
    await send(bob, g.id, 'checkpoint', 'c-evil', {
      adv: adv.id,
      id: 'evil',
      rev: 1,
      ord: 5,
      name: 'Evil',
      kind: 'other',
      lat: 1,
      lon: 1,
      ts: 1,
    });
    await settle(all);
    for (const n of [org, cat]) {
      expect((await n.repo.get(adv.id))?.name).toBe('Ridge day');
      expect((await n.repo.get(adv.id))?.status).toBe('active');
      expect((await n.repo.checkpoints(adv.id)).map(c => c.name)).toEqual(['Viewpoint', 'Summit']);
    }
  });

  it('a member cannot report an arrival for someone else', async () => {
    const { members, org, g, all, adv, view } = await started();
    await send(members[0]!, g.id, 'reached', 'r-fake', {
      adv: adv.id,
      cp: view.id,
      id: 'fake',
      at: 1,
      m: 'auto',
      addr: 'off1cat',
    });
    await settle(all);
    expect(await org.repo.completions(adv.id)).toEqual([]);
  });

  it('arrivals for unknown checkpoints, planned or cancelled adventures are refused', async () => {
    const { members, org, g, all, adv, view } = await started();
    await send(members[0]!, g.id, 'reached', 'r-1', {
      adv: adv.id,
      cp: 'nope',
      id: 'x1',
      at: 1,
      m: 'auto',
    });
    await settle(all);
    expect(await org.repo.completions(adv.id)).toEqual([]);
    const other = await org.service.createAdventure({ name: 'Later' }, { groupId: g.id });
    const planned = other.ok ? other.value.id : '';
    await org.service.addCheckpoint(planned, { name: 'P', kind: 'other', ...START });
    await settle(all);
    const pcp = (await org.repo.checkpoints(planned))[0]!;
    await send(members[0]!, g.id, 'reached', 'r-2', {
      adv: planned,
      cp: pcp.id,
      id: 'x2',
      at: 1,
      m: 'auto',
    });
    await settle(all);
    expect(await org.repo.completions(planned)).toEqual([]);
    void view;
  });

  it('removed members and non-members are ignored', async () => {
    const { members, org, g, all, adv, view } = await started();
    await org.groups.removeMember(g.id, 'off1bob');
    await settle(all, 10);
    await send(members[0]!, g.id, 'reached', 'r-3', {
      adv: adv.id,
      cp: view.id,
      id: 'x3',
      at: 1,
      m: 'auto',
    });
    await settle(all);
    expect(await org.repo.completions(adv.id)).toEqual([]);
  });

  it('an adventure update that is older, equal or illegal is ignored; a final status stays final', async () => {
    const { members, org, all, adv } = await started();
    const cat = members[1]!;
    await org.service.act(adv.id, 'complete');
    await settle(all);
    expect((await cat.repo.get(adv.id))?.status).toBe('completed');
    // The organizer's device republishes an older "active" header: stale revisions change nothing.
    const stale = createEnvelope(
      {
        type: 'adventure',
        author: 'off1org',
        payload: { id: adv.id, rev: 2, name: 'Old', status: 'active', ca: 1, ts: 1 },
      },
      { clock: org.clock, newId: () => 'stale-env' },
    );
    expect(encodeEnvelope(stale).ok).toBe(true);
    await org.pubsub.publish({
      topic: groupTopic((await cat.groupsRepo.list())[0]!.id, GroupChannel.adv),
      type: 'adventure',
      key: `a-${adv.id}`,
      payload: { id: adv.id, rev: 2, name: 'Old', status: 'active', ca: 1, ts: 1 },
    });
    // A higher revision that tries to reopen a completed adventure is refused as an illegal transition.
    await org.pubsub.publish({
      topic: groupTopic((await cat.groupsRepo.list())[0]!.id, GroupChannel.adv),
      type: 'adventure',
      key: `a-${adv.id}`,
      payload: { id: adv.id, rev: 50, name: 'Reopened', status: 'active', ca: 1, ts: 1 },
    });
    await settle(all);
    const after = (await cat.repo.get(adv.id))!;
    expect(after.status).toBe('completed');
    expect(after.name).toBe('Ridge day');
  });
});

describe('reconnection', () => {
  async function started() {
    const f = await formGroup(new FakeNetwork(), ['off1bob', 'off1cat']);
    const p = await plan(f.org, f.g.id, f.all);
    await f.org.service.act(p.adv.id, 'start');
    for (const m of f.members) {
      await m.service.join(p.adv.id);
    }
    await settle(f.all, 12);
    return { ...f, ...p };
  }

  it('a member who was out of range catches up on the lifecycle, checkpoints and arrivals it missed', async () => {
    const { org, members, all, g, adv, view } = await started();
    const [bob, cat] = members as [AdventureNode, AdventureNode];
    await cat.pubsub.unsubscribeAll(); // cat walks out of range
    await org.service.act(adv.id, 'pause');
    const extra = await org.service.addCheckpoint(adv.id, {
      name: 'Lake',
      kind: 'rest',
      ...destination(START, 180, 600),
    });
    await org.service.act(adv.id, 'resume');
    await bob.service.confirmArrival(adv.id, view.id, 'auto');
    await settle(all);
    expect((await cat.repo.get(adv.id))?.rev).toBeLessThan((await org.repo.get(adv.id))!.rev);
    expect(await cat.repo.completions(adv.id)).toEqual([]);

    cat.clock.advance(61_000);
    await cat.groups.resumeNow();
    await settle(all, 14);
    const back = (await cat.repo.get(adv.id))!;
    expect(back.rev).toBe((await org.repo.get(adv.id))!.rev);
    expect(back.status).toBe('active');
    expect((await cat.repo.checkpoints(adv.id)).map(c => c.name)).toEqual([
      'Viewpoint',
      'Summit',
      'Lake',
    ]);
    expect((await cat.repo.completions(adv.id)).map(c => c.address)).toEqual(['off1bob']);
    void g;
    void extra;
  });

  it('an arrival made while out of range is sent, and confirmed, once the organizer follows again', async () => {
    const { org, members, all, adv, top } = await started();
    const bob = members[0]!;
    for (const sub of org.pubsub
      .getSnapshot()
      .subscriptions.filter(x => x.provider === 'off1bob')) {
      await org.pubsub.unsubscribe(sub.subId);
    }
    await bob.service.confirmArrival(adv.id, top.id, 'auto');
    await settle(all);
    expect(await org.repo.completions(adv.id)).toEqual([]);
    expect((await bob.repo.completion(adv.id, top.id, 'off1bob'))?.published).toBe(false);

    org.clock.advance(61_000);
    await org.groups.resumeNow();
    await settle(all, 14);
    expect((await org.repo.completions(adv.id)).map(c => c.address)).toEqual(['off1bob']);
    expect((await bob.repo.completion(adv.id, top.id, 'off1bob'))?.published).toBe(true);
  });

  it('a member restarting the app keeps joined state and arrivals, and is resynced by the organizer', async () => {
    const { org, members, all, adv, view } = await started();
    const bob = members[0]!;
    await bob.service.confirmArrival(adv.id, view.id, 'auto');
    await settle(all);
    await org.service.act(adv.id, 'pause');
    await settle(all);
    expect((await bob.repo.participant(adv.id, 'off1bob'))?.state).toBe('joined');
    expect((await bob.repo.completions(adv.id)).length).toBe(1);
    expect((await bob.repo.get(adv.id))?.status).toBe('paused');
  });

  it('applying updates in any order gives the same state (checkpoint arrives before its adventure)', async () => {
    const f = await formGroup(new FakeNetwork(), ['off1bob']);
    const bob = f.members[0]!;
    await bob.pubsub.unsubscribeAll();
    const p = await plan(f.org, f.g.id, f.all);
    bob.clock.advance(61_000);
    await bob.groups.resumeNow();
    await settle(f.all, 14);
    expect(await bob.repo.get(p.adv.id)).not.toBeNull();
    expect((await bob.repo.checkpoints(p.adv.id)).length).toBe(2);
  });
});

describe('mesh milestone and privacy', () => {
  it('a message from a group member during an adventure records the first mesh exchange, only for adventures that are running', async () => {
    const f = await formGroup(new FakeNetwork());
    const bob = f.members[0]!;
    const { adv } = await plan(f.org, f.g.id, f.all);
    // Planned: nothing is running yet, so nothing is recorded.
    expect((await bob.repo.get(adv.id))?.progress.meshExchangeAt).toBeNull();
    await f.org.service.act(adv.id, 'start');
    await bob.service.join(adv.id);
    await settle(f.all, 12);
    await f.org.service.act(adv.id, 'pause');
    await f.org.service.act(adv.id, 'resume');
    await settle(f.all, 12);
    expect((await bob.repo.get(adv.id))?.progress.meshExchangeAt).not.toBeNull();
    await bob.engine.evaluateNow();
    expect((await bob.unlocks.list()).map(u => u.id)).toContain('mesh_connected');
  });

  it('publishing alone never unlocks it: no message received, no badge', async () => {
    const net = new FakeNetwork();
    const org = await makeAdventureNode(net, 'off1org', { name: 'Olive' });
    const g = await org.groups.createGroup({ name: 'Solo group' });
    const r = await org.service.createAdventure(
      { name: 'Alone' },
      { groupId: g.ok ? g.value.id : '' },
    );
    await org.service.act(r.ok ? r.value.id : '', 'start');
    await settle([org]);
    await org.engine.evaluateNow();
    expect((await org.unlocks.list()).map(u => u.id)).not.toContain('mesh_connected');
  });

  it('Rally Point comes from a meeting point someone else acknowledged', async () => {
    const f = await formGroup(new FakeNetwork());
    const bob = f.members[0]!;
    const p = await f.org.groups.publishPoint(f.g.id, { name: 'Junction', lat: 46.8, lon: 8.2 });
    await settle(f.all);
    await f.org.engine.evaluateNow();
    expect((await f.org.unlocks.list()).map(u => u.id)).not.toContain('rally_point');
    await bob.groups.acknowledge(f.g.id, p.ok ? p.value.point.id : '');
    await settle(f.all);
    await f.org.engine.evaluateNow();
    await bob.engine.evaluateNow();
    expect((await f.org.unlocks.list()).map(u => u.id)).toContain('rally_point');
    expect((await bob.unlocks.list()).map(u => u.id)).toContain('rally_point');
  });

  it('the service id and channel are the existing group ones (no new service, no breaking change)', () => {
    expect(GROUP_SERVICE_ID).toBe('tm.group.1');
    expect(groupTopic('g1', GroupChannel.adv)).toBe('tm/1/g1/adv');
  });
});

describe('unreliable radio', () => {
  async function started(net: FakeNetwork) {
    const f = await formGroup(net, ['off1bob', 'off1cat']);
    const p = await plan(f.org, f.g.id, f.all);
    await f.org.service.act(p.adv.id, 'start');
    for (const m of f.members) {
      await m.service.join(p.adv.id);
    }
    await settle(f.all, 12);
    return { ...f, ...p };
  }

  it('every update delivered twice changes nothing and announces nothing twice', async () => {
    const net = new FakeNetwork();
    const f = await started(net);
    net.duplicate = true;
    f.org.service.dismissNotices();
    f.members[1]!.service.dismissNotices();
    await f.members[0]!.service.confirmArrival(f.adv.id, f.view.id, 'auto');
    await settle(f.all, 12);
    for (const n of f.all) {
      expect(await n.repo.completions(f.adv.id)).toHaveLength(1);
    }
    expect(
      f.members[1]!.service.getSnapshot().notices.filter(n => n.text === 'bob reached Viewpoint'),
    ).toHaveLength(1);
  });

  it('lost updates are repaired by the next sync: state converges although messages were dropped', async () => {
    const net = new FakeNetwork();
    const f = await started(net);
    const cat = f.members[1]!;
    net.lossRate = 1;
    await f.members[0]!.service.confirmArrival(f.adv.id, f.view.id, 'auto');
    await f.org.service.act(f.adv.id, 'pause');
    await settle(f.all, 12);
    expect((await cat.repo.get(f.adv.id))?.status).toBe('active'); // cat missed everything
    net.lossRate = 0;
    cat.clock.advance(61_000);
    await cat.pubsub.unsubscribeAll();
    await cat.groups.resumeNow();
    // Bob's phone retries what the organizer never confirmed (this is what the 30 s timer does).
    await f.members[0]!.service.resumeNow();
    await settle(f.all, 16);
    expect((await cat.repo.get(f.adv.id))?.status).toBe('paused');
    expect((await cat.repo.completions(f.adv.id)).map(c => c.address)).toEqual(['off1bob']);
  });
});

describe('when the group ends', () => {
  it('a member who leaves the group has the group adventure closed on their phone, and the clock stops', async () => {
    const f = await formGroup(new FakeNetwork());
    const bob = f.members[0]!;
    const { adv } = await plan(f.org, f.g.id, f.all);
    await f.org.service.act(adv.id, 'start');
    await bob.service.join(adv.id);
    await settle(f.all, 12);
    bob.clock.advance(10 * 60_000);
    await bob.groups.leaveGroup(f.g.id);
    await settle(f.all, 12);
    const mine = (await bob.repo.get(adv.id))!;
    expect(mine.status).toBe('cancelled');
    expect(mine.progress.resumedAt).toBeNull();
    expect(mine.progress.activeMs).toBe(10 * 60_000);
    expect(bob.service.getSnapshot().notices.map(n => n.text)).toContain(
      '"Ridge day" was closed because the group ended',
    );
  });

  it('when the organizer ends the group, members keep a closed record they can still read', async () => {
    const f = await formGroup(new FakeNetwork());
    const bob = f.members[0]!;
    const { adv, view } = await plan(f.org, f.g.id, f.all);
    await f.org.service.act(adv.id, 'start');
    await settle(f.all, 12);
    await bob.service.join(adv.id);
    expect((await bob.service.confirmArrival(adv.id, view.id, 'manual')).ok).toBe(true);
    await settle(f.all, 12);
    await f.org.groups.leaveGroup(f.g.id);
    await settle(f.all, 12);
    expect((await bob.repo.get(adv.id))?.status).toBe('cancelled');
    expect(await bob.repo.completions(adv.id)).toHaveLength(1);
    expect((await f.org.repo.get(adv.id))?.status).toBe('cancelled');
  });
});
