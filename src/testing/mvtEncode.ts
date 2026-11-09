import {
  COMPRESSION_GZIP,
  COMPRESSION_NONE,
  DirEntry,
  gzip,
  serializeDirectory,
  writeFullHeader,
  zxyToTileId,
} from '../domain/maps/pmtilesDir';
import { PMTILES_HEADER_BYTES } from '../domain/maps/pmtiles';

/** Test helpers: encode small MVT tiles and PMTiles archives in memory. */

type Bytes = number[];

const varint = (out: Bytes, v: number) => {
  let n = v;
  while (n >= 128) {
    out.push(n % 128 | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
};
const key = (out: Bytes, field: number, wire: number) => varint(out, field * 8 + wire);
const bytesField = (out: Bytes, field: number, b: Bytes) => {
  key(out, field, 2);
  varint(out, b.length);
  out.push(...b);
};
const str = (s: string): Bytes => Array.from(Buffer.from(s, 'utf8'));
const zz = (n: number) => (n < 0 ? -2 * n - 1 : 2 * n);

export type TestLine = { props: Record<string, string>; parts: [number, number][][] };

/** One tile with one layer of line features (plus an optional unrelated polygon layer). */
export function encodeTile(
  layers: { name: string; lines: TestLine[]; extent?: number }[],
): Uint8Array {
  const tile: Bytes = [];
  for (const l of layers) {
    const keys: string[] = [];
    const values: string[] = [];
    const layer: Bytes = [];
    key(layer, 15, 0);
    varint(layer, 2);
    bytesField(layer, 1, str(l.name));
    for (const f of l.lines) {
      const tags: Bytes = [];
      for (const [k, v] of Object.entries(f.props)) {
        let ki = keys.indexOf(k);
        if (ki < 0) {
          ki = keys.push(k) - 1;
        }
        let vi = values.indexOf(v);
        if (vi < 0) {
          vi = values.push(v) - 1;
        }
        varint(tags, ki);
        varint(tags, vi);
      }
      const geom: Bytes = [];
      let cx = 0;
      let cy = 0;
      for (const part of f.parts) {
        varint(geom, (1 & 7) | (1 << 3));
        varint(geom, zz(part[0]![0] - cx));
        varint(geom, zz(part[0]![1] - cy));
        [cx, cy] = part[0]!;
        varint(geom, (2 & 7) | ((part.length - 1) << 3));
        for (const [x, y] of part.slice(1)) {
          varint(geom, zz(x - cx));
          varint(geom, zz(y - cy));
          cx = x;
          cy = y;
        }
      }
      const feat: Bytes = [];
      bytesField(feat, 2, tags);
      key(feat, 3, 0);
      varint(feat, 2);
      bytesField(feat, 4, geom);
      bytesField(layer, 2, feat);
    }
    for (const k of keys) {
      bytesField(layer, 3, str(k));
    }
    for (const v of values) {
      const val: Bytes = [];
      bytesField(val, 1, str(v));
      bytesField(layer, 4, val);
    }
    key(layer, 5, 0);
    varint(layer, l.extent ?? 4096);
    bytesField(tile, 3, layer);
  }
  return Uint8Array.from(tile);
}

/** A PMTiles v3 archive (uncompressed tiles, gzipped directory) holding the given tiles. */
export function buildArchive(
  tiles: { z: number; x: number; y: number; data: Uint8Array }[],
  zooms: { min: number; max: number },
): Uint8Array {
  const sorted = tiles
    .map(t => ({ ...t, id: zxyToTileId(t.z, t.x, t.y) }))
    .sort((a, b) => a.id - b.id);
  const entries: DirEntry[] = [];
  let off = 0;
  for (const t of sorted) {
    entries.push({ tileId: t.id, offset: off, length: t.data.length, runLength: 1 });
    off += t.data.length;
  }
  const root = gzip(serializeDirectory(entries));
  const dataOffset = PMTILES_HEADER_BYTES + root.length;
  const header = writeFullHeader({
    rootDirOffset: PMTILES_HEADER_BYTES,
    rootDirLength: root.length,
    metadataOffset: dataOffset,
    metadataLength: 0,
    leafDirsOffset: dataOffset,
    leafDirsLength: 0,
    tileDataOffset: dataOffset,
    tileDataLength: off,
    addressedTiles: entries.length,
    tileEntries: entries.length,
    tileContents: entries.length,
    clustered: true,
    internalCompression: COMPRESSION_GZIP,
    tileCompression: COMPRESSION_NONE,
    tileType: 1,
    minZoom: zooms.min,
    maxZoom: zooms.max,
    bounds: [-180, -85, 180, 85],
    centerZoom: zooms.max,
    center: [0, 0],
  });
  const out = new Uint8Array(dataOffset + off);
  out.set(header, 0);
  out.set(root, PMTILES_HEADER_BYTES);
  let p = dataOffset;
  for (const t of sorted) {
    out.set(t.data, p);
    p += t.data.length;
  }
  return out;
}
