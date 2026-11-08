import React, { createContext, useContext } from 'react';
import type { KvRepo } from '../data/repositories/KvRepo';
import type { PointsRepo } from '../data/repositories/PointsRepo';
import type { RegionsRepo } from '../data/repositories/RegionsRepo';
import type { DbPort } from '../data/DbPort';
import type { EventsRepo } from '../data/repositories/EventsRepo';
import type { AchievementsRepo, AdventuresRepo } from '../data/repositories/AdventuresRepo';
import type { GroupsRepo } from '../data/repositories/GroupsRepo';
import type { MeetingPointsRepo } from '../data/repositories/MeetingPointsRepo';
import type { AchievementEngine } from '../features/adventures/AchievementEngine';
import type { AdventureService } from '../features/adventures/AdventureService';
import type { AdventureTracker } from '../features/adventures/AdventureTracker';
import type { GroupService } from '../features/groups/GroupService';
import type { MeshPort } from '../mesh/types';
import type { PubSub } from '../mesh/PubSub';
import type { PhotoPort } from '../platform/PhotoPort';
import type { PlaceSearch } from '../features/maps-manager/PlaceSearch';
import type { MapPackManager } from '../features/maps-manager/MapPackManager';
import type { InstalledStyleAssets } from '../features/map/styleAssets';
import type { FilePort } from '../platform/FilePort';
import type { LocationService } from '../platform/LocationService';
import type { Clock } from '../shared/clock';

/** Composition root output. Created once in app/bootstrap and injected, so features never import each other. */
export type Services = {
  db: DbPort;
  kv: KvRepo;
  regions: RegionsRepo;
  points: PointsRepo;
  events: EventsRepo;
  groupsRepo: GroupsRepo;
  meetingPoints: MeetingPointsRepo;
  /** Group membership and meeting point sharing over `groupPubsub`. */
  groups: GroupService;
  adventuresRepo: AdventuresRepo;
  achievementsRepo: AchievementsRepo;
  /** Adventures, checkpoints, arrivals and their group replication (`adv` channel). */
  adventures: AdventureService;
  /** Route, distance and arrival detection from location fixes. */
  adventureTracker: AdventureTracker;
  achievements: AchievementEngine;
  /** The only door to the SDK. Real adapter in the app, FakeMesh in tests. */
  mesh: MeshPort;
  pubsub: PubSub;
  /** Second PubSub instance, scoped to the group service (`tm.group.*`). */
  groupPubsub: PubSub;
  fs: FilePort;
  /** Attach a photo from the library to a phase; stays on this phone. */
  photos: PhotoPort;
  packs: MapPackManager;
  /** Online place search for picking a region to download. */
  places: PlaceSearch;
  location: LocationService;
  style: InstalledStyleAssets;
  clock: Clock;
};

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({
  services,
  children,
}: {
  services: Services;
  children: React.ReactNode;
}) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) {
    throw new Error('useServices outside ServicesProvider');
  }
  return s;
}
