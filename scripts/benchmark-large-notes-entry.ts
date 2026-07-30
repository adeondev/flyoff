import {
  benchmarkWheelScroll,
  forceLayout,
  nextFrame,
  nextTask,
  summarize,
  type BenchmarkResult,
} from './benchmark/harness';
import {
  benchmarkCodeMirror,
  benchmarkMonaco,
  type ReferenceEditorBenchmark,
} from './benchmark/reference-editors';

import { renderMarkdownInto } from '../src/renderer/projects/markdown-render';
import { SOURCE_INPUT_MIRROR_MAX_CODE_UNITS } from '../src/renderer/projects/source-engine/source-input-mirror';
import { getSourceViewAdapter } from '../src/renderer/projects/source-engine/source-view-adapter';
import { WindowedSourceView } from '../src/renderer/projects/source-engine/windowed-source-view';
import { WindowedMarkdownView } from '../src/renderer/projects/source-engine/windowed-markdown-view';
import {
  disposeSourceRenderer,
  getSourceDocumentModel,
  reconcileSource,
  updateActiveSourceLine,
} from '../src/renderer/projects/source-renderer';
import {
  readSelection,
  writeSelection,
} from '../src/renderer/projects/source-caret';
import { sourcePositionStatus } from '../src/renderer/projects/source-status';
import {
  clearSourceSpellingErrors,
  renderSourceSpellingErrors,
  sourceSpellingErrorCount,
  sourceSpellcheckViewportRange,
} from '../src/renderer/projects/source-spellcheck';
import { serializeImageDirective } from '../src/shared/markdown';

interface RenderBenchmark {
  coldDurationMs: number;
  descendantNodes: number;
  edit: BenchmarkResult;
  initial: BenchmarkResult;
  interaction?: {
    activeLine: BenchmarkResult;
    caretRoundTrip: BenchmarkResult;
    selectionStatus: BenchmarkResult;
    unchangedReconcile: BenchmarkResult;
  };
  scroll: {
    distancePx: number;
    frameTime: BenchmarkResult;
    heightAfterPx: number;
    heightBeforePx: number;
    heightChangePx: number;
  };
  scrollHeight: number;
}

interface WindowedRenderBenchmark {
  coldDurationMs: number;
  descendantNodes: number;
  edit: BenchmarkResult;
  editBreakdown: {
    inputMutation: BenchmarkResult;
    inputRead: BenchmarkResult;
    layout: BenchmarkResult;
    reveal: BenchmarkResult;
    sourceUpdate: BenchmarkResult;
  };
  initial: BenchmarkResult;
  keystroke: BenchmarkResult;
  interaction: {
    caretRect: BenchmarkResult;
    selectionRoundTrip: BenchmarkResult;
    selectionStatus: BenchmarkResult;
    unchangedUpdate: BenchmarkResult;
  };
  mountedLines: number;
  scroll: RenderBenchmark['scroll'] & {
    mountedLines: {
      maximum: number;
      minimum: number;
    };
    settle: {
      anchorDeltaPx: number;
      line: number;
      scrollDeltaPx: number;
    };
  };
  scrollHeight: number;
  wheelScroll: {
    frameTime: BenchmarkResult;
    stepPx: number;
  };
}

interface SpellcheckBenchmark {
  coldDurationMs: number;
  domMarkers: number;
  durationMs: number;
  markers: number;
  range?: { endLine: number; startLine: number };
  timing: BenchmarkResult;
}

interface WindowedPreviewBenchmark extends RenderBenchmark {
  blocks: number;
  mountedBlocks: number;
  mountedBlocksAfterScroll: number;
}

declare global {
  interface Window {
    runLargeNotesBenchmark(
      lineCount?: number,
      options?: { skipLegacy?: boolean; skipReference?: boolean },
    ): Promise<{
      fixture: { characters: number; lines: number };
      codemirror?: ReferenceEditorBenchmark;
      legacyPreview?: RenderBenchmark;
      legacySource?: RenderBenchmark;
      stableLayoutValidated: boolean;
      preview: WindowedPreviewBenchmark;
      source: WindowedRenderBenchmark;
      spellcheck: {
        fullDocument: SpellcheckBenchmark;
        visibleWindow: SpellcheckBenchmark;
      };
      viewport: { height: number; width: number };
    }>;
  }
}

