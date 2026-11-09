/* eslint-disable no-bitwise -- binary decoding and heap index maths */
import { distanceM } from '../geo';
import type { WalkGraph } from './graph';

/** Gives up after this many node expansions so a huge graph cannot stall the phone. */
export const MAX_EXPANSIONS = 500_000;

/** Binary min-heap of node ids keyed by f-score. */
class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, key: number) {
    this.ids.push(id);
    this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p]! <= this.keys[i]!) {
        break;
      }
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.ids[0]!;
    const lastId = this.ids.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.ids.length && this.keys[l]! < this.keys[m]!) {
          m = l;
        }
        if (r < this.ids.length && this.keys[r]! < this.keys[m]!) {
          m = r;
        }
        if (m === i) {
          break;
        }
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.ids[a], this.ids[b]] = [this.ids[b]!, this.ids[a]!];
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
  }
}

/**
 * A* over the walking graph. Edge weights are length x a walking factor >= 1, so straight-line
 * distance never overestimates and the result is the cheapest path. Returns node ids from start
 * to goal, or null when they are not connected (or the search gives up).
 */
export function aStar(g: WalkGraph, start: number, goal: number): number[] | null {
  const n = g.nodeCount;
  const gs = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const target = g.at(goal);
  const h = (id: number) => distanceM(g.at(id), target);
  const open = new Heap();
  gs[start] = 0;
  open.push(start, h(start));
  let expansions = 0;
  while (open.size > 0) {
    const cur = open.pop();
    if (cur === goal) {
      const path = [cur];
      let p = from[cur]!;
      while (p !== -1) {
        path.push(p);
        p = from[p]!;
      }
      return path.reverse();
    }
    if (closed[cur]) {
      continue;
    }
    closed[cur] = 1;
    if (++expansions > MAX_EXPANSIONS) {
      return null;
    }
    for (const e of g.adj[cur]!) {
      if (closed[e.to]) {
        continue;
      }
      const tentative = gs[cur]! + e.w;
      if (tentative < gs[e.to]!) {
        gs[e.to] = tentative;
        from[e.to] = cur;
        open.push(e.to, tentative + h(e.to));
      }
    }
  }
  return null;
}
