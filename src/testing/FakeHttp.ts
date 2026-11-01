import { HttpClient, StreamResponse } from '../features/maps-manager/http';

export type Served = { bytes: Uint8Array; ignoreRange?: boolean };

/**
 * In-memory HttpClient. Serves files with Range support, and can fail mid-stream, to drive the
 * MapPackManager resume logic deterministically.
 */
export class FakeHttp implements HttpClient {
  files = new Map<string, Served>();
  json = new Map<string, unknown>();
  requests: { url: string; range: string | null }[] = [];
  /** Throw after this many bytes of the next stream, once. */
  failNextAfter: number | null = null;
  /** Hang forever after this many bytes of the next stream (until aborted), once. */
  stallNextAfter: number | null = null;
  chunk = 1024;
  offline = false;

  async getJson(url: string): Promise<unknown> {
    this.requests.push({ url, range: null });
    if (this.offline || !this.json.has(url)) {
      throw new Error('network unreachable');
    }
    return this.json.get(url);
  }

  async stream(
    url: string,
    opts: { headers?: Record<string, string>; signal?: AbortSignal },
  ): Promise<StreamResponse> {
    const range = opts.headers?.Range ?? null;
    this.requests.push({ url, range });
    if (this.offline) {
      throw new Error('network unreachable');
    }
    const f = this.files.get(url);
    if (!f) {
      return { status: 404, headers: {}, body: (async function* () {})() };
    }
    let start = 0;
    let status = 200;
    const headers: Record<string, string> = {};
    const m = range ? /^bytes=(\d+)-(\d*)/.exec(range) : null;
    let stop = f.bytes.length;
    if (m && !f.ignoreRange) {
      start = Number(m[1]);
      if (start >= f.bytes.length) {
        return { status: 416, headers: {}, body: (async function* () {})() };
      }
      if (m[2]) {
        stop = Math.min(f.bytes.length, Number(m[2]) + 1);
      }
      status = 206;
      headers['content-range'] = `bytes ${start}-${stop - 1}/${f.bytes.length}`;
    }
    const failAfter = this.failNextAfter;
    const stallAfter = this.stallNextAfter;
    this.failNextAfter = null;
    this.stallNextAfter = null;
    const chunk = this.chunk;
    async function* body() {
      let sent = 0;
      for (let o = start; o < stop; o += chunk) {
        if (opts.signal?.aborted) {
          throw new Error('aborted');
        }
        if (failAfter !== null && sent >= failAfter) {
          throw new Error('connection reset');
        }
        if (stallAfter !== null && sent >= stallAfter) {
          await new Promise<void>((_, rej) => {
            opts.signal?.addEventListener('abort', () => rej(new Error('aborted')));
          });
        }
        const piece = f!.bytes.slice(o, Math.min(o + chunk, stop));
        sent += piece.length;
        yield piece;
        await Promise.resolve();
      }
    }
    return { status, headers, body: body() };
  }
}