/**
 * Enough keystrokes for a p95 that means something, plus a warm-up long enough
 * for the first-key allocations and the JIT to stop dominating.
 */
const WINDOWED_EDIT_SAMPLES = 60;
const WINDOWED_EDIT_WARMUP = 10;

function benchmarkHost(kind: 'preview' | 'source'): {
  host: HTMLElement;
  target: HTMLDivElement;
} {
  const host = document.createElement('main');
  const body = document.createElement('div');
  const target = document.createElement('div');
  host.className = 'markdown-editor';
  host.style.width = '1000px';
  host.style.height = '650px';
  body.className = `markdown-editor__body markdown-editor__body--${
    kind === 'source' ? 'edit' : 'reading'
  }`;
  if (kind === 'source') {
    const source = document.createElement('div');
    source.className = 'markdown-source';
    target.className = 'markdown-source__editor';
    source.appendChild(target);
    body.appendChild(source);
  } else {
    target.className = 'markdown-view';
    body.appendChild(target);
  }
  host.appendChild(body);
  document.body.appendChild(host);
  return { host, target };
}

function wrappedImageSource(): string {
  return serializeImageDirective({
    align: 'left',
    alt: 'Benchmark',
    assetId: '123e4567-e89b-42d3-a456-426614174000',
    caption: '',
    height: 180,
    instanceId: '223e4567-e89b-42d3-a456-426614174001',
    margin: 12,
    maxWidth: 1200,
    minWidth: 96,
    mode: 'wrap',
    path: 'Media/benchmark.png',
    positionLock: false,
    ratioLock: true,
    version: 2,
    width: 320,
  });
}

function representativeSource(lineCount: number): string {
  const lines: string[] = [];
  for (let index = 0; index < lineCount; index += 1) {
    if (index % 9 === 0) {
      lines.push(
        `${'#'.repeat((index % 5) + 1)} Seção ${index}: sociedade, religião e poder`,
      );
    } else if (index >= 220 && index < 280) {
      lines.push(
        `| Dinastia ${index - 219} | Período ${index} | Evidência |`,
      );
    } else if (index % 4 === 0) {
      lines.push(
        `- Item ${index}: administração, comércio e **vida cotidiana**.`,
      );
    } else if (index % 33 === 0) {
      lines.push(
        `Consulte [fonte ${index}](https://example.com/${index}) e referências.`,
      );
    } else {
      lines.push(
        `Registro ${index}: política, religião e vida cotidiana no período.`,
      );
    }
  }
  return lines.join('\n');
}

function validateStableLayout(): void {
  const sourceHost = benchmarkHost('source');
  sourceHost.target.dataset.windowed = 'true';
  const sourceView = new WindowedSourceView(sourceHost.target, {
    ariaLabel: 'Benchmark',
    readOnly: false,
    selection: { direction: 'none', end: 0, start: 0 },
    source: `before\n${wrappedImageSource()}\nbeside\n# Clear\nafter`,
  });
  forceLayout(sourceHost.target);
  const sourceImage = sourceHost.target.querySelector<HTMLElement>(
    '.md-source-image--wrap',
  )!;
  const sourceClear = sourceHost.target.querySelector<HTMLElement>(
    '.md-line[data-line="4"]',
  )!;
  const sourceAfter = sourceHost.target.querySelector<HTMLElement>(
    '.md-line[data-line="5"]',
  )!;
  const sourceValid =
    getComputedStyle(sourceImage).float === 'left' &&
    getComputedStyle(sourceClear).clear === 'both' &&
    getComputedStyle(sourceAfter).contentVisibility === 'visible';
  sourceView.dispose();
  sourceHost.host.remove();

  const previewHost = benchmarkHost('preview');
  renderMarkdownInto(
    previewHost.target,
    `${wrappedImageSource()}\n\nbeside\n\n# Clear\n\nafter`,
  );
  forceLayout(previewHost.target);
  const previewImage = previewHost.target.querySelector<HTMLElement>(
    '.markdown-image--wrap',
  )!;
  const previewClear = previewHost.target.children[2]!;
  const previewValid =
    getComputedStyle(previewImage).float === 'left' &&
    getComputedStyle(previewClear).clear === 'both' &&
    getComputedStyle(previewHost.target.children[3]!).contentVisibility ===
      'visible';
  previewHost.host.remove();

  if (!sourceValid || !previewValid) {
    throw new Error('Stable editor layout validation failed.');
  }
}

