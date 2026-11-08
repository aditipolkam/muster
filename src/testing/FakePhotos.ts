import { PhotoPort } from '../platform/PhotoPort';
import { Result, ok } from '../shared/result';

/** TEST ONLY: returns what the test queued, or "cancelled" when nothing is queued. */
export class FakePhotos implements PhotoPort {
  next: Result<string | null> = ok(null);
  picks = 0;
  discarded: string[] = [];

  async pick(): Promise<Result<string | null>> {
    this.picks++;
    return this.next;
  }

  async discard(uri: string): Promise<void> {
    this.discarded.push(uri);
  }
}
