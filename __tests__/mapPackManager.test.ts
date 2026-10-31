import { RegionEntry } from '../src/domain/maps/catalog';
import { PMTILES_HEADER_BYTES } from '../src/domain/maps/pmtiles';
import { MapPackManager } from '../src/features/maps-manager/MapPackManager';
import { hashOf, makePmtiles } from '../src/testing/pmtilesFixture';
import { ManualClock, makeTestServices, testId } from '../src/testing/services';
import { KvRepo } from '../src/data/repositories/KvRepo';
import { RegionsRepo } from '../src/data/repositories/RegionsRepo';

const URL_A = 'http://maps.test/a.pmtiles';
const bytesA = makePmtiles({ size: 50_000, seed: 1 });

const entryFor = (bytes: Uint8Array, over: Partial<RegionEntry> = {}): RegionEntry => ({
  id: 'region-a',
  name: 'Region A',
  bbox: [-5.1, 56.74, -4.9, 56.85],
  minZoom: 0,
  maxZoom: 14,
  bytes: bytes.length,
  sha256: hashOf(bytes),
  url: URL_A,
  osmDataDate: '2026-10-29',
  schema: 1,
  ...over,
});

async function setup() {
  const t = await makeTestServices();
  t.http.files.set(URL_A, { bytes: bytesA });
  return t;
}

