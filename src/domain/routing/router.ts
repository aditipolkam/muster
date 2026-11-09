import { distanceM, LatLon } from '../geo';
import { latToTileY, lonToTileX } from '../maps/pmtilesDir';
import { aStar } from './astar';
import { buildGraph, GraphTile, ROAD_TAGS, WalkGraph } from './graph';
import { decodeLines } from './mvt';
import type { TileSource } from './tileSource';

/**
 * Offline walking routes (experiment, ADR 0015): a graph built from the path, track and road
 * lines already inside the downloaded map tiles, searched with A*.
 */

export type RouteFailure =
  /** No downloaded map covers both ends. */
  | 'no_map'
  /** Further apart than this experiment routes. */
  | 'too_far'
  /** Start or end is too far from any walkable line. */
  | 'off_network'
  /** Both ends are near paths, but the paths do not connect (or the search gave up). */
  | 'no_route'
  | 'error';

export type RouteStats = {
  zoom: number;
  tiles: number;
  nodes: number;
  edges: number;
  /** Reading and decoding tiles. */
  loadMs: number;
  /** Building the graph. */
  buildMs: number;
  /** A* search. */
  searchMs: number;
};

export type Route = {
  ok: true;
  /** From the start point, along the paths, to the end point. */
  coords: LatLon[];
  /** Metres along `coords`. */
  distanceM: number;
  /** Straight-line metres from start or end to the path it joins (included in distanceM). */
  snapM: { start: number; end: number };
  stats: RouteStats;
};

export type RouteResult = Route | { ok: false; reason: RouteFailure; stats?: Partial<RouteStats> };

/** What navigation asks for; the app's adapter picks the downloaded region and calls `planRoute`. */
export interface RouterPort {
  route(from: LatLon, to: LatLon): Promise<RouteResult>;
}

export const MAX_ROUTE_M = 15_000;
/** Start or end may be this far from the nearest path (walked as a straight line). */
export const MAX_SNAP_M = 250;
/** Never load more tiles than this for one route; zoom drops a level until it fits. */
export const MAX_TILES = 600;

type Opts = { now?: () => number };

/** Tiles at `z` covering the box around both points, with a margin for detours. */
export function tilesFor(from: LatLon, to: LatLon, z: number) {
  const d = distanceM(from, to);
  const marginM = Math.max(600, d * 0.35);
  const dLat = marginM / 111_000;
  const midLat = (from.lat + to.lat) / 2;
  const dLon = marginM / (111_000 * Math.max(0.2, Math.cos((midLat * Math.PI) / 180)));
  const west = Math.min(from.lon, to.lon) - dLon;
  const east = Math.max(from.lon, to.lon) + dLon;
  const south = Math.min(from.lat, to.lat) - dLat;
  const north = Math.max(from.lat, to.lat) + dLat;
  const x0 = lonToTileX(west, z);
  const x1 = lonToTileX(east, z);
  const y0 = latToTileY(north, z);
  const y1 = latToTileY(south, z);
  const out: { z: number; x: number; y: number }[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      out.push({ z, x, y });
    }
  }
  return out;
}

