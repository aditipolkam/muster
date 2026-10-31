import { FilePort } from '../../platform/FilePort';
import { KvRepo } from '../../data/repositories/KvRepo';
import { base64ToBytes } from '../../shared/base64';
import { createLogger } from '../../shared/logger';

const log = createLogger('style');

export type StyleAssetBundle = {
  version: string;
  files: Record<string, string>; // relative path -> base64
  worldVersion: string;
  worldBase64: () => string;
};

export type InstalledStyleAssets = {
  /** file:// URI of the style directory, trailing slash */
  styleRoot: string;
  worldBaseUri: string;
};

/** Loaded lazily so the multi-MB base64 modules are only parsed when a copy is needed. */
function loadBundled(): StyleAssetBundle {
  const s = require('../../assets/generated/styleAssets') as {
    STYLE_ASSETS_VERSION: string;
    STYLE_ASSETS: Record<string, string>;
  };
  return {
    version: s.STYLE_ASSETS_VERSION,
    files: s.STYLE_ASSETS,
    worldVersion: (require('../../assets/generated/worldBase') as { WORLD_BASE_VERSION: string })
      .WORLD_BASE_VERSION,
    worldBase64: () =>
      (require('../../assets/generated/worldBase') as { WORLD_BASE_BASE64: string })
        .WORLD_BASE_BASE64,
  };
}

const SENTINEL = 'fonts/Noto Sans Regular/0-255.pbf';

/**
 * Copies bundled glyphs, sprites and the z0-3 world base to documents/style on first launch (or
 * when the bundled version changes). Android cannot byte-range APK assets and MapLibre needs
 * file:// access, so everything must live on the filesystem (MAP_ARCHITECTURE.md 3.2).
 */
export async function ensureStyleAssets(
  fs: FilePort,
  kv: KvRepo,
  bundle: () => StyleAssetBundle = loadBundled,
): Promise<InstalledStyleAssets> {
  const styleRoot = `${fs.root}style/`;
  const worldBaseUri = `${styleRoot}world-base.pmtiles`;
  const installedVersion = await kv.get('style.assets.version');
  const installedWorld = await kv.get('style.world.version');
  const sentinelOk = await fs.exists(`${styleRoot}${SENTINEL}`);
  const worldOk = await fs.exists(worldBaseUri);
  const b = bundle();
  if (installedVersion !== b.version || !sentinelOk) {
    log.info(`installing style assets ${b.version}`);
    for (const [rel, b64] of Object.entries(b.files)) {
      await fs.writeBytes(`${styleRoot}${rel}`, base64ToBytes(b64));
    }
    await kv.set('style.assets.version', b.version);
  }
  if (installedWorld !== b.worldVersion || !worldOk) {
    log.info(`installing world base ${b.worldVersion}`);
    await fs.writeBytes(worldBaseUri, base64ToBytes(b.worldBase64()));
    await kv.set('style.world.version', b.worldVersion);
  }
  return { styleRoot, worldBaseUri };
}
