import { z } from 'zod';
import { BBox } from '../geo';
import { CoverageRegion, covers } from './coverage';

/** The largest area, in degrees on a side, that anyone may be asked to download in one go. */
export const MAX_AREA_SPAN_DEG = 0.5;
export const MAX_AREA_ZOOM = 16;
export const MAP_AREA_NAME_MAX = 60;
export const DEFAULT_AREA_MIN_ZOOM = 8;
export const DEFAULT_AREA_MAX_ZOOM = 15;

/**
 * An area someone else asks this person to download: an activity's area, or a group's trip map.
 * Only the definition travels; the tiles are fetched by each person.
 */
export type MapArea = {
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  name: string;
  minZoom: number;
  maxZoom: number;
};

const latLon = {
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
};

/** On the wire: `{b: [w, s, e, n], n: name, z: [min, max]}`. Untrusted, always parsed. */
export const MapAreaWireSchema = z
  .object({
    b: z.tuple([latLon.lon, latLon.lat, latLon.lon, latLon.lat]),
    n: z
      .string()
      .min(1)
      .max(MAP_AREA_NAME_MAX * 2),
    z: z.tuple([z.number().int().min(0).max(24), z.number().int().min(0).max(24)]),
  })
  .refine(a => {
    const [w, s, e, n] = a.b;
    return w < e && s < n && e - w <= MAX_AREA_SPAN_DEG && n - s <= MAX_AREA_SPAN_DEG;
  }, 'area is empty or larger than the allowed span')
  .refine(a => a.z[0] <= a.z[1] && a.z[1] <= MAX_AREA_ZOOM, 'zoom range is not allowed');
export type MapAreaWire = z.infer<typeof MapAreaWireSchema>;

export const toMapArea = (w: MapAreaWire): MapArea => ({
  bbox: [...w.b],
  name: w.n,
  minZoom: w.z[0],
  maxZoom: w.z[1],
});
export const toMapAreaWire = (a: MapArea): MapAreaWire => ({
  b: [...a.bbox],
  n: a.name,
  z: [a.minZoom, a.maxZoom],
});

/** An area at the default zoom range, named for the downloads list. */
export const areaFromBox = (bbox: BBox, name: string): MapArea => ({
  bbox: [...bbox],
  name: name.trim().slice(0, MAP_AREA_NAME_MAX) || 'Map area',
  minZoom: DEFAULT_AREA_MIN_ZOOM,
  maxZoom: DEFAULT_AREA_MAX_ZOOM,
});

/** A stored or received area, or null when it is missing or not valid. */
export function parseMapArea(raw: unknown): MapArea | null {
  const r = MapAreaWireSchema.safeParse(raw);
  return r.success ? toMapArea(r.data) : null;
}

/**
 * Rough download size for an area, before anything is fetched. It is a guess from the tile count
 * and a flat average per tile [ASSUMPTION A-34: not measured against real regions], so the screens
 * say "about"; the exact size is shown when the download starts.
 */
export const AVG_TILE_BYTES = 40_000;
export function estimateAreaBytes(box: BBox, minZoom: number, maxZoom: number): number {
  let tiles = 0;
  for (let zoom = minZoom; zoom <= maxZoom; zoom++) {
    const n = 2 ** zoom;
    const x = (lon: number) => Math.floor(((lon + 180) / 360) * n);
    const y = (lat: number) => {
      const r = (lat * Math.PI) / 180;
      return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
    };
    tiles += (x(box[2]) - x(box[0]) + 1) * (y(box[1]) - y(box[3]) + 1);
  }
  return tiles * AVG_TILE_BYTES;
}

/** Is the whole box (its corners and centre) inside regions the person has installed? */
export function boxIsInstalled(regions: CoverageRegion[], box: BBox): boolean {
  const [w, s, e, n] = box;
  const pts = [
    { lat: s, lon: w },
    { lat: s, lon: e },
    { lat: n, lon: w },
    { lat: n, lon: e },
    { lat: (s + n) / 2, lon: (w + e) / 2 },
  ];
  return pts.every(p => covers(regions, p));
}

/** "118 MB", "850 KB". */
export function formatBytesShort(bytes: number): string {
  if (bytes >= 1_000_000) {
    return `${Math.round(bytes / 1_000_000)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}
