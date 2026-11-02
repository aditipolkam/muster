import { AchievementsRepo, AdventuresRepo } from '../data/repositories/AdventuresRepo';
import type { CoverageRegion } from '../domain/maps/coverage';
import type { Fix } from '../domain/location/fix';
import { AchievementEngine } from '../features/adventures/AchievementEngine';
import { AdventureService } from '../features/adventures/AdventureService';
import { AdventureTracker } from '../features/adventures/AdventureTracker';
import { Emitter } from '../shared/emitter';
import { FakeNetwork } from './FakeMesh';
import { makeGroupNode, settle as settleGroups } from './groupNode';

export type AdventureNode = Awaited<ReturnType<typeof makeAdventureNode>>;

/**
 * A simulated phone with the real adventure stack on top of `makeGroupNode`: its own SQLite
 * database, `AdventureService`, tracker and achievement engine. TEST ONLY: proves protocol and
 * rule logic, not Bluetooth or GPS.
 */
export async function makeAdventureNode(
  net: FakeNetwork,
  address: string,
  opts: Parameters<typeof makeGroupNode>[2] & { regions?: CoverageRegion[] } = {},
) {
  const node = await makeGroupNode(net, address, opts);
  const repo = new AdventuresRepo(node.db);
  const unlocks = new AchievementsRepo(node.db);
  const regions: { list: CoverageRegion[] } = { list: opts.regions ?? [] };
  const service = new AdventureService({
    repo,
    groups: node.groupsRepo,
    mesh: node.mesh,
    pubsub: node.pubsub,
    clock: node.clock,
    newId: () => `01ADV${String(++counter).padStart(8, '0')}`,
    displayName: async () => (await node.kv.get('profile.name')) ?? address,
    installedRegions: async () => regions.list,
    tzOffsetMin: () => 0,
  });
  service.start({ poll: false });
  const fixes = new Emitter<Fix | null>();
  const tracker = new AdventureTracker({
    service,
    repo,
    clock: node.clock,
    fixes: fn => fixes.subscribe(fn),
    radiusM: async () => 30,
  });
  tracker.start();
  const engine = new AchievementEngine({
    repo,
    unlocks,
    clock: node.clock,
    address: () => node.mesh.getSnapshot().localAddress,
    sources: [node.points.changes as Emitter<unknown>],
  });
  return { ...node, repo, unlocks, service, tracker, engine, regions, fixes };
}

let counter = 0;

export async function settle(nodes: AdventureNode[], rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await settleGroups(nodes, 1);
    for (const n of nodes) {
      await n.service.idle();
    }
  }
}

export function fixAt(lat: number, lon: number, at: number, accM = 5): Fix {
  return { lat, lon, accM, fixAt: at };
}
