import { parseInviteLink } from '../src/domain/groups/invite';
import { FakeNetwork } from '../src/testing/FakeMesh';
import { GroupNode, makeGroupNode, settle } from '../src/testing/groupNode';

/** Organizer `org` with members; the first joiner is made a co-leader when `lead` is set. */
async function formGroup(joiners: string[], lead = true) {
  const net = new FakeNetwork();
  const org = await makeGroupNode(net, 'off1org', { name: 'Olive' });
  const created = await org.groups.createGroup({ name: 'Ridge walk' });
  if (!created.ok) {
    throw new Error(created.error.message);
  }
  const g = created.value;
  const members: GroupNode[] = [];
  for (const a of joiners) {
    const n = await makeGroupNode(net, a, { name: a.replace('off1', '') });
    members.push(n);
    const inv = await org.groups.createInvite(g.id, { autoApprove: true });
    const link = inv.ok ? parseInviteLink(inv.value.link) : null;
    if (!link?.ok) {
      throw new Error('bad link');
    }
    expect((await n.groups.joinFromInvite(link.invite)).ok).toBe(true);
    await settle([org, ...members]);
  }
  const all = [org, ...members];
  if (lead) {
    expect((await org.groups.setLeader(g.id, joiners[0]!, true)).ok).toBe(true);
    await settle(all);
  }
  return { org, g, members, all };
}

const roles = (n: GroupNode, groupId: string) =>
  n.groupsRepo.members(groupId).then(ms => ms.map(m => [m.address, m.role]));

