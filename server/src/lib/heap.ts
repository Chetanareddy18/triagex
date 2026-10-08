/**
 * Array-backed binary heap. `compare(a, b) < 0` means `a` has higher priority
 * (comes out first), so `(a, b) => a - b` gives a min-heap.
 *
 *   push / pop   O(log n)
 *   peek / size  O(1)
 *   from(items)  O(n)  (bottom-up heapify)
 */
export type Comparator<T> = (a: T, b: T) => number;

export class BinaryHeap<T> {
  private readonly items: T[] = [];

  constructor(private readonly compare: Comparator<T>) {}

  static from<T>(values: Iterable<T>, compare: Comparator<T>): BinaryHeap<T> {
    const heap = new BinaryHeap(compare);
    heap.items.push(...values);
    for (let i = (heap.items.length >> 1) - 1; i >= 0; i--) heap.siftDown(i);
    return heap;
  }

  get size(): number {
    return this.items.length;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  push(value: T): void {
    this.items.push(value);
    this.siftUp(this.items.length - 1);
  }

  pop(): T | undefined {
    const { items } = this;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop() as T;
    if (items.length > 0) {
      items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  /** Drains the heap in priority order (destructive). */
  drain(): T[] {
    const out: T[] = [];
    while (!this.isEmpty()) out.push(this.pop() as T);
    return out;
  }

  private siftUp(index: number): void {
    const { items, compare } = this;
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (compare(items[i], items[parent]) >= 0) break;
      [items[i], items[parent]] = [items[parent], items[i]];
      i = parent;
    }
  }

  private siftDown(index: number): void {
    const { items, compare } = this;
    const n = items.length;
    let i = index;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let best = i;
      if (left < n && compare(items[left], items[best]) < 0) best = left;
      if (right < n && compare(items[right], items[best]) < 0) best = right;
      if (best === i) return;
      [items[i], items[best]] = [items[best], items[i]];
      i = best;
    }
  }
}
