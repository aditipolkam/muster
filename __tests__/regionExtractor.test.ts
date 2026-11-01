import { BBox } from '../src/domain/geo';
import { parsePmtilesHeader } from '../src/domain/maps/pmtiles';
import {
  countTiles,
  parseDirectory,
  readFullHeader,
  tileRects,
  wantedTileIds,
  zxyToTileId,
} from '../src/domain/maps/pmtilesDir';
import { AreaPlan } from '../src/domain/maps/area';
import { MAX_AREA_TILES } from '../src/features/maps-manager/RegionExtractor';
import { FakeHttp } from '../src/testing/FakeHttp';
import { fakeTile, makePlanet } from '../src/testing/planetFixture';
import { makeTestServices } from '../src/testing/services';

const PLANET = 'http://planet.test/planet.pmtiles';
const CATALOG = 'http://catalog.test/catalog.json';
const BBOX: BBox = [-5.1, 56.74, -4.9, 56.85];

describe('tile ids', () => {
  it('matches the PMTiles reference values', () => {
    expect(zxyToTileId(0, 0, 0)).toBe(0);
    expect(zxyToTileId(1, 0, 0)).toBe(1);
    expect(zxyToTileId(1, 0, 1)).toBe(2);
    expect(zxyToTileId(1, 1, 1)).toBe(3);
    expect(zxyToTileId(1, 1, 0)).toBe(4);
    expect(zxyToTileId(2, 0, 0)).toBe(5);
  });
});

/** Looks a tile up in a finished archive by walking its own directories. */
function readTile(file: Uint8Array, z: number, x: number, y: number): Uint8Array | null {
  const h = readFullHeader(file);
  const id = zxyToTileId(z, x, y);
  const dir = (off: number, len: number) =>
    parseDirectory(file.subarray(off, off + len), h.internalCompression);
  let entries = dir(h.rootDirOffset, h.rootDirLength);
  for (;;) {
    let hit = null;
    for (const e of entries) {
      if (e.tileId <= id) {
        hit = e;
      }
    }
    if (!hit) {
      return null;
    }
    if (hit.runLength === 0) {
      entries = dir(h.leafDirsOffset + hit.offset, hit.length);
      continue;
    }
    if (id >= hit.tileId + hit.runLength) {
      return null;
    }
    return file.subarray(h.tileDataOffset + hit.offset, h.tileDataOffset + hit.offset + hit.length);
  }
}

async function setup(maxZoom = 6, leafSize = 500) {
  const planet = makePlanet(maxZoom, leafSize);
  const http = new FakeHttp();
  http.files.set(PLANET, { bytes: planet });
  http.json.set(CATALOG, {
    catalogVersion: 1,
    generatedAt: 'x',
    planet: { url: PLANET, osmDataDate: '2026-10-29' },
    regions: [],
  });
  const t = await makeTestServices({ http });
  return { t, http, planet };
}

