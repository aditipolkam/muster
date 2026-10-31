import { z } from 'zod';
import { isValidLatLon } from '../geo';

export const MARKER_NAME_MAX = 80;
export const MARKER_NOTE_MAX = 500;

export const MarkerInputSchema = z.object({
  name: z.string().trim().min(1).max(MARKER_NAME_MAX),
  note: z.string().max(MARKER_NOTE_MAX).nullable().optional(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export type MarkerInput = z.infer<typeof MarkerInputSchema>;

export type Marker = {
  id: string;
  name: string;
  note: string | null;
  lat: number;
  lon: number;
  createdAt: number;
  updatedAt: number;
};

export function defaultMarkerName(existing: Marker[]): string {
  let n = existing.length + 1;
  const names = new Set(existing.map(m => m.name));
  while (names.has(`Marker ${n}`)) {
    n++;
  }
  return `Marker ${n}`;
}

export function isValidMarkerPosition(lat: number, lon: number): boolean {
  return isValidLatLon(lat, lon);
}
