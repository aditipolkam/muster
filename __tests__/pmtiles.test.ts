import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PmtilesError, parsePmtilesHeader } from '../src/domain/maps/pmtiles';
import { makePmtiles } from '../src/testing/pmtilesFixture';

const reason = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof PmtilesError ? e.reason : 'other';
  }
  return 'none';
};

describe('parsePmtilesHeader', () => {
  it('parses a valid header', () => {
    const h = parsePmtilesHeader(
      makePmtiles({ minZoom: 2, maxZoom: 13, bounds: [-3.45, 54.3, -2.7, 54.75] }),
    );
    expect(h.specVersion).toBe(3);
    expect(h.tileType).toBe('mvt');
    expect([h.minZoom, h.maxZoom]).toEqual([2, 13]);
    expect(h.bounds[0]).toBeCloseTo(-3.45, 6);
    expect(h.bounds[3]).toBeCloseTo(54.75, 6);
  });

  it('parses a real Protomaps extract when one is present locally', () => {
    const f = join(__dirname, '..', 'tools/region-builder/hosted/ben-nevis.pmtiles');
    if (!existsSync(f)) {
      return;
    }
    const h = parsePmtilesHeader(readFileSync(f).subarray(0, 127));
    expect(h.tileType).toBe('mvt');
    expect(h.bounds[0]).toBeCloseTo(-5.1, 5);
    expect(h.maxZoom).toBe(14);
  });

  it.each([
    ['too_short', () => new Uint8Array(50)],
    ['bad_magic', () => makePmtiles({ magic: 'PMTilez' })],
    ['unsupported_version', () => makePmtiles({ version: 2 })],
    ['not_vector', () => makePmtiles({ tileType: 2 })],
    ['bad_zoom', () => makePmtiles({ minZoom: 9, maxZoom: 3 })],
    ['bad_bounds', () => makePmtiles({ bounds: [10, 0, 5, 1] })],
  ])('rejects %s with a specific reason', (expected, make) => {
    expect(reason(() => parsePmtilesHeader(make()))).toBe(expected);
  });

  it('rejects out-of-range bounds', () => {
    expect(reason(() => parsePmtilesHeader(makePmtiles({ bounds: [-200, 0, 5, 1] })))).toBe(
      'bad_bounds',
    );
  });
});
