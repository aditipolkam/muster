import { BBox } from '../geo';

export const PMTILES_HEADER_BYTES = 127;

export type PmtilesTileType = 'unknown' | 'mvt' | 'png' | 'jpeg' | 'webp' | 'avif';

export type PmtilesHeader = {
  specVersion: number;
  tileType: PmtilesTileType;
  minZoom: number;
  maxZoom: number;
  bounds: BBox;
  rootDirOffset: number;
  tileDataOffset: number;
  tileDataLength: number;
  tileEntries: number;
};

export type PmtilesRejectReason =
  | 'too_short'
  | 'bad_magic'
  | 'unsupported_version'
  | 'not_vector'
  | 'bad_bounds'
  | 'bad_zoom';

export class PmtilesError extends Error {
  constructor(readonly reason: PmtilesRejectReason, message: string) {
    super(message);
  }
}

const TILE_TYPES: PmtilesTileType[] = ['unknown', 'mvt', 'png', 'jpeg', 'webp', 'avif'];

export const REJECT_MESSAGES: Record<PmtilesRejectReason, string> = {
  too_short: 'The file is too small to be a PMTiles archive.',
  bad_magic: 'This is not a PMTiles file (missing "PMTiles" signature).',
  unsupported_version: 'Only PMTiles version 3 is supported.',
  not_vector: 'This archive does not contain vector tiles (MVT).',
  bad_bounds: 'The archive has invalid geographic bounds.',
  bad_zoom: 'The archive has an invalid zoom range.',
};

function reject(reason: PmtilesRejectReason): never {
  throw new PmtilesError(reason, REJECT_MESSAGES[reason]);
}

/** Parses and validates the fixed 127-byte PMTiles v3 header. Throws PmtilesError. */
export function parsePmtilesHeader(bytes: Uint8Array): PmtilesHeader {
  if (bytes.length < PMTILES_HEADER_BYTES) {
    reject('too_short');
  }
  const magic = String.fromCharCode(...Array.from(bytes.subarray(0, 7)));
  if (magic !== 'PMTiles') {
    reject('bad_magic');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const specVersion = view.getUint8(7);
  if (specVersion !== 3) {
    reject('unsupported_version');
  }
  // Offsets/lengths are u64; archives here are far below 2^53 so Number is exact.
  const u64 = (o: number) => Number(view.getBigUint64(o, true));
  const tileType = TILE_TYPES[view.getUint8(99)] ?? 'unknown';
  if (tileType !== 'mvt') {
    reject('not_vector');
  }
  const minZoom = view.getUint8(100);
  const maxZoom = view.getUint8(101);
  if (minZoom > maxZoom || maxZoom > 30) {
    reject('bad_zoom');
  }
  const e7 = (o: number) => view.getInt32(o, true) / 1e7;
  const bounds: BBox = [e7(102), e7(106), e7(110), e7(114)];
  const [minLon, minLat, maxLon, maxLat] = bounds;
  if (
    minLon >= maxLon ||
    minLat >= maxLat ||
    minLon < -180 ||
    maxLon > 180 ||
    minLat < -90 ||
    maxLat > 90
  ) {
    reject('bad_bounds');
  }
  return {
    specVersion,
    tileType,
    minZoom,
    maxZoom,
    bounds,
    rootDirOffset: u64(8),
    tileDataOffset: u64(56),
    tileDataLength: u64(64),
    tileEntries: u64(80),
  };
}
