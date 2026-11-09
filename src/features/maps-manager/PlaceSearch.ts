import { z } from 'zod';
import { NominatimHitSchema, PlaceResult, placeFromHit } from '../../domain/maps/places';
import { AppError, Result, appError, err, ok } from '../../shared/result';
import { HttpClient } from './http';

/**
 * Online place search for choosing a region to download. Runs only when the user submits a search.
 * Uses the public Nominatim service for development and testing: its policy allows light,
 * submit-only use with an identifying User-Agent and at most one request per second. Swap the
 * base URL for your own geocoder before shipping.
 */
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
export const MIN_QUERY_LENGTH = 3;
const MIN_INTERVAL_MS = 1100;

export class PlaceSearch {
  private last = 0;

  constructor(
    private readonly http: HttpClient,
    private readonly now: () => number = Date.now,
    private readonly baseUrl: string = NOMINATIM_URL,
  ) {}

  async search(query: string, signal?: AbortSignal): Promise<Result<PlaceResult[]>> {
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      return ok([]);
    }
    const wait = this.last + MIN_INTERVAL_MS - this.now();
    if (wait > 0) {
      await new Promise<void>(r => setTimeout(r, wait));
    }
    this.last = this.now();
    try {
      const json = await this.http.getJson(
        `${this.baseUrl}/search?format=jsonv2&limit=8&q=${encodeURIComponent(q)}`,
        {
          signal,
          headers: { 'User-Agent': 'Muster-dev/0.1 (offline hiking app, development build)' },
        },
      );
      const hits = z.array(z.unknown()).parse(json);
      const places = hits.flatMap(h => {
        const p = NominatimHitSchema.safeParse(h);
        return p.success ? [placeFromHit(p.data)] : [];
      });
      return ok(places);
    } catch (e) {
      return err(failure(e, signal));
    }
  }
}

function failure(e: unknown, signal?: AbortSignal): AppError {
  if (signal?.aborted) {
    return appError('cancelled', 'Cancelled.');
  }
  return appError('search_failed', 'Search needs an internet connection. Check it and try again.', {
    retryable: true,
    message: String(e),
  });
}
