import {
  nextRegionState,
  hasEnoughSpace,
  requiredFreeBytes,
  RegionState,
  RegionEvent,
} from '../src/domain/maps/region';
import {
  covers,
  coveringRegions,
  needsRegionBanner,
  selectActiveRegions,
} from '../src/domain/maps/coverage';
import { CatalogSchema, parseCatalog } from '../src/domain/maps/catalog';

describe('region state machine', () => {
  const step = (s: RegionState, ...events: RegionEvent['type'][]) =>
    events.reduce<RegionState>((st, type) => nextRegionState(st, { type } as RegionEvent), s);

  it('happy path', () => {
    expect(step('available', 'start', 'downloaded', 'verified')).toBe('installed');
  });
  it('pause and resume', () => {
    expect(step('available', 'start', 'pause')).toBe('paused');
    expect(step('paused', 'resume')).toBe('downloading');
  });
  it('failure and retry', () => {
    expect(step('downloading', 'fail')).toBe('failed');
    expect(step('failed', 'retry')).toBe('downloading');
    expect(step('verifying', 'fail')).toBe('failed');
  });
  it('interrupted downloads become paused (resumable)', () => {
    expect(step('downloading', 'interrupted')).toBe('paused');
  });
  it('ignores invalid transitions', () => {
    expect(step('available', 'verified')).toBe('available');
    expect(step('installed', 'start')).toBe('installed');
    expect(step('verifying', 'pause')).toBe('verifying');
  });
});

describe('space guard', () => {
  it('requires 1.2x the remaining bytes', () => {
    expect(requiredFreeBytes(100)).toBe(120);
    expect(hasEnoughSpace(119, 100)).toBe(false);
    expect(hasEnoughSpace(120, 100)).toBe(true);
  });
});

describe('coverage', () => {
  const regions = [
    { id: 'a', bbox: [0, 0, 2, 2] as [number, number, number, number], minZoom: 0, maxZoom: 14 },
    {
      id: 'b',
      bbox: [10, 10, 12, 12] as [number, number, number, number],
      minZoom: 0,
      maxZoom: 14,
    },
    {
      id: 'c',
      bbox: [50, 50, 52, 52] as [number, number, number, number],
      minZoom: 0,
      maxZoom: 14,
    },
    {
      id: 'd',
      bbox: [20, 20, 22, 22] as [number, number, number, number],
      minZoom: 0,
      maxZoom: 14,
    },
  ];
  it('answers point coverage locally', () => {
    expect(covers(regions, { lat: 1, lon: 1 })).toBe(true);
    expect(covers(regions, { lat: 5, lon: 5 })).toBe(false);
    expect(coveringRegions(regions, { lat: 11, lon: 11 }).map(r => r.id)).toEqual(['b']);
  });
  it('banner only when zoomed in past the world base and outside every region', () => {
    expect(needsRegionBanner(regions, { lat: 5, lon: 5 }, 3)).toBe(false);
    expect(needsRegionBanner(regions, { lat: 5, lon: 5 }, 8)).toBe(true);
    expect(needsRegionBanner(regions, { lat: 1, lon: 1 }, 8)).toBe(false);
    expect(needsRegionBanner([], { lat: 1, lon: 1 }, 8)).toBe(true);
  });
  it('selects the nearest regions up to the cap, covering region first', () => {
    const picked = selectActiveRegions(regions, { lat: 1, lon: 1 }, 3).map(r => r.id);
    expect(picked).toHaveLength(3);
    expect(picked[0]).toBe('a');
    expect(picked).not.toContain('c');
  });
});

describe('catalog schema', () => {
  const entry = {
    id: 'lake-district',
    name: 'Lake District',
    bbox: [-3.45, 54.3, -2.7, 54.75],
    minZoom: 0,
    maxZoom: 15,
    bytes: 100,
    sha256: 'a'.repeat(64),
    url: 'https://example.com/x.pmtiles',
    osmDataDate: '2026-10-29',
    schema: 1,
  };
  const cat = (e: unknown) => ({ catalogVersion: 1, generatedAt: 'now', regions: [e] });
  it('accepts the bundled catalog', () => {
    const bundled = require('../src/assets/catalog.json');
    expect(parseCatalog(bundled).regions.length).toBeGreaterThan(0);
  });
  it('rejects malformed entries', () => {
    expect(CatalogSchema.safeParse(cat(entry)).success).toBe(true);
    expect(CatalogSchema.safeParse(cat({ ...entry, sha256: 'xyz' })).success).toBe(false);
    expect(CatalogSchema.safeParse(cat({ ...entry, bbox: [5, 5, 1, 1] })).success).toBe(false);
    expect(CatalogSchema.safeParse(cat({ ...entry, id: '../etc' })).success).toBe(false);
    expect(CatalogSchema.safeParse(cat({ ...entry, bytes: 0 })).success).toBe(false);
    expect(CatalogSchema.safeParse({ ...cat(entry), catalogVersion: 2 }).success).toBe(false);
  });
});