describe('custom area extract', () => {
  it('plans exact sizes without downloading tile data, then writes a valid archive', async () => {
    const { t, http, planet } = await setup();
    const r = await t.packs.planArea(BBOX, 6);
    expect(r.ok).toBe(true);
    const plan = (r as { ok: true; value: AreaPlan }).value;
    // Far smaller than the planet.
    expect(plan.fileBytes).toBeLessThan(planet.length / 3);
    expect(plan.tileCount).toBeGreaterThan(0);
    // Planning only read the header/root/leaf directories, never tile ranges.
    const tileStart = readFullHeader(planet).tileDataOffset;
    const read = http.requests
      .filter(q => q.url === PLANET && q.range)
      .map(q => Number(/bytes=(\d+)-/.exec(q.range!)![1]));
    expect(read.every(o => o < tileStart)).toBe(true);

    const started = await t.packs.startArea(plan, 'Ben Nevis area');
    expect(started.ok).toBe(true);
    const id = (started as { ok: true; value: { id: string } }).value.id;
    await t.packs.whenSettled(id);

    const rec = await t.regions.get(id);
    expect(rec?.state).toBe('installed');
    expect(rec?.source).toBe('custom');
    const file = t.fs.files.get(rec!.filePath!)!;
    expect(file.length).toBe(plan.fileBytes);
    expect(rec!.bytes).toBe(plan.fileBytes);
    expect(parsePmtilesHeader(file).bounds).toEqual(BBOX);

    // Every tile of the area is present and identical to the planet's.
    for (const rect of tileRects(BBOX, 0, 6)) {
      for (let x = rect.x0; x <= rect.x1; x++) {
        for (let y = rect.y0; y <= rect.y1; y++) {
          expect(readTile(file, rect.z, x, y)).toEqual(fakeTile(rect.z, x, y));
        }
      }
    }
    // Tiles outside the area were not copied.
    expect(readTile(file, 6, 0, 0)).toBeNull();
    expect(wantedTileIds(tileRects(BBOX, 0, 6)).length).toBeGreaterThan(0);
  });

  it('uses leaf directories in the output when the area is big enough to need them', async () => {
    const { t } = await setup(8, 50_000);
    const r = await t.packs.planArea([-170, -60, 170, 60], 8);
    const plan = (r as { ok: true; value: AreaPlan }).value;
    const h = readFullHeader(plan.prefix);
    expect(h.leafDirsLength).toBeGreaterThan(0);
    expect(h.rootDirOffset + h.rootDirLength + h.metadataLength).toBeLessThanOrEqual(16384);
  });

  it('rejects areas whose tile count exceeds the cap before reading anything', () => {
    expect(countTiles(tileRects([-180, -85, 180, 85], 0, 12))).toBeGreaterThan(MAX_AREA_TILES);
    expect(countTiles(tileRects(BBOX, 0, 14))).toBeLessThan(MAX_AREA_TILES);
  });

  it('says so when no planet source is configured', async () => {
    const t = await makeTestServices();
    const r = await t.packs.planArea(BBOX, 6);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe('no_planet');
  });

  it('fails clearly when the server ignores range requests, and does not fetch the whole planet', async () => {
    const { t, http, planet } = await setup();
    http.files.set(PLANET, { bytes: planet, ignoreRange: true });
    const r = await t.packs.planArea(BBOX, 6);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe('range_unsupported');
  });

  it('cancel removes the partial file and the record', async () => {
    const { t } = await setup();
    const plan = ((await t.packs.planArea(BBOX, 6)) as { ok: true; value: AreaPlan }).value;
    const started = await t.packs.startArea(plan, 'x');
    const id = (started as { ok: true; value: { id: string } }).value.id;
    await t.packs.cancel(id);
    expect(await t.regions.get(id)).toBeNull();
    expect([...t.fs.files.keys()].some(k => k.includes(id))).toBe(false);
  });

  it('refuses to start when there is not enough free space', async () => {
    const { t } = await setup();
    const plan = ((await t.packs.planArea(BBOX, 6)) as { ok: true; value: AreaPlan }).value;
    t.fs.free = 10;
    const r = await t.packs.startArea(plan, 'x');
    expect(!r.ok && r.error.code).toBe('insufficient_space');
  });
});

describe('devPlanet', () => {
  it('points at a dated Protomaps build from two days ago', () => {
    const { devPlanet } = require('../src/shared/config');
    expect(devPlanet(new Date('2026-11-01T12:00:00Z'))).toEqual({
      url: 'https://build.protomaps.com/20261030.pmtiles',
      osmDataDate: '2026-10-30',
    });
  });
});

describe('planet fallbacks', () => {
  it('tries older builds when the newest cannot be read, and says why when all fail', async () => {
    const planet = makePlanet(6);
    const http = new FakeHttp();
    http.files.set('http://old.test/p.pmtiles', { bytes: planet });
    const t = await makeTestServices({ http });
    const { MapPackManager } = require('../src/features/maps-manager/MapPackManager');
    const packs = new MapPackManager({
      ...(t.packs as unknown as { d: object }).d,
      fallbackPlanets: () => [
        { url: 'http://new.test/missing.pmtiles', osmDataDate: '2026-10-31' },
        { url: 'http://old.test/p.pmtiles', osmDataDate: '2026-10-30' },
      ],
    });
    const ok = await packs.planArea(BBOX, 6);
    expect(ok.ok).toBe(true);
    expect(ok.value.osmDataDate).toBe('2026-10-30');
    const none = new MapPackManager({
      ...(t.packs as unknown as { d: object }).d,
      fallbackPlanets: () => [{ url: 'http://new.test/missing.pmtiles', osmDataDate: 'x' }],
    });
    const bad = await none.planArea(BBOX, 6);
    expect(bad.ok).toBe(false);
    expect(bad.error.userMessage).toMatch(/HTTP 404/);
  });
});

describe('startArea failures', () => {
  it('returns an error instead of throwing, so the UI can show why', async () => {
    const { t } = await setup();
    const plan = ((await t.packs.planArea(BBOX, 6)) as { ok: true; value: AreaPlan }).value;
    (t.packs as unknown as { d: { newId: () => string } }).d.newId = () => {
      throw new Error('Failed to find a reliable PRNG');
    };
    const r = await t.packs.startArea(plan, 'x');
    expect(!r.ok && r.error.code).toBe('start_failed');
    expect(!r.ok && r.error.userMessage).toMatch(/PRNG/);
  });
});