async function benchmarkScroll(target: HTMLElement): Promise<{
  distancePx: number;
  frameTime: BenchmarkResult;
  heightAfterPx: number;
  heightBeforePx: number;
  heightChangePx: number;
}> {
  target.scrollTop = 0;
  await nextFrame();
  await nextFrame();
  const heightBeforePx = target.scrollHeight;
  const distancePx = Math.max(0, heightBeforePx - target.clientHeight);
  const samples: number[] = [];
  let previous = performance.now();

  for (let index = 1; index <= 120; index += 1) {
    target.scrollTop = (distancePx * index) / 120;
    await nextFrame();
    const current = performance.now();
    samples.push(current - previous);
    previous = current;
  }

  const heightAfterPx = target.scrollHeight;
  return {
    distancePx,
    frameTime: summarize(samples),
    heightAfterPx,
    heightBeforePx,
    heightChangePx: heightAfterPx - heightBeforePx,
  };
}

async function benchmarkWindowedScroll(
  target: HTMLElement,
  view: WindowedSourceView,
): Promise<WindowedRenderBenchmark['scroll']> {
  const refresh = (): void => {
    target.dispatchEvent(new Event('scroll'));
  };
  target.scrollTop = 0;
  refresh();
  await nextFrame();
  await nextFrame();
  const heightBeforePx = target.scrollHeight;
  const distancePx = Math.max(0, heightBeforePx - target.clientHeight);
  const samples: number[] = [];
  let minimumMountedLines = Number.POSITIVE_INFINITY;
  let maximumMountedLines = 0;
  let previous = performance.now();

  for (let index = 1; index <= 120; index += 1) {
    target.scrollTop = (distancePx * index) / 120;
    refresh();
    await nextFrame();
    const current = performance.now();
    samples.push(current - previous);
    previous = current;
    const mountedLines = view.getVisibleLineElements().length;
    minimumMountedLines = Math.min(minimumMountedLines, mountedLines);
    maximumMountedLines = Math.max(maximumMountedLines, mountedLines);
  }

  target.scrollTop = distancePx * 0.63;
  refresh();
  await nextFrame();
  await nextFrame();
  const targetBounds = target.getBoundingClientRect();
  const anchor = view.getVisibleLineElements().find((line) => {
    const bounds = line.getBoundingClientRect();
    return bounds.bottom > targetBounds.top && bounds.top < targetBounds.bottom;
  });
  const anchorLine = Number(anchor?.dataset.line);
  const anchorTopBefore =
    anchor?.getBoundingClientRect().top ?? targetBounds.top;
  const scrollTopBefore = target.scrollTop;
  await new Promise((resolve) => setTimeout(resolve, 140));
  await nextFrame();
  await nextFrame();
  const settledAnchor = Number.isFinite(anchorLine)
    ? view
        .getVisibleLineElements()
        .find((line) => Number(line.dataset.line) === anchorLine)
    : undefined;
  const heightAfterPx = target.scrollHeight;
  return {
    distancePx,
    frameTime: summarize(samples),
    heightAfterPx,
    heightBeforePx,
    heightChangePx: heightAfterPx - heightBeforePx,
    mountedLines: {
      maximum: maximumMountedLines,
      minimum: Number.isFinite(minimumMountedLines)
        ? minimumMountedLines
        : 0,
    },
    settle: {
      anchorDeltaPx:
        (settledAnchor?.getBoundingClientRect().top ?? anchorTopBefore) -
        anchorTopBefore,
      line: Number.isFinite(anchorLine) ? anchorLine : 0,
      scrollDeltaPx: target.scrollTop - scrollTopBefore,
    },
  };
}

