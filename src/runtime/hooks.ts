import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Emitter } from '../data/events';
import { Marker } from '../domain/markers/marker';
import { RegionRecord } from '../domain/maps/region';
import type { PubSubSnapshot } from '../mesh/PubSub';
import type { MeshSnapshot } from '../mesh/types';
import { useServices } from './services';

/** Re-runs `load` whenever any emitter fires. Table-level invalidation as in ARCHITECTURE.md 5. */
export function useLiveQuery<T>(
  emitters: Emitter<unknown>[],
  load: () => Promise<T>,
  initial: T,
): T {
  const [value, setValue] = useState<T>(initial);
  const loadRef = useRef(load);
  loadRef.current = load;
  const refresh = useCallback(() => {
    loadRef.current().then(setValue, () => undefined);
  }, []);
  useEffect(() => {
    refresh();
    const unsubs = emitters.map(e => e.subscribe(refresh));
    return () => unsubs.forEach(u => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}

export function useMarkers(): Marker[] {
  const { points } = useServices();
  return useLiveQuery([points.changes as Emitter<unknown>], () => points.list(), []);
}

export function useRegions(): RegionRecord[] {
  const { regions } = useServices();
  return useLiveQuery([regions.changes as Emitter<unknown>], () => regions.list(), []);
}

/** Mesh state for screens. Snapshots are immutable, so identity changes only when something did. */
export function useMesh(): MeshSnapshot {
  const { mesh } = useServices();
  return useSyncExternalStore(mesh.subscribe, mesh.getSnapshot);
}

export function usePubSub(): PubSubSnapshot {
  const { pubsub } = useServices();
  return useSyncExternalStore(pubsub.subscribeChanges, pubsub.getSnapshot);
}
