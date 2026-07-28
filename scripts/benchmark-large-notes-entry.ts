import { renderMarkdownInto } from '../src/renderer/projects/markdown-render';
import { reconcileSource } from '../src/renderer/projects/source-renderer';
import { serializeImageDirective } from '../src/shared/markdown';

interface BenchmarkResult {
  iterations: number;
  maximumMs: number;
  medianMs: number;
  minimumMs: number;
}

declare global {
  interface Window {
    runLargeNotesBenchmark(validateContainment?: boolean): Promise<{
      floatContainmentValidated: boolean;
      preview: BenchmarkResult;
      sourceWithWrap: BenchmarkResult;
      viewportHeight: number;
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
  };
}

function forceLayout(element: HTMLElement): void {
  void element.offsetHeight;
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

function validateFloatContainment(): void {
  const source = document.createElement('div');
  source.className = 'markdown-source__editor';
  document.body.appendChild(source);
  reconcileSource(
    source,
    `before\n${wrappedImageSource()}\nbeside\n# Clear\nafter`,
  );
  forceLayout(source);
  const sourceImage = source.querySelector<HTMLElement>(
    '.md-source-image--wrap',
  )!;
  const sourceClear = source.children[3]!;
  const sourceValid =
    getComputedStyle(sourceImage).float === 'left' &&
    source.children[1]?.classList.contains('md-line--float-context') === true &&
    source.children[2]?.classList.contains('md-line--float-context') === true &&
    getComputedStyle(sourceClear).clear === 'both' &&
    getComputedStyle(source.children[4]!).contentVisibility === 'auto';
  source.remove();

  const preview = document.createElement('div');
  preview.className = 'markdown-view';
  document.body.appendChild(preview);
  renderMarkdownInto(
    preview,
    `${wrappedImageSource()}\n\nbeside\n\n# Clear\n\nafter`,
  );
  forceLayout(preview);
  const previewImage = preview.querySelector<HTMLElement>(
    '.markdown-image--wrap',
  )!;
  const previewClear = preview.children[2]!;
  const previewValid =
    getComputedStyle(previewImage).float === 'left' &&
    preview.children[0]?.classList.contains(
      'markdown-block--float-context',
    ) === true &&
    preview.children[1]?.classList.contains(
      'markdown-block--float-context',
    ) === true &&
    getComputedStyle(previewClear).clear === 'both' &&
    getComputedStyle(preview.children[3]!).contentVisibility === 'auto';
  preview.remove();

  if (!sourceValid || !previewValid) {
    throw new Error('Selective float containment validation failed.');
  }
}

function benchmarkPreview(): BenchmarkResult {
  const container = document.createElement('div');
  container.className = 'markdown-view';
  document.body.appendChild(container);
  const blocks = Array.from(
    { length: 3_000 },
    (_, index) => `Paragraph ${index} with **formatted text** and a [link](https://example.com/${index}).`,
  );
  const middle = Math.floor(blocks.length / 2);
  const source = blocks.join('\n\n');
  renderMarkdownInto(container, source);
  forceLayout(container);

  const samples: number[] = [];
  for (let iteration = 0; iteration < 9; iteration += 1) {
    blocks[middle] = `Paragraph ${middle} changed ${iteration} with **formatted text** and a [link](https://example.com/${iteration}).`;
    const next = blocks.join('\n\n');
    const startedAt = performance.now();
    renderMarkdownInto(container, next);
    forceLayout(container);
    samples.push(performance.now() - startedAt);
  }

  container.remove();
  return summarize(samples.slice(2));
}

function benchmarkSourceWithWrap(): BenchmarkResult {
  const editor = document.createElement('div');
  editor.className = 'markdown-source__editor';
  document.body.appendChild(editor);
  const lines = Array.from(
    { length: 6_000 },
    (_, index) => `Line ${index} with enough text to exercise layout across the editor.`,
  );
  lines[100] = wrappedImageSource();
  lines[110] = '# Clear the short float';
  reconcileSource(editor, lines.join('\n'));
  forceLayout(editor);

  const samples: number[] = [];
  for (let iteration = 0; iteration < 7; iteration += 1) {
    lines[3_000] = `Line 3000 changed ${iteration} with enough text to exercise layout across the editor.`;
    const startedAt = performance.now();
    reconcileSource(editor, lines.join('\n'));
    forceLayout(editor);
    samples.push(performance.now() - startedAt);
  }

  editor.remove();
  return summarize(samples.slice(2));
}

window.runLargeNotesBenchmark = async (validateContainment = true) => {
  const result = {
    floatContainmentValidated: validateContainment,
    preview: benchmarkPreview(),
    sourceWithWrap: benchmarkSourceWithWrap(),
    viewportHeight: window.innerHeight,
  };
  if (validateContainment) {
    validateFloatContainment();
  }
  return result;
};
