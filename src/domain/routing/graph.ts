import { distanceM } from '../geo';
import type { DecodedLayer } from './mvt';

/** Tags read from the Protomaps `roads` layer. */
export const ROAD_TAGS = ['kind', 'kind_detail', 'access', 'name'] as const;

/**
 * How much walking a way "costs" per metre, or null when people should not walk it. Paths and
 * tracks are preferred; quiet roads are fine; big roads are a last resort; motorways and private
 * ways are never used. Protomaps basemap `roads` kinds: highway, major_road, minor_road, path, other.
 */
export function walkFactor(props: Record<string, unknown>): number | null {
  const kind = String(props.kind ?? '');
  const detail = String(props.kind_detail ?? '');
  const access = String(props.access ?? '');
  if (access === 'private' || access === 'no') {
    return null;
  }
  if (kind === 'highway' || kind === 'ferry' || detail === 'motorway') {
    return null;
  }
  if (kind === 'path') {
    return detail === 'steps' ? 1.3 : 1;
  }
  if (kind === 'minor_road') {
    return detail === 'track' ? 1 : 1.15;
  }
  if (kind === 'other') {
    return 1.2;
  }
  if (kind === 'major_road') {
    // Trunk roads in hill country often have no pavement: a last resort.
    return detail === 'trunk' || detail === 'trunk_link' ? 2.5 : 1.8;
  }
  return null;
}

export type Edge = { to: number; len: number; w: number };

/** Degrees per grid cell of the node index (about 55 m north-south). */
const CELL = 0.0005;

/** An undirected walking graph. Node ids are array indexes. */
export class WalkGraph {
  readonly lat: number[] = [];
  readonly lon: number[] = [];
  readonly adj: Edge[][] = [];
  private readonly byKey = new Map<string, number>();
  private grid: Map<string, number[]> | null = null;

  get nodeCount() {
    return this.lat.length;
  }
  get edgeCount() {
    let n = 0;
    for (const a of this.adj) {
      n += a.length;
    }
    return n / 2;
  }

  node(key: string, lat: number, lon: number): number {
    const hit = this.byKey.get(key);
    if (hit !== undefined) {
      return hit;
    }
    const id = this.lat.length;
    this.lat.push(lat);
    this.lon.push(lon);
    this.adj.push([]);
    this.byKey.set(key, id);
    this.grid = null;
    return id;
  }

  edge(a: number, b: number, factor: number): void {
    if (a === b || this.adj[a]!.some(e => e.to === b)) {
      return;
    }
    const len = distanceM(this.at(a), this.at(b));
    this.adj[a]!.push({ to: b, len, w: len * factor });
    this.adj[b]!.push({ to: a, len, w: len * factor });
  }

  at(id: number) {
    return { lat: this.lat[id]!, lon: this.lon[id]! };
  }

  private cellOf(lat: number, lon: number) {
    return [Math.floor(lat / CELL), Math.floor(lon / CELL)] as const;
  }

  private index(): Map<string, number[]> {
    if (!this.grid) {
      const g = new Map<string, number[]>();
      for (let i = 0; i < this.lat.length; i++) {
        const [r, c] = this.cellOf(this.lat[i]!, this.lon[i]!);
        const k = `${r},${c}`;
        const list = g.get(k);
        if (list) {
          list.push(i);
        } else {
          g.set(k, [i]);
        }
      }
      this.grid = g;
    }
    return this.grid;
  }

  /** Connected component id per node (computed once, after the graph is complete). */
  components(): Int32Array {
    const comp = new Int32Array(this.nodeCount).fill(-1);
    let c = 0;
    for (let i = 0; i < this.nodeCount; i++) {
      if (comp[i] !== -1) {
        continue;
      }
      const stack = [i];
      comp[i] = c;
      while (stack.length > 0) {
        const x = stack.pop()!;
        for (const e of this.adj[x]!) {
          if (comp[e.to] === -1) {
            comp[e.to] = c;
            stack.push(e.to);
          }
        }
      }
      c++;
    }
    return comp;
  }

  /** All nodes within `maxM` metres, nearest first. */
  within(p: { lat: number; lon: number }, maxM: number): { id: number; distM: number }[] {
    const g = this.index();
    const [r0, c0] = this.cellOf(p.lat, p.lon);
    const cellM = CELL * 111_000 * Math.max(0.2, Math.cos((p.lat * Math.PI) / 180));
    const rings = Math.ceil(maxM / cellM) + 1;
    const out: { id: number; distM: number }[] = [];
    for (let dr = -rings; dr <= rings; dr++) {
      for (let dc = -rings; dc <= rings; dc++) {
        for (const id of g.get(`${r0 + dr},${c0 + dc}`) ?? []) {
          const d = distanceM(p, this.at(id));
          if (d <= maxM) {
            out.push({ id, distM: d });
          }
        }
      }
    }
    return out.sort((a, b) => a.distM - b.distM);
  }

