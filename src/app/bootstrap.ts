import { openOpSqlite } from '../data/opSqliteAdapter';
import { runMigrations } from '../data/migrations';
import { KvRepo } from '../data/repositories/KvRepo';
import { EventsRepo } from '../data/repositories/EventsRepo';
import { PointsRepo } from '../data/repositories/PointsRepo';
import { RegionsRepo } from '../data/repositories/RegionsRepo';
import { parseCatalog } from '../domain/maps/catalog';
import { ensureStyleAssets } from '../features/map/styleAssets';
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
import { config, resolveRegionUrl } from '../shared/config';
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
  const packs = new MapPackManager({
    fs,
    http: createExpoHttpClient(),
    regions,
    kv,
    clock: systemClock,
    bundledCatalog,
    newId,
    catalogUrl: () => kvCatalogUrl,
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
  const pubsub = new PubSub({ mesh, clock: systemClock, newId, inbox: events });

  log.info(`bootstrap ${Date.now() - t0} ms`);
  return {
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
    style,
    clock: systemClock,
  };
}
