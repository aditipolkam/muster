import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { buildStyle, PmtilesFileStrategy } from '../src/features/map/StyleBuilder';
import { ensureStyleAssets, StyleAssetBundle } from '../src/features/map/styleAssets';
import {
  accuracyCircle,
  headingCone,
  markersCollection,
  mePuck,
} from '../src/features/map/overlays';
import { KvRepo } from '../src/data/repositories/KvRepo';
import { runMigrations } from '../src/data/migrations';
import { openNodeSqlite } from '../src/testing/nodeSqlite';
import { MemoryFs } from '../src/testing/MemoryFs';
import { base64ToBytes } from '../src/shared/base64';
import { OSM_ATTRIBUTION } from '../src/shared/attribution';
import { sha256File, sha256Bytes } from '../src/features/maps-manager/hash';
import { createHash } from 'node:crypto';

const ROOT = 'file:///docs/style/';
const input = (n: number) => ({
  styleRoot: ROOT,
  worldBaseUri: `${ROOT}world-base.pmtiles`,
  regions: Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    uri: `file:///docs/maps/r${i}.pmtiles`,
  })),
});

describe('StyleBuilder', () => {
  it('produces a style that passes the MapLibre style-spec validator', () => {
    for (const n of [0, 1, 3]) {
      expect(validateStyleMin(buildStyle(input(n)) as never)).toEqual([]);
    }
  });

  it('has one vector source for the world base plus one per region, with unique layer ids', () => {
    const style = buildStyle(input(3));
    expect(Object.keys(style.sources)).toEqual(['src-world', 'src-r0', 'src-r1', 'src-r2']);
    const ids = style.layers.map(l => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    const per = (prefix: string) => ids.filter(i => i.startsWith(`${prefix}:`)).length;
    expect(per('world')).toBeGreaterThan(50);
    expect(per('r0')).toBe(per('r1'));
    expect(per('r1')).toBe(per('r2'));
    expect(style.layers.filter(l => l.type === 'background')).toHaveLength(1);
  });

  it('snapshot of structure (source/layer counts and ordering)', () => {
    const style = buildStyle(input(2));
    const summary = {
      sources: Object.entries(style.sources).map(([k, v]) => [k, (v as { type: string }).type]),
      layerCount: style.layers.length,
      first: style.layers[0]!.id,
      firstWorld: style.layers[1]!.id,
      lastRegionPrefix: style.layers[style.layers.length - 1]!.id.split(':')[0],
    };
    expect(summary.sources).toEqual([
      ['src-world', 'vector'],
      ['src-r0', 'vector'],
      ['src-r1', 'vector'],
    ]);
    expect(summary.first).toBe('background');
    expect(summary.firstWorld.startsWith('world:')).toBe(true);
    expect(summary.lastRegionPrefix).toBe('r1');
    expect(summary.layerCount).toBeGreaterThan(150);
  });

  it('draws world layers first, then regions, and limits their zoom ranges', () => {
    const style = buildStyle(input(1));
    const idx = (p: string) => style.layers.map(l => l.id.split(':')[0]).lastIndexOf(p);
    expect(idx('world')).toBeLessThan(style.layers.findIndex(l => l.id.startsWith('r0:')));
    for (const l of style.layers.filter(x => x.id.startsWith('world:'))) {
      expect((l as { maxzoom?: number }).maxzoom).toBeLessThanOrEqual(6);
    }
    for (const l of style.layers.filter(x => x.id.startsWith('r0:'))) {
      expect((l as { minzoom?: number }).minzoom).toBeGreaterThanOrEqual(4);
    }
  });

  it('references only local files: no http(s) URL anywhere in the style (offline guarantee)', () => {
    const json = JSON.stringify(buildStyle(input(2)));
    expect(json).not.toMatch(/https?:\/\/(?!www\.openstreetmap\.org\/copyright)/);
    const style = buildStyle(input(2));
    expect(style.glyphs).toBe(`${ROOT}fonts/{fontstack}/{range}.pbf`);
    expect(style.sprite).toBe(`${ROOT}sprites/light/sprite`);
    for (const s of Object.values(style.sources)) {
      expect((s as { url: string }).url).toMatch(/^pmtiles:\/\/file:\/\//);
    }
  });

  it('carries OpenStreetMap attribution on every source', () => {
    const style = buildStyle(input(2));
    for (const s of Object.values(style.sources)) {
      expect((s as { attribution?: string }).attribution).toContain(OSM_ATTRIBUTION);
    }
  });

  it('TileSourceStrategy isolates how tiles reach MapLibre', () => {
    const custom = { sourceUrl: (u: string) => `http://127.0.0.1:1/${encodeURIComponent(u)}` };
    const s = buildStyle(input(1), custom);
    expect((s.sources['src-r0'] as { url: string }).url.startsWith('http://127.0.0.1:1/')).toBe(
      true,
    );
    expect(PmtilesFileStrategy.sourceUrl('file:///x.pmtiles')).toBe('pmtiles://file:///x.pmtiles');
  });

  it('every glyph font the style uses is among those the generator bundles', () => {
    const { STYLE_FONTS, STYLE_ASSETS } = require('../src/assets/generated/styleAssets');
    const used = new Set<string>();
    const walk = (v: unknown) =>
      Array.isArray(v)
        ? v.forEach(walk)
        : typeof v === 'string' && v.startsWith('Noto') && used.add(v);
    for (const l of buildStyle(input(1)).layers) {
      walk((l as { layout?: Record<string, unknown> }).layout?.['text-font']);
    }
    for (const f of used) {
      expect(STYLE_FONTS).toContain(f);
      expect(STYLE_ASSETS[`fonts/${f}/0-255.pbf`]).toBeTruthy();
    }
    expect(STYLE_FONTS).toContain('Noto Sans Regular'); // overlay labels
    expect(STYLE_ASSETS['sprites/light/sprite.json']).toBeTruthy();
    expect(STYLE_ASSETS['sprites/light/sprite@2x.png']).toBeTruthy();
  });
});

describe('style assets bootstrap', () => {
  const bundle = (version = 'v1', world = 'w1'): StyleAssetBundle => ({
    version,
    files: { 'fonts/Noto Sans Regular/0-255.pbf': 'AAEC', 'sprites/light/sprite.json': 'e30=' },
    worldVersion: world,
    worldBase64: () => 'AwQF',
  });
  const setup = async () => {
    const db = openNodeSqlite();
    await runMigrations(db);
    return { fs: new MemoryFs(), kv: new KvRepo(db) };
  };

  it('copies assets to documents/style on first launch', async () => {
    const { fs, kv } = await setup();
    const r = await ensureStyleAssets(fs, kv, () => bundle());
    expect(r.styleRoot).toBe('file:///docs/style/');
    expect([...fs.files.get('file:///docs/style/fonts/Noto Sans Regular/0-255.pbf')!]).toEqual([
      0, 1, 2,
    ]);
    expect([...fs.files.get(r.worldBaseUri)!]).toEqual([3, 4, 5]);
  });

  it('does not rewrite on later launches, but repairs missing files and honours version bumps', async () => {
    const { fs, kv } = await setup();
    await ensureStyleAssets(fs, kv, () => bundle());
    const spy = jest.spyOn(fs, 'writeBytes');
    await ensureStyleAssets(fs, kv, () => bundle());
    expect(spy).not.toHaveBeenCalled();
    await fs.remove('file:///docs/style/world-base.pmtiles');
    await ensureStyleAssets(fs, kv, () => bundle());
    expect(spy).toHaveBeenCalledTimes(1); // only the world base
    spy.mockClear();
    await ensureStyleAssets(fs, kv, () => bundle('v2'));
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('overlays', () => {
  const fix = { lat: 54.5, lon: -3.1, accM: 12, fixAt: 1 };
  it('are empty without a fix and never depend on tiles', () => {
    expect(accuracyCircle(null).features).toHaveLength(0);
    expect(mePuck(null, false).features).toHaveLength(0);
    expect(headingCone(fix, null, 100).features).toHaveLength(0);
  });
  it('build GeoJSON for the fix and markers', () => {
    expect(accuracyCircle(fix).features[0]!.geometry.type).toBe('Polygon');
    expect(mePuck(fix, true).features[0]!.properties).toEqual({ stale: true });
    expect(headingCone(fix, 90, 100).features).toHaveLength(1);
    const fc = markersCollection([
      { id: 'a', name: 'A', note: null, lat: 1, lon: 2, createdAt: 0, updatedAt: 0 },
    ]);
    expect(fc.features[0]).toMatchObject({ id: 'a', geometry: { coordinates: [2, 1] } });
  });
  it('caps absurd accuracy circles', () => {
    const ring = (
      accuracyCircle({ ...fix, accM: 1e7 }).features[0]!.geometry as { coordinates: number[][][] }
    ).coordinates[0]!;
    expect(ring.length).toBeGreaterThan(3);
    expect(Math.abs(ring[0]![1]! - fix.lat)).toBeLessThan(1);
  });
});

describe('base64 + sha256', () => {
  it('decodes like Buffer', () => {
    for (const s of ['', 'a', 'ab', 'abc', 'abcd', 'The quick brown fox 🦊']) {
      const b64 = Buffer.from(s).toString('base64');
      expect(Buffer.from(base64ToBytes(b64)).toString()).toBe(s);
    }
    expect(() => base64ToBytes('@@@@')).toThrow();
  });
  it('streams sha256 identically to node crypto, across chunk boundaries', async () => {
    const fs = new MemoryFs();
    const data = new Uint8Array(2.5 * 1024 * 1024).map((_, i) => (i * 31) & 0xff);
    await fs.writeBytes('file:///f', data);
    const expected = createHash('sha256').update(data).digest('hex');
    const progress: number[] = [];
    expect(await sha256File(fs, 'file:///f', d => progress.push(d))).toBe(expected);
    expect(progress.length).toBe(3);
    expect(sha256Bytes(new Uint8Array([97, 98, 99]))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
