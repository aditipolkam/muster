import { BBox } from '../domain/geo';
import {
  COMPRESSION_GZIP,
  DirEntry,
  FullHeader,
  gzip,
  serializeDirectory,
  writeFullHeader,
  zxyToTileId,
} from '../domain/maps/pmtilesDir';

/** Payload of a fake tile. Odd rows share one payload to exercise the source's tile dedupe. */
export function fakeTile(z: number, x: number, y: number): Uint8Array {
  const text =
    y % 2 === 1 ? `shared-ocean-${z}` : `tile ${z}/${x}/${y} ${'x'.repeat((x * 7 + y) % 40)}`;
  return new TextEncoder().encode(text);
}

/**
 * A small but structurally real planet archive: every tile of zooms 0..maxZoom, gzipped root and
 * leaf directories, deduped payloads, metadata. Leaves hold `leafSize` entries.
 */
export function makePlanet(maxZoom = 6, leafSize = 500): Uint8Array {
  const tiles: { id: number; z: number; x: number; y: number }[] = [];
  for (let z = 0; z <= maxZoom; z++) {
    const n = 2 ** z;
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        tiles.push({ id: zxyToTileId(z, x, y), z, x, y });
      }
    }
  }
  tiles.sort((a, b) => a.id - b.id);

  const data: Uint8Array[] = [];
  let dataLen = 0;
  const seen = new Map<string, { offset: number; length: number }>();
  const entries: DirEntry[] = tiles.map(t => {
    const bytes = fakeTile(t.z, t.x, t.y);
    const key = new TextDecoder().decode(bytes);
    let at = seen.get(key);
    if (!at) {
      at = { offset: dataLen, length: bytes.length };
      seen.set(key, at);
      data.push(bytes);
      dataLen += bytes.length;
    }
    return { tileId: t.id, offset: at.offset, length: at.length, runLength: 1 };
  });

  const leafChunks: Uint8Array[] = [];
  const rootEntries: DirEntry[] = [];
  let leafLen = 0;
  for (let i = 0; i < entries.length; i += leafSize) {
    const gz = gzip(serializeDirectory(entries.slice(i, i + leafSize)));
    rootEntries.push({
      tileId: entries[i]!.tileId,
      offset: leafLen,
      length: gz.length,
      runLength: 0,
    });
    leafChunks.push(gz);
    leafLen += gz.length;
  }
  const root = gzip(serializeDirectory(rootEntries));
  const metadata = gzip(new TextEncoder().encode('{"name":"test planet"}'));

  const rootOff = 127;
  const metaOff = rootOff + root.length;
  const leafOff = metaOff + metadata.length;
  const tileOff = leafOff + leafLen;
  const header: FullHeader = {
    rootDirOffset: rootOff,
    rootDirLength: root.length,
    metadataOffset: metaOff,
    metadataLength: metadata.length,
    leafDirsOffset: leafOff,
    leafDirsLength: leafLen,
    tileDataOffset: tileOff,
    tileDataLength: dataLen,
    addressedTiles: tiles.length,
    tileEntries: tiles.length,
    tileContents: seen.size,
    clustered: true,
    internalCompression: COMPRESSION_GZIP,
    tileCompression: 1,
    tileType: 1,
    minZoom: 0,
    maxZoom,
    bounds: [-180, -85, 180, 85] as BBox,
    centerZoom: 0,
    center: [0, 0],
  };
  const out = new Uint8Array(tileOff + dataLen);
  out.set(writeFullHeader(header), 0);
  out.set(root, rootOff);
  out.set(metadata, metaOff);
  let p = leafOff;
  for (const c of leafChunks) {
    out.set(c, p);
    p += c.length;
  }
  p = tileOff;
  for (const d of data) {
    out.set(d, p);
    p += d.length;
  }
  return out;
}
