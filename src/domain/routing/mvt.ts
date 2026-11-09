/* eslint-disable no-bitwise -- binary decoding and heap index maths */
/**
 * Minimal Mapbox Vector Tile (MVT v2) decoder: just enough to read line features of one layer.
 * Pure TypeScript, no dependency. Spec: https://github.com/mapbox/vector-tile-spec
 */

export type TileLine = {
  /** Tag values that matter for walking (kind, kind_detail, access, name). */
  props: Record<string, string | number | boolean>;
  /** One or more parts, each a list of [x, y] in tile pixels (0..extent, may go past by the buffer). */
  parts: [number, number][][];
};

export type DecodedLayer = { extent: number; lines: TileLine[] };

class Reader {
  pos = 0;
  constructor(readonly buf: Uint8Array, readonly end = buf.length) {}
  varint(): number {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      if (this.pos >= this.end) {
        throw new Error('mvt: truncated varint');
      }
      b = this.buf[this.pos++]!;
      result += (b & 0x7f) * Math.pow(2, shift);
      shift += 7;
    } while (b >= 0x80);
    return result;
  }
  skip(wire: number): void {
    if (wire === 0) {
      this.varint();
    } else if (wire === 1) {
      this.pos += 8;
    } else if (wire === 2) {
      this.pos += this.varint();
    } else if (wire === 5) {
      this.pos += 4;
    } else {
      throw new Error(`mvt: unsupported wire type ${wire}`);
    }
  }
  bytes(): Uint8Array {
    const len = this.varint();
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }
  sub(): Reader {
    const len = this.varint();
    const r = new Reader(this.buf, this.pos + len);
    r.pos = this.pos;
    this.pos += len;
    return r;
  }
}

const utf8 = (b: Uint8Array): string => {
  // Tag strings are short; a hand decoder avoids depending on TextDecoder in Hermes.
  let s = '';
  for (let i = 0; i < b.length; ) {
    const c = b[i++]!;
    if (c < 0x80) {
      s += String.fromCharCode(c);
    } else if (c < 0xe0) {
      s += String.fromCharCode(((c & 0x1f) << 6) | (b[i++]! & 0x3f));
    } else if (c < 0xf0) {
      s += String.fromCharCode(((c & 0x0f) << 12) | ((b[i++]! & 0x3f) << 6) | (b[i++]! & 0x3f));
    } else {
      const cp =
        ((c & 0x07) << 18) | ((b[i++]! & 0x3f) << 12) | ((b[i++]! & 0x3f) << 6) | (b[i++]! & 0x3f);
      const v = cp - 0x10000;
      s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    }
  }
  return s;
};

const zigzag = (n: number) => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);

function readValue(r: Reader): string | number | boolean {
  let v: string | number | boolean = '';
  while (r.pos < r.end) {
    const tag = r.varint();
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (field === 1) {
      v = utf8(r.bytes());
    } else if (field === 2) {
      v = new DataView(r.buf.buffer, r.buf.byteOffset + r.pos, 4).getFloat32(0, true);
      r.pos += 4;
    } else if (field === 3) {
      v = new DataView(r.buf.buffer, r.buf.byteOffset + r.pos, 8).getFloat64(0, true);
      r.pos += 8;
    } else if (field === 4 || field === 5) {
      v = r.varint();
    } else if (field === 6) {
      v = zigzag(r.varint());
    } else if (field === 7) {
      v = r.varint() !== 0;
    } else {
      r.skip(wire);
    }
  }
  return v;
}

function packed(r: Reader): number[] {
  const sub = r.sub();
  const out: number[] = [];
  while (sub.pos < sub.end) {
    out.push(sub.varint());
  }
  return out;
}

function lineParts(cmds: number[]): [number, number][][] {
  const parts: [number, number][][] = [];
  let x = 0;
  let y = 0;
  let cur: [number, number][] | null = null;
  for (let i = 0; i < cmds.length; ) {
    const c = cmds[i++]!;
    const id = c & 7;
    const count = c >> 3;
    if (id === 1 || id === 2) {
      for (let k = 0; k < count; k++) {
        x += zigzag(cmds[i++]!);
        y += zigzag(cmds[i++]!);
        if (id === 1) {
          cur = [[x, y]];
          parts.push(cur);
        } else {
          cur?.push([x, y]);
        }
      }
    }
    // ClosePath (7) has no parameters and only occurs in polygons.
  }
  return parts.filter(p => p.length >= 2);
}

/** Line features of `layerName` in one (uncompressed) MVT tile, keeping only `keep` tags. */
export function decodeLines(
  tile: Uint8Array,
  layerName: string,
  keep: readonly string[],
): DecodedLayer | null {
  const r = new Reader(tile);
  while (r.pos < r.end) {
    const tag = r.varint();
    if (tag >> 3 !== 3 || (tag & 7) !== 2) {
      r.skip(tag & 7);
      continue;
    }
    const layer = r.sub();
    let name = '';
    let extent = 4096;
    const keys: string[] = [];
    const values: (string | number | boolean)[] = [];
    const feats: { tags: number[]; type: number; geom: number[] }[] = [];
    while (layer.pos < layer.end) {
      const t = layer.varint();
      const field = t >> 3;
      if (field === 1) {
        name = utf8(layer.bytes());
      } else if (field === 2) {
        const f = layer.sub();
        const feat = { tags: [] as number[], type: 0, geom: [] as number[] };
        while (f.pos < f.end) {
          const ft = f.varint();
          const ff = ft >> 3;
          if (ff === 2) {
            feat.tags = packed(f);
          } else if (ff === 3) {
            feat.type = f.varint();
          } else if (ff === 4) {
            feat.geom = packed(f);
          } else {
            f.skip(ft & 7);
          }
        }
        feats.push(feat);
      } else if (field === 3) {
        keys.push(utf8(layer.bytes()));
      } else if (field === 4) {
        values.push(readValue(layer.sub()));
      } else if (field === 5) {
        extent = layer.varint();
      } else {
        layer.skip(t & 7);
      }
    }
    if (name !== layerName) {
      continue;
    }
    const lines: TileLine[] = [];
    for (const f of feats) {
      if (f.type !== 2) {
        continue;
      }
      const props: Record<string, string | number | boolean> = {};
      for (let i = 0; i + 1 < f.tags.length; i += 2) {
        const k = keys[f.tags[i]!];
        if (k !== undefined && keep.includes(k)) {
          props[k] = values[f.tags[i + 1]!] ?? '';
        }
      }
      const parts = lineParts(f.geom);
      if (parts.length > 0) {
        lines.push({ props, parts });
      }
    }
    return { extent, lines };
  }
  return null;
}