describe('co-leaders (ADR 0016)', () => {
  it('the organizer makes a member a leader; every phone sees it, leaders listed after the organizer', async () => {
    const { org, g, members, all } = await formGroup(['off1lea', 'off1bob']);
    const expected = [
      ['off1org', 'organizer'],
      ['off1lea', 'leader'],
      ['off1bob', 'member'],
    ];
    for (const n of all) {
      expect(await roles(n, g.id)).toEqual(expected);
    }
    expect(org.groups.getSnapshot().notices[0]?.text).toBe('lea is now a leader');

    // And back to a member.
    expect((await org.groups.setLeader(g.id, 'off1lea', false)).ok).toBe(true);
    await settle(all);
    expect((await members[1]!.groupsRepo.member(g.id, 'off1lea'))?.role).toBe('member');
  });

  it('only the organizer chooses leaders, and only among active members', async () => {
    const { org, g, members } = await formGroup(['off1lea', 'off1bob']);
    const lea = members[0]!;
    const denied = await lea.groups.setLeader(g.id, 'off1bob', true);
    expect(!denied.ok && denied.error.code).toBe('groups.not_organizer');
    const stranger = await org.groups.setLeader(g.id, 'off1eve', true);
    expect(!stranger.ok && stranger.error.code).toBe('groups.no_member');
    const self = await org.groups.setLeader(g.id, 'off1org', true);
    expect(self.ok).toBe(false);
  });

  it('a leader adds a meeting point: the organizer shares it and every member gets it', async () => {
    const { org, g, members, all } = await formGroup(['off1lea', 'off1bob']);
    const [lea, bob] = members as [GroupNode, GroupNode];
    const r = await lea.groups.publishPoint(g.id, { name: 'Tea stall', lat: 18.7, lon: 73.4 });
    expect(r.ok && r.value.delivered).toBe(true);
    await settle(all);
    const id = r.ok ? r.value.point.id : '';
    for (const n of all) {
      expect(await n.points.get(g.id, id)).toMatchObject({
        name: 'Tea stall',
        rev: 1,
        createdBy: 'off1lea',
        updatedBy: 'off1lea',
      });
    }
    expect(org.groups.getSnapshot().notices[0]?.text).toBe('lea shared meeting point "Tea stall"');
    expect(bob.groups.getSnapshot().notices[0]?.text).toBe('Meeting point "Tea stall" shared');
  });

  it("a leader edits and removes the organizer's point; the organizer can edit the leader's", async () => {
    const { org, g, members, all } = await formGroup(['off1lea', 'off1bob']);
    const [lea, bob] = members as [GroupNode, GroupNode];
    const p = await org.groups.publishPoint(g.id, { name: 'Gate', lat: 1, lon: 1 });
    const id = p.ok ? p.value.point.id : '';
    await settle(all);
    expect(
      (await lea.groups.publishPoint(g.id, { name: 'North gate', lat: 1, lon: 1 }, id)).ok,
    ).toBe(true);
    await settle(all);
    for (const n of all) {
      expect(await n.points.get(g.id, id)).toMatchObject({
        name: 'North gate',
        rev: 2,
        createdBy: 'off1org',
        updatedBy: 'off1lea',
      });
    }
    await org.groups.publishPoint(g.id, { name: 'North gate (car park)', lat: 1, lon: 1 }, id);
    await settle(all);
    expect((await lea.points.get(g.id, id))?.name).toBe('North gate (car park)');

    expect((await lea.groups.removePoint(g.id, id)).ok).toBe(true);
    await settle(all);
    for (const n of all) {
      expect(await n.points.get(g.id, id)).toMatchObject({ deleted: true, rev: 4 });
    }
    expect(await bob.points.list(g.id)).toEqual([]);
  });

  it('a plain member still cannot edit the plan, and a proposal from one is ignored', async () => {
    const { org, g, members, all } = await formGroup(['off1lea', 'off1bob']);
    const bob = members[1]!;
    const denied = await bob.groups.publishPoint(g.id, { name: 'Mine', lat: 1, lon: 2 });
    expect(!denied.ok && denied.error.code).toBe('groups.not_organizer');
    // A modified client sends a proposal anyway.
    await bob.pubsub.publish({
      topic: `tm/1/${g.id}/member`,
      type: 'point_edit',
      key: 'e-X',
      payload: {
        id: 'X',
        rev: 1,
        name: 'Forged',
        note: null,
        lat: 1,
        lon: 2,
        by: 'off1bob',
        createdBy: 'off1bob',
        createdAt: 1,
        ts: 1,
      },
    });
    await settle(all);
    expect(await org.points.get(g.id, 'X')).toBeNull();
  });

  it('a demoted leader can no longer edit, and the points they wrote stay', async () => {
    const { org, g, members, all } = await formGroup(['off1lea', 'off1bob']);
    const [lea, bob] = members as [GroupNode, GroupNode];
    const r = await lea.groups.publishPoint(g.id, { name: 'Camp', lat: 1, lon: 1 });
    await settle(all);
    await org.groups.setLeader(g.id, 'off1lea', false);
    await settle(all);
    const denied = await lea.groups.publishPoint(g.id, { name: 'Camp 2', lat: 1, lon: 1 });
    expect(!denied.ok && denied.error.code).toBe('groups.not_organizer');
    expect((await bob.points.get(g.id, r.ok ? r.value.point.id : ''))?.name).toBe('Camp');
  });

  it('an edit a leader makes out of range reaches everyone once the organizer follows again', async () => {
    const { org, g, members, all } = await formGroup(['off1lea', 'off1bob']);
    const [lea, bob] = members as [GroupNode, GroupNode];
    for (const sub of org.pubsub
      .getSnapshot()
      .subscriptions.filter(x => x.provider === 'off1lea')) {
      await org.pubsub.unsubscribe(sub.subId);
    }
    const r = await lea.groups.publishPoint(g.id, { name: 'Late camp', lat: 2, lon: 2 });
    expect(r.ok && r.value.delivered).toBe(false);
    await settle(all);
    const id = r.ok ? r.value.point.id : '';
    expect(await bob.points.get(g.id, id)).toBeNull();

    org.clock.advance(61_000);
    await org.groups.resumeNow();
    await settle(all, 10);
    expect((await bob.points.get(g.id, id))?.name).toBe('Late camp');
    expect((await org.points.get(g.id, id))?.rev).toBe(1);
  });

  it('two leaders editing the same point at once settle on the same version everywhere', async () => {
    const { org, g, members, all } = await formGroup(['off1lea', 'off1zed', 'off1bob']);
    await org.groups.setLeader(g.id, 'off1zed', true);
    await settle(all);
    const [lea, zed] = members as [GroupNode, GroupNode];
    const p = await org.groups.publishPoint(g.id, { name: 'Ford', lat: 1, lon: 1 });
    const id = p.ok ? p.value.point.id : '';
    await settle(all);
    // Both edit revision 1 before either hears of the other's edit.
    await Promise.all([
      lea.groups.publishPoint(g.id, { name: 'Ford (lea)', lat: 1, lon: 1 }, id),
      zed.groups.publishPoint(g.id, { name: 'Ford (zed)', lat: 1, lon: 1 }, id),
    ]);
    await settle(all, 10);
    const names = await Promise.all(all.map(n => n.points.get(g.id, id).then(x => x?.name)));
    // Same revision: the greater author address wins (MESH_PROTOCOL.md 3.3).
    expect(new Set(names)).toEqual(new Set(['Ford (zed)']));
  });
});