describe('MapPackManager download', () => {
  it('downloads, verifies sha256 and installs atomically', async () => {
    const t = await setup();
    const e = entryFor(bytesA);
    expect((await t.packs.start(e)).ok).toBe(true);
    await t.packs.whenSettled(e.id);
    const rec = await t.regions.get(e.id);
    expect(rec).toMatchObject({
      state: 'installed',
      progressBytes: bytesA.length,
      errorCode: null,
    });
    expect(await t.fs.size(rec!.filePath!)).toBe(bytesA.length);
    expect(await t.fs.exists(t.packs.partUri(e.id))).toBe(false); // .part renamed away
    expect(t.fs.files.get(rec!.filePath!)).toEqual(bytesA);
    expect(t.http.requests.map(r => r.range)).toEqual([null]);
  });

  it('reports progress up to the full size', async () => {
    const t = await setup();
    const e = entryFor(bytesA);
    await t.packs.start(e);
    await t.packs.whenSettled(e.id);
    const dl = (t.progress as { phase: string; receivedBytes: number }[]).filter(
      p => p.phase === 'downloading',
    );
    expect(dl[dl.length - 1]!.receivedBytes).toBe(bytesA.length);
    expect((t.progress as { phase: string }[]).some(p => p.phase === 'verifying')).toBe(true);
  });

  it('pauses mid-download and resumes with an HTTP Range request (no re-download)', async () => {
    const t = await setup();
    const e = entryFor(bytesA);
    t.http.stallNextAfter = 20_000;
    await t.packs.start(e);
    await new Promise(r => setTimeout(r, 20));
    await t.packs.pause(e.id);
    const paused = await t.regions.get(e.id);
    expect(paused!.state).toBe('paused');
    const have = await t.fs.size(t.packs.partUri(e.id));
    expect(have).toBeGreaterThan(0);
    expect(have).toBeLessThan(bytesA.length);

    await t.packs.resumeById(e.id);
    await t.packs.whenSettled(e.id);
    expect((await t.regions.get(e.id))!.state).toBe('installed');
    expect(t.http.requests[1]!.range).toBe(`bytes=${have}-`);
    expect(t.fs.files.get(t.packs.finalUri(e.id))).toEqual(bytesA);
  });

  it('resumes after the app is killed (new manager instance, same files and database)', async () => {
    const t = await setup();
    const e = entryFor(bytesA);
    t.http.stallNextAfter = 30_000;
    await t.packs.start(e);
    await new Promise(r => setTimeout(r, 20));
    const have = await t.fs.size(t.packs.partUri(e.id));
    expect(have).toBeGreaterThan(0);
    // "kill": abandon the old manager without pausing; DB still says downloading.
    expect((await t.regions.get(e.id))!.state).toBe('downloading');

    const packs2 = new MapPackManager({
      fs: t.fs,
      http: t.http,
      regions: new RegionsRepo(t.db),
      kv: new KvRepo(t.db),
      clock: new ManualClock(),
      bundledCatalog: { catalogVersion: 1, generatedAt: 'x', regions: [] },
      newId: testId,
      catalogUrl: () => 'x',
    });
    await packs2.init();
    const after = await t.regions.get(e.id);
    expect(after).toMatchObject({ state: 'paused', errorCode: 'interrupted' });
    await packs2.resumeById(e.id);
    await packs2.whenSettled(e.id);
    expect((await t.regions.get(e.id))!.state).toBe('installed');
    expect(t.http.requests[t.http.requests.length - 1]!.range).toMatch(/^bytes=\d+-$/);
    expect(t.fs.files.get(packs2.finalUri(e.id))).toEqual(bytesA);
  });

  it('keeps partial data after network loss and resumes to a correct file', async () => {
    const t = await setup();
    const e = entryFor(bytesA);
    t.http.failNextAfter = 15_000;
    await t.packs.start(e);
    await t.packs.whenSettled(e.id);
    const failed = await t.regions.get(e.id);
    expect(failed).toMatchObject({ state: 'failed', errorCode: 'network' });
    expect(failed!.progressBytes).toBeGreaterThan(0);

    await t.packs.resumeById(e.id);
    await t.packs.whenSettled(e.id);
    expect((await t.regions.get(e.id))!.state).toBe('installed');
    expect(t.fs.files.get(t.packs.finalUri(e.id))).toEqual(bytesA);
  });

  it('restarts from zero when the server ignores Range', async () => {
    const t = await setup();
    t.http.files.set(URL_A, { bytes: bytesA, ignoreRange: true });
    const e = entryFor(bytesA);
    t.http.failNextAfter = 10_000;
    await t.packs.start(e);
    await t.packs.whenSettled(e.id);
    await t.packs.resumeById(e.id);
    await t.packs.whenSettled(e.id);
    expect((await t.regions.get(e.id))!.state).toBe('installed');
    expect(t.fs.files.get(t.packs.finalUri(e.id))).toEqual(bytesA);
  });

  it('rejects a corrupt file (bad sha256), removes it, and does not install', async () => {
    const t = await setup();
    const corrupt = bytesA.slice();
    corrupt[5000] = (corrupt[5000] ?? 0) ^ 0xff;
    t.http.files.set(URL_A, { bytes: corrupt });
    const e = entryFor(bytesA); // advertises the genuine hash
    await t.packs.start(e);
    await t.packs.whenSettled(e.id);
    expect(await t.regions.get(e.id)).toMatchObject({
      state: 'failed',
      errorCode: 'checksum_mismatch',
      progressBytes: 0,
    });
    expect(await t.fs.exists(t.packs.partUri(e.id))).toBe(false);
    expect(await t.fs.exists(t.packs.finalUri(e.id))).toBe(false);
  });

  it('rejects a file with a valid hash but invalid PMTiles content', async () => {
    const t = await setup();
    const junk = new Uint8Array(5000).fill(7);
    t.http.files.set(URL_A, { bytes: junk });
    const e = entryFor(junk);
    await t.packs.start(e);
    await t.packs.whenSettled(e.id);
    expect(await t.regions.get(e.id)).toMatchObject({
      state: 'failed',
      errorCode: 'invalid_pmtiles',
    });
    expect(await t.fs.exists(t.packs.finalUri(e.id))).toBe(false);
  });

  it('refuses to start without enough free space (needs 1.2x) and makes no request', async () => {
    const t = await setup();
    const e = entryFor(bytesA);
    t.fs.free = Math.floor(bytesA.length * 1.2) - 1;
    await t.packs.start(e);
    await t.packs.whenSettled(e.id);
    expect(await t.regions.get(e.id)).toMatchObject({
      state: 'failed',
      errorCode: 'insufficient_space',
    });
    expect(t.http.requests).toHaveLength(0);
    // freeing space makes it retryable
    t.fs.free = bytesA.length * 2;
    await t.packs.resumeById(e.id);
    await t.packs.whenSettled(e.id);
    expect((await t.regions.get(e.id))!.state).toBe('installed');
  });

  it('only counts the remaining bytes when resuming', async () => {
    const t = await setup();
    const e = entryFor(bytesA);
    t.http.failNextAfter = 40_000;
    await t.packs.start(e);
    await t.packs.whenSettled(e.id);
    const have = await t.fs.size(t.packs.partUri(e.id));
    t.fs.free = Math.ceil((bytesA.length - have) * 1.2); // enough for the remainder only
    await t.packs.resumeById(e.id);
    await t.packs.whenSettled(e.id);
    expect((await t.regions.get(e.id))!.state).toBe('installed');
  });

  it('records HTTP errors as failed with a retryable code', async () => {
    const t = await setup();
    const e = entryFor(bytesA, { url: 'http://maps.test/missing.pmtiles' });
    await t.packs.start(e);
    await t.packs.whenSettled(e.id);
    expect(await t.regions.get(e.id)).toMatchObject({ state: 'failed', errorCode: 'http_404' });
  });

  it('fails when the server sends more bytes than the catalog promised', async () => {
    const t = await setup();
    const e = entryFor(bytesA, { bytes: bytesA.length - 1000 });
    await t.packs.start(e);
    await t.packs.whenSettled(e.id);
    expect((await t.regions.get(e.id))!.state).toBe('failed');
    expect(await t.fs.exists(t.packs.finalUri(e.id))).toBe(false);
  });

  it('surfaces a disk-write failure without installing', async () => {
    const t = await setup();
    t.fs.failWritesAfter = 10_000;
    const e = entryFor(bytesA);
    await t.packs.start(e);
    await t.packs.whenSettled(e.id);
    expect(await t.regions.get(e.id)).toMatchObject({ state: 'failed', errorCode: 'disk_error' });
  });

  it('cancel discards partial data and the record', async () => {
    const t = await setup();
    const e = entryFor(bytesA);
    t.http.stallNextAfter = 20_000;
    await t.packs.start(e);
    await new Promise(r => setTimeout(r, 20));
    await t.packs.cancel(e.id);
    expect(await t.regions.get(e.id)).toBeNull();
    expect(await t.fs.exists(t.packs.partUri(e.id))).toBe(false);
  });

  it('start is idempotent while a job is active', async () => {
    const t = await setup();
    const e = entryFor(bytesA);
    await Promise.all([t.packs.start(e), t.packs.start(e), t.packs.start(e)]);
    await t.packs.whenSettled(e.id);
    expect(t.http.requests).toHaveLength(1);
  });
});

