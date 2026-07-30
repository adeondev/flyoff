export interface BenchmarkResult {
  iterations: number;
  maximumIndex: number;
  maximumMs: number;
  medianMs: number;
  minimumMs: number;
  p95Ms: number;
  p99Ms: number;
  standardDeviationMs: number;
}

export interface ScrollBenchmark {
  frameTime: BenchmarkResult;
  stepPx: number;
}

function quantile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)
  ]!;
}

export function summarize(samples: readonly number[]): BenchmarkResult {
  const sorted = [...samples].sort((left, right) => left - right);
  const maximumMs = sorted.at(-1) ?? 0;
  const mean =
    sorted.reduce((total, value) => total + value, 0) /
    Math.max(1, sorted.length);
  const variance =
    sorted.reduce((total, value) => total + (value - mean) ** 2, 0) /
    Math.max(1, sorted.length);
  return {
    iterations: sorted.length,
    // Which sample spiked says more than the spike itself: a first-frame
    // outlier is a warm-up, a mid-pass one is work landing on the wrong frame.
    maximumIndex: samples.indexOf(maximumMs),
    maximumMs,
    medianMs: quantile(sorted, 0.5),
    minimumMs: sorted[0] ?? 0,
    p95Ms: quantile(sorted, 0.95),
    // Only meaningful with enough samples; reported as the maximum otherwise.
    p99Ms: quantile(sorted, 0.99),
    standardDeviationMs: Math.sqrt(variance),
  };
}

export function forceLayout(element: HTMLElement): void {
  void element.offsetHeight;
  void element.scrollHeight;
}

export function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) =>
    requestAnimationFrame(() => resolve()),
  );
}

/**
 * Yield to the task queue, not only to the next frame.
 *
 * Resolving inside a `requestAnimationFrame` callback continues on a microtask,
 * still inside that same callback, so nothing an editor defers to a task ever
 * runs. Real keys arrive as separate tasks with the queue drained between them;
 * every editor in this benchmark is paced the same way.
 */
export function nextTask(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * Scroll at a rate a person can actually produce.
 *
 * The full-pass scroll covers the whole document in 120 frames, which on a
 * 20.000 line note is about 1.900 px per frame — far more than the mounted
 * window, so every frame remounts all of it. That is a useful worst case but
 * it is not what a wheel or a trackpad does. A wheel notch is roughly 100 px,
 * so this pass keeps the window mostly intact between frames and reports what
 * ordinary reading costs.
 */
export async function benchmarkWheelScroll(
  target: HTMLElement,
  stepPx = 120,
): Promise<ScrollBenchmark> {
  target.scrollTop = 0;
  target.dispatchEvent(new Event('scroll'));
  await nextFrame();
  await nextFrame();

  const samples: number[] = [];
  let previous = performance.now();
  for (let index = 1; index <= 90; index += 1) {
    target.scrollTop = stepPx * index;
    target.dispatchEvent(new Event('scroll'));
    await nextFrame();
    const current = performance.now();
    samples.push(current - previous);
    previous = current;
  }

  return { frameTime: summarize(samples), stepPx };
}

export async function benchmarkFlingScroll(
  target: HTMLElement,
  frames = 120,
): Promise<BenchmarkResult> {
  target.scrollTop = 0;
  await nextFrame();
  await nextFrame();
  const distancePx = Math.max(0, target.scrollHeight - target.clientHeight);
  const samples: number[] = [];
  let previous = performance.now();
  for (let index = 1; index <= frames; index += 1) {
    target.scrollTop = (distancePx * index) / frames;
    await nextFrame();
    const current = performance.now();
    samples.push(current - previous);
    previous = current;
  }
  return summarize(samples);
}