  /** Nearest node within `maxM` metres (optionally skipping some), or null. */
  nearest(
    p: { lat: number; lon: number },
    maxM: number,
    skip?: (id: number) => boolean,
  ): { id: number; distM: number } | null {
    const g = this.index();
    const [r0, c0] = this.cellOf(p.lat, p.lon);
    const cellM = CELL * 111_000 * Math.max(0.2, Math.cos((p.lat * Math.PI) / 180));
    const rings = Math.ceil(maxM / cellM) + 1;
    let best: { id: number; distM: number } | null = null;
    for (let dr = -rings; dr <= rings; dr++) {
      for (let dc = -rings; dc <= rings; dc++) {
        for (const id of g.get(`${r0 + dr},${c0 + dc}`) ?? []) {
          if (skip?.(id)) {
            continue;
          }
          const d = distanceM(p, this.at(id));
          if (d <= maxM && (!best || d < best.distM)) {
            best = { id, distM: d };
          }
        }
      }
    }
    return best;
  }
}

export type GraphTile = { z: number; x: number; y: number; layer: DecodedLayer };

/** Sub-pixel key resolution: points closer than 1/16 pixel are the same node. */
const KEY_SUBPIXELS = 16;
/** Dangling line ends this close to another node are joined to it (tile edges, small gaps). */
export const SNAP_M = 4;

const toLon = (u: number) => u * 360 - 180;
const toLat = (v: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * v))) * 180) / Math.PI;

/** Liang-Barsky: the part of segment a-b inside the box, as parameters [t0, t1], or null. */
function clip(
  a: [number, number],
  b: [number, number],
  box: [number, number, number, number],
): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const checks: [number, number][] = [
    [-dx, a[0] - box[0]],
    [dx, box[2] - a[0]],
    [-dy, a[1] - box[1]],
    [dy, box[3] - a[1]],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) {
        return null;
      }
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) {
          return null;
        }
        t0 = Math.max(t0, t);
      } else {
        if (t < t0) {
          return null;
        }
        t1 = Math.min(t1, t);
      }
    }
  }
  return t0 <= t1 ? [t0, t1] : null;
}

/**
 * Builds the walking graph from the `roads` lines of a set of tiles at one zoom. Each line is
 * clipped to its own tile square (dropping the buffer that overlaps the next tile), vertices that
 * fall on the same sub-pixel become one node, and line ends left dangling are snapped to the
 * nearest node within `SNAP_M` (this joins lines across tile edges).
 */
export function buildGraph(tiles: GraphTile[]): WalkGraph {
  const g = new WalkGraph();
  const ends = new Set<number>();
  for (const t of tiles) {
    const n = Math.pow(2, t.z);
    const ext = t.layer.extent;
    const scale = n * ext * KEY_SUBPIXELS;
    // Tile square in pixels of this tile.
    const box: [number, number, number, number] = [0, 0, ext, ext];
    const nodeAt = (px: number, py: number) => {
      const u = (t.x + px / ext) / n;
      const v = (t.y + py / ext) / n;
      return g.node(`${Math.round(u * scale)},${Math.round(v * scale)}`, toLat(v), toLon(u));
    };
    for (const line of t.layer.lines) {
      const factor = walkFactor(line.props);
      if (factor === null) {
        continue;
      }
      for (const part of line.parts) {
        let prev: number | null = null;
        let first: number | null = null;
        for (let i = 0; i + 1 < part.length; i++) {
          const a = part[i]!;
          const b = part[i + 1]!;
          const c = clip(a, b, box);
          if (!c) {
            if (prev !== null) {
              ends.add(prev);
            }
            prev = null;
            continue;
          }
          const p0 = nodeAt(a[0] + (b[0] - a[0]) * c[0], a[1] + (b[1] - a[1]) * c[0]);
          const p1 = nodeAt(a[0] + (b[0] - a[0]) * c[1], a[1] + (b[1] - a[1]) * c[1]);
          if (prev === null) {
            ends.add(p0);
            first = first ?? p0;
          }
          g.edge(p0, p1, factor);
          prev = p1;
          // Leaving the tile ends this piece.
          if (c[1] < 1) {
            ends.add(p1);
            prev = null;
          }
        }
        if (prev !== null) {
          ends.add(prev);
        }
      }
    }
  }
  for (const id of ends) {
    if (g.adj[id]!.length > 1) {
      continue;
    }
    const near = g.nearest(
      g.at(id),
      SNAP_M,
      other => other === id || g.adj[id]!.some(e => e.to === other),
    );
    if (near) {
      g.edge(id, near.id, 1);
    }
  }
  return g;
}
