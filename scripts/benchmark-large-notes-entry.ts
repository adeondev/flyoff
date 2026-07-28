import { renderMarkdownInto } from '../src/renderer/projects/markdown-render';
import { reconcileSource } from '../src/renderer/projects/source-renderer';
import {
  renderSourceSpellingErrors,
  sourceSpellcheckViewportRange,
} from '../src/renderer/projects/source-spellcheck';
import { serializeImageDirective } from '../src/shared/markdown';

interface BenchmarkResult {
  iterations: number;
  maximumMs: number;
  medianMs: number;
  minimumMs: number;
  p95Ms: number;
}

interface RenderBenchmark {
  descendantNodes: number;
  edit: BenchmarkResult;
  initial: BenchmarkResult;
  scroll: {
    distancePx: number;
    frameTime: BenchmarkResult;
    heightAfterPx: number;
    heightBeforePx: number;
    heightChangePx: number;
  };
  scrollHeight: number;
}

interface SpellcheckBenchmark {
  durationMs: number;
  markers: number;
  range?: { endLine: number; startLine: number };
}

declare global {
  interface Window {
    runLargeNotesBenchmark(): Promise<{
      fixture: { characters: number; lines: number };
      stableLayoutValidated: boolean;
      preview: RenderBenchmark;
      source: RenderBenchmark;
      spellcheck: {
        fullDocument: SpellcheckBenchmark;
        visibleWindow: SpellcheckBenchmark;
      };
      viewport: { height: number; width: number };
    }>;
  }
}

function summarize(samples: readonly number[]): BenchmarkResult {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    iterations: sorted.length,
    maximumMs: sorted.at(-1) ?? 0,
    medianMs: sorted[Math.floor(sorted.length / 2)] ?? 0,
    minimumMs: sorted[0] ?? 0,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0,
  };
}

function forceLayout(element: HTMLElement): void {
  void element.offsetHeight;
  void element.scrollHeight;
}

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

function representativeSource(): string {
  const lines: string[] = [];
  for (let index = 0; index < 1_766; index += 1) {
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
  reconcileSource(
    sourceHost.target,
    `before\n${wrappedImageSource()}\nbeside\n# Clear\nafter`,
  );
  forceLayout(sourceHost.target);
  const sourceImage = sourceHost.target.querySelector<HTMLElement>(
    '.md-source-image--wrap',
  )!;
  const sourceClear = sourceHost.target.children[3]!;
  const sourceValid =
    getComputedStyle(sourceImage).float === 'left' &&
    getComputedStyle(sourceClear).clear === 'both' &&
    getComputedStyle(sourceHost.target.children[4]!).contentVisibility ===
      'visible';
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

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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
  const result = {
    descendantNodes: target.querySelectorAll('*').length,
    edit: summarize(editSamples.slice(2)),
    initial: summarize(initialSamples.slice(2)),
    scroll: await benchmarkScroll(target),
    scrollHeight: target.scrollHeight,
  };
  host.remove();
  return result;
}

function benchmarkSpellcheck(
  source: string,
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
    const startedAt = performance.now();
    renderSourceSpellingErrors(target, misspelled, false, range);
    forceLayout(target);
    const result = {
      durationMs: performance.now() - startedAt,
      markers: target.querySelectorAll('.md-spelling-error').length,
      ...(range ? { range } : {}),
    };
    host.remove();
    return result;
  };

  const probe = benchmarkHost('source');
  reconcileSource(probe.target, source);
  forceLayout(probe.target);
  probe.target.scrollTop = probe.target.scrollHeight / 2;
  const range = sourceSpellcheckViewportRange(probe.target, 1_766);
  probe.host.remove();
  return {
    fullDocument: measure(),
    visibleWindow: measure(range),
  };
}

window.runLargeNotesBenchmark = async () => {
  document.body.style.margin = '0';
  const source = representativeSource();
  validateStableLayout();
  const result = {
    fixture: {
      characters: source.length,
      lines: source.split('\n').length,
    },
    stableLayoutValidated: true,
    preview: await benchmarkRender(source, 'preview'),
    source: await benchmarkRender(source, 'source'),
    spellcheck: benchmarkSpellcheck(source),
    viewport: { height: 650, width: 1_000 },
  };
  return result;
};
