import { Services } from '../runtime/services';
import { KvRepo } from '../data/repositories/KvRepo';
import { EventsRepo } from '../data/repositories/EventsRepo';
import { GroupsRepo } from '../data/repositories/GroupsRepo';
import { MeetingPointsRepo } from '../data/repositories/MeetingPointsRepo';
import { GroupService } from '../features/groups/GroupService';
import { GROUP_SERVICE_ID } from '../mesh/groupTopics';
import { PointsRepo } from '../data/repositories/PointsRepo';
import { PubSub } from '../mesh/PubSub';
import { FakeMesh, FakeNetwork } from './FakeMesh';
import { RegionsRepo } from '../data/repositories/RegionsRepo';
import { runMigrations } from '../data/migrations';
import { parseCatalog } from '../domain/maps/catalog';
import { PlaceSearch } from '../features/maps-manager/PlaceSearch';
import { MapPackManager } from '../features/maps-manager/MapPackManager';
import { LocationService } from '../platform/LocationService';
import { Clock } from '../shared/clock';
import { FakeHttp } from './FakeHttp';
import { FakeLocation } from './FakeLocation';
import { MemoryFs } from './MemoryFs';
import { openNodeSqlite } from './nodeSqlite';

export class ManualClock implements Clock {
  constructor(public t = 1_700_000_000_000) {}
  now() {
    return this.t;
  }
  advance(ms: number) {
    this.t += ms;
  }
}

let idCounter = 0;
export const testId = () => `01TEST${String(++idCounter).padStart(6, '0')}`;

let randomCounter = 0;
/** Distinct bytes on every call. Test only; production uses expo-crypto. */
export const testRandomBytes = (n: number): Uint8Array => {
  randomCounter++;
  return Uint8Array.from({ length: n }, (_, i) => (randomCounter * 37 + i * 11) % 256);
};

export async function makeTestServices(
  over: {
    catalog?: unknown;
    dbPath?: string;
    fs?: MemoryFs;
    http?: FakeHttp;
    net?: FakeNetwork;
    address?: string;
  } = {},
) {
  const db = openNodeSqlite(over.dbPath);
  await runMigrations(db);
  const clock = new ManualClock();
  const fs = over.fs ?? new MemoryFs();
  const http = over.http ?? new FakeHttp();
  const kv = new KvRepo(db);
  const regions = new RegionsRepo(db);
  const points = new PointsRepo(db, clock, testId);
  const bundledCatalog = parseCatalog(
    over.catalog ?? { catalogVersion: 1, generatedAt: 'x', regions: [] },
  );
  const progress: unknown[] = [];
  const packs = new MapPackManager({
    fs,
    http,
    regions,
    kv,
    clock,
    bundledCatalog,
    newId: testId,
    catalogUrl: () => 'http://catalog.test/catalog.json',
    progress: e => progress.push(e),
  });
  await packs.init();
  const events = new EventsRepo(db);
  const mesh = new FakeMesh(over.address ?? 'off1testdevice', over.net ?? new FakeNetwork());
  const pubsub = new PubSub({
    mesh,
    clock,
    newId: testId,
    inbox: events,
    owns: id => id !== GROUP_SERVICE_ID,
  });
  const groupPubsub = new PubSub({
    mesh,
    clock,
    newId: testId,
    inbox: events,
    owns: id => id === GROUP_SERVICE_ID,
  });
  const groupsRepo = new GroupsRepo(db);
  const meetingPoints = new MeetingPointsRepo(db);
  const groups = new GroupService({
    mesh,
    pubsub: groupPubsub,
    groups: groupsRepo,
    points: meetingPoints,
    clock,
    newId: testId,
    randomBytes: testRandomBytes,
    displayName: async () => (await kv.get('profile.name')) ?? 'Tester',
  });
  const places = new PlaceSearch(http, () => clock.now());
  const loc = new FakeLocation();
  const location = new LocationService(loc, clock);
  const services: Services = {
    db,
    kv,
    regions,
    points,
    events,
    groupsRepo,
    meetingPoints,
    groups,
    mesh,
    pubsub,
    groupPubsub,
    fs,
    packs,
    places,
    location,
    style: { styleRoot: `${fs.root}style/`, worldBaseUri: `${fs.root}style/world-base.pmtiles` },
    clock,
  };
  return {
    services,
    db,
    clock,
    fs,
    http,
    loc,
    progress,
    packs,
    regions,
    points,
    kv,
    events,
    groupsRepo,
    meetingPoints,
    groups,
    mesh,
    pubsub,
    groupPubsub,
  };
}
