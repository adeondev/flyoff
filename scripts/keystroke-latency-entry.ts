import { setLocalSourceChangePathEnabled } from '../src/renderer/projects/source-document-model';
import { SOURCE_INPUT_MIRROR_MAX_CODE_UNITS } from '../src/renderer/projects/source-engine/source-input-mirror';
import { WindowedSourceView } from '../src/renderer/projects/source-engine/windowed-source-view';

/**
 * Per-keystroke phase breakdown for the windowed source editor.
 *
 * The aggregate benchmark answers "how long is a key"; this answers "which part
 * of a key, on which keys". Every sample is kept, so the distribution and the
 * individual spikes survive instead of collapsing into three quantiles.
 *
 * Phases are timed by shadowing the view's own methods on the instance. A class
 * method called as `this.method()` resolves through the instance first, so an
 * own property wraps it without touching the engine or changing what runs.
 */

interface KeystrokeProfile {
  ablation: string;
  fixture: { characters: number; lines: number };
  gc: {
    collections: number;
    /** Heap growth per keystroke, bytes, when the heap did not collect. */
    growthMedianBytes: number;
    heapEndBytes: number;
    heapStartBytes: number;
    /** Indexes of keystrokes during which the heap shrank. */
    collectionIndexes: number[];
    /** Bytes charged to each phase, only when `heapPhases` is on. */
    phaseBytes?: {
      flatten: number;
      readInputEdit: number;
      rest: number;
      setSource: number;
    };
  };
  histogramMs: { count: number; upperMs: number }[];
  phases: Record<
    string,
    {
      maximumMs: number;
      medianMs: number;
      p95Ms: number;
      p99Ms: number;
      totalMs: number;
    }
  >;
  samples: number;
  /** The slowest keystrokes, with every phase, so a spike can be explained. */
  slowest: { index: number; phases: Record<string, number>; totalMs: number }[];
  total: {
    maximumMs: number;
    medianMs: number;
    minimumMs: number;
    p95Ms: number;
    p99Ms: number;
    standardDeviationMs: number;
  };
}

declare global {
  interface Window {
    runKeystrokeLatencyProfile: (
      lineCount: number,
      options?: {
        ablation?: string;
        heapPhases?: boolean;
        samples?: number;
      },
    ) => Promise<KeystrokeProfile>;
  }
  interface Performance {
    memory?: {
      jsHeapSizeLimit: number;
      totalJSHeapSize: number;
      usedJSHeapSize: number;
    };
  }
}

const PHASES = [
  'inputMutation',
  'inputRead',
  'flatten',
  'model',
  'syncInputMirror',
  'heightMap',
  'sourceMetrics',
  'reconcileLines',
  'measureLines',
  'paintSelection',
  'renderOther',
  'setSourceOther',
  'reveal',
  'layout',
] as const;

/**
 * `ascii` drops every accented character. V8 can then keep the document in a
 * one-byte representation, which halves the bytes a keystroke has to
 * re-materialise — the ablation that shows how much of the tail is the document
 * copy rather than the editing work itself.
 */
function representativeSource(lineCount: number): string {
  const lines: string[] = [];
  for (let index = 0; index < lineCount; index += 1) {
    if (index % 9 === 0) {
      lines.push(
        `${'#'.repeat((index % 5) + 1)} Seção ${index}: sociedade, religião e poder`,
      );
    } else if (index >= 220 && index < 280) {
      lines.push(`| Dinastia ${index - 219} | Período ${index} | Evidência |`);
    } else if (index % 4 === 0) {
      lines.push(
        `- Item ${index}: administração, comércio e **vida cotidiana**.`,
      );
    } else {
      lines.push(
        `Registro ${index}: política, religião e vida cotidiana no período.`,
      );
    }
  }
  return lines.join('\n');
}

/** Same shape, same length, no character above U+00FF. */
function asciiSource(lineCount: number): string {
  const lines: string[] = [];
  for (let index = 0; index < lineCount; index += 1) {
    if (index % 9 === 0) {
      lines.push(
        `${'#'.repeat((index % 5) + 1)} Secao ${index}: sociedade, religiao e poder`,
      );
    } else if (index >= 220 && index < 280) {
      lines.push(`| Dinastia ${index - 219} | Periodo ${index} | Evidencia |`);
    } else if (index % 4 === 0) {
      lines.push(
        `- Item ${index}: administracao, comercio e **vida cotidiana**.`,
      );
    } else {
      lines.push(
        `Registro ${index}: politica, religiao e vida cotidiana no periodo.`,
      );
    }
  }
  return lines.join('\n');
}

