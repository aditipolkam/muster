import { parseInviteLink } from '../src/domain/groups/invite';
import { destination } from '../src/domain/geo';
import { setFeature } from '../src/shared/features';
import { FakeNetwork } from '../src/testing/FakeMesh';
import { AdventureNode, makeAdventureNode, settle } from '../src/testing/adventureNode';
import { ManualClock } from '../src/testing/services';

const START = { lat: 46.8, lon: 8.2 };
const VIEW = destination(START, 90, 800);
const LAKE = destination(START, 180, 1200);

/** Organizer, a co-leader `lea` and a member `bob`, with one planned group adventure. */
async function setup(joiners = ['off1lea', 'off1bob']) {
  const net = new FakeNetwork();
  const clock = new ManualClock();
  const org = await makeAdventureNode(net, 'off1org', { name: 'Olive', clock });
  const created = await org.groups.createGroup({ name: 'Ridge walk' });
  if (!created.ok) {
    throw new Error('group');
  }
  const g = created.value;
  const members: AdventureNode[] = [];
  for (const a of joiners) {
    const n = await makeAdventureNode(net, a, { name: a.replace('off1', ''), clock });
    members.push(n);
    const inv = await org.groups.createInvite(g.id, { autoApprove: true });
    const link = inv.ok ? parseInviteLink(inv.value.link) : null;
    if (!link?.ok) {
      throw new Error('link');
    }
    await n.groups.joinFromInvite(link.invite);
    await settle([org, ...members], 10);
  }
  const all = [org, ...members];
  await org.groups.setLeader(g.id, 'off1lea', true);
  await settle(all, 10);
  const r = await org.service.createAdventure({ name: 'Ridge day' }, { groupId: g.id });
  if (!r.ok) {
    throw new Error(r.error.code);
  }
  const view = await org.service.addCheckpoint(r.value.id, {
    name: 'Viewpoint',
    kind: 'viewpoint',
    ...VIEW,
  });
  if (!view.ok) {
    throw new Error('cp');
  }
  await settle(all, 10);
  return { org, g, members, all, adv: r.value, view: view.value, clock };
}

const names = (n: AdventureNode, advId: string) =>
  n.repo.checkpoints(advId).then(cs => cs.map(c => c.name));

describe('co-leaders edit the group adventure (ADR 0016)', () => {
  afterEach(() => setFeature('groupActivities', false));

  it('a leader adds, changes and removes checkpoints; every phone follows', async () => {
    const { org, members, all, adv, view } = await setup();
    const [lea, bob] = members as [AdventureNode, AdventureNode];
    const add = await lea.service.addCheckpoint(adv.id, { name: 'Lake', kind: 'rest', ...LAKE });
    expect(add.ok).toBe(true);
    await settle(all, 10);
    for (const n of all) {
      expect(await names(n, adv.id)).toEqual(['Viewpoint', 'Lake']);
    }
    expect(org.service.getSnapshot().notices[0]?.text).toBe('lea added checkpoint Lake');

    const upd = await lea.service.updateCheckpoint(adv.id, view.id, {
      name: 'Upper viewpoint',
      kind: 'viewpoint',
      ...VIEW,
    });
    expect(upd.ok).toBe(true);
    await settle(all, 10);
    for (const n of all) {
      expect((await n.repo.checkpoint(adv.id, view.id))?.name).toBe('Upper viewpoint');
    }

    expect((await lea.service.removeCheckpoint(adv.id, view.id)).ok).toBe(true);
    await settle(all, 10);
    expect(await names(bob, adv.id)).toEqual(['Lake']);
    expect(await names(org, adv.id)).toEqual(['Lake']);
  });

  it('a leader cannot rename, start or cancel the adventure: that stays with the organizer', async () => {
    const { members, adv } = await setup();
    const lea = members[0]!;
    const rename = await lea.service.updateAdventure(adv.id, { name: 'Mine now' });
    expect(rename.ok).toBe(false);
    const start = await lea.service.act(adv.id, 'start');
    expect(start.ok).toBe(false);
  });

  it('a plain member still cannot change checkpoints', async () => {
    const { members, adv, view } = await setup();
    const bob = members[1]!;
    const r = await bob.service.addCheckpoint(adv.id, { name: 'Mine', kind: 'other', ...LAKE });
    expect(!r.ok && r.error.code).toBe('adventures.not_organizer');
    const rm = await bob.service.removeCheckpoint(adv.id, view.id);
    expect(!rm.ok && rm.error.code).toBe('adventures.not_organizer');
  });

  it("the organizer and a leader editing the same checkpoint at once end on the organizer's", async () => {
    const { org, members, all, adv, view } = await setup();
    const lea = members[0]!;
    await Promise.all([
      org.service.updateCheckpoint(adv.id, view.id, {
        name: 'Org says',
        kind: 'viewpoint',
        ...VIEW,
      }),
      lea.service.updateCheckpoint(adv.id, view.id, {
        name: 'Lea says',
        kind: 'viewpoint',
        ...VIEW,
      }),
    ]);
    await settle(all, 12);
    const got = await Promise.all(all.map(n => n.repo.checkpoint(adv.id, view.id)));
    expect(new Set(got.map(c => c?.name))).toEqual(new Set(['Org says']));
    expect(new Set(got.map(c => c?.rev))).toEqual(new Set([3]));
  });

  it('a change a leader makes out of range reaches everyone once the organizer follows again', async () => {
    const { org, members, all, adv, clock } = await setup();
    const [lea, bob] = members as [AdventureNode, AdventureNode];
    for (const sub of org.pubsub
      .getSnapshot()
      .subscriptions.filter(x => x.provider === 'off1lea')) {
      await org.pubsub.unsubscribe(sub.subId);
    }
    await lea.service.addCheckpoint(adv.id, { name: 'Lake', kind: 'rest', ...LAKE });
    await settle(all, 10);
    expect(await names(bob, adv.id)).toEqual(['Viewpoint']);

    clock.advance(61_000);
    await org.groups.resumeNow();
    await settle(all, 12);
    expect(await names(bob, adv.id)).toEqual(['Viewpoint', 'Lake']);
  });

  it('a published activity stays fixed for leaders too', async () => {
    setFeature('groupActivities', true);
    const { org, g, members, all } = await setup();
    const lea = members[0]!;
    const r = await org.service.createAdventure(
      { name: 'Treasure hunt' },
      { groupId: g.id, draft: true },
    );
    if (!r.ok) {
      throw new Error(r.error.code);
    }
    await org.service.addCheckpoint(r.value.id, { name: 'Clue 1', kind: 'other', ...VIEW });
    expect((await org.service.act(r.value.id, 'publish')).ok).toBe(true);
    await settle(all, 10);
    const add = await lea.service.addCheckpoint(r.value.id, {
      name: 'Sneaky',
      kind: 'other',
      ...LAKE,
    });
    expect(!add.ok && add.error.code).toBe('adventures.published');
  });
});
