import { useEffect, useRef, useState } from 'react';
import type { LatLon } from '../../domain/geo';
import type { RegionRecord } from '../../domain/maps/region';
import {
  planRoute,
  Route,
  RouteFailure,
  RouterPort,
  routeProgress,
} from '../../domain/routing/router';
import { PmtilesTileSource } from '../../domain/routing/tileSource';
import type { FilePort } from '../../platform/FilePort';
import { createLogger } from '../../shared/logger';

const log = createLogger('route');

const inBox = (b: [number, number, number, number], p: LatLon) =>
  p.lon >= b[0] && p.lon <= b[2] && p.lat >= b[1] && p.lat <= b[3];

/** Opened archives, by file: the header and root directory are read once. */
const sources = new Map<string, Promise<PmtilesTileSource>>();

/**
 * RouterPort over the downloaded regions (ADR 0015, experiment): the installed region that holds
 * both ends, with the most detail, is read straight from its PMTiles file. No network.
 */
export function createTrailRouter(fs: FilePort, regions: RegionRecord[]): RouterPort {
  return {
    async route(from, to) {
      const region = regions
        .filter(
          r => r.state === 'installed' && r.filePath && inBox(r.bbox, from) && inBox(r.bbox, to),
        )
        .sort((a, b) => b.maxZoom - a.maxZoom)[0];
      if (!region?.filePath) {
        log.info(`no downloaded region holds both ends (${regions.length} regions on this phone)`);
        return { ok: false, reason: 'no_map' };
      }
      const uri = region.filePath;
      let src = sources.get(uri);
      if (!src) {
        src = PmtilesTileSource.open((offset, length) => fs.readRange(uri, offset, length));
        sources.set(uri, src);
      }
      try {
        return await planRoute(await src, from, to);
      } catch (e) {
        sources.delete(uri);
        log.warn(`route failed: ${String(e)}`);
        return { ok: false, reason: 'error' };
      }
    },
  };
}

export type TrailState =
  | { status: 'idle' }
  | { status: 'finding' }
  | { status: 'none'; reason: RouteFailure }
  | {
      status: 'ok';
      route: Route;
      /** Metres left along the route from where you are. */
      remainingM: number;
      /** A point a little further along the route, to head for. */
      ahead: LatLon;
    };

/** Off the route by more than this: look for a new one (at most every REROUTE_MS). */
export const OFF_ROUTE_M = 60;
export const REROUTE_MS = 30_000;

/**
 * A walking route from where you are to the navigation target, found once when navigation
 * starts (and again when you wander off it). While none is found the caller shows the straight
 * line.
 */
export function useTrailRoute(
  router: RouterPort,
  target: (LatLon & { name: string }) | null,
  fix: LatLon | null,
): TrailState {
  const [state, setState] = useState<TrailState>({ status: 'idle' });
  const token = useRef(0);
  const lastAttempt = useRef(0);
  const targetKey = target ? `${target.name}|${target.lat}|${target.lon}` : '';
  const hasFix = !!fix;

  const run = (from: LatLon, to: LatLon) => {
    const my = ++token.current;
    lastAttempt.current = Date.now();
    setState(s => (s.status === 'ok' ? s : { status: 'finding' }));
    void router.route(from, to).then(r => {
      if (my !== token.current) {
        return;
      }
      // No coordinates in logs (CLAUDE.md rule 8): only the outcome and the graph size.
      log.info(
        r.ok
          ? `trail route: ${Math.round(r.distanceM)} m, ${JSON.stringify(r.stats)}`
          : `no trail route: ${r.reason}${r.stats ? ` ${JSON.stringify(r.stats)}` : ''}`,
      );
      if (r.ok) {
        const p = routeProgress(r.coords, from);
        setState({ status: 'ok', route: r, remainingM: p.remainingM, ahead: p.ahead });
      } else {
        setState({ status: 'none', reason: r.reason });
      }
    });
  };

  // A new destination (or the first GPS fix) asks for a route.
  useEffect(() => {
    token.current++;
    if (!target) {
      setState({ status: 'idle' });
      return;
    }
    if (fix) {
      run(fix, target);
    } else {
      setState({ status: 'finding' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, hasFix, router]);

  // Follow progress along the route; off it for a while, look again from here.
  useEffect(() => {
    if (!fix || !target || state.status !== 'ok') {
      return;
    }
    const p = routeProgress(state.route.coords, fix);
    if (p.offRouteM > OFF_ROUTE_M && Date.now() - lastAttempt.current > REROUTE_MS) {
      run(fix, target);
      return;
    }
    if (Math.abs(p.remainingM - state.remainingM) > 1) {
      setState({ ...state, remainingM: p.remainingM, ahead: p.ahead });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix?.lat, fix?.lon]);

  return state;
}
