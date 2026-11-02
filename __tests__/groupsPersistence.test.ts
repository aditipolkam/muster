import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LATEST_VERSION, MIGRATIONS, runMigrations } from '../src/data/migrations';
import { parseInviteLink } from '../src/domain/groups/invite';
import { FakeNetwork } from '../src/testing/FakeMesh';
import { makeGroupNode, settle } from '../src/testing/groupNode';
import { openNodeSqlite } from '../src/testing/nodeSqlite';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tm-groups-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('migration 3', () => {
  it('adds the group tables and keeps earlier data', async () => {
    const db = openNodeSqlite(join(dir, 'm.db'));
    await runMigrations(
      db,
      MIGRATIONS.filter(m => m.version <= 2),
    );
    await db.run(
      "INSERT INTO local_points(id,name,lat,lon,created_at,updated_at) VALUES('p','Cairn',1,2,3,4)",
    );
    await db.run(
      "INSERT INTO events(id,group_id,type,author,received_at,body) VALUES('e','diag','ping','a',1,'{}')",
    );
    const r = await runMigrations(db);
    expect(r).toEqual({ from: 2, to: LATEST_VERSION });
    const tables = (
      await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
    ).map(t => t.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'groups',
        'group_members',
        'group_invites',
        'meeting_points',
        'point_acks',
      ]),
    );
    expect(await db.get('SELECT name FROM local_points WHERE id = ?', ['p'])).toEqual({
      name: 'Cairn',
    });
    expect(await db.get('SELECT type FROM events WHERE id = ?', ['e'])).toEqual({ type: 'ping' });
    // Re-running is a no-op.
    expect(await runMigrations(db)).toEqual({ from: LATEST_VERSION, to: LATEST_VERSION });
  });
});

