import type { LatLon } from '../geo';

export type Projected = { x: number; y: number };

/**
 * Fit points into a `w` x `h` box (with `pad`) without distorting them: an equirectangular
 * projection scaled by cos(latitude), the same shape a flat map shows at this size. One point, or
 * points on one spot, land in the middle of the box.
 */
export function projectToBox(points: LatLon[], w: number, h: number, pad = 12): Projected[] {
  if (points.length === 0) {
    return [];
  }
  const midLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const k = Math.cos((midLat * Math.PI) / 180);
  const xs = points.map(p => p.lon * k);
  const ys = points.map(p => p.lat);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const iw = Math.max(1, w - 2 * pad);
  const ih = Math.max(1, h - 2 * pad);
  const scale =
    spanX === 0 && spanY === 0 ? 0 : Math.min(iw / (spanX || 1e-12), ih / (spanY || 1e-12));
  const ox = pad + (iw - spanX * scale) / 2;
  const oy = pad + (ih - spanY * scale) / 2;
  return points.map((_, i) => ({
    x: ox + ((xs[i] as number) - minX) * scale,
    // Screen y grows downwards while latitude grows upwards.
    y: oy + (maxY - (ys[i] as number)) * scale,
  }));
}

/** [minLon, minLat, maxLon, maxLat] of the points, or null when there are none. */
export function boundsOf(points: LatLon[]): [number, number, number, number] | null {
  if (points.length === 0) {
    return null;
  }
  return [
    Math.min(...points.map(p => p.lon)),
    Math.min(...points.map(p => p.lat)),
    Math.max(...points.map(p => p.lon)),
    Math.max(...points.map(p => p.lat)),
  ];
}
