import { gunzipSync, gzipSync } from 'fflate';
import { BBox } from '../geo';
import { PMTILES_HEADER_BYTES } from './pmtiles';

/** PMTiles v3 directories, tile ids and the full header: what `pmtiles extract` needs. */

export type DirEntry = {
  tileId: number;
  offset: number;
  length: number;
  /** 0 marks a pointer to a leaf directory. */
  runLength: number;
};

export type FullHeader = {
  rootDirOffset: number;
  rootDirLength: number;
  metadataOffset: number;
  metadataLength: number;
  leafDirsOffset: number;
  leafDirsLength: number;
  tileDataOffset: number;
  tileDataLength: number;
  addressedTiles: number;
  tileEntries: number;
  tileContents: number;
  clustered: boolean;
  internalCompression: number;
  tileCompression: number;
  tileType: number;
  minZoom: number;
  maxZoom: number;
  bounds: BBox;
  centerZoom: number;
  center: [number, number];
};

export const COMPRESSION_NONE = 1;
export const COMPRESSION_GZIP = 2;
/** Readers fetch the first 16 KiB to get header + root directory. */
export const ROOT_FETCH_BYTES = 16384;
export const MAX_TILE_ZOOM = 26;

// ---- tile ids (Hilbert curve, zoom-major) --------------------------------------------------

const rotate = (n: number, xy: [number, number], rx: number, ry: number) => {
  if (ry === 0) {
    if (rx === 1) {
      xy[0] = n - 1 - xy[0];
      xy[1] = n - 1 - xy[1];
    }
    const t = xy[0];
    xy[0] = xy[1];
    xy[1] = t;
  }
};

export const zoomBase = (z: number): number => (Math.pow(4, z) - 1) / 3;