function host(): { host: HTMLElement; target: HTMLDivElement } {
  const shell = document.createElement('main');
  const body = document.createElement('div');
  const source = document.createElement('div');
  const target = document.createElement('div');
  shell.className = 'markdown-editor';
  shell.style.width = '1000px';
  shell.style.height = '650px';
  body.className = 'markdown-editor__body markdown-editor__body--edit';
  source.className = 'markdown-source';
  target.className = 'markdown-source__editor';
  target.dataset.windowed = 'true';
  source.appendChild(target);
  body.appendChild(source);
  shell.appendChild(body);
  document.body.appendChild(shell);
  return { host: shell, target };
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function quantile(sorted: readonly number[], ratio: number): number {
  return sorted.length === 0
    ? 0
    : sorted[
        Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)
      ]!;
}

function describe(values: Float64Array | number[]) {
  const list = Array.from(values);
  const sorted = [...list].sort((left, right) => left - right);
  const total = list.reduce((sum, value) => sum + value, 0);
  const mean = total / Math.max(1, list.length);
  return {
    maximumMs: sorted.at(-1) ?? 0,
    medianMs: quantile(sorted, 0.5),
    minimumMs: sorted[0] ?? 0,
    p95Ms: quantile(sorted, 0.95),
    p99Ms: quantile(sorted, 0.99),
    standardDeviationMs: Math.sqrt(
      list.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        Math.max(1, list.length),
    ),
    totalMs: total,
  };
}

/** Log-ish buckets: the interesting structure is in the tail, not the middle. */
const HISTOGRAM_EDGES = [
  0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 15, 20, 30, 50, Infinity,
];

function histogram(values: Float64Array) {
  const buckets = HISTOGRAM_EDGES.map((upperMs) => ({ count: 0, upperMs }));
  for (const value of values) {
    const bucket = buckets.find((entry) => value <= entry.upperMs);
    if (bucket) {
      bucket.count += 1;
    }
  }
  return buckets.filter((bucket) => bucket.count > 0);
}

interface Timers {
  [phase: string]: number;
}

/** Median over the samples that grew, ignoring the ones a collection crossed. */
function positiveMedian(values: Float64Array): number {
  const positive = [...values].filter((value) => value > 0);
  positive.sort((left, right) => left - right);
  return Math.round(positive[positive.length >> 1] ?? 0);
}