export async function planRoute(
  source: TileSource,
  from: LatLon,
  to: LatLon,
  opts: Opts = {},
): Promise<RouteResult> {
  const now = opts.now ?? (() => Date.now());
  const straight = distanceM(from, to);
  if (straight > MAX_ROUTE_M) {
    return { ok: false, reason: 'too_far' };
  }
  // Paths are in Protomaps tiles from about z13; z15 has the most detail.
  let z = Math.min(15, source.maxZoom);
  if (z < 13) {
    return { ok: false, reason: 'no_map' };
  }
  let wanted = tilesFor(from, to, z);
  while (wanted.length > MAX_TILES && z > 13) {
    z -= 1;
    wanted = tilesFor(from, to, z);
  }
  if (wanted.length > MAX_TILES) {
    return { ok: false, reason: 'too_far' };
  }

  const t0 = now();
  const tiles: GraphTile[] = [];
  for (let i = 0; i < wanted.length; i += 8) {
    const batch = wanted.slice(i, i + 8);
    const got = await Promise.all(batch.map(t => source.tile(t.z, t.x, t.y)));
    got.forEach((bytes, k) => {
      if (!bytes) {
        return;
      }
      const layer = decodeLines(bytes, 'roads', ROAD_TAGS);
      if (layer) {
        tiles.push({ ...batch[k]!, layer });
      }
    });
  }
  const t1 = now();
  const g = buildGraph(tiles);
  const t2 = now();
  const base = {
    zoom: z,
    tiles: tiles.length,
    nodes: g.nodeCount,
    edges: g.edgeCount,
    loadMs: t1 - t0,
    buildMs: t2 - t1,
  };
  if (tiles.length === 0) {
    return { ok: false, reason: 'no_map', stats: base };
  }

  const ends = snapEnds(g, from, to);
  if (ends === 'off_network' || ends === 'no_route') {
    return { ok: false, reason: ends, stats: base };
  }
  const { s, e } = ends;
  const path = aStar(g, s.id, e.id);
  const t3 = now();
  const stats: RouteStats = { ...base, searchMs: t3 - t2 };
  if (!path) {
    return { ok: false, reason: 'no_route', stats };
  }
  const coords: LatLon[] = [from, ...path.map(id => g.at(id)), to];
  return {
    ok: true,
    coords,
    distanceM: lengthOf(coords),
    snapM: { start: s.distM, end: e.distM },
    stats,
  };
}

/**
 * Joins start and end to the graph. The nearest node can sit on a short, cut-off piece (a path
 * stub beside a road that is not walkable), so both ends join the same connected piece, keeping
 * the total straight-line gap smallest.
 */
export function snapEnds(
  g: WalkGraph,
  from: LatLon,
  to: LatLon,
): { s: Snap; e: Snap } | 'off_network' | 'no_route' {
  const sc = g.within(from, MAX_SNAP_M);
  const ec = g.within(to, MAX_SNAP_M);
  if (sc.length === 0 || ec.length === 0) {
    return 'off_network';
  }
  const comp = g.components();
  const bestS = new Map<number, Snap>();
  for (const c of sc) {
    const k = comp[c.id]!;
    if (!bestS.has(k)) {
      bestS.set(k, c);
    }
  }
  let pick: { s: Snap; e: Snap } | null = null;
  const seen = new Set<number>();
  for (const c of ec) {
    const k = comp[c.id]!;
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    const s = bestS.get(k);
    if (s && (!pick || s.distM + c.distM < pick.s.distM + pick.e.distM)) {
      pick = { s, e: c };
    }
  }
  return pick ?? 'no_route';
}

type Snap = { id: number; distM: number };

export function lengthOf(coords: LatLon[]): number {
  let d = 0;
  for (let i = 1; i < coords.length; i++) {
    d += distanceM(coords[i - 1]!, coords[i]!);
  }
  return d;
}

/**
 * Where you are along a route: the nearest route vertex, metres left from there (plus the gap to
 * it), how far you are off the route, and a point about `aheadM` further on to head for.
 */
export function routeProgress(coords: LatLon[], at: LatLon, aheadM = 40) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = distanceM(at, coords[i]!);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  let rest = 0;
  for (let i = best + 1; i < coords.length; i++) {
    rest += distanceM(coords[i - 1]!, coords[i]!);
  }
  let ahead = coords[coords.length - 1]!;
  let walked = 0;
  for (let i = best + 1; i < coords.length; i++) {
    walked += distanceM(coords[i - 1]!, coords[i]!);
    if (walked >= aheadM) {
      ahead = coords[i]!;
      break;
    }
  }
  return { index: best, offRouteM: bestD, remainingM: bestD + rest, ahead };
}
