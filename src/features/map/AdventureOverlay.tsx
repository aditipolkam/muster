import { useEffect, useMemo, useRef, useState } from 'react';
import { placeOf } from '../../domain/adventures/model';
import { thinRoute } from '../../domain/adventures/track';
import { boundsOf } from '../../domain/adventures/route';
import { useAdventureDetail, useAdventureRuntime, useCurrentAdventure } from '../../runtime/hooks';
import { useServices } from '../../runtime/services';
import { useReducedMotion } from '../../ui/motion';
import { CheckpointPin, checkpointsCollection, routeCollection } from './overlays';

const PULSE_STEPS = [0, 1, 2];
const PULSE_STEP_MS = 300;
/** Reload the drawn route at most this often; it can hold thousands of points. */
const ROUTE_REFRESH_MS = 15_000;

/** What the map draws for the adventure in view: its checkpoints, route and a gentle pulse. */
export function useAdventureMapState(showId: string | undefined) {
  const { adventuresRepo } = useServices();
  const current = useCurrentAdventure();
  const shownId = showId ?? current?.adventure.id ?? '';
  const detail = useAdventureDetail(shownId);
  const rt = useAdventureRuntime();
  const reduced = useReducedMotion();

  const [route, setRoute] = useState<{ lat: number; lon: number }[]>([]);
  useEffect(() => {
    if (!shownId) {
      setRoute([]);
      return;
    }
    let live = true;
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      last = Date.now();
      void adventuresRepo.track(shownId).then(t => live && setRoute(thinRoute(t, 400)));
    };
    load();
    const unsub = adventuresRepo.changes.subscribe(() => {
      if (timer) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        load();
      }, Math.max(0, ROUTE_REFRESH_MS - (Date.now() - last)));
    });
    return () => {
      live = false;
      unsub();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [adventuresRepo, shownId]);

  const pins: CheckpointPin[] = useMemo(
    () =>
      detail
        ? detail.checkpoints.flatMap(cp => {
            const place = placeOf(cp);
            return place
              ? [
                  {
                    id: cp.id,
                    name: cp.name,
                    ...place,
                    reached: detail.completions.some(
                      x => x.checkpointId === cp.id && x.address === detail.self,
                    ),
                  },
                ]
              : [];
          })
        : [],
    [detail],
  );
  const checkpoints = useMemo(() => checkpointsCollection(pins), [pins]);
  const routeData = useMemo(() => routeCollection(route), [route]);

  // A short, small swell on the marker that was just reached. Skipped with reduced motion.
  const newest = rt.celebrations.filter(c => c.checkpointId).slice(-1)[0];
  const [pulse, setPulse] = useState<{ id: string; step: number } | null>(null);
  const lastPulse = useRef<string | null>(null);
  useEffect(() => {
    if (!newest?.checkpointId || reduced || lastPulse.current === newest.id) {
      return;
    }
    lastPulse.current = newest.id;
    const timers = PULSE_STEPS.map((step, i) =>
      setTimeout(() => setPulse({ id: newest.checkpointId as string, step }), i * PULSE_STEP_MS),
    );
    timers.push(setTimeout(() => setPulse(null), PULSE_STEPS.length * PULSE_STEP_MS));
    return () => timers.forEach(clearTimeout);
  }, [newest, reduced]);

  const bounds = useMemo(() => boundsOf([...pins, ...route]), [pins, route]);
  return { current, detail, checkpoints, route: routeData, pulse, bounds, shownId };
}
