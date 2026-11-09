/**
 * Offline routing on real downloaded regions (tools/region-builder/out, not in git).
 * Runs only with ROUTING_REAL=1 and the files present:
 *   ROUTING_REAL=1 npx jest __tests__/routingRealRegion.test.ts
 * Prints distance, timings and graph size per route; asserts only that a route is found.
 * For the peak memory of one route build, run node with --expose-gc:
 *   ROUTING_REAL=1 node --expose-gc node_modules/.bin/jest __tests__/routingRealRegion.test.ts
 */
import fs from 'fs';
import path from 'path';
import { distanceM } from '../src/domain/geo';
import { planRoute } from '../src/domain/routing/router';
import { PmtilesTileSource } from '../src/domain/routing/tileSource';

const OUT = path.join(__dirname, '..', 'tools', 'region-builder', 'out');
const on =
  process.env.ROUTING_REAL === '1' && fs.existsSync(path.join(OUT, 'lake-district.pmtiles'));
const maybe = on ? describe : describe.skip;

const open = (file: string) => {
  const fd = fs.openSync(path.join(OUT, file), 'r');
  return PmtilesTileSource.open(async (offset, length) => {
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, offset);
    return new Uint8Array(buf.buffer, buf.byteOffset, n);
  });
};

const CASES: { file: string; name: string; from: [number, number]; to: [number, number] }[] = [
  {
    file: 'lake-district.pmtiles',
    name: 'Grasmere village to Easedale Tarn',
    from: [54.4586, -3.0244],
    to: [54.4605, -3.0575],
  },
  {
    file: 'lake-district.pmtiles',
    name: 'Ambleside to Grasmere',
    from: [54.4326, -2.9618],
    to: [54.4586, -3.0244],
  },
  {
    file: 'lake-district.pmtiles',
    name: 'Seathwaite to Scafell Pike summit',
    from: [54.4997, -3.1823],
    to: [54.4542, -3.2116],
  },
  {
    file: 'lake-district.pmtiles',
    name: 'Old Dungeon Ghyll to Scafell Pike summit',
    from: [54.4456, -3.1013],
    to: [54.4542, -3.2116],
  },
  {
    file: 'lake-district.pmtiles',
    name: 'Keswick to Buttermere',
    from: [54.6013, -3.1347],
    to: [54.5414, -3.2766],
  },
  {
    file: 'ben-nevis.pmtiles',
    name: 'Glen Nevis visitor centre to Ben Nevis summit',
    from: [56.8077, -5.0889],
    to: [56.7969, -5.0036],
  },
];

maybe('offline routing on real regions', () => {
  jest.setTimeout(120_000);
  for (const c of CASES) {
    it(c.name, async () => {
      const src = await open(c.file);
      const from = { lat: c.from[0], lon: c.from[1] };
      const to = { lat: c.to[0], lon: c.to[1] };
      const gc = (global as { gc?: () => void }).gc;
      gc?.();
      const heapBefore = process.memoryUsage().heapUsed;
      const r = await planRoute(src, from, to);
      gc?.();
      const heapAfter = process.memoryUsage().heapUsed;
      const straight = distanceM(from, to);
      console.log(
        JSON.stringify({
          route: c.name,
          ok: r.ok,
          reason: r.ok ? undefined : r.reason,
          straightKm: +(straight / 1000).toFixed(2),
          routeKm: r.ok ? +(r.distanceM / 1000).toFixed(2) : null,
          ratio: r.ok ? +(r.distanceM / straight).toFixed(2) : null,
          snapM: r.ok ? r.snapM : null,
          vertices: r.ok ? r.coords.length : null,
          stats: r.stats,
          heapDeltaMB: +((heapAfter - heapBefore) / 1e6).toFixed(1),
        }),
      );
      if (r.ok && process.env.ROUTING_DUMP) {
        fs.writeFileSync(
          path.join(process.env.ROUTING_DUMP, `${c.name.replace(/\W+/g, '-')}.json`),
          JSON.stringify(r.coords),
        );
      }
      expect(r.ok).toBe(true);
    });
  }
});
