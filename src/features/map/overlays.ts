import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';
import { circleRing, sectorRing } from '../../domain/geo';
import { Fix, usableHeading } from '../../domain/location/fix';
import type { MeetingPoint } from '../../domain/groups/model';
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

/** Shared meeting points. The feature id is `<groupId>:<pointId>` so the same ULID in two groups cannot collide. */
export const meetingPointKey = (p: Pick<MeetingPoint, 'groupId' | 'id'>) => `${p.groupId}:${p.id}`;

export function meetingPointsCollection(points: MeetingPoint[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points
      .filter(p => !p.deleted)
      .map(p => ({
        type: 'Feature',
        id: meetingPointKey(p),
        properties: { id: meetingPointKey(p), name: p.name, acked: p.ackedRev >= p.rev },
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      })),
  };
}

export type CheckpointPin = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  reached: boolean;
};

/** Checkpoints of the adventure being shown; `reached` is this person's own record. */
export function checkpointsCollection(pins: CheckpointPin[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: pins.map(p => ({
      type: 'Feature',
      id: p.id,
      properties: { id: p.id, name: p.name, reached: p.reached },
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    })),
  };
}

/** The recorded route as one line (nothing when fewer than two points were recorded). */
export function routeCollection(points: { lat: number; lon: number }[]): FeatureCollection {
  if (points.length < 2) {
    return empty();
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: points.map(p => [p.lon, p.lat]) },
      },
    ],
  };
}

/** Rough on-screen metres-per-pixel at a latitude/zoom, used to size the heading cone. */
export function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** The straight guidance line from the user to the navigation target (empty without a fix). */
export function guideLine(
  from: { lat: number; lon: number } | null,
  to: { lat: number; lon: number } | null,
): FeatureCollection {
  return from && to ? routeCollection([from, to]) : empty();
}

/** A single temporary pin (the dropped pin or the navigation target); empty when null. */
export function pinCollection(p: { lat: number; lon: number } | null): FeatureCollection {
  return p
    ? {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
          },
        ],
      }
    : empty();
}
