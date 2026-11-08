import type { Result } from '../shared/result';

/**
 * Attach a photo from the person's own library. The file is copied into this app's storage, so
 * it stays when the original is deleted, and it never leaves the phone. `null` means they
 * cancelled. Behind an interface so screens can be tested without a device.
 */
export interface PhotoPort {
  pick(): Promise<Result<string | null>>;
  /** Delete a file this port created. Idempotent. */
  discard(uri: string): Promise<void>;
}
