import { openOpSqlite } from '../data/opSqliteAdapter';
import { runMigrations } from '../data/migrations';
import { KvRepo } from '../data/repositories/KvRepo';
import { EventsRepo } from '../data/repositories/EventsRepo';
import { GroupsRepo } from '../data/repositories/GroupsRepo';
import { MeetingPointsRepo } from '../data/repositories/MeetingPointsRepo';
import { GroupService } from '../features/groups/GroupService';
import { GROUP_SERVICE_ID } from '../mesh/groupTopics';
import { getRandomBytes } from 'expo-crypto';
import { PointsRepo } from '../data/repositories/PointsRepo';
import { RegionsRepo } from '../data/repositories/RegionsRepo';
import { parseCatalog } from '../domain/maps/catalog';
import { ensureStyleAssets } from '../features/map/styleAssets';
import { PlaceSearch } from '../features/maps-manager/PlaceSearch';
import { MapPackManager } from '../features/maps-manager/MapPackManager';
import { createExpoHttpClient } from '../features/maps-manager/http';
import { PubSub } from '../mesh/PubSub';
import { nativePermissions } from '../mesh/permissions';
import { realSdk } from '../mesh/sdk';
import { SdkMeshAdapter } from '../mesh/SdkMeshAdapter';
import { createExpoBatteryPort } from '../platform/expoBatteryAdapter';
import { createExpoFilePort } from '../platform/expoFileAdapter';
import { createExpoLocationPort } from '../platform/expoLocationAdapter';
import { LocationService } from '../platform/LocationService';
import { Platform } from 'react-native';
import { Services } from '../runtime/services';
import { usePackStore } from '../runtime/packStore';
import { systemClock } from '../shared/clock';
import { config, devPlanet, devPlanets, resolveRegionUrl } from '../shared/config';
import { newId } from '../shared/ids';
import { createLogger, setDebugPositions } from '../shared/logger';

const log = createLogger('boot');

export async function bootstrap(): Promise<Services> {
  const t0 = Date.now();
  const db = await openOpSqlite(config.dbName);
  const migrated = await runMigrations(db);
  log.info(`db v${migrated.from} -> v${migrated.to}`);
  const kv = new KvRepo(db);
  const regions = new RegionsRepo(db);
  const points = new PointsRepo(db, systemClock, newId);
  const fs = createExpoFilePort();

  setDebugPositions((await kv.get('debug.positions')) === '1');

  const bundled = parseCatalog(require('../assets/catalog.json'));
  const bundledCatalog = {
    ...bundled,
    regions: bundled.regions.map(r => ({ ...r, url: resolveRegionUrl(r.url) })),
  };
  const http = createExpoHttpClient();
  const packs = new MapPackManager({
    fs,
    http,
    regions,
    kv,
    clock: systemClock,
    bundledCatalog,
    newId,
    catalogUrl: () => kvCatalogUrl,
    fallbackPlanet: () => devPlanet(),
    fallbackPlanets: () => devPlanets(),
    progress: e => {
      const store = usePackStore.getState();
      if (e.phase === 'idle') {
        store.clear(e.id);
      } else {
        store.report(e.id, e, Date.now());
      }
    },
  });
  let kvCatalogUrl = (await kv.get('catalog.url')) ?? config.defaultCatalogUrl ?? '';
  kv.changes.subscribe(key => {
    if (key === 'catalog.url') {
      void kv.get('catalog.url').then(v => {
        kvCatalogUrl = v ?? config.defaultCatalogUrl ?? '';
      });
    }
  });
  await packs.init();
  const style = await ensureStyleAssets(fs, kv);

  const location = new LocationService(createExpoLocationPort(), systemClock);
  void location.start();

  // The adapter only constructs; nothing touches Bluetooth until the user starts the mesh.
  const events = new EventsRepo(db);
  const mesh = new SdkMeshAdapter({
    sdk: realSdk,
    permissions: nativePermissions,
    clock: systemClock,
    platform: Platform.OS === 'android' ? 'android' : 'ios',
    battery: createExpoBatteryPort(),
  });
  const isGroupService = (id: string) => id === GROUP_SERVICE_ID;
  const pubsub = new PubSub({
    mesh,
    clock: systemClock,
    newId,
    inbox: events,
    owns: id => !isGroupService(id),
  });
  const groupPubsub = new PubSub({
    mesh,
    clock: systemClock,
    newId,
    inbox: events,
    owns: isGroupService,
  });
  const groupsRepo = new GroupsRepo(db);
  const meetingPoints = new MeetingPointsRepo(db);
  const groups = new GroupService({
    mesh,
    pubsub: groupPubsub,
    groups: groupsRepo,
    points: meetingPoints,
    clock: systemClock,
    newId,
    randomBytes: getRandomBytes,
    displayName: async () => (await kv.get('profile.name')) ?? 'Hiker',
  });
  await groups.start();

  log.info(`bootstrap ${Date.now() - t0} ms`);
  return {
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
    places: new PlaceSearch(http),
    location,
    style,
    clock: systemClock,
  };
}