async function benchmarkRender(
  source: string,
  kind: 'preview' | 'source',
): Promise<RenderBenchmark> {
  const render =
    kind === 'source'
      ? (target: HTMLElement, value: string) =>
          reconcileSource(target, value)
      : (target: HTMLElement, value: string) =>
          renderMarkdownInto(target, value);
  const initialSamples: number[] = [];
  for (let iteration = 0; iteration < 7; iteration += 1) {
    const { host, target } = benchmarkHost(kind);
    const startedAt = performance.now();
    render(target, source);
    forceLayout(target);
    initialSamples.push(performance.now() - startedAt);
    if (kind === 'source') {
      disposeSourceRenderer(target);
    }
    host.remove();
  }

  const { host, target } = benchmarkHost(kind);
  render(target, source);
  forceLayout(target);
  const marker = 'vida cotidiana';
  const editOffset = source.indexOf(marker, Math.floor(source.length / 3));
  const before = source.slice(0, editOffset);
  const after = source.slice(editOffset + marker.length);
  const editSamples: number[] = [];
  for (let iteration = 0; iteration < 11; iteration += 1) {
    const next = `${before}vida cotidiana ${iteration}${after}`;
    const startedAt = performance.now();
    render(target, next);
    forceLayout(target);
    editSamples.push(performance.now() - startedAt);
  }
  const interaction =
    kind === 'source'
      ? benchmarkSourceInteraction(target, source)
      : undefined;
  const result = {
    coldDurationMs: initialSamples[0] ?? 0,
    descendantNodes: target.querySelectorAll('*').length,
    edit: summarize(editSamples.slice(2)),
    initial: summarize(initialSamples.slice(2)),
    ...(interaction ? { interaction } : {}),
    scroll: await benchmarkScroll(target),
    scrollHeight: target.scrollHeight,
  };
  if (kind === 'source') {
    disposeSourceRenderer(target);
  }
  host.remove();
  return result;
}

/**
 * The reading view as the application renders a large note: only the visible
 * blocks are mounted. `benchmarkRender('preview')` keeps measuring the full
 * DOM path beside it, so a regression back toward it stays visible.
 */
async function benchmarkWindowedPreview(
  source: string,
): Promise<WindowedPreviewBenchmark> {
  const initialSamples: number[] = [];
  for (let iteration = 0; iteration < 7; iteration += 1) {
    const { host, target } = benchmarkHost('preview');
    const startedAt = performance.now();
    const view = new WindowedMarkdownView(target);
    view.setSource(source);
    view.flush();
    forceLayout(target);
    initialSamples.push(performance.now() - startedAt);
    view.destroy();
    host.remove();
  }

  const { host, target } = benchmarkHost('preview');
  const view = new WindowedMarkdownView(target);
  view.setSource(source);
  view.flush();
  forceLayout(target);

  const marker = 'vida cotidiana';
  const editOffset = source.indexOf(marker, Math.floor(source.length / 3));
  const before = source.slice(0, editOffset);
  const after = source.slice(editOffset + marker.length);
  const editSamples: number[] = [];
  for (let iteration = 0; iteration < 11; iteration += 1) {
    const next = `${before}vida cotidiana ${iteration}${after}`;
    const startedAt = performance.now();
    view.setSource(next);
    view.flush();
    forceLayout(target);
    editSamples.push(performance.now() - startedAt);
  }

  const mountedBlocks = view.mountedBlockCount;
  const descendantNodes = target.querySelectorAll('*').length;
  const scroll = await benchmarkScroll(target);

  const result: WindowedPreviewBenchmark = {
    blocks: view.blockCount,
    coldDurationMs: initialSamples[0] ?? 0,
    descendantNodes,
    edit: summarize(editSamples.slice(2)),
    initial: summarize(initialSamples.slice(2)),
    mountedBlocks,
    mountedBlocksAfterScroll: view.mountedBlockCount,
    scroll,
    scrollHeight: target.scrollHeight,
  };
  view.destroy();
  host.remove();
  return result;
}

