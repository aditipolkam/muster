import { runMigrations } from '../data/migrations';
import { EventsRepo } from '../data/repositories/EventsRepo';
import { GroupsRepo } from '../data/repositories/GroupsRepo';
import { KvRepo } from '../data/repositories/KvRepo';
import { MeetingPointsRepo } from '../data/repositories/MeetingPointsRepo';
import { GroupService } from '../features/groups/GroupService';
import { GROUP_SERVICE_ID } from '../mesh/groupTopics';
import { PubSub } from '../mesh/PubSub';
import { FakeMesh, FakeNetwork } from './FakeMesh';
import { ManualClock, testId, testRandomBytes } from './services';
import { openNodeSqlite } from './nodeSqlite';

export type GroupNode = Awaited<ReturnType<typeof makeGroupNode>>;

/**
 * One simulated phone for group scenarios: its own SQLite database, mesh endpoint on a shared
 * FakeNetwork, and the real `GroupService`/`PubSub`. TEST ONLY: proves protocol logic, not Bluetooth.
 */
export async function makeGroupNode(
  net: FakeNetwork,
  address: string,
  opts: { name?: string; dbPath?: string; clock?: ManualClock } = {},
) {
  const db = openNodeSqlite(opts.dbPath);
  await runMigrations(db);
  const clock = opts.clock ?? new ManualClock();
  const mesh = new FakeMesh(address, net);
  const events = new EventsRepo(db);
  const kv = new KvRepo(db);
  await kv.set('profile.name', opts.name ?? address);
  const pubsub = new PubSub({
    mesh,
    clock,
    newId: testId,
    inbox: events,
    owns: id => id === GROUP_SERVICE_ID,
  });
  const groupsRepo = new GroupsRepo(db);
  const points = new MeetingPointsRepo(db);
  const groups = new GroupService({
    mesh,
    pubsub,
    groups: groupsRepo,
    points,
    clock,
    newId: testId,
    randomBytes: testRandomBytes,
    displayName: async () => (await kv.get('profile.name')) ?? address,
  });
  await mesh.start();
  await groups.start({ poll: false });
  return { address, db, clock, mesh, events, kv, pubsub, groupsRepo, points, groups };
}

/** Let queued async work on every node finish (messages hop through several awaits). */
export async function settle(nodes: { groups: GroupService }[], rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise(r => setImmediate(r));
    for (const n of nodes) {
      await n.groups.idle();
    }
  }
}
