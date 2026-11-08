import type { LatLon } from '../geo';
import { CoverageRegion, covers } from '../maps/coverage';
import { MAP_AREA_NAME_MAX, MAX_AREA_SPAN_DEG, MapArea } from './model';

/** About 1 km at mid latitudes: room around the outermost places so the trail edges are mapped. */
export const AREA_PADDING_DEG = 0.01;
export const DEFAULT_AREA_MIN_ZOOM = 8;
export const DEFAULT_AREA_MAX_ZOOM = 15;

export type AreaResult =
  | { ok: true; area: MapArea }
  | { ok: false; reason: 'no_places' | 'too_wide' };

/**
 * The map area an activity needs: the bounds of its places plus padding. Fails, rather than
 * guessing, when the places are too far apart to fetch as one download.
 */
export function areaForPlaces(places: LatLon[], name: string): AreaResult {
  if (places.length === 0) {
    return { ok: false, reason: 'no_places' };
  }
  const lats = places.map(p => p.lat);
  const lons = places.map(p => p.lon);
  const round = (n: number) => Math.round(n * 1e4) / 1e4;
  const west = Math.max(-180, Math.min(...lons) - AREA_PADDING_DEG);
  const east = Math.min(180, Math.max(...lons) + AREA_PADDING_DEG);
  const south = Math.max(-85, Math.min(...lats) - AREA_PADDING_DEG);
  const north = Math.min(85, Math.max(...lats) + AREA_PADDING_DEG);
  if (east - west > MAX_AREA_SPAN_DEG || north - south > MAX_AREA_SPAN_DEG) {
    return { ok: false, reason: 'too_wide' };
  }
  return {
    ok: true,
    area: {
      bbox: [round(west), round(south), round(east), round(north)],
      name: name.trim().slice(0, MAP_AREA_NAME_MAX) || 'Activity area',
      minZoom: DEFAULT_AREA_MIN_ZOOM,
      maxZoom: DEFAULT_AREA_MAX_ZOOM,
    },
  };
}

export type Box = [number, number, number, number];

/** About 4 km on a side: a walking area round one place, the reference default for a phase. */
export const DEFAULT_REGION_SIDE_KM = 4.2;
export const MIN_REGION_SIDE_KM = 1;
export const MAX_REGION_SIDE_KM = 20;

const KM_PER_DEG_LAT = 111.32;
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** A square of `sideKm` centred on `center`, clamped to the world and the allowed span. */
export function boxAround(center: LatLon, sideKm: number = DEFAULT_REGION_SIDE_KM): Box {
  const side = Math.min(MAX_REGION_SIDE_KM, Math.max(MIN_REGION_SIDE_KM, sideKm));
  const halfLat = side / 2 / KM_PER_DEG_LAT;
  // Longitude degrees shrink towards the poles; keep the box roughly square on the ground.
  const cos = Math.max(0.05, Math.cos((center.lat * Math.PI) / 180));
  const halfLon = side / 2 / (KM_PER_DEG_LAT * cos);
  return [
    round4(Math.max(-180, center.lon - halfLon)),
    round4(Math.max(-85, center.lat - halfLat)),
    round4(Math.min(180, center.lon + halfLon)),
    round4(Math.min(85, center.lat + halfLat)),
  ];
}

/** Side length of a box in km along its shorter axis at the centre; for showing "~4.2 km". */
export function boxSideKm(b: Box): { widthKm: number; heightKm: number } {
  const [w, s, e, n] = b;
  const cos = Math.cos((((s + n) / 2) * Math.PI) / 180);
  return {
    widthKm: Math.round((e - w) * KM_PER_DEG_LAT * cos * 10) / 10,
    heightKm: Math.round((n - s) * KM_PER_DEG_LAT * 10) / 10,
  };
}

export const unionBoxes = (boxes: Box[]): Box | null =>
  boxes.length === 0
    ? null
    : [
        Math.min(...boxes.map(b => b[0])),
        Math.min(...boxes.map(b => b[1])),
        Math.max(...boxes.map(b => b[2])),
        Math.max(...boxes.map(b => b[3])),
      ];

/** The one area an activity asks people to download: every phase's region merged. */
export function areaForBoxes(boxes: Box[], name: string): AreaResult {
  const u = unionBoxes(boxes);
  if (!u) {
    return { ok: false, reason: 'no_places' };
  }
  if (u[2] - u[0] > MAX_AREA_SPAN_DEG || u[3] - u[1] > MAX_AREA_SPAN_DEG) {
    return { ok: false, reason: 'too_wide' };
  }
  return {
    ok: true,
    area: {
      bbox: u,
      name: name.trim().slice(0, MAP_AREA_NAME_MAX) || 'Activity area',
      minZoom: DEFAULT_AREA_MIN_ZOOM,
      maxZoom: DEFAULT_AREA_MAX_ZOOM,
    },
  };
}

/**
 * Rough download size for an area, before anything is fetched. It is a guess from the tile count
 * and a flat average per tile [ASSUMPTION A-34: not measured against real regions], so the screens
 * say "about"; the exact size is shown when the download starts.
 */
export const AVG_TILE_BYTES = 40_000;
export function estimateAreaBytes(box: Box, minZoom: number, maxZoom: number): number {
  let tiles = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const n = 2 ** z;
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
export function boxIsInstalled(regions: CoverageRegion[], box: Box): boolean {
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