function benchmarkSourceInteraction(
  target: HTMLElement,
  source: string,
): NonNullable<RenderBenchmark['interaction']> {
  target.setAttribute('contenteditable', 'plaintext-only');
  target.focus({ preventScroll: true });
  reconcileSource(target, source);
  const model = getSourceDocumentModel(target)!;
  const centerLine = Math.floor(model.lines.length / 2);
  writeSelection(target, model.lineStarts[centerLine]!);
  const unchangedReconcile: number[] = [];
  const caretRoundTrip: number[] = [];
  const activeLine: number[] = [];
  const selectionStatus: number[] = [];

  for (let iteration = 0; iteration < 25; iteration += 1) {
    let startedAt = performance.now();
    reconcileSource(target, source);
    unchangedReconcile.push(performance.now() - startedAt);

    const lineIndex = Math.min(
      model.lines.length - 1,
      centerLine + (iteration % 2),
    );
    const offset = model.lineStarts[lineIndex]!;
    startedAt = performance.now();
    writeSelection(target, offset);
    readSelection(target);
    caretRoundTrip.push(performance.now() - startedAt);

    startedAt = performance.now();
    updateActiveSourceLine(target, source, offset);
    forceLayout(target);
    activeLine.push(performance.now() - startedAt);

    startedAt = performance.now();
    sourcePositionStatus(
      source,
      {
        direction: 'forward',
        end: Math.floor(source.length * 0.9),
        start: Math.floor(source.length * 0.1),
      },
      model,
    );
    selectionStatus.push(performance.now() - startedAt);
  }

  return {
    activeLine: summarize(activeLine.slice(5)),
    caretRoundTrip: summarize(caretRoundTrip.slice(5)),
    selectionStatus: summarize(selectionStatus.slice(5)),
    unchangedReconcile: summarize(unchangedReconcile.slice(5)),
  };
}

function benchmarkWindowedSourceInteraction(
  target: HTMLElement,
  view: WindowedSourceView,
  source: string,
): WindowedRenderBenchmark['interaction'] {
  const adapter = getSourceViewAdapter(target);
  if (!adapter) {
    throw new Error('Windowed source adapter was not registered.');
  }
  const model = adapter.getModel();
  const centerLine = Math.floor(model.lines.length / 2);
  const centerOffset = model.lineStarts[centerLine] ?? 0;
  adapter.writeSelection({
    direction: 'none',
    end: centerOffset,
    start: centerOffset,
  });
  adapter.focus();
  const unchangedUpdate: number[] = [];
  const selectionRoundTrip: number[] = [];
  const caretRect: number[] = [];
  const selectionStatus: number[] = [];

  for (let iteration = 0; iteration < 25; iteration += 1) {
    let startedAt = performance.now();
    view.setSource(source, adapter.readSelection());
    unchangedUpdate.push(performance.now() - startedAt);

    const lineIndex = Math.min(
      model.lines.length - 1,
      centerLine + (iteration % 2),
    );
    const offset = model.lineStarts[lineIndex] ?? 0;
    startedAt = performance.now();
    adapter.writeSelection({
      direction: 'none',
      end: offset,
      start: offset,
    });
    adapter.readSelection();
    selectionRoundTrip.push(performance.now() - startedAt);

    startedAt = performance.now();
    adapter.sourceCaretRect(offset);
    caretRect.push(performance.now() - startedAt);

    startedAt = performance.now();
    sourcePositionStatus(
      source,
      {
        direction: 'forward',
        end: Math.floor(source.length * 0.9),
        start: Math.floor(source.length * 0.1),
      },
      adapter.getModel(),
    );
    selectionStatus.push(performance.now() - startedAt);
  }

  return {
    caretRect: summarize(caretRect.slice(5)),
    selectionRoundTrip: summarize(selectionRoundTrip.slice(5)),
    selectionStatus: summarize(selectionStatus.slice(5)),
    unchangedUpdate: summarize(unchangedUpdate.slice(5)),
  };
}

