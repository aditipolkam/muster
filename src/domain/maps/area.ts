import { BBox } from '../geo';
import { FullHeader } from './pmtilesDir';

export type AreaBlock = { oldOffset: number; length: number; newOffset: number };
export type AreaRange = { start: number; length: number; blocks: AreaBlock[] };

export type AreaPlan = {
  planetUrl: string;
  osmDataDate: string;
  bbox: BBox;
  minZoom: number;
  maxZoom: number;
  /** Tiles addressed by the new archive. */
  tileCount: number;
  /** Tile bytes to keep. */
  dataBytes: number;
  /** Bytes that will cross the network, gaps included. */
  fetchBytes: number;
  /** Size of the finished file. */
  fileBytes: number;
  source: FullHeader;
  /** Everything before the tile data: header, root directory, metadata, leaf directories. */
  prefix: Uint8Array;
  ranges: AreaRange[];
};
