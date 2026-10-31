import React, { createContext, useContext } from 'react';
import type { KvRepo } from '../data/repositories/KvRepo';
import type { PointsRepo } from '../data/repositories/PointsRepo';
import type { RegionsRepo } from '../data/repositories/RegionsRepo';
import type { DbPort } from '../data/DbPort';
import type { EventsRepo } from '../data/repositories/EventsRepo';
import type { MeshPort } from '../mesh/types';
import type { PubSub } from '../mesh/PubSub';
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
  /** The only door to the SDK. Real adapter in the app, FakeMesh in tests. */
  mesh: MeshPort;
  pubsub: PubSub;
  fs: FilePort;
  packs: MapPackManager;
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