async function benchmarkWindowedSource(
  source: string,
): Promise<WindowedRenderBenchmark> {
  const initialSamples: number[] = [];
  for (let iteration = 0; iteration < 7; iteration += 1) {
    const { host, target } = benchmarkHost('source');
    target.dataset.windowed = 'true';
    let view: WindowedSourceView | undefined;
    try {
      const startedAt = performance.now();
      view = new WindowedSourceView(target, {
        ariaLabel: 'Benchmark',
        readOnly: false,
        selection: { direction: 'none', end: 0, start: 0 },
        source,
      });
      forceLayout(target);
      await nextFrame();
      forceLayout(target);
      initialSamples.push(performance.now() - startedAt);
    } finally {
      view?.dispose();
      host.remove();
    }
  }

  const { host, target } = benchmarkHost('source');
  target.dataset.windowed = 'true';
  const view = new WindowedSourceView(target, {
    ariaLabel: 'Benchmark',
    readOnly: false,
    selection: { direction: 'none', end: 0, start: 0 },
    source,
  });
  try {
    forceLayout(target);
    await nextFrame();
    forceLayout(target);
    const mountedLines = view.getVisibleLineElements().length;
    const marker = 'vida cotidiana';
    const editOffset = Math.max(
      0,
      source.indexOf(marker, Math.floor(source.length / 3)),
    );
    const before = source.slice(0, editOffset);
    const after = source.slice(editOffset + marker.length);
    const editSamples: number[] = [];
    const inputMutationSamples: number[] = [];
    const inputReadSamples: number[] = [];
    const sourceUpdateSamples: number[] = [];
    const layoutSamples: number[] = [];
    const revealSamples: number[] = [];
    const keystrokeSamples: number[] = [];
    let currentSource = source;
    let replacedLength = marker.length;
    for (
      let iteration = 0;
      iteration < WINDOWED_EDIT_SAMPLES;
      iteration += 1
    ) {
      const inserted = `vida cotidiana ${iteration}`;
      view.writeSelection({
        direction: 'forward',
        end: editOffset + replacedLength,
        start: editOffset,
      });
      const mirror = view.captureInputMirror();
      if (
        view.input.value !== mirror.value ||
        view.input.value.length > SOURCE_INPUT_MIRROR_MAX_CODE_UNITS
      ) {
        throw new Error('Windowed source input mirror is not bounded.');
      }
      const startedAt = performance.now();
      view.input.setRangeText(
        inserted,
        mirror.selectionStart,
        mirror.selectionEnd,
        'end',
      );
      const inputMutatedAt = performance.now();
      const edit = view.readInputEdit(currentSource, mirror);
      const inputReadAt = performance.now();
      view.setSource(edit.content, edit.selection, {
        nextSelection: edit.selection,
        previousSelection: {
          end: editOffset + replacedLength,
          start: editOffset,
        },
      });
      const sourceUpdatedAt = performance.now();
      // What the application actually pays per key: the editor also scrolls the
      // caret back into view before handing the transaction to React. Measuring
      // only `setSource` understated the latency a person feels.
      view.revealOffset(edit.selection.end);
      const revealedAt = performance.now();
      forceLayout(target);
      const layoutForcedAt = performance.now();
      keystrokeSamples.push(layoutForcedAt - startedAt);
      inputMutationSamples.push(inputMutatedAt - startedAt);
      inputReadSamples.push(inputReadAt - inputMutatedAt);
      sourceUpdateSamples.push(sourceUpdatedAt - inputReadAt);
      revealSamples.push(revealedAt - sourceUpdatedAt);
      layoutSamples.push(layoutForcedAt - revealedAt);
      editSamples.push(sourceUpdatedAt - startedAt);
      currentSource = edit.content;
      replacedLength = inserted.length;
      const expected = `${before}${inserted}${after}`;
      if (
        currentSource !== expected ||
        view.getModel().source !== expected
      ) {
        throw new Error('Windowed source edit lost the complete model.');
      }
      // A person does not type two keys inside one frame, and the reference
      // editors are measured the same way. Without it the editor never reaches
      // the point where deferred work runs, which measures a burst no keyboard
      // produces and compares it against a paced one.
      await nextFrame();
      await nextTask();
    }

    const lastSource = `${before}vida cotidiana ${
      WINDOWED_EDIT_SAMPLES - 1
    }${after}`;
    if (
      currentSource !== lastSource ||
      view.getModel().source !== lastSource
    ) {
      throw new Error('Windowed source edit benchmark lost input state.');
    }
    const model = view.getModel();
    const centerOffset =
      model.lineStarts[Math.floor(model.lines.length / 2)] ?? 0;
    view.setSource(source, {
      direction: 'none',
      end: centerOffset,
      start: centerOffset,
    });
    await nextFrame();
    const interaction = benchmarkWindowedSourceInteraction(
      target,
      view,
      source,
    );
    const scroll = await benchmarkWindowedScroll(target, view);
    return {
      coldDurationMs: initialSamples[0] ?? 0,
      descendantNodes: target.querySelectorAll('*').length,
      edit: summarize(editSamples.slice(WINDOWED_EDIT_WARMUP)),
      editBreakdown: {
        inputMutation: summarize(
          inputMutationSamples.slice(WINDOWED_EDIT_WARMUP),
        ),
        inputRead: summarize(inputReadSamples.slice(WINDOWED_EDIT_WARMUP)),
        layout: summarize(layoutSamples.slice(WINDOWED_EDIT_WARMUP)),
        reveal: summarize(revealSamples.slice(WINDOWED_EDIT_WARMUP)),
        sourceUpdate: summarize(
          sourceUpdateSamples.slice(WINDOWED_EDIT_WARMUP),
        ),
      },
      initial: summarize(initialSamples.slice(2)),
      keystroke: summarize(keystrokeSamples.slice(WINDOWED_EDIT_WARMUP)),
      interaction,
      mountedLines,
      scroll,
      scrollHeight: target.scrollHeight,
      wheelScroll: await benchmarkWheelScroll(target),
    };
  } finally {
    view.dispose();
    host.remove();
  }
}

