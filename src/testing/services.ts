import { Services } from '../runtime/services';
import { KvRepo } from '../data/repositories/KvRepo';
import { EventsRepo } from '../data/repositories/EventsRepo';
import { PointsRepo } from '../data/repositories/PointsRepo';
import { PubSub } from '../mesh/PubSub';
import { FakeMesh, FakeNetwork } from './FakeMesh';
import { RegionsRepo } from '../data/repositories/RegionsRepo';
import { runMigrations } from '../data/migrations';
import { parseCatalog } from '../domain/maps/catalog';
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

export async function makeTestServices(
  over: { catalog?: unknown; dbPath?: string; fs?: MemoryFs; http?: FakeHttp } = {},
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
  const mesh = new FakeMesh('off1testdevice', new FakeNetwork());
  const pubsub = new PubSub({ mesh, clock, newId: testId, inbox: events });
  const loc = new FakeLocation();
  const location = new LocationService(loc, clock);
  const services: Services = {
    db,
    kv,
    regions,
    points,
    events,
    mesh,
    pubsub,
    fs,
    packs,
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
    mesh,
    pubsub,
  };
}
