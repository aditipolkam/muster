import { Platform } from 'react-native';

/**
 * D-3 (where region files are hosted) is undecided, so release builds ship with no remote catalog
 * and use the bundled one. Debug builds talk to tools/region-builder/serve.mjs on the dev machine.
 * The catalog URL can be overridden in Settings (kv key `catalog.url`).
 */
const devHost = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';

export const config = {
  defaultCatalogUrl: __DEV__ ? `http://${devHost}:8787/catalog.json` : null,
  /** Bundled catalog URLs were generated against this base; rewritten to the dev host in debug. */
  bundledCatalogBase: 'http://localhost:8787',
  devHost,
  dbName: 'muster.db',
} as const;

/**
 * Development/testing only: the public Protomaps daily planet build (supports Range requests).
 * Protomaps asks production apps to host their own copy, so release builds return null and rely on
 * `planet` in the catalog. Builds are dated and eventually removed, so use one from two days ago.
 */
export function devPlanet(now: Date = new Date()): { url: string; osmDataDate: string } | null {
  if (!__DEV__) {
    return null;
  }
  const d = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const iso = d.toISOString().slice(0, 10);
  return { url: `https://build.protomaps.com/${iso.replace(/-/g, '')}.pmtiles`, osmDataDate: iso };
}

/** Same build, then older ones, in case the newest is not published (or cached) yet. */
export function devPlanets(now: Date = new Date()): { url: string; osmDataDate: string }[] {
  if (!__DEV__) {
    return [];
  }
  return [2, 3, 4, 5, 6].map(days => {
    const iso = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return {
      url: `https://build.protomaps.com/${iso.replace(/-/g, '')}.pmtiles`,
      osmDataDate: iso,
    };
  });
}

export function resolveRegionUrl(url: string): string {
  return __DEV__ && url.startsWith(config.bundledCatalogBase)
    ? url.replace(config.bundledCatalogBase, `http://${config.devHost}:8787`)
    : url;
}
