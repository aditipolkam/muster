import { z } from 'zod';
import { BBox } from '../geo';

export type PlaceResult = {
  id: string;
  name: string;
  /** Region / country line shown under the name. */
  detail: string;
  lat: number;
  lon: number;
  /** The area to download for this place. */
  bbox: BBox;
};

const num = z.coerce.number().finite();

/** One Nominatim `jsonv2` search hit. `boundingbox` is [south, north, west, east] as strings. */
export const NominatimHitSchema = z.object({
  place_id: z.union([z.number(), z.string()]),
  display_name: z.string(),
  name: z.string().optional(),
  lat: num,
  lon: num,
  boundingbox: z.tuple([num, num, num, num]),
});

/** A hit for a peak or a village is a point; give it a sensible walking-area box around it. */
export const MIN_SPAN_DEG = 0.1;

export function placeFromHit(hit: z.infer<typeof NominatimHitSchema>): PlaceResult {
  const [s, n, w, e] = hit.boundingbox;
  const grow = (lo: number, hi: number, mid: number): [number, number] => {
    const span = hi - lo;
    return span >= MIN_SPAN_DEG ? [lo, hi] : [mid - MIN_SPAN_DEG / 2, mid + MIN_SPAN_DEG / 2];
  };
  const [lon0, lon1] = grow(w, e, hit.lon);
  const [lat0, lat1] = grow(s, n, hit.lat);
  const parts = hit.display_name.split(',').map(p => p.trim());
  return {
    id: String(hit.place_id),
    name: hit.name || parts[0] || hit.display_name,
    detail: parts.slice(1).join(', '),
    lat: hit.lat,
    lon: hit.lon,
    bbox: [Math.max(-180, lon0), Math.max(-85, lat0), Math.min(180, lon1), Math.min(85, lat1)],
  };
}