describe('MapPackManager import / delete / storage / catalog', () => {
  it('imports a valid .pmtiles and records its bounds', async () => {
    const t = await setup();
    const file = makePmtiles({ size: 3000, bounds: [-3.45, 54.3, -2.7, 54.75], maxZoom: 13 });
    await t.fs.writeBytes('file:///cache/Lake.pmtiles', file);
    const r = await t.packs.importFile('file:///cache/Lake.pmtiles', 'Lake.pmtiles');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({
        name: 'Lake',
        state: 'installed',
        source: 'import',
        maxZoom: 13,
      });
      expect(r.value.bbox[0]).toBeCloseTo(-3.45, 6);
      expect(await t.fs.exists('file:///cache/Lake.pmtiles')).toBe(false);
      expect(await t.fs.size(r.value.filePath!)).toBe(3000);
    }
  });

  it.each([
    ['not a pmtiles file', new Uint8Array(500).fill(1), /signature|PMTiles/i],
    ['too small', new Uint8Array(20), /too small/i],
    ['raster tiles', makePmtiles({ tileType: 2 }), /vector/i],
    ['wrong version', makePmtiles({ version: 2 }), /version 3/i],
  ])('rejects an invalid import (%s) with a specific reason', async (_n, bytes, msg) => {
    const t = await setup();
    await t.fs.writeBytes('file:///cache/x.pmtiles', bytes);
    const r = await t.packs.importFile('file:///cache/x.pmtiles', 'x.pmtiles');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.userMessage).toMatch(msg);
    }
    expect(await t.regions.list()).toHaveLength(0);
  });

  it('refuses an import that does not fit', async () => {
    const t = await setup();
    await t.fs.writeBytes('file:///cache/big.pmtiles', makePmtiles({ size: 5000 }));
    t.fs.free = 1000;
    const r = await t.packs.importFile('file:///cache/big.pmtiles', 'big.pmtiles');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('insufficient_space');
    }
  });

  it('deletes files and rows, and reports storage usage', async () => {
    const t = await setup();
    const e = entryFor(bytesA);
    await t.packs.start(e);
    await t.packs.whenSettled(e.id);
    await t.fs.writeBytes(`${t.packs.styleDir}fonts/f/0-255.pbf`, new Uint8Array(1000));
    await t.fs.writeBytes(t.packs.partUri('other'), new Uint8Array(300));
    const u = await t.packs.storageUsage();
    expect(u).toMatchObject({ regionsBytes: bytesA.length, partialBytes: 300, styleBytes: 1000 });
    await t.packs.delete(e.id);
    expect(await t.regions.get(e.id)).toBeNull();
    expect(await t.fs.exists(t.packs.finalUri(e.id))).toBe(false);
    expect((await t.packs.storageUsage()).regionsBytes).toBe(0);
  });

  it('marks installed regions whose file vanished as failed on init', async () => {
    const t = await setup();
    const e = entryFor(bytesA);
    await t.packs.start(e);
    await t.packs.whenSettled(e.id);
    await t.fs.remove(t.packs.finalUri(e.id));
    await t.packs.init();
    expect(await t.regions.get(e.id)).toMatchObject({ state: 'failed', errorCode: 'file_missing' });
  });

  it('adopts valid untracked archives on init and ignores invalid or partial ones', async () => {
    const t = await setup();
    const good = makePmtiles({ size: 3000, bounds: [-3.45, 54.3, -2.7, 54.75], maxZoom: 15 });
    await t.fs.writeBytes(t.packs.finalUri('lake-district'), good);
    await t.fs.writeBytes(t.packs.finalUri('junk'), new Uint8Array(500).fill(1));
    await t.fs.writeBytes(t.packs.partUri('half'), good); // .part is never adopted
    await t.packs.init();
    const ids = (await t.regions.list()).map(r => r.id);
    expect(ids).toEqual(['lake-district']);
    expect(await t.regions.get('lake-district')).toMatchObject({
      state: 'installed',
      maxZoom: 15,
      source: 'import',
    });
    await t.packs.init(); // idempotent
    expect(await t.regions.list()).toHaveLength(1);
  });

  it('catalog: remote -> cache -> bundled fallback chain', async () => {
    const bundled = {
      catalogVersion: 1,
      generatedAt: 'b',
      regions: [entryFor(bytesA, { id: 'bundled' })],
    };
    const t = await makeTestServices({ catalog: bundled });
    const remote = {
      catalogVersion: 1,
      generatedAt: 'r',
      regions: [entryFor(bytesA, { id: 'remote' })],
    };

    expect((await t.packs.loadCatalog({ refresh: true })).source).toBe('bundled'); // nothing yet, offline
    t.http.json.set('http://catalog.test/catalog.json', remote);
    const r = await t.packs.loadCatalog({ refresh: true });
    expect(r.source).toBe('remote');
    expect(r.catalog.regions[0]!.id).toBe('remote');

    t.http.offline = true;
    const c = await t.packs.loadCatalog({ refresh: true });
    expect(c.source).toBe('cache');
    expect(c.catalog.regions[0]!.id).toBe('remote');
  });

  it('catalog: ignores a malformed remote catalog', async () => {
    const t = await makeTestServices();
    t.http.json.set('http://catalog.test/catalog.json', { catalogVersion: 99 });
    expect((await t.packs.loadCatalog({ refresh: true })).source).toBe('bundled');
  });

  it('header constant matches the PMTiles v3 header size', () => {
    expect(PMTILES_HEADER_BYTES).toBe(127);
  });
});
