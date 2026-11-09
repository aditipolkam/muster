import { parseInviteLink } from '../src/domain/groups/invite';
import { destination } from '../src/domain/geo';
import { FakeNetwork } from '../src/testing/FakeMesh';
import { AdventureNode, makeAdventureNode, settle } from '../src/testing/adventureNode';
import { buildRecap } from '../src/domain/adventures/stats';
import { completedAt, isOverFor } from '../src/domain/adventures/lifecycle';
import { ManualClock } from '../src/testing/services';

const START = { lat: 46.8, lon: 8.2 };
const VIEW = destination(START, 90, 800);
const AREA = {
  bbox: [8.1, 46.7, 8.4, 46.9] as [number, number, number, number],
  name: 'Valley',
  minZoom: 10,
  maxZoom: 15,
};

async function formGroup(net: FakeNetwork, joiners: string[] = ['off1bob', 'off1cat']) {
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

async function draft(org: AdventureNode, groupId: string, ordered = false) {
  const r = await org.service.createAdventure(
    { name: 'Flower hunt' },
    { groupId, draft: true, ordered, region: AREA },
  );
  if (!r.ok) {
    throw new Error(r.error.code);
  }
  const place = await org.service.addCheckpoint(r.value.id, {
    name: 'Viewpoint',
    kind: 'viewpoint',
    ...VIEW,
  });
  const task = await org.service.addCheckpoint(r.value.id, {
    name: 'Flower',
    kind: 'other',
    type: 'task',
    task: 'Collect a yellow flower',
  });
  if (!place.ok || !task.ok) {
    throw new Error('phase');
  }
  return { adv: r.value, place: place.value, task: task.value };
}

describe('group activities', () => {
  it('a draft stays on the organizer phone: nothing is sent, members see nothing', async () => {
    const { org, g, members, all } = await formGroup(new FakeNetwork());
    const { adv } = await draft(org, g.id);
    await settle(all, 10);
    expect((await org.repo.get(adv.id))?.status).toBe('draft');
    expect((await org.repo.get(adv.id))?.rev).toBe(0);
    for (const m of members) {
      expect(await m.repo.get(adv.id)).toBeNull();
      expect(await m.repo.checkpoints(adv.id)).toEqual([]);
    }
    expect(await org.repo.participant(adv.id, 'off1org')).toBeNull();
    // Editing a draft is allowed and does not make a new revision.
    const edit = await org.service.updateAdventure(
      adv.id,
      { name: 'Flower hunt 2' },
      { ordered: true },
    );
    expect(edit.ok && edit.value).toMatchObject({ name: 'Flower hunt 2', rev: 0, ordered: true });
  });

  it('only the organizer can make a draft, and only for a group', async () => {
    const { members, g } = await formGroup(new FakeNetwork());
    const r = await members[0]!.service.createAdventure(
      { name: 'x' },
      { groupId: g.id, draft: true },
    );
    expect(!r.ok && r.error.code).toBe('adventures.not_organizer');
    const solo = await members[0]!.service.createAdventure({ name: 'x' }, { draft: true });
    expect(!solo.ok && solo.error.code).toBe('adventures.solo');
  });

  it('rejects an oversized map area', async () => {
    const { org, g } = await formGroup(new FakeNetwork());
    const r = await org.service.createAdventure(
      { name: 'Big' },
      { groupId: g.id, draft: true, region: { ...AREA, bbox: [0, 0, 5, 5] } },
    );
    expect(!r.ok && r.error.code).toBe('adventures.invalid_area');
  });

  it('cannot be published without a phase', async () => {
    const { org, g } = await formGroup(new FakeNetwork());
    const r = await org.service.createAdventure({ name: 'Empty' }, { groupId: g.id, draft: true });
    if (!r.ok) {
      throw new Error('draft');
    }
    const p = await org.service.act(r.value.id, 'publish');
    expect(!p.ok && p.error.code).toBe('adventures.no_phases');
  });

  it('publishing starts it for the group, with the order flag, map area and task phases', async () => {
    const { org, g, members, all } = await formGroup(new FakeNetwork());
    const { adv, place, task } = await draft(org, g.id, true);
    const p = await org.service.act(adv.id, 'publish');
    expect(p.ok && p.value).toMatchObject({ status: 'active', rev: 1 });
    await settle(all, 10);
    for (const m of members) {
      const got = await m.repo.get(adv.id);
      expect(got).toMatchObject({ status: 'active', rev: 1, ordered: true, name: 'Flower hunt' });
      // The area is the phases' regions merged: it covers the place phase's box.
      const [w, so, e, n] = got!.region!.bbox;
      expect(VIEW.lon).toBeGreaterThan(w);
      expect(VIEW.lon).toBeLessThan(e);
      expect(VIEW.lat).toBeGreaterThan(so);
      expect(VIEW.lat).toBeLessThan(n);
      expect(got?.region?.name).toBe('Flower hunt');
      const cps = await m.repo.checkpoints(adv.id);
      expect(cps.map(c => c.id).sort()).toEqual([place.id, task.id].sort());
      expect(cps.find(c => c.id === task.id)).toMatchObject({
        lat: null,
        lon: null,
        task: 'Collect a yellow flower',
      });
      // Nobody is running yet: starting is each person's own choice.
      expect(got?.progress.resumedAt).toBeNull();
    }
  });

  it('a published activity cannot be edited, only cancelled', async () => {
    const { org, g, all } = await formGroup(new FakeNetwork());
    const { adv, place } = await draft(org, g.id);
    await org.service.act(adv.id, 'publish');
    await settle(all);
    const add = await org.service.addCheckpoint(adv.id, {
      name: 'More',
      kind: 'other',
      type: 'task',
      task: 'x',
    });
    expect(!add.ok && add.error.code).toBe('adventures.published');
    const upd = await org.service.updateCheckpoint(adv.id, place.id, {
      name: 'Moved',
      kind: 'other',
      type: 'task',
      task: 'x',
    });
    expect(!upd.ok && upd.error.code).toBe('adventures.published');
    const rem = await org.service.removeCheckpoint(adv.id, place.id);
    expect(!rem.ok && rem.error.code).toBe('adventures.published');
    const rename = await org.service.updateAdventure(adv.id, { name: 'Renamed' });
    expect(!rename.ok && rename.error.code).toBe('adventures.published');
    const c = await org.service.act(adv.id, 'cancel');
    expect(c.ok && c.value.status).toBe('cancelled');
    await settle(all);
  });

  it('each person has their own timer, started by them and stopped by their last phase', async () => {
    const { org, g, members, all } = await formGroup(new FakeNetwork());
    const [bob, cat] = members as [AdventureNode, AdventureNode];
    const { adv, place, task } = await draft(org, g.id);
    await org.service.act(adv.id, 'publish');
    await settle(all, 10);

    bob.clock.advance(60_000);
    expect((await bob.service.join(adv.id)).ok).toBe(true); // Bob starts at t=60s
    bob.clock.advance(10 * 60_000);
    expect((await cat.service.join(adv.id)).ok).toBe(true); // Cat starts 10 minutes later
    await settle(all);

    bob.clock.advance(5 * 60_000);
    expect((await bob.service.confirmArrival(adv.id, place.id, 'manual')).ok).toBe(true);
    expect((await bob.repo.participant(adv.id, 'off1bob'))?.state).toBe('joined');
    bob.clock.advance(5 * 60_000);
    expect((await bob.service.confirmArrival(adv.id, task.id, 'manual')).ok).toBe(true);
    await settle(all);

    const bobAdv = (await bob.repo.get(adv.id))!;
    expect((await bob.repo.participant(adv.id, 'off1bob'))?.state).toBe('done');
    expect(bobAdv.progress.resumedAt).toBeNull();
    expect(bobAdv.progress.activeMs).toBe(10 * 60_000 + 10 * 60_000); // 10 min before Cat joined + 10 min after
    // Cat's clock is unaffected by Bob finishing.
    expect((await cat.repo.get(adv.id))?.progress.resumedAt).not.toBeNull();
    // The group hears that Bob finished.
    for (const n of [org, cat]) {
      expect((await n.repo.participant(adv.id, 'off1bob'))?.state).toBe('done');
    }
    // A finished person cannot start again.
    const again = await bob.service.join(adv.id);
    expect(!again.ok && again.error.code).toBe('adventures.finished');
  });

  it('a late joiner starts from the first phase', async () => {
    const { org, g, members, all } = await formGroup(new FakeNetwork());
    const [bob, cat] = members as [AdventureNode, AdventureNode];
    const { adv, place } = await draft(org, g.id);
    await org.service.act(adv.id, 'publish');
    await settle(all, 10);
    await bob.service.join(adv.id);
    await bob.service.confirmArrival(adv.id, place.id, 'manual');
    cat.clock.advance(3_600_000);
    await cat.service.join(adv.id);
    expect(await cat.repo.completion(adv.id, place.id, 'off1cat')).toBeNull();
  });

  it('ordered: a later phase is locked on the phone until the earlier one is done', async () => {
    const { org, g, members, all } = await formGroup(new FakeNetwork());
    const bob = members[0]!;
    const { adv, place, task } = await draft(org, g.id, true);
    await org.service.act(adv.id, 'publish');
    await settle(all, 10);
    await bob.service.join(adv.id);
    const locked = await bob.service.confirmArrival(adv.id, task.id, 'manual');
    expect(!locked.ok && locked.error.code).toBe('adventures.locked');
    expect((await bob.service.confirmArrival(adv.id, place.id, 'manual')).ok).toBe(true);
    expect((await bob.service.confirmArrival(adv.id, task.id, 'manual')).ok).toBe(true);
  });

  it('any order: phases can be done in any sequence', async () => {
    const { org, g, members, all } = await formGroup(new FakeNetwork());
    const bob = members[0]!;
    const { adv, place, task } = await draft(org, g.id, false);
    await org.service.act(adv.id, 'publish');
    await settle(all, 10);
    await bob.service.join(adv.id);
    expect((await bob.service.confirmArrival(adv.id, task.id, 'manual')).ok).toBe(true);
    expect((await bob.service.confirmArrival(adv.id, place.id, 'manual')).ok).toBe(true);
    expect((await bob.repo.participant(adv.id, 'off1bob'))?.state).toBe('done');
  });

  it('a draft can be discarded without anything being sent', async () => {
    const { org, g, members, all } = await formGroup(new FakeNetwork());
    const { adv } = await draft(org, g.id);
    expect((await org.service.deleteAdventure(adv.id)).ok).toBe(true);
    await settle(all);
    expect(await org.repo.get(adv.id)).toBeNull();
    expect(await members[0]!.repo.get(adv.id)).toBeNull();
  });

  it('nobody can join a draft', async () => {
    const { org, g } = await formGroup(new FakeNetwork());
    const { adv } = await draft(org, g.id);
    const r = await org.service.join(adv.id);
    expect(!r.ok && r.error.code).toBe('adventures.draft');
  });

  it('a phase of the longest multi-byte text still fits in one message', async () => {
    const { org, g, members, all } = await formGroup(new FakeNetwork(), ['off1bob']);
    const r = await org.service.createAdventure(
      { name: '😀'.repeat(30), description: '😀'.repeat(100) },
      { groupId: g.id, draft: true, region: { ...AREA, name: '😀'.repeat(30) } },
    );
    if (!r.ok) {
      throw new Error(r.error.code);
    }
    const cp = await org.service.addCheckpoint(r.value.id, {
      name: '😀'.repeat(30),
      description: '😀'.repeat(70),
      kind: 'other',
      type: 'task',
      task: '😀'.repeat(70),
      ...VIEW,
    });
    expect(cp.ok).toBe(true);
    const p = await org.service.act(r.value.id, 'publish');
    expect(p.ok).toBe(true);
    await settle(all, 10);
    expect((await members[0]!.repo.checkpoints(r.value.id)).length).toBe(1);
  });

  describe('a person finishing counts as completing it for them', () => {
    async function bobFinishes() {
      const f = await formGroup(new FakeNetwork());
      const [bob, cat] = f.members as [AdventureNode, AdventureNode];
      const { adv, place, task } = await draft(f.org, f.g.id);
      await f.org.service.act(adv.id, 'publish');
      await settle(f.all, 10);
      await bob.service.join(adv.id);
      await cat.service.join(adv.id);
      bob.clock.advance(60_000);
      await bob.service.confirmArrival(adv.id, place.id, 'manual');
      bob.clock.advance(60_000);
      await bob.service.confirmArrival(adv.id, task.id, 'manual');
      await settle(f.all, 10);
      return { ...f, bob, cat, adv };
    }

    it('is over and completed for them, still open for the others', async () => {
      const { bob, cat, org, adv } = await bobFinishes();
      const mine = (await bob.repo.get(adv.id))!;
      expect(mine.status).toBe('active'); // the shared status is the organizer's
      expect(isOverFor(mine)).toBe(true);
      expect(completedAt(mine)).toBe(mine.progress.finishedAt);
      expect(isOverFor((await cat.repo.get(adv.id))!)).toBe(false);
      expect(isOverFor((await org.repo.get(adv.id))!)).toBe(false);
    });

    it('the recap reads as completed with their own time', async () => {
      const { bob, adv } = await bobFinishes();
      const a = (await bob.repo.get(adv.id))!;
      const recap = buildRecap({
        adventure: a,
        checkpoints: await bob.repo.checkpoints(adv.id),
        completions: await bob.repo.completions(adv.id),
        participants: await bob.repo.participants(adv.id),
        track: [],
        unlockedIds: [],
        me: 'off1bob',
        now: a.progress.finishedAt! + 3_600_000,
      });
      expect(recap.status).toBe('completed');
      expect(recap.endedAt).toBe(a.progress.finishedAt);
      expect(recap.durationMs).toBe(2 * 60_000); // does not keep growing after they finished
      expect(recap.checkpointsDone).toHaveLength(2);
    });

    it('earns badges, and only for the person who finished', async () => {
      const { bob, cat } = await bobFinishes();
      await bob.engine.evaluateNow();
      await cat.engine.evaluateNow();
      expect(bob.engine.getSnapshot().fresh).toContain('first_adventure');
      expect(cat.engine.getSnapshot().fresh).not.toContain('first_adventure');
    });

    it('survives the organizer cancelling or completing the activity afterwards', async () => {
      const { org, bob, adv, all } = await bobFinishes();
      const before = (await bob.repo.get(adv.id))!;
      await org.service.act(adv.id, 'cancel');
      await settle(all, 10);
      const after = (await bob.repo.get(adv.id))!;
      expect(after.status).toBe('cancelled');
      expect(after.progress.finishedAt).toBe(before.progress.finishedAt);
      expect(after.tzOffsetMin).toBe(before.tzOffsetMin);
      expect(completedAt(after)).toBe(before.progress.finishedAt);
      expect(isOverFor(after)).toBe(true);
    });

    it('someone who never finished gets nothing when the organizer cancels', async () => {
      const { org, cat, adv, all } = await bobFinishes();
      await org.service.act(adv.id, 'cancel');
      await settle(all, 10);
      expect(completedAt((await cat.repo.get(adv.id))!)).toBeNull();
    });
  });

  it('attaches the map area itself at publish when the organizer did not', async () => {
    const { org, g, members, all } = await formGroup(new FakeNetwork(), ['off1bob']);
    const r = await org.service.createAdventure({ name: 'Auto' }, { groupId: g.id, draft: true });
    if (!r.ok) {
      throw new Error('draft');
    }
    await org.service.addCheckpoint(r.value.id, { name: 'A', kind: 'other', ...START });
    await org.service.addCheckpoint(r.value.id, { name: 'B', kind: 'other', ...VIEW });
    await org.service.addCheckpoint(r.value.id, {
      name: 'T',
      kind: 'other',
      type: 'task',
      task: 'no place',
    });
    expect((await org.repo.get(r.value.id))?.region).toBeNull(); // nothing yet, only at publish
    const p = await org.service.act(r.value.id, 'publish');
    expect(p.ok).toBe(true);
    await settle(all, 10);
    const area = (await members[0]!.repo.get(r.value.id))?.region;
    expect(area?.name).toBe('Auto');
    const [w, s, e, n] = area!.bbox;
    for (const pt of [START, VIEW]) {
      expect(pt.lon).toBeGreaterThan(w);
      expect(pt.lon).toBeLessThan(e);
      expect(pt.lat).toBeGreaterThan(s);
      expect(pt.lat).toBeLessThan(n);
    }
  });

  it('refuses to publish when the phase regions are too far apart for one download', async () => {
    const { org, g } = await formGroup(new FakeNetwork(), ['off1bob']);
    const r = await org.service.createAdventure({ name: 'Wide' }, { groupId: g.id, draft: true });
    if (!r.ok) {
      throw new Error('draft');
    }
    await org.service.addCheckpoint(r.value.id, { name: 'A', kind: 'other', ...START });
    const far = await org.service.addCheckpoint(r.value.id, {
      name: 'B',
      kind: 'other',
      lat: START.lat + 2,
      lon: START.lon,
    });
    const p = await org.service.act(r.value.id, 'publish');
    expect(!p.ok && p.error.code).toBe('adventures.region_too_wide');
    expect((await org.repo.get(r.value.id))?.status).toBe('draft');
    // Dropping one phase's map region fixes it, and the activity then publishes.
    if (!far.ok) {
      throw new Error('phase');
    }
    await org.service.updateCheckpoint(r.value.id, far.value.id, {
      name: 'B',
      kind: 'other',
      lat: START.lat + 2,
      lon: START.lon,
      region: null,
    });
    expect((await org.service.act(r.value.id, 'publish')).ok).toBe(true);
  });
});
