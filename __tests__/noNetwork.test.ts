import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildStyle } from '../src/features/map/StyleBuilder';
import { ensureStyleAssets } from '../src/features/map/styleAssets';
import { LocationService } from '../src/platform/LocationService';
import { distanceM } from '../src/domain/geo';
import { FakeLocation } from '../src/testing/FakeLocation';
import { makeTestServices, ManualClock } from '../src/testing/services';

const SRC = join(__dirname, '..', 'src');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe('AC8: no network outside the user-initiated map download', () => {
  it('core flows never call fetch / XMLHttpRequest / WebSocket', async () => {
    const trap = jest.fn(() => {
      throw new Error('unexpected network call');
    });
    const g = globalThis as Record<string, unknown>;
    const saved = { fetch: g.fetch, XMLHttpRequest: g.XMLHttpRequest, WebSocket: g.WebSocket };
    g.fetch = trap;
    g.XMLHttpRequest = trap;
    g.WebSocket = trap;
    try {
      const t = await makeTestServices();
      // style, assets, db, markers, regions, storage, location: everything except MapPackManager downloads
      buildStyle({ styleRoot: 'file:///s/', worldBaseUri: 'file:///s/w.pmtiles', regions: [] });
      await ensureStyleAssets(t.fs, t.kv, () => ({
        version: 'v',
        files: { 'a/b': 'AAEC' },
        worldVersion: 'w',
        worldBase64: () => 'AAEC',
      }));
      const m = await t.points.create({ name: 'x', lat: 1, lon: 2 });
      await t.points.update(m.id, { lat: 3 });
      await t.regions.list();
      await t.packs.storageUsage();
      distanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 1 });
      t.loc.perm = {
        status: 'granted',
        canAskAgain: true,
        coarseOnly: false,
        servicesEnabled: true,
      };
      const svc = new LocationService(new FakeLocation(), new ManualClock());
      await svc.start();
      expect(trap).not.toHaveBeenCalled();
    } finally {
      Object.assign(g, saved);
    }
  });

  it('MapPackManager uses the injected client only (no global fetch) when downloading', async () => {
    const trap = jest.fn();
    const g = globalThis as Record<string, unknown>;
    const saved = g.fetch;
    g.fetch = trap;
    try {
      const t = await makeTestServices();
      await t.packs.loadCatalog({ refresh: true });
      expect(trap).not.toHaveBeenCalled();
      expect(t.http.requests.length).toBe(1);
    } finally {
      g.fetch = saved;
    }
  });

  it('source scan: fetch/XHR/WebSocket/expo-fetch appear only under features/maps-manager', () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      if (!/\.(ts|tsx)$/.test(f) || f.includes('/assets/generated/')) {
        continue;
      }
      const rel = relative(SRC, f);
      if (rel.startsWith('features/maps-manager/')) {
        continue;
      }
      const code = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      if (/\bfetch\s*\(|XMLHttpRequest|new WebSocket|expo\/fetch|axios/.test(code)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the real HTTP client is constructed only in the composition root (tests use FakeHttp)', () => {
    const importers: string[] = [];
    for (const f of walk(SRC)) {
      const code = /\.(ts|tsx)$/.test(f) ? readFileSync(f, 'utf8') : '';
      if (/from '[^']*maps-manager\/http'/.test(code) || /from '\.\/http'/.test(code)) {
        importers.push(relative(SRC, f));
      }
    }
    // FakeHttp, MapPackManager, PlaceSearch and RegionExtractor import only the HttpClient *type*.
    expect(importers.sort()).toEqual(
      [
        'app/bootstrap.ts',
        'features/maps-manager/MapPackManager.ts',
        'features/maps-manager/PlaceSearch.ts',
        'features/maps-manager/RegionExtractor.ts',
        'testing/FakeHttp.ts',
      ].sort(),
    );
    const manager = readFileSync(join(SRC, 'features/maps-manager/MapPackManager.ts'), 'utf8');
    expect(manager).toMatch(/import \{ HttpClient \} from '\.\/http'/);
    expect(manager).not.toMatch(/createExpoHttpClient/);
  });

  it('the bundled style never lets MapLibre fall back to a remote URL', () => {
    const s = JSON.stringify(
      buildStyle({
        styleRoot: 'file:///s/',
        worldBaseUri: 'file:///s/w.pmtiles',
        regions: [{ id: 'a', uri: 'file:///m/a.pmtiles' }],
      }),
    );
    const urls = s.match(/"(https?:)?\/\/[^"]+"/g) ?? [];
    expect(urls.filter(u => !u.includes('openstreetmap.org/copyright'))).toEqual([]);
  });
});
