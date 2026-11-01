import { BBox } from '../../domain/geo';
import { AreaBlock, AreaPlan, AreaRange } from '../../domain/maps/area';
import { PMTILES_HEADER_BYTES, parsePmtilesHeader } from '../../domain/maps/pmtiles';
import {
  COMPRESSION_GZIP,
  DirEntry,
  FullHeader,
  ROOT_FETCH_BYTES,
  anyIdIn,
  buildDirectories,
  countTiles,
  parseDirectory,
  readFullHeader,
  tileRects,
  wantedTileIds,
  writeFullHeader,
} from '../../domain/maps/pmtilesDir';
import { FilePort } from '../../platform/FilePort';
import { HttpClient } from './http';

/**
 * Cuts a region out of a planet PMTiles archive with HTTP range requests, like `pmtiles extract`
 * but on the device: read the directories, find the tiles that intersect the area, fetch only
 * those byte ranges and write a new, self-contained archive.
 */

export const MAX_AREA_TILES = 600_000;
export const MAX_AREA_BYTES = 2 * 1024 ** 3;
/** Adjacent tile blocks closer than this are fetched in one request. */
const GAP_BYTES = 64 * 1024;
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const LEAF_CONCURRENCY = 6;
const ATTEMPTS = 3;

export type ExtractErrorCode =
  | 'area_too_large'
  | 'area_invalid'
  | 'source_unsupported'
  | 'source_unreachable'
  | 'range_unsupported'
  | 'incomplete';

export class ExtractError extends Error {
  constructor(readonly code: ExtractErrorCode, message: string, readonly permanent = false) {
    super(message);
  }
}

