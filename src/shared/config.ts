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
  dbName: 'trailmesh.db',
} as const;

export function resolveRegionUrl(url: string): string {
  return __DEV__ && url.startsWith(config.bundledCatalogBase)
    ? url.replace(config.bundledCatalogBase, `http://${config.devHost}:8787`)
    : url;
}
