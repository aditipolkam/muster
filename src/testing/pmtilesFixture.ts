import { sha256Bytes } from '../features/maps-manager/hash';

/** Builds a syntactically valid PMTiles v3 archive: 127-byte header + filler payload. */
export function makePmtiles(opts: {
  size?: number;
  tileType?: number;
  version?: number;
  bounds?: [number, number, number, number];
  minZoom?: number;
  maxZoom?: number;
  magic?: string;
  seed?: number;
}): Uint8Array {
  const size = opts.size ?? 4096;
  const buf = new Uint8Array(size);
  const view = new DataView(buf.buffer);
  const magic = opts.magic ?? 'PMTiles';
  for (let i = 0; i < magic.length; i++) {
    buf[i] = magic.charCodeAt(i);
  }
  view.setUint8(7, opts.version ?? 3);
  view.setBigUint64(56, 127n, true); // tile data offset
  view.setBigUint64(64, BigInt(Math.max(0, size - 127)), true);
  view.setUint8(99, opts.tileType ?? 1);
  view.setUint8(100, opts.minZoom ?? 0);
  view.setUint8(101, opts.maxZoom ?? 14);
  const [w, s, e, n] = opts.bounds ?? [-5.1, 56.74, -4.9, 56.85];
  view.setInt32(102, Math.round(w * 1e7), true);
  view.setInt32(106, Math.round(s * 1e7), true);
  view.setInt32(110, Math.round(e * 1e7), true);
  view.setInt32(114, Math.round(n * 1e7), true);
  // deterministic filler
  let x = opts.seed ?? 7;
  for (let i = 127; i < size; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    buf[i] = x & 0xff;
  }
  return buf;
}

export const hashOf = sha256Bytes;
