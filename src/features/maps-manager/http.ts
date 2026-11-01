import { fetch as expoFetch } from 'expo/fetch';

/**
 * The only network client in the app (CLAUDE.md rule 6). It is constructed once in app/ and handed
 * to MapPackManager; nothing else may import it.
 */
export type StreamResponse = {
  status: number;
  /** lower-cased header names */
  headers: Record<string, string>;
  body: AsyncIterable<Uint8Array>;
};

export interface HttpClient {
  stream(
    url: string,
    opts: { headers?: Record<string, string>; signal?: AbortSignal },
  ): Promise<StreamResponse>;
  getJson(
    url: string,
    opts: { signal?: AbortSignal; timeoutMs?: number; headers?: Record<string, string> },
  ): Promise<unknown>;
}

export function createExpoHttpClient(): HttpClient {
  return {
    stream: async (url, { headers, signal }) => {
      const res = await expoFetch(url, { headers, signal });
      const out: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        out[k.toLowerCase()] = v;
      });
      async function* iterate(): AsyncGenerator<Uint8Array> {
        let stream: ReadableStream<Uint8Array> | null;
        try {
          stream = res.body;
        } catch {
          // No ReadableStream in this runtime: fall back to the whole body as one chunk.
          yield new Uint8Array(await res.arrayBuffer());
          return;
        }
        if (!stream) {
          return;
        }
        const reader = stream.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) {
              return;
            }
            if (value) {
              yield value;
            }
          }
        } finally {
          reader.releaseLock();
        }
      }
      return { status: res.status, headers: out, body: iterate() };
    },
    getJson: async (url, { signal, timeoutMs = 10_000, headers }) => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      const onAbort = () => ctl.abort();
      signal?.addEventListener('abort', onAbort);
      try {
        const res = await expoFetch(url, {
          signal: ctl.signal,
          headers: { accept: 'application/json', ...headers },
        });
        if (res.status < 200 || res.status >= 300) {
          throw new Error(`http_${res.status}`);
        }
        return await res.json();
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}
