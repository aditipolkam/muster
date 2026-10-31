/** Bounded "have I seen this id" set. Oldest ids are evicted first. The SDK dedupes 5,000 ids; so do we. */
export class SeenIds {
  private ids = new Set<string>();

  constructor(private readonly capacity = 5000) {}

  /** Returns true when `id` was new (and records it), false for a duplicate. */
  add(id: string): boolean {
    if (this.ids.has(id)) {
      return false;
    }
    this.ids.add(id);
    if (this.ids.size > this.capacity) {
      const oldest = this.ids.values().next().value;
      if (oldest !== undefined) {
        this.ids.delete(oldest);
      }
    }
    return true;
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  get size(): number {
    return this.ids.size;
  }
}