function benchmarkSpellcheck(
  source: string,
  lineCount: number,
): {
  fullDocument: SpellcheckBenchmark;
  visibleWindow: SpellcheckBenchmark;
} {
  const misspelled = [
    'administração',
    'comércio',
    'cotidiana',
    'evidência',
    'período',
    'política',
    'referências',
    'religião',
    'sociedade',
  ];
  const measure = (
    range?: { endLine: number; startLine: number },
  ): SpellcheckBenchmark => {
    const { host, target } = benchmarkHost('source');
    reconcileSource(target, source);
    forceLayout(target);
    if (range) {
      target.scrollTop = target.scrollHeight / 2;
    }
    const durations: number[] = [];
    let domMarkers = 0;
    let markers = 0;
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const startedAt = performance.now();
      renderSourceSpellingErrors(target, misspelled, false, range);
      forceLayout(target);
      durations.push(performance.now() - startedAt);
      domMarkers = target.querySelectorAll('.md-spelling-error').length;
      markers = sourceSpellingErrorCount(target);
      clearSourceSpellingErrors(target);
      forceLayout(target);
    }
    const timing = summarize(durations.slice(1));
    const result = {
      coldDurationMs: durations[0]!,
      domMarkers,
      durationMs: timing.medianMs,
      markers,
      ...(range ? { range } : {}),
      timing,
    };
    disposeSourceRenderer(target);
    host.remove();
    return result;
  };

  const probe = benchmarkHost('source');
  reconcileSource(probe.target, source);
  forceLayout(probe.target);
  probe.target.scrollTop = probe.target.scrollHeight / 2;
  const range = sourceSpellcheckViewportRange(probe.target, lineCount);
  disposeSourceRenderer(probe.target);
  probe.host.remove();
  const visibleWindow = measure(range);
  return { fullDocument: measure(), visibleWindow };
}

window.runLargeNotesBenchmark = async (
  lineCount = 1_766,
  options: { skipLegacy?: boolean; skipReference?: boolean } = {},
) => {
  document.body.style.margin = '0';
  const source = representativeSource(lineCount);
  validateStableLayout();
  // The full-DOM diagnostics cost minutes once the CPU is throttled, and they
  // only exist to catch a regression back toward them. A throttled sweep is
  // about the shipped paths.
  const reference = options.skipReference
    ? {}
    : {
        codemirror: await benchmarkCodeMirror(source),
        monaco: await benchmarkMonaco(source),
      };
  const legacy = options.skipLegacy
    ? {}
    : {
        legacyPreview: await benchmarkRender(source, 'preview'),
        legacySource: await benchmarkRender(source, 'source'),
      };
  const result = {
    fixture: {
      characters: source.length,
      lines: source.split('\n').length,
    },
    stableLayoutValidated: true,
    preview: await benchmarkWindowedPreview(source),
    source: await benchmarkWindowedSource(source),
    ...reference,
    ...legacy,
    spellcheck: benchmarkSpellcheck(source, lineCount),
    viewport: { height: 650, width: 1_000 },
  };
  return result;
};