export function zxyToTileId(z: number, x: number, y: number): number {
  const n = Math.pow(2, z);
  if (z > MAX_TILE_ZOOM || x < 0 || y < 0 || x >= n || y >= n) {
    throw new Error('tile out of range');
  }
  let d = 0;
  const xy: [number, number] = [x, y];
  for (let s = n / 2; s > 0; s /= 2) {
    const rx = (xy[0] & s) > 0 ? 1 : 0;
    const ry = (xy[1] & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    rotate(s, xy, rx, ry);
  }
  return zoomBase(z) + d;
}

// ---- bbox -> tiles -------------------------------------------------------------------------

const MAX_LAT = 85.0511287798;

export function lonToTileX(lon: number, z: number): number {
  const n = Math.pow(2, z);
  return Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
}

export function latToTileY(lat: number, z: number): number {
  const n = Math.pow(2, z);
  const l = Math.min(MAX_LAT, Math.max(-MAX_LAT, lat));
  const r = (l * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return Math.min(n - 1, Math.max(0, Math.floor(y)));
}

export type TileRect = { z: number; x0: number; x1: number; y0: number; y1: number };

export function tileRects(bbox: BBox, minZoom: number, maxZoom: number): TileRect[] {
  const [w, s, e, n] = bbox;
  const out: TileRect[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    out.push({
      z,
      x0: lonToTileX(w, z),
      x1: lonToTileX(e, z),
      y0: latToTileY(n, z),
      y1: latToTileY(s, z),
    });
  }
  return out;
}

export const countTiles = (rects: TileRect[]): number =>
  rects.reduce((a, r) => a + (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1), 0);

/** Sorted ascending, unique tile ids for every tile intersecting the rectangles. */
export function wantedTileIds(rects: TileRect[]): number[] {
  const ids: number[] = [];
  for (const r of rects) {
    for (let x = r.x0; x <= r.x1; x++) {
      for (let y = r.y0; y <= r.y1; y++) {
        ids.push(zxyToTileId(r.z, x, y));
      }
    }
  }
  return ids.sort((a, b) => a - b);
}

/** True when any id in the sorted array lies in [from, to). */
export function anyIdIn(sorted: number[], from: number, to: number): boolean {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < from) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo < sorted.length && sorted[lo]! < to;
}

// ---- varints -------------------------------------------------------------------------------

function readVarint(b: Uint8Array, pos: { i: number }): number {
  let result = 0;
  let mul = 1;
  for (;;) {
    const byte = b[pos.i++];
    if (byte === undefined) {
      throw new Error('truncated varint');
    }
    result += (byte & 0x7f) * mul;
    if ((byte & 0x80) === 0) {
      return result;
    }
    mul *= 128;
    if (mul > 2 ** 56) {
      throw new Error('varint too long');
    }
  }
}

function writeVarint(out: number[], v: number): void {
  let n = v;
  while (n >= 128) {
    out.push(n % 128 | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
}

// ---- directories ---------------------------------------------------------------------------

export function decompress(bytes: Uint8Array, compression: number): Uint8Array {
  if (compression === COMPRESSION_NONE) {
    return bytes;
  }
  if (compression === COMPRESSION_GZIP) {
    return gunzipSync(bytes);
  }
  throw new Error(`unsupported compression ${compression}`);
}

export function parseDirectory(raw: Uint8Array, compression: number): DirEntry[] {
  const b = decompress(raw, compression);
  const pos = { i: 0 };
  const count = readVarint(b, pos);
  if (count > 50_000_000) {
    throw new Error('directory too large');
  }
  const entries: DirEntry[] = new Array(count);
  let id = 0;
  for (let i = 0; i < count; i++) {
    id += readVarint(b, pos);
    entries[i] = { tileId: id, offset: 0, length: 0, runLength: 0 };
  }
  for (let i = 0; i < count; i++) {
    entries[i]!.runLength = readVarint(b, pos);
  }
  for (let i = 0; i < count; i++) {
    entries[i]!.length = readVarint(b, pos);
  }
  for (let i = 0; i < count; i++) {
    const v = readVarint(b, pos);
    const e = entries[i]!;
    if (v === 0 && i > 0) {
      e.offset = entries[i - 1]!.offset + entries[i - 1]!.length;
    } else {
      e.offset = v - 1;
    }
  }
  return entries;
}

/** Uncompressed directory bytes; sort order by tileId is the caller's job. */
export function serializeDirectory(entries: DirEntry[]): Uint8Array {
  const out: number[] = [];
  writeVarint(out, entries.length);
  let last = 0;
  for (const e of entries) {
    writeVarint(out, e.tileId - last);
    last = e.tileId;
  }
  for (const e of entries) {
    writeVarint(out, e.runLength);
  }
  for (const e of entries) {
    writeVarint(out, e.length);
  }
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const prev = entries[i - 1];
    writeVarint(out, i > 0 && prev && e.offset === prev.offset + prev.length ? 0 : e.offset + 1);
  }
  return Uint8Array.from(out);
}

export const gzip = (b: Uint8Array): Uint8Array => gzipSync(b);

// ---- header --------------------------------------------------------------------------------

export function readFullHeader(bytes: Uint8Array): FullHeader {
  if (bytes.length < PMTILES_HEADER_BYTES) {
    throw new Error('short header');
  }
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u64 = (o: number) => Number(v.getBigUint64(o, true));
  const e7 = (o: number) => v.getInt32(o, true) / 1e7;
  return {
    rootDirOffset: u64(8),
    rootDirLength: u64(16),
    metadataOffset: u64(24),
    metadataLength: u64(32),
    leafDirsOffset: u64(40),
    leafDirsLength: u64(48),
    tileDataOffset: u64(56),
    tileDataLength: u64(64),
    addressedTiles: u64(72),
    tileEntries: u64(80),
    tileContents: u64(88),
    clustered: v.getUint8(96) === 1,
    internalCompression: v.getUint8(97),
    tileCompression: v.getUint8(98),
    tileType: v.getUint8(99),
    minZoom: v.getUint8(100),
    maxZoom: v.getUint8(101),
    bounds: [e7(102), e7(106), e7(110), e7(114)],
    centerZoom: v.getUint8(118),
    center: [e7(119), e7(123)],
  };
}

export function writeFullHeader(h: FullHeader): Uint8Array {
  const b = new Uint8Array(PMTILES_HEADER_BYTES);
  const v = new DataView(b.buffer);
  'PMTiles'.split('').forEach((ch, i) => (b[i] = ch.charCodeAt(0)));
  v.setUint8(7, 3);
  const u64 = (o: number, n: number) => v.setBigUint64(o, BigInt(n), true);
  u64(8, h.rootDirOffset);
  u64(16, h.rootDirLength);
  u64(24, h.metadataOffset);
  u64(32, h.metadataLength);
  u64(40, h.leafDirsOffset);
  u64(48, h.leafDirsLength);
  u64(56, h.tileDataOffset);
  u64(64, h.tileDataLength);
  u64(72, h.addressedTiles);
  u64(80, h.tileEntries);
  u64(88, h.tileContents);
  v.setUint8(96, h.clustered ? 1 : 0);
  v.setUint8(97, h.internalCompression);
  v.setUint8(98, h.tileCompression);
  v.setUint8(99, h.tileType);
  v.setUint8(100, h.minZoom);
  v.setUint8(101, h.maxZoom);
  const e7 = (o: number, d: number) => v.setInt32(o, Math.round(d * 1e7), true);
  e7(102, h.bounds[0]);
  e7(106, h.bounds[1]);
  e7(110, h.bounds[2]);
  e7(114, h.bounds[3]);
  v.setUint8(118, h.centerZoom);
  e7(119, h.center[0]);
  e7(123, h.center[1]);
  return b;
}

/**
 * Lays entries out as a root directory plus leaf directories so the gzipped root (with the header
 * and metadata) fits the 16 KiB first read that readers make. Leaf size doubles until it fits.
 */
export function buildDirectories(
  entries: DirEntry[],
  metadataLength: number,
): { root: Uint8Array; leaves: Uint8Array } {
  const budget = ROOT_FETCH_BYTES - PMTILES_HEADER_BYTES - metadataLength;
  const rootAll = gzip(serializeDirectory(entries));
  if (rootAll.length <= budget) {
    return { root: rootAll, leaves: new Uint8Array(0) };
  }
  for (let leafSize = 4096; ; leafSize *= 2) {
    const chunks: Uint8Array[] = [];
    const rootEntries: DirEntry[] = [];
    let off = 0;
    for (let i = 0; i < entries.length; i += leafSize) {
      const part = gzip(serializeDirectory(entries.slice(i, i + leafSize)));
      rootEntries.push({
        tileId: entries[i]!.tileId,
        offset: off,
        length: part.length,
        runLength: 0,
      });
      chunks.push(part);
      off += part.length;
    }
    const root = gzip(serializeDirectory(rootEntries));
    if (root.length <= budget || rootEntries.length === 1) {
      const leaves = new Uint8Array(off);
      let p = 0;
      for (const c of chunks) {
        leaves.set(c, p);
        p += c.length;
      }
      return { root, leaves };
    }
  }
}
