import { sha256 } from '@noble/hashes/sha2.js';
import { FilePort } from '../../platform/FilePort';

const CHUNK = 1024 * 1024;

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

/**
 * Streaming SHA-256 of a file in 1 MiB reads. Pure JS (@noble/hashes): slower than a native hash
 * on Hermes, so it yields to the event loop between chunks and reports progress.
 */
export async function sha256File(
  fs: FilePort,
  uri: string,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const total = await fs.size(uri);
  const h = sha256.create();
  for (let off = 0; off < total; off += CHUNK) {
    if (signal?.aborted) {
      throw new Error('aborted');
    }
    h.update(await fs.readRange(uri, off, Math.min(CHUNK, total - off)));
    onProgress?.(Math.min(off + CHUNK, total), total);
    await new Promise<void>(r => setTimeout(r, 0));
  }
  return hex(h.digest());
}

export function sha256Bytes(bytes: Uint8Array): string {
  return hex(sha256(bytes));
}