type Deps = { http: HttpClient; fs: FilePort };

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function fetchOnce(
  http: HttpClient,
  url: string,
  offset: number,
  length: number,
  allowShort: boolean,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await http.stream(url, {
      headers: { Range: `bytes=${offset}-${offset + length - 1}` },
      signal: ctl.signal,
    });
    if (res.status === 200 && offset > 0) {
      ctl.abort();
      throw new ExtractError(
        'range_unsupported',
        'The map server does not support partial downloads, so a custom area cannot be cut from it.',
      );
    }
    if (res.status !== 206 && res.status !== 200) {
      throw new ExtractError(
        'source_unreachable',
        `The map server answered HTTP ${res.status}.`,
        res.status >= 400 && res.status < 500 && res.status !== 429,
      );
    }
    const out = new Uint8Array(length);
    let filled = 0;
    for await (const chunk of res.body) {
      const take = Math.min(chunk.length, length - filled);
      out.set(chunk.subarray(0, take), filled);
      filled += take;
      if (filled >= length) {
        if (res.status === 200) {
          ctl.abort();
        }
        break;
      }
    }
    if (filled < length && !allowShort) {
      throw new ExtractError('incomplete', 'The map server ended a response early.');
    }
    return filled === length ? out : out.slice(0, filled);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

async function fetchRange(
  http: HttpClient,
  url: string,
  offset: number,
  length: number,
  signal?: AbortSignal,
  allowShort = false,
): Promise<Uint8Array> {
  let last: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (signal?.aborted) {
      throw new Error('aborted');
    }
    try {
      return await fetchOnce(http, url, offset, length, allowShort, signal);
    } catch (e) {
      if (
        signal?.aborted ||
        (e instanceof ExtractError && (e.code === 'range_unsupported' || e.permanent))
      ) {
        throw e;
      }
      last = e;
      await sleep(300 * 2 ** attempt);
    }
  }
  if (last instanceof ExtractError) {
    throw last;
  }
  const why = String(last instanceof Error ? last.message : last).slice(0, 120);
  throw new ExtractError('source_unreachable', `Could not reach the map server (${why}).`);
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

/** Works out exactly which bytes an area needs, without downloading any tile data. */
export async function planArea(
  { http }: Deps,
  planet: { url: string; osmDataDate: string },
  bbox: BBox,
  maxZoom: number,
  signal?: AbortSignal,
): Promise<AreaPlan> {
  const [w, s, e, n] = bbox;
  if (!(w < e && s < n && w >= -180 && e <= 180 && s >= -90 && n <= 90)) {
    throw new ExtractError('area_invalid', 'That area is not valid.');
  }
  const head = await fetchRange(http, planet.url, 0, ROOT_FETCH_BYTES, signal, true);
  let source: FullHeader;
  try {
    parsePmtilesHeader(head);
    source = readFullHeader(head);
  } catch {
    throw new ExtractError('source_unsupported', 'The map source is not a vector PMTiles file.');
  }
  const top = Math.min(maxZoom, source.maxZoom);
  const rects = tileRects(bbox, source.minZoom, top);
  if (countTiles(rects) > MAX_AREA_TILES) {
    throw new ExtractError(
      'area_too_large',
      'That area is too large at this detail. Zoom in or choose less detail.',
    );
  }
  const wanted = wantedTileIds(rects);
  const slice = async (off: number, len: number) =>
    off + len <= head.length
      ? head.subarray(off, off + len)
      : fetchRange(http, planet.url, off, len, signal);

  const root = parseDirectory(
    await slice(source.rootDirOffset, source.rootDirLength),
    source.internalCompression,
  );
  const metadata =
    source.metadataLength > 0
      ? new Uint8Array(await slice(source.metadataOffset, source.metadataLength))
      : new Uint8Array(0);

  // Walk root -> leaves, only descending where a wanted tile id can live.
  const tiles: DirEntry[] = [];
  let level: DirEntry[][] = [root];
  while (level.length > 0) {
    const leaves: DirEntry[] = [];
    for (const dir of level) {
      dir.forEach((d, i) => {
        if (d.runLength > 0) {
          if (anyIdIn(wanted, d.tileId, d.tileId + d.runLength)) {
            tiles.push(d);
          }
        } else if (anyIdIn(wanted, d.tileId, dir[i + 1]?.tileId ?? Infinity)) {
          leaves.push(d);
        }
      });
    }
    level = await pool(leaves, LEAF_CONCURRENCY, async l =>
      parseDirectory(
        await fetchRange(http, planet.url, source.leafDirsOffset + l.offset, l.length, signal),
        source.internalCompression,
      ),
    );
  }
  tiles.sort((a, b) => a.tileId - b.tileId);

  // Unique tile blocks (the source dedupes identical tiles) in source order.
  const blockMap = new Map<number, AreaBlock>();
  for (const t of tiles) {
    if (!blockMap.has(t.offset)) {
      blockMap.set(t.offset, { oldOffset: t.offset, length: t.length, newOffset: 0 });
    }
  }
  const blocks = [...blockMap.values()].sort((a, b) => a.oldOffset - b.oldOffset);
  let dataBytes = 0;
  for (const b of blocks) {
    b.newOffset = dataBytes;
    dataBytes += b.length;
  }
  if (dataBytes > MAX_AREA_BYTES) {
    throw new ExtractError(
      'area_too_large',
      'That area is too large at this detail. Zoom in or choose less detail.',
    );
  }

  const entries: DirEntry[] = tiles.map(t => ({
    tileId: t.tileId,
    offset: blockMap.get(t.offset)!.newOffset,
    length: t.length,
    runLength: t.runLength,
  }));
  let clustered = true;
  let high = -1;
  for (const en of entries) {
    if (en.offset < high) {
      clustered = false;
    }
    high = Math.max(high, en.offset);
  }

  // Group blocks into range requests.
  const ranges: AreaRange[] = [];
  let fetchBytes = 0;
  for (const b of blocks) {
    const abs = source.tileDataOffset + b.oldOffset;
    const cur = ranges[ranges.length - 1];
    const curEnd = cur ? cur.start + cur.length : 0;
    if (cur && abs - curEnd <= GAP_BYTES && abs + b.length - cur.start <= MAX_REQUEST_BYTES) {
      cur.length = abs + b.length - cur.start;
      cur.blocks.push(b);
    } else {
      ranges.push({ start: abs, length: b.length, blocks: [b] });
    }
  }
  for (const r of ranges) {
    fetchBytes += r.length;
  }

  const { root: rootDir, leaves } = buildDirectories(entries, metadata.length);
  const rootDirOffset = PMTILES_HEADER_BYTES;
  const metadataOffset = rootDirOffset + rootDir.length;
  const leafDirsOffset = metadataOffset + metadata.length;
  const tileDataOffset = leafDirsOffset + leaves.length;
  const addressed = entries.reduce((a, d) => a + d.runLength, 0);
  const header: FullHeader = {
    rootDirOffset,
    rootDirLength: rootDir.length,
    metadataOffset,
    metadataLength: metadata.length,
    leafDirsOffset,
    leafDirsLength: leaves.length,
    tileDataOffset,
    tileDataLength: dataBytes,
    addressedTiles: addressed,
    tileEntries: entries.length,
    tileContents: blocks.length,
    clustered,
    internalCompression: COMPRESSION_GZIP,
    tileCompression: source.tileCompression,
    tileType: source.tileType,
    minZoom: source.minZoom,
    maxZoom: top,
    bounds: bbox,
    centerZoom: Math.min(top, 10),
    center: [(w + e) / 2, (s + n) / 2],
  };
  const prefix = new Uint8Array(tileDataOffset);
  prefix.set(writeFullHeader(header), 0);
  prefix.set(rootDir, rootDirOffset);
  prefix.set(metadata, metadataOffset);
  prefix.set(leaves, leafDirsOffset);

  return {
    planetUrl: planet.url,
    osmDataDate: planet.osmDataDate,
    bbox,
    minZoom: source.minZoom,
    maxZoom: top,
    tileCount: addressed,
    dataBytes,
    fetchBytes,
    fileBytes: tileDataOffset + dataBytes,
    source,
    prefix,
    ranges,
  };
}

/** Downloads the planned ranges and writes the new archive to `partUri`. Returns its size. */
export async function extractArea(
  { http, fs }: Deps,
  plan: AreaPlan,
  partUri: string,
  onProgress: (writtenTileBytes: number) => void,
  signal: AbortSignal,
): Promise<number> {
  const writer = await fs.openWriter(partUri, 'truncate');
  let written = 0;
  try {
    await writer.write(plan.prefix);
    for (const r of plan.ranges) {
      const bytes = await fetchRange(http, plan.planetUrl, r.start, r.length, signal);
      for (const b of r.blocks) {
        const at = plan.source.tileDataOffset + b.oldOffset - r.start;
        await writer.write(bytes.subarray(at, at + b.length));
        written += b.length;
      }
      onProgress(written);
    }
  } finally {
    await writer.close().catch(() => undefined);
  }
  return plan.prefix.length + written;
}
