import { BBox, LatLon, bboxContains } from '../geo';

export type CoverageRegion = { id: string; bbox: BBox; minZoom: number; maxZoom: number };

/** RegionIndex.covers(lat, lon) from MAP_ARCHITECTURE.md section 6. */
export function coveringRegions(
  regions: CoverageRegion[],
  p: LatLon,
  zoom?: number,
): CoverageRegion[] {
  return regions.filter(
    r => bboxContains(r.bbox, p) && (zoom === undefined || zoom >= r.minZoom - 0.0001),
  );
}

export function covers(regions: CoverageRegion[], p: LatLon, zoom?: number): boolean {
  return coveringRegions(regions, p, zoom).length > 0;
}

/** Base world data covers every point up to this zoom. */
export const WORLD_BASE_MAX_ZOOM = 3;

/** True when the camera is somewhere only overzoomed world data can answer. */
export function needsRegionBanner(
  regions: CoverageRegion[],
  center: LatLon,
  zoom: number,
): boolean {
  return zoom > WORLD_BASE_MAX_ZOOM + 1 && !covers(regions, center);
}

/** Squared planar distance from p to a bbox (0 inside). Good enough for ranking regions. */
function distToBBox(b: BBox, p: LatLon): number {
  const dx = Math.max(b[0] - p.lon, 0, p.lon - b[2]);
  const dy = Math.max(b[1] - p.lat, 0, p.lat - b[3]);
  return dx * dx + dy * dy;
}

/**
 * Regions to load as map sources (A-13: cap simultaneous sources, default 3). Regions covering the
 * camera centre come first, then the nearest by bbox distance; ties break on id for determinism.
 */
export function selectActiveRegions<T extends CoverageRegion>(
  regions: T[],
  center: LatLon,
  cap = 3,
): T[] {
  return [...regions]
    .sort(
      (a, b) => distToBBox(a.bbox, center) - distToBBox(b.bbox, center) || a.id.localeCompare(b.id),
    )
    .slice(0, cap);
}
