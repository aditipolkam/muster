import { moveLegacyDb } from '../data/legacyDb';
import { openOpSqlite, sqliteDirUri } from '../data/opSqliteAdapter';
import { runMigrations } from '../data/migrations';
import { KvRepo } from '../data/repositories/KvRepo';
import { EventsRepo } from '../data/repositories/EventsRepo';
import { GroupsRepo } from '../data/repositories/GroupsRepo';
import { MeetingPointsRepo } from '../data/repositories/MeetingPointsRepo';
import { AchievementsRepo, AdventuresRepo } from '../data/repositories/AdventuresRepo';
import { clampRadius, DEFAULT_RADIUS_M } from '../domain/adventures/arrival';
import { AchievementEngine } from '../features/adventures/AchievementEngine';
import { AdventureService } from '../features/adventures/AdventureService';
import { AdventureTracker } from '../features/adventures/AdventureTracker';
import { RADIUS_KEY } from '../features/adventures/settings';
import { GroupService } from '../features/groups/GroupService';
import { GROUP_SERVICE_ID } from '../mesh/groupTopics';
import { getRandomBytes } from 'expo-crypto';
import { PointsRepo } from '../data/repositories/PointsRepo';
import { RegionsRepo } from '../data/repositories/RegionsRepo';
import { parseCatalog } from '../domain/maps/catalog';
import { ensureStyleAssets } from '../features/map/styleAssets';
import { createExpoPhotoPort } from '../platform/expoPhotoAdapter';
import { PlaceSearch } from '../features/maps-manager/PlaceSearch';
import { MapPackManager } from '../features/maps-manager/MapPackManager';
import { createExpoHttpClient, HttpClient } from '../features/maps-manager/http';
import { useLocationStore } from '../platform/locationStore';
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
  // Renamed from TrailMesh: an install from before keeps its data (legacy file name moved once).
  try {
    if (await moveLegacyDb(createExpoFilePort(), sqliteDirUri(), config.dbName)) {
      log.info('moved the database from its pre-rename name');
    }
  } catch (e) {
    log.warn(`could not move the old database: ${String(e)}`);
  }
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
  // Any use of the network is noted on the adventures running at that moment (it decides whether an
  // adventure counts as "off the grid"). The client itself is unchanged.
  let onNetwork: () => void = () => undefined;
  const http = noteNetworkUse(createExpoHttpClient(), () => onNetwork());
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

  const adventuresRepo = new AdventuresRepo(db);
  const achievementsRepo = new AchievementsRepo(db);
  const adventures = new AdventureService({
    repo: adventuresRepo,
    groups: groupsRepo,
    mesh,
    pubsub: groupPubsub,
    clock: systemClock,
    newId,
    displayName: async () => (await kv.get('profile.name')) ?? 'Hiker',
    installedRegions: async () =>
      (await regions.list())
        .filter(r => r.state === 'installed')
        .map(r => ({ id: r.id, bbox: r.bbox, minZoom: r.minZoom, maxZoom: r.maxZoom })),
    tzOffsetMin: () => new Date().getTimezoneOffset(),
  });
  adventures.start();
  onNetwork = () => void adventures.noteNetworkUse();
  const adventureTracker = new AdventureTracker({
    service: adventures,
    repo: adventuresRepo,
    clock: systemClock,
    fixes: fn =>
      useLocationStore.subscribe((state, prev) => {
        if (state.fix !== prev.fix) {
          fn(state.fix);
        }
      }),
    radiusM: async () => {
      const v = Number(await kv.get(RADIUS_KEY));
      return Number.isFinite(v) && v > 0 ? clampRadius(v) : DEFAULT_RADIUS_M;
    },
    onRadiusChange: fn => kv.changes.subscribe(k => k === RADIUS_KEY && fn()),
  });
  adventureTracker.start();
  const achievements = new AchievementEngine({
    repo: adventuresRepo,
    unlocks: achievementsRepo,
    clock: systemClock,
    address: () => mesh.getSnapshot().localAddress,
    sources: [meetingPoints.changes as never],
  });
  achievements.start();

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
    adventuresRepo,
    achievementsRepo,
    adventures,
    adventureTracker,
    achievements,
    mesh,
    pubsub,
    groupPubsub,
    fs,
    photos: createExpoPhotoPort(),
    packs,
    places: new PlaceSearch(http),
    location,
    style,
    clock: systemClock,
  };
}

function noteNetworkUse(inner: HttpClient, note: () => void): HttpClient {
  return {
    stream: (url, opts) => {
      note();
      return inner.stream(url, opts);
    },
    getJson: (url, opts) => {
      note();
      return inner.getJson(url, opts);
    },
  };
}
