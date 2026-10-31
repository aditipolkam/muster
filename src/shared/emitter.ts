export type Unsubscribe = () => void;

export class Emitter<T = void> {
  private handlers = new Set<(v: T) => void>();

  subscribe(fn: (v: T) => void): Unsubscribe {
    this.handlers.add(fn);
    return () => {
      this.handlers.delete(fn);
    };
  }

  emit(v: T): void {
    for (const h of [...this.handlers]) {
      h(v);
    }
  }

  get size(): number {
    return this.handlers.size;
  }
}