window.runKeystrokeLatencyProfile = async (lineCount, options = {}) => {
  document.body.style.margin = '0';
  const ablation = options.ablation ?? 'none';
  const sampleCount = options.samples ?? 200;
  const heapPhases = options.heapPhases ?? false;
  const warmup = 20;
  // `derive-change` turns off the line-local edit path, so the same run can be
  // compared against the model deriving the change from the document text.
  setLocalSourceChangePathEnabled(ablation !== 'derive-change');
  const source =
    ablation === 'ascii'
      ? asciiSource(lineCount)
      : representativeSource(lineCount);
  const shell = host();
  const view = new WindowedSourceView(shell.target, {
    ariaLabel: 'Profile',
    readOnly: false,
    selection: { direction: 'none', end: 0, start: 0 },
    source,
  });

  const internals = view as unknown as Record<string, (...args: never[]) => unknown>;
  const pending: Timers = {};
  function wrap(name: string, bucket: string): void {
    const original = internals[name]!.bind(view);
    (internals as Record<string, unknown>)[name] = (...args: never[]) => {
      const startedAt = performance.now();
      try {
        return original(...args);
      } finally {
        pending[bucket] = (pending[bucket] ?? 0) + (performance.now() - startedAt);
      }
    };
  }

  wrap('syncInputMirror', 'syncInputMirror');
  wrap('rebuildHeightMap', 'heightMap');
  wrap('updateSingleLineHeight', 'heightMap');
  wrap('updateSourceMetrics', 'sourceMetrics');
  wrap('reconcileLines', 'reconcileLines');
  wrap('measureLines', 'measureLines');
  wrap('paintSelection', 'paintSelection');

  // `render` is wrapped separately: its own time is what is left after the
  // pieces above, which are called from inside it.
  const originalRender = internals.render!.bind(view);
  (internals as Record<string, unknown>).render = (...args: never[]) => {
    const before =
      (pending.reconcileLines ?? 0) +
      (pending.measureLines ?? 0) +
      (pending.paintSelection ?? 0);
    const startedAt = performance.now();
    try {
      return originalRender(...args);
    } finally {
      const inner =
        (pending.reconcileLines ?? 0) +
        (pending.measureLines ?? 0) +
        (pending.paintSelection ?? 0) -
        before;
      pending.renderOther =
        (pending.renderOther ?? 0) + (performance.now() - startedAt) - inner;
    }
  };

  shell.target.scrollTop = 0;
  void shell.target.offsetHeight;
  await nextFrame();

  const marker = 'vida cotidiana';
  const editOffset = Math.max(
    0,
    source.indexOf(marker, Math.floor(source.length / 3)),
  );
  const samples: Record<string, Float64Array> = {};
  for (const phase of PHASES) {
    samples[phase] = new Float64Array(sampleCount);
  }
  const totals = new Float64Array(sampleCount);
  const heap = new Float64Array(sampleCount + 1);
  const readHeap = () => performance.memory?.usedJSHeapSize ?? 0;
  // Heap readings between the phase boundaries, so the bytes can be charged to
  // a phase the same way the milliseconds are. Off by default: each reading is
  // a call into the host and four of them per key move the timings.
  const heapPhasesEnabled = heapPhases;
  const heapInputRead = new Float64Array(sampleCount);
  const heapFlatten = new Float64Array(sampleCount);
  const heapSetSource = new Float64Array(sampleCount);
  const heapRest = new Float64Array(sampleCount);

  let currentSource = source;
  let replacedLength = marker.length;
  const before = source.slice(0, editOffset);
  const after = source.slice(editOffset + marker.length);

  heap[0] = readHeap();
  for (let iteration = 0; iteration < warmup + sampleCount; iteration += 1) {
    const index = iteration - warmup;
    const inserted = `vida cotidiana ${iteration}`;
    view.writeSelection({
      direction: 'forward',
      end: editOffset + replacedLength,
      start: editOffset,
    });
    const mirror = view.captureInputMirror();
    if (view.input.value.length > SOURCE_INPUT_MIRROR_MAX_CODE_UNITS) {
      throw new Error('input mirror is not bounded');
    }
    for (const phase of PHASES) {
      pending[phase] = 0;
    }

    const h0 = heapPhasesEnabled ? readHeap() : 0;
    const t0 = performance.now();
    view.input.setRangeText(
      inserted,
      mirror.selectionStart,
      mirror.selectionEnd,
      'end',
    );
    const t1 = performance.now();
    const h1 = heapPhasesEnabled ? readHeap() : 0;
    const edit = view.readInputEdit(currentSource, mirror);
    const t2 = performance.now();
    const h2 = heapPhasesEnabled ? readHeap() : 0;
    // Attribute the whole-document flatten explicitly: V8 keeps the new text as
    // a rope until the first character read, and that read would otherwise land
    // inside `setSource` and be charged to the model.
    const flattenProbe = edit.content.charCodeAt(0);
    const t3 = performance.now();
    const h3 = heapPhasesEnabled ? readHeap() : 0;
    view.setSource(edit.content, edit.selection, {
      change: ablation === 'no-change-hint' ? undefined : edit.change,
      nextSelection: edit.selection,
      previousSelection: {
        end: editOffset + replacedLength,
        start: editOffset,
      },
    });
    const t4 = performance.now();
    const h4 = heapPhasesEnabled ? readHeap() : 0;
    view.revealOffset(edit.selection.end);
    const t5 = performance.now();
    void shell.target.offsetHeight;
    void shell.target.scrollHeight;
    const t6 = performance.now();
    if (flattenProbe < 0) {
      throw new Error('unreachable');
    }

    currentSource = edit.content;
    replacedLength = inserted.length;
    // Only the length here. Comparing two million-character strings per
    // keystroke materialises both of them, and that allocation is the harness's,
    // not the editor's — it hid the real per-key figure completely. The full
    // comparison runs once, after the loop.
    const expectedLength =
      before.length + inserted.length + after.length;
    if (
      currentSource.length !== expectedLength ||
      view.getModel().source.length !== expectedLength
    ) {
      throw new Error('keystroke profile lost the complete model');
    }

    if (index >= 0) {
      const wrapped =
        (pending.syncInputMirror ?? 0) +
        (pending.heightMap ?? 0) +
        (pending.sourceMetrics ?? 0) +
        (pending.reconcileLines ?? 0) +
        (pending.measureLines ?? 0) +
        (pending.paintSelection ?? 0) +
        (pending.renderOther ?? 0);
      samples.inputMutation![index] = t1 - t0;
      samples.inputRead![index] = t2 - t1;
      samples.flatten![index] = t3 - t2;
      samples.syncInputMirror![index] = pending.syncInputMirror ?? 0;
      samples.heightMap![index] = pending.heightMap ?? 0;
      samples.sourceMetrics![index] = pending.sourceMetrics ?? 0;
      samples.reconcileLines![index] = pending.reconcileLines ?? 0;
      samples.measureLines![index] = pending.measureLines ?? 0;
      samples.paintSelection![index] = pending.paintSelection ?? 0;
      samples.renderOther![index] = Math.max(0, pending.renderOther ?? 0);
      // Everything in `setSource` that is not one of the wrapped calls is the
      // document model update.
      samples.model![index] = Math.max(0, t4 - t3 - wrapped);
      samples.setSourceOther![index] = 0;
      samples.reveal![index] = t5 - t4;
      samples.layout![index] = t6 - t5;
      totals[index] = t6 - t0;
      const h6 = readHeap();
      heap[index + 1] = h6;
      if (heapPhasesEnabled) {
        heapInputRead[index] = h2 - h1;
        heapFlatten[index] = h3 - h2;
        heapSetSource[index] = h4 - h3;
        heapRest[index] = h6 - h4 + (h1 - h0);
      }
    }

    await nextFrame();
    await nextTask();
  }

  const finalExpected = `${before}vida cotidiana ${
    warmup + sampleCount - 1
  }${after}`;
  if (
    currentSource !== finalExpected ||
    view.getModel().source !== finalExpected
  ) {
    throw new Error('keystroke profile lost the complete model');
  }

  const phases: KeystrokeProfile['phases'] = {};
  for (const phase of PHASES) {
    const stats = describe(samples[phase]!);
    phases[phase] = {
      maximumMs: stats.maximumMs,
      medianMs: stats.medianMs,
      p95Ms: stats.p95Ms,
      p99Ms: stats.p99Ms,
      totalMs: stats.totalMs,
    };
  }

  const collectionIndexes: number[] = [];
  const growth: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const delta = heap[index + 1]! - heap[index]!;
    if (delta < 0) {
      collectionIndexes.push(index);
    } else {
      growth.push(delta);
    }
  }
  growth.sort((left, right) => left - right);

  const ranked = Array.from(totals)
    .map((totalMs, index) => ({ index, totalMs }))
    .sort((left, right) => right.totalMs - left.totalMs)
    .slice(0, 12)
    .map(({ index, totalMs }) => ({
      index,
      phases: Object.fromEntries(
        PHASES.map((phase) => [
          phase,
          Number(samples[phase]![index]!.toFixed(3)),
        ]),
      ),
      totalMs: Number(totalMs.toFixed(3)),
    }));

  const totalStats = describe(totals);
  view.dispose();
  shell.host.remove();

  return {
    ablation,
    fixture: { characters: source.length, lines: lineCount },
    gc: {
      collectionIndexes,
      collections: collectionIndexes.length,
      growthMedianBytes: growth[growth.length >> 1] ?? 0,
      heapEndBytes: heap[sampleCount]!,
      heapStartBytes: heap[0]!,
      // Median of the positive readings only: a keystroke that collected
      // reports a negative delta that says nothing about what it allocated.
      ...(heapPhases
        ? {
            phaseBytes: {
              flatten: positiveMedian(heapFlatten),
              readInputEdit: positiveMedian(heapInputRead),
              rest: positiveMedian(heapRest),
              setSource: positiveMedian(heapSetSource),
            },
          }
        : {}),
    },
    histogramMs: histogram(totals),
    phases,
    samples: sampleCount,
    slowest: ranked,
    total: {
      maximumMs: totalStats.maximumMs,
      medianMs: totalStats.medianMs,
      minimumMs: totalStats.minimumMs,
      p95Ms: totalStats.p95Ms,
      p99Ms: totalStats.p99Ms,
      standardDeviationMs: totalStats.standardDeviationMs,
    },
  };
};
