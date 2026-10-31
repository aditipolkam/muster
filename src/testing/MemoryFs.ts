import { FilePort, FileWriter } from '../platform/FilePort';

/** In-memory FilePort for unit tests, with a configurable free-space number. */
export class MemoryFs implements FilePort {
  readonly root = 'file:///docs/';
  files = new Map<string, Uint8Array>();
  dirs = new Set<string>();
  free = 10 * 1024 ** 3;
  /** Hook: throw from writer.write after this many bytes written in total (simulates a crash). */
  failWritesAfter: number | null = null;
  private written = 0;

  async exists(uri: string) {
    return this.files.has(uri) || this.dirs.has(uri);
  }
  async size(uri: string) {
    return this.files.get(uri)?.length ?? 0;
  }
  async mkdirp(uri: string) {
    this.dirs.add(uri);
  }
  async remove(uri: string) {
    this.files.delete(uri);
    this.dirs.delete(uri);
  }
  async move(from: string, to: string) {
    const f = this.files.get(from);
    if (!f) {
      throw new Error(`move: missing ${from}`);
    }
    this.files.set(to, f);
    this.files.delete(from);
  }
  async readRange(uri: string, offset: number, length: number) {
    const f = this.files.get(uri);
    if (!f) {
      throw new Error(`read: missing ${uri}`);
    }
    return f.slice(offset, offset + length);
  }
  async readText(uri: string) {
    const f = this.files.get(uri);
    if (!f) {
      throw new Error(`read: missing ${uri}`);
    }
    return new TextDecoder().decode(f);
  }
  async writeBytes(uri: string, bytes: Uint8Array) {
    this.files.set(uri, bytes.slice());
  }
  async openWriter(uri: string, mode: 'truncate' | 'append'): Promise<FileWriter> {
    if (mode === 'truncate' || !this.files.has(uri)) {
      this.files.set(uri, new Uint8Array(0));
    }
    return {
      write: async bytes => {
        if (this.failWritesAfter !== null && this.written + bytes.length > this.failWritesAfter) {
          throw new Error('disk write failed');
        }
        this.written += bytes.length;
        const cur = this.files.get(uri) ?? new Uint8Array(0);
        const next = new Uint8Array(cur.length + bytes.length);
        next.set(cur);
        next.set(bytes, cur.length);
        this.files.set(uri, next);
      },
      close: async () => undefined,
    };
  }
  async freeBytes() {
    return this.free;
  }
  async dirSize(dirUri: string) {
    const prefix = dirUri.endsWith('/') ? dirUri : `${dirUri}/`;
    let n = 0;
    for (const [k, v] of this.files) {
      if (k.startsWith(prefix)) {
        n += v.length;
      }
    }
    return n;
  }
  async list(dirUri: string) {
    const prefix = dirUri.endsWith('/') ? dirUri : `${dirUri}/`;
    const names = new Set<string>();
    for (const k of this.files.keys()) {
      if (k.startsWith(prefix)) {
        names.add(k.slice(prefix.length).split('/')[0] as string);
      }
    }
    return [...names];
  }
}
