function normalizeHeight(height: number): number {
  return Number.isFinite(height) && height > 0 ? height : 0;
}

function normalizeBoundary(index: number, length: number): number {
  if (Number.isNaN(index) || index === Number.NEGATIVE_INFINITY) {
    return 0;
  }
  if (index === Number.POSITIVE_INFINITY) {
    return length;
  }
  return Math.min(length, Math.max(0, Math.trunc(index)));
}

function normalizeSpliceStart(start: number, length: number): number {
  if (Number.isNaN(start) || start === Number.NEGATIVE_INFINITY) {
    return 0;
  }
  if (start === Number.POSITIVE_INFINITY) {
    return length;
  }
  const integer = Math.trunc(start);
  return integer < 0
    ? Math.max(0, length + integer)
    : Math.min(length, integer);
}

function normalizeDeleteCount(deleteCount: number, available: number): number {
  if (
    Number.isNaN(deleteCount) ||
    deleteCount === Number.NEGATIVE_INFINITY
  ) {
    return 0;
  }
  if (deleteCount === Number.POSITIVE_INFINITY) {
    return available;
  }
  return Math.min(available, Math.max(0, Math.trunc(deleteCount)));
}

export class SourceHeightMap {
  private heights: number[] = [];
  private tree = new Float64Array(1);
  private total = 0;

  constructor(heights: readonly number[] = []) {
    this.replace(heights);
  }

  get length(): number {
    return this.heights.length;
  }

  get totalHeight(): number {
    return this.total;
  }

  replace(heights: readonly number[]): void {
    this.heights = Array.from(heights, normalizeHeight);
    this.rebuildTree();
  }

  heightAt(index: number): number {
    if (this.heights.length === 0) {
      return 0;
    }
    const clamped = Math.min(
      this.heights.length - 1,
      normalizeBoundary(index, this.heights.length),
    );
    return this.heights[clamped]!;
  }

  indexAtOffset(offset: number): number {
    if (this.heights.length === 0) {
      return 0;
    }
    if (this.total === 0) {
      return 0;
    }

    const target = Number.isNaN(offset)
      ? 0
      : Math.min(this.total, Math.max(0, offset));
    if (target >= this.total) {
      return this.heights.length - 1;
    }

    let index = 0;
    let accumulated = 0;
    let step = 1;
    while (step * 2 < this.tree.length) {
      step *= 2;
    }

    for (; step > 0; step >>= 1) {
      const next = index + step;
      if (
        next < this.tree.length &&
        accumulated + this.tree[next]! <= target
      ) {
        index = next;
        accumulated += this.tree[next]!;
      }
    }

    return Math.min(index, this.heights.length - 1);
  }

  offsetAtIndex(index: number): number {
    const boundary = normalizeBoundary(index, this.heights.length);
    let sum = 0;
    for (let cursor = boundary; cursor > 0; cursor -= cursor & -cursor) {
      sum += this.tree[cursor]!;
    }
    return sum;
  }

  update(index: number, height: number): void {
    if (!Number.isFinite(index)) {
      return;
    }
    const target = Math.trunc(index);
    if (target < 0 || target >= this.heights.length) {
      return;
    }

    const next = normalizeHeight(height);
    const delta = next - this.heights[target]!;
    if (delta === 0) {
      return;
    }

    this.heights[target] = next;
    this.total += delta;
    for (
      let cursor = target + 1;
      cursor < this.tree.length;
      cursor += cursor & -cursor
    ) {
      this.tree[cursor] = this.tree[cursor]! + delta;
    }
  }

  splice(
    start: number,
    deleteCount: number,
    newHeights: readonly number[],
  ): void {
    const target = normalizeSpliceStart(start, this.heights.length);
    const removal = normalizeDeleteCount(
      deleteCount,
      this.heights.length - target,
    );
    this.heights.splice(
      target,
      removal,
      ...Array.from(newHeights, normalizeHeight),
    );
    this.rebuildTree();
  }

  private rebuildTree(): void {
    this.tree = new Float64Array(this.heights.length + 1);
    this.total = 0;
    for (let index = 0; index < this.heights.length; index += 1) {
      const height = this.heights[index]!;
      this.total += height;
      this.tree[index + 1] = this.tree[index + 1]! + height;
      const parent = index + 1 + ((index + 1) & -(index + 1));
      if (parent < this.tree.length) {
        this.tree[parent] = this.tree[parent]! + this.tree[index + 1]!;
      }
    }
  }
}
