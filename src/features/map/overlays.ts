import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';
import { circleRing, sectorRing } from '../../domain/geo';
import { Fix, usableHeading } from '../../domain/location/fix';
import { Marker } from '../../domain/markers/marker';

const empty = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] });

export function accuracyCircle(fix: Fix | null): FeatureCollection {
  if (!fix || !Number.isFinite(fix.accM)) {
    return empty();
  }
  const f: Feature<Polygon> = {
    type: 'Feature',
    properties: {},
    // Cap the circle so a bad fix cannot paint the whole screen.
    geometry: { type: 'Polygon', coordinates: [circleRing(fix, Math.min(fix.accM, 5000))] },
  };
  return { type: 'FeatureCollection', features: [f] };
}

export function headingCone(
  fix: Fix | null,
  headingDeg: number | null,
  radiusM: number,
): FeatureCollection {
  const h = usableHeading(headingDeg);
  if (!fix || h === undefined) {
    return empty();
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [sectorRing(fix, h, radiusM)] },
      },
    ],
  };
}

export function mePuck(fix: Fix | null, stale: boolean): FeatureCollection {
  if (!fix) {
    return empty();
  }
  const f: Feature<Point> = {
    type: 'Feature',
    properties: { stale },
    geometry: { type: 'Point', coordinates: [fix.lon, fix.lat] },
  };
  return { type: 'FeatureCollection', features: [f] };
}

export function markersCollection(markers: Marker[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: markers.map(m => ({
      type: 'Feature',
      id: m.id,
      properties: { id: m.id, name: m.name },
      geometry: { type: 'Point', coordinates: [m.lon, m.lat] },
    })),
  };
}

/** Rough on-screen metres-per-pixel at a latitude/zoom, used to size the heading cone. */
export function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}