describe('persistence across an app restart', () => {
  it('keeps groups, membership, meeting points and acknowledgments', async () => {
    const net = new FakeNetwork();
    const path = join(dir, 'bob.db');
    const org = await makeGroupNode(net, 'off1org', { name: 'Olive' });
    const created = await org.groups.createGroup({ name: 'Trip' });
    const g = created.ok ? created.value : (undefined as never);
    let bob = await makeGroupNode(net, 'off1bob', { name: 'Bob', dbPath: path });
    const inv = await org.groups.createInvite(g.id, { autoApprove: true });
    const parsed = inv.ok ? parseInviteLink(inv.value.link) : null;
    await bob.groups.joinFromInvite(parsed && parsed.ok ? parsed.invite : (undefined as never));
    await settle([org, bob]);
    const pub = await org.groups.publishPoint(g.id, {
      name: 'Hut',
      note: 'Tea',
      lat: 56.8,
      lon: -5.1,
    });
    const id = pub.ok ? pub.value.point.id : '';
    await settle([org, bob]);
    await bob.groups.acknowledge(g.id, id);
    await settle([org, bob]);
    bob.groups.stop();
    await bob.db.close();

    // New process: same database file, fresh services.
    bob = await makeGroupNode(new FakeNetwork(), 'off1bob', { dbPath: path });
    expect(await bob.groupsRepo.get(g.id)).toMatchObject({
      name: 'Trip',
      role: 'member',
      status: 'active',
      organizer: 'off1org',
    });
    expect((await bob.groupsRepo.members(g.id)).map(m => [m.address, m.state])).toEqual([
      ['off1org', 'active'],
      ['off1bob', 'active'],
    ]);
    expect(await bob.points.get(g.id, id)).toMatchObject({
      name: 'Hut',
      note: 'Tea',
      lat: 56.8,
      lon: -5.1,
      rev: 1,
      ackedRev: 1,
      ackPublished: true,
    });
    expect(await bob.points.listVisible()).toHaveLength(1);
  });

  it('keeps the received-event inbox, so a redelivered message is a duplicate after restart', async () => {
    const net = new FakeNetwork();
    const path = join(dir, 'bob2.db');
    const org = await makeGroupNode(net, 'off1org');
    const created = await org.groups.createGroup({ name: 'Trip' });
    const g = created.ok ? created.value : (undefined as never);
    const bob = await makeGroupNode(net, 'off1bob', { dbPath: path });
    const inv = await org.groups.createInvite(g.id, { autoApprove: true });
    const parsed = inv.ok ? parseInviteLink(inv.value.link) : null;
    await bob.groups.joinFromInvite(parsed && parsed.ok ? parsed.invite : (undefined as never));
    await settle([org, bob]);
    await org.groups.publishPoint(g.id, { name: 'Hut', lat: 1, lon: 2 });
    await settle([org, bob]);
    const stored = await bob.events.count();
    expect(stored).toBeGreaterThan(0);
    const ids = await bob.db.all<{ id: string }>("SELECT id FROM events WHERE type = 'point'");
    bob.groups.stop();
    await bob.db.close();

    const again = await makeGroupNode(new FakeNetwork(), 'off1bob', { dbPath: path });
    for (const { id } of ids) {
      expect(
        await again.events.record({
          id,
          scope: g.id,
          type: 'point',
          author: 'x',
          sentTs: 0,
          receivedAt: 0,
          body: '{}',
        }),
      ).toBe(false);
    }
  });

  it('a restarted member picks up what it missed and the organizer follows it again', async () => {
    const net = new FakeNetwork();
    const path = join(dir, 'bob3.db');
    const org = await makeGroupNode(net, 'off1org');
    const created = await org.groups.createGroup({ name: 'Trip' });
    const g = created.ok ? created.value : (undefined as never);
    let bob = await makeGroupNode(net, 'off1bob', { dbPath: path });
    const inv = await org.groups.createInvite(g.id, { autoApprove: true });
    const parsed = inv.ok ? parseInviteLink(inv.value.link) : null;
    await bob.groups.joinFromInvite(parsed && parsed.ok ? parsed.invite : (undefined as never));
    await settle([org, bob]);
    bob.groups.stop();
    await bob.db.close();

    // Bob's app is closed while the organizer shares a point; the SDK ends the organizer's follow.
    const pub = await org.groups.publishPoint(g.id, { name: 'While away', lat: 1, lon: 2 });
    const id = pub.ok ? pub.value.point.id : '';
    for (const s of org.pubsub.getSnapshot().subscriptions.filter(x => x.provider === 'off1bob')) {
      await org.pubsub.unsubscribe(s.subId);
    }

    bob = await makeGroupNode(net, 'off1bob', { dbPath: path });
    await bob.groups.resumeNow();
    org.clock.advance(61_000);
    await org.groups.resumeNow();
    await settle([org, bob], 10);
    expect(await bob.points.get(g.id, id)).toMatchObject({ name: 'While away' });
    const ack = await bob.groups.acknowledge(g.id, id);
    await settle([org, bob]);
    expect(ack.ok && ack.value).toBe(true);
    expect(await org.points.acks(g.id, id)).toHaveLength(1);
  });

  it('abandons a join that never completed', async () => {
    const net = new FakeNetwork();
    const path = join(dir, 'stale.db');
    const first = await makeGroupNode(net, 'off1bob', { dbPath: path });
    await first.groupsRepo.save({
      id: 'G',
      name: 'x',
      organizer: 'off1org',
      role: 'member',
      status: 'joining',
      createdAt: first.clock.now(),
      joinedAt: null,
      memberRev: 0,
    });
    first.groups.stop();
    await first.db.close();
    const later = await makeGroupNode(new FakeNetwork(), 'off1bob', {
      dbPath: path,
      clock: first.clock,
    });
    expect(await later.groupsRepo.get('G')).not.toBeNull();
    later.groups.stop();
    await later.db.close();
    first.clock.advance(6 * 60_000);
    const again = await makeGroupNode(new FakeNetwork(), 'off1bob', {
      dbPath: path,
      clock: first.clock,
    });
    expect(await again.groupsRepo.get('G')).toBeNull();
  });
});

describe('repositories', () => {
  it('keeps the highest acknowledgment per member and purges everything with the group', async () => {
    const net = new FakeNetwork();
    const org = await makeGroupNode(net, 'off1org');
    const created = await org.groups.createGroup({ name: 'Trip' });
    const g = created.ok ? created.value : (undefined as never);
    expect(
      await org.points.recordAck({ groupId: g.id, pointId: 'P', address: 'a', rev: 2, at: 1 }),
    ).toBe(true);
    expect(
      await org.points.recordAck({ groupId: g.id, pointId: 'P', address: 'a', rev: 1, at: 2 }),
    ).toBe(false);
    expect((await org.points.acks(g.id, 'P'))[0]?.rev).toBe(2);
    await org.groupsRepo.purge(g.id);
    for (const t of ['groups', 'group_members', 'group_invites', 'meeting_points', 'point_acks']) {
      expect((await org.db.all(`SELECT 1 FROM ${t}`)).length).toBe(0);
    }
  });
});
