export type LatLon = { lat: number; lon: number };
/** [minLon, minLat, maxLon, maxLat] */
export type BBox = [number, number, number, number];

const EARTH_RADIUS_M = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function isValidLatLon(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
  );
}

export function normalizeLon(lon: number): number {
  const r = ((((lon + 180) % 360) + 360) % 360) - 180;
  return r === -180 && lon > 0 ? 180 : r;
}

/** Great-circle distance in metres (haversine). */
export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing from a to b in degrees [0, 360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point reached from `from` travelling `distM` along `bearing` degrees. */
export function destination(from: LatLon, bearing: number, distM: number): LatLon {
  const d = distM / EARTH_RADIUS_M;
  const brg = toRad(bearing);
  const phi1 = toRad(from.lat);
  const lam1 = toRad(from.lon);
  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(d) + Math.cos(phi1) * Math.sin(d) * Math.cos(brg),
  );
  const lam2 =
    lam1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(d) * Math.cos(phi1),
      Math.cos(d) - Math.sin(phi1) * Math.sin(phi2),
    );
  return { lat: toDeg(phi2), lon: normalizeLon(toDeg(lam2)) };
}

export function bboxContains(b: BBox, p: LatLon): boolean {
  return p.lon >= b[0] && p.lon <= b[2] && p.lat >= b[1] && p.lat <= b[3];
}

export function bboxOverlaps(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function bboxCenter(b: BBox): LatLon {
  return { lat: (b[1] + b[3]) / 2, lon: (b[0] + b[2]) / 2 };
}

/** Approximate area in km^2 (equirectangular; fine for download-size hints). */
export function bboxAreaKm2(b: BBox): number {
  const midLat = (b[1] + b[3]) / 2;
  const w = (b[2] - b[0]) * 111.32 * Math.cos(toRad(midLat));
  const h = (b[3] - b[1]) * 110.574;
  return Math.max(0, w * h);
}

/** Closed polygon approximating a circle. Returns [lon, lat] ring. */
export function circleRing(center: LatLon, radiusM: number, steps = 48): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const p = destination(center, (360 * i) / steps, radiusM);
    ring.push([p.lon, p.lat]);
  }
  ring.push(ring[0] as [number, number]);
  return ring;
}

/** Wedge polygon pointing along `headingDeg`, used for the heading cone. */
export function sectorRing(
  center: LatLon,
  headingDeg: number,
  radiusM: number,
  spreadDeg = 60,
  steps = 12,
): [number, number][] {
  const ring: [number, number][] = [[center.lon, center.lat]];
  for (let i = 0; i <= steps; i++) {
    const b = headingDeg - spreadDeg / 2 + (spreadDeg * i) / steps;
    const p = destination(center, b, radiusM);
    ring.push([p.lon, p.lat]);
  }
  ring.push([center.lon, center.lat]);
  return ring;
}

export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) {
    return '-';
  }
  if (m < 1000) {
    return `${Math.round(m)} m`;
  }
  if (m < 10000) {
    return `${(m / 1000).toFixed(2)} km`;
  }
  return `${(m / 1000).toFixed(1)} km`;
}

export function formatCoord({ lat, lon }: LatLon, dp = 5): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(dp)}° ${ns}, ${Math.abs(lon).toFixed(dp)}° ${ew}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '-';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}
