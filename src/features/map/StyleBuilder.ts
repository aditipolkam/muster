import { layers as protomapsLayers, namedFlavor } from '@protomaps/basemaps';
import type { LayerSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { WORLD_BASE_MAX_ZOOM } from '../../domain/maps/coverage';
import { ATTRIBUTION_HTML } from '../../shared/attribution';

/** World layers stop here; beyond it only installed regions draw (plain background elsewhere). */
export const WORLD_LAYER_MAX_ZOOM = 6;
export const OVERLAY_FONT = 'Noto Sans Regular';

export type StyleRegion = { id: string; uri: string };

export type StyleInput = {
  /** file:// URI of the style directory (trailing slash) holding fonts/ and sprites/. */
  styleRoot: string;
  worldBaseUri: string;
  regions: StyleRegion[];
  /** Remote planet archive streamed over HTTP when nothing downloaded covers the view. */
  onlineUri?: string;
  flavor?: 'light' | 'dark' | 'white' | 'grayscale' | 'black';
  lang?: string;
};

/** TileSourceStrategy: how tiles reach MapLibre (MAP_ARCHITECTURE.md 3.4). */
export interface TileSourceStrategy {
  sourceUrl(fileUri: string): string;
}

/** First choice: MapLibre Native reads the PMTiles file directly. Needs device verification (A-14). */
export const PmtilesFileStrategy: TileSourceStrategy = {
  sourceUrl: fileUri => `pmtiles://${fileUri}`,
};

const sourceId = (key: string) => `src-${key}`;

function prefixed(
  layer: LayerSpecification,
  prefix: string,
  source: string,
  minzoom?: number,
  maxzoom?: number,
) {
  const l = { ...layer, id: `${prefix}:${layer.id}` } as LayerSpecification & { source?: string };
  if (l.type !== 'background') {
    l.source = source;
    const lo = Math.max(l.minzoom ?? 0, minzoom ?? 0);
    if (lo > 0) {
      l.minzoom = lo;
    }
    if (maxzoom !== undefined) {
      l.maxzoom = Math.min(l.maxzoom ?? maxzoom, maxzoom);
    }
  }
  return l as LayerSpecification;
}

/**
 * Generates the style at runtime: bundled world base first, then one vector source per installed
 * region with its own layer set (MAP_ARCHITECTURE.md 3.2). Overlays are added separately.
 */
export function buildStyle(
  input: StyleInput,
  strategy: TileSourceStrategy = PmtilesFileStrategy,
): StyleSpecification {
  const flavor = namedFlavor(input.flavor ?? 'light');
  const lang = input.lang ?? 'en';
  const sources: StyleSpecification['sources'] = {
    [sourceId('world')]: {
      type: 'vector',
      url: strategy.sourceUrl(input.worldBaseUri),
      attribution: ATTRIBUTION_HTML,
    },
  };
  const layers: LayerSpecification[] = [];

  const worldLayers = protomapsLayers(sourceId('world'), flavor, { lang }) as LayerSpecification[];
  for (const l of worldLayers) {
    if (l.type === 'background') {
      layers.push(l);
    }
  }
  for (const l of worldLayers) {
    if (l.type !== 'background') {
      layers.push(prefixed(l, 'world', sourceId('world'), undefined, WORLD_LAYER_MAX_ZOOM));
    }
  }
  input.regions.forEach((r, i) => {
    const sid = sourceId(`r${i}`);
    sources[sid] = {
      type: 'vector',
      url: strategy.sourceUrl(r.uri),
      attribution: ATTRIBUTION_HTML,
    };
    for (const l of protomapsLayers(sid, flavor, { lang }) as LayerSpecification[]) {
      if (l.type !== 'background') {
        // Region archives include z0-3, which the world base already draws.
        layers.push(prefixed(l, `r${i}`, sid, WORLD_BASE_MAX_ZOOM + 1));
      }
    }
  });

  if (input.onlineUri) {
    // Only above the zooms the bundled world base answers, and below any installed region's layers.
    sources[sourceId('online')] = {
      type: 'vector',
      url: strategy.sourceUrl(input.onlineUri),
      attribution: ATTRIBUTION_HTML,
    };
    for (const l of protomapsLayers(sourceId('online'), flavor, { lang }) as LayerSpecification[]) {
      if (l.type !== 'background') {
        layers.push(prefixed(l, 'online', sourceId('online'), WORLD_BASE_MAX_ZOOM + 1));
      }
    }
  }

  return {
    version: 8,
    name: 'trailmesh',
    glyphs: `${input.styleRoot}fonts/{fontstack}/{range}.pbf`,
    sprite: `${input.styleRoot}sprites/${input.flavor ?? 'light'}/sprite`,
    sources,
    layers,
  };
}
