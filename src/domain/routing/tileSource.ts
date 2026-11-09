/* eslint-disable no-bitwise -- binary decoding and heap index maths */
import {
  decompress,
  DirEntry,
  FullHeader,
  parseDirectory,
  readFullHeader,
  ROOT_FETCH_BYTES,
  zxyToTileId,
} from '../maps/pmtilesDir';

/** Reads `length` bytes at `offset` of one local file (FilePort.readRange in the app, fs in tests). */
export type ReadRange = (offset: number, length: number) => Promise<Uint8Array>;

/** A vector tile source: uncompressed MVT bytes for z/x/y, or null when the tile is absent. */
export interface TileSource {
  readonly minZoom: number;
  readonly maxZoom: number;
  tile(z: number, x: number, y: number): Promise<Uint8Array | null>;
}

function findEntry(entries: DirEntry[], tileId: number): DirEntry | null {
  let lo = 0;
  let hi = entries.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const e = entries[mid]!;
    if (e.tileId === tileId) {
      return e;
    }
    if (e.tileId < tileId) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  // A run (or a leaf pointer) that starts before the id may still cover it.
  if (hi >= 0) {
    const e = entries[hi]!;
    if (e.runLength === 0 || tileId - e.tileId < e.runLength) {
      return e;
    }
  }
  return null;
}

/** A local PMTiles v3 archive read through `ReadRange`. Leaf directories are cached. */
export class PmtilesTileSource implements TileSource {
  private leaves = new Map<number, DirEntry[]>();
  private constructor(
    private readonly read: ReadRange,
    readonly header: FullHeader,
    private readonly root: DirEntry[],
  ) {}

  get minZoom() {
    return this.header.minZoom;
  }
  get maxZoom() {
    return this.header.maxZoom;
  }

  static async open(read: ReadRange): Promise<PmtilesTileSource> {
    const first = await read(0, ROOT_FETCH_BYTES);
    const header = readFullHeader(first);
    if (header.tileType !== 1) {
      throw new Error('not a vector (MVT) archive');
    }
    const rootBytes =
      header.rootDirOffset + header.rootDirLength <= first.length
        ? first.subarray(header.rootDirOffset, header.rootDirOffset + header.rootDirLength)
        : await read(header.rootDirOffset, header.rootDirLength);
    const root = parseDirectory(rootBytes, header.internalCompression);
    return new PmtilesTileSource(read, header, root);
  }

  async tile(z: number, x: number, y: number): Promise<Uint8Array | null> {
    const id = zxyToTileId(z, x, y);
    let dir = this.root;
    for (let depth = 0; depth < 4; depth++) {
      const e = findEntry(dir, id);
      if (!e) {
        return null;
      }
      if (e.runLength > 0) {
        const raw = await this.read(this.header.tileDataOffset + e.offset, e.length);
        return decompress(raw, this.header.tileCompression);
      }
      const key = this.header.leafDirsOffset + e.offset;
      let leaf = this.leaves.get(key);
      if (!leaf) {
        leaf = parseDirectory(await this.read(key, e.length), this.header.internalCompression);
        this.leaves.set(key, leaf);
      }
      dir = leaf;
    }
    return null;
  }
}
