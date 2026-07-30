import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

import {
  benchmarkFlingScroll,
  benchmarkWheelScroll,
  forceLayout,
  nextFrame,
  nextTask,
  summarize,
  type BenchmarkResult,
  type ScrollBenchmark,
} from './harness';

/**
 * CodeMirror 6 and Monaco on the same fixture, as external reference points.
 *
 * Both are devDependencies of the benchmark only — the application imports
 * neither and neither is in any shipped bundle. They exist so Flyoff's numbers
 * can be read against editors whose large-document behaviour is well
 * understood, instead of only against Flyoff's own previous numbers.
 */
export interface ReferenceEditorBenchmark {
  coldDurationMs: number;
  descendantNodes: number;
  edit: BenchmarkResult;
  initial: BenchmarkResult;
  scroll: { frameTime: BenchmarkResult };
  scrollHeight: number;
  wheelScroll: ScrollBenchmark;
}

const MOUNT_SAMPLES = 7;
const MOUNT_WARMUP = 2;
const EDIT_SAMPLES = 60;
const EDIT_WARMUP = 10;

function host(): HTMLElement {
  const element = document.createElement('main');
  element.style.width = '1000px';
  element.style.height = '650px';
  document.body.appendChild(element);
  return element;
}

function editOffset(source: string, marker: string): number {
  return Math.max(0, source.indexOf(marker, Math.floor(source.length / 3)));
}

export async function benchmarkCodeMirror(
  source: string,
  marker = 'vida cotidiana',
): Promise<ReferenceEditorBenchmark> {
  // Line wrapping on, to match the Flyoff source editor. Without it CodeMirror
  // can treat every line as one row and skip the measurement Flyoff has to do.
  const extensions = [markdown(), EditorView.lineWrapping];

  const initialSamples: number[] = [];
  for (let iteration = 0; iteration < MOUNT_SAMPLES; iteration += 1) {
    const parent = host();
    const startedAt = performance.now();
    const view = new EditorView({
      parent,
      state: EditorState.create({ doc: source, extensions }),
    });
    forceLayout(view.scrollDOM);
    await nextFrame();
    forceLayout(view.scrollDOM);
    initialSamples.push(performance.now() - startedAt);
    view.destroy();
    parent.remove();
  }

  const parent = host();
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: source, extensions }),
  });
  const scroller = view.scrollDOM;
  forceLayout(scroller);
  await nextFrame();
  forceLayout(scroller);

  const offset = editOffset(source, marker);
  const editSamples: number[] = [];
  for (let iteration = 0; iteration < EDIT_SAMPLES; iteration += 1) {
    const startedAt = performance.now();
    view.dispatch({
      changes: { from: offset + iteration, insert: 'x' },
      selection: { anchor: offset + iteration + 1 },
    });
    forceLayout(scroller);
    editSamples.push(performance.now() - startedAt);
    await nextFrame();
    await nextTask();
  }

  const descendantNodes = scroller.querySelectorAll('*').length;
  const scroll = { frameTime: await benchmarkFlingScroll(scroller) };
  const wheelScroll = await benchmarkWheelScroll(scroller);
  const scrollHeight = scroller.scrollHeight;

  view.destroy();
  parent.remove();

  return {
    coldDurationMs: initialSamples[0] ?? 0,
    descendantNodes,
    edit: summarize(editSamples.slice(EDIT_WARMUP)),
    initial: summarize(initialSamples.slice(MOUNT_WARMUP)),
    scroll,
    scrollHeight,
    wheelScroll,
  };
}

export async function benchmarkMonaco(
  source: string,
  marker = 'vida cotidiana',
): Promise<ReferenceEditorBenchmark> {
  // Word wrap on and the minimap off, so the comparison is about the same job
  // Flyoff does: wrapped Markdown text in a scroller of the same size.
  const options: monaco.editor.IStandaloneEditorConstructionOptions = {
    automaticLayout: false,
    language: 'markdown',
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    value: source,
    wordWrap: 'on',
  };

  const initialSamples: number[] = [];
  for (let iteration = 0; iteration < MOUNT_SAMPLES; iteration += 1) {
    const parent = host();
    const startedAt = performance.now();
    const editor = monaco.editor.create(parent, options);
    editor.layout({ height: 650, width: 1_000 });
    forceLayout(parent);
    await nextFrame();
    forceLayout(parent);
    initialSamples.push(performance.now() - startedAt);
    editor.getModel()?.dispose();
    editor.dispose();
    parent.remove();
  }

  const parent = host();
  const editor = monaco.editor.create(parent, options);
  editor.layout({ height: 650, width: 1_000 });
  forceLayout(parent);
  await nextFrame();
  forceLayout(parent);

  const model = editor.getModel()!;
  const offset = editOffset(source, marker);
  const editSamples: number[] = [];
  for (let iteration = 0; iteration < EDIT_SAMPLES; iteration += 1) {
    const position = model.getPositionAt(offset + iteration);
    const startedAt = performance.now();
    editor.executeEdits('benchmark', [
      {
        forceMoveMarkers: true,
        range: new monaco.Range(
          position.lineNumber,
          position.column,
          position.lineNumber,
          position.column,
        ),
        text: 'x',
      },
    ]);
    editor.render(true);
    forceLayout(parent);
    editSamples.push(performance.now() - startedAt);
    await nextFrame();
    await nextTask();
  }

  // Monaco scrolls through its own API; the DOM scroller is a synthetic
  // viewport, so driving `scrollTop` on it would measure nothing.
  const scrollHeight = editor.getScrollHeight();
  const distancePx = Math.max(0, scrollHeight - 650);
  const flingSamples: number[] = [];
  let previous = performance.now();
  for (let index = 1; index <= 120; index += 1) {
    editor.setScrollTop((distancePx * index) / 120);
    editor.render(true);
    await nextFrame();
    const current = performance.now();
    flingSamples.push(current - previous);
    previous = current;
  }

  editor.setScrollTop(0);
  await nextFrame();
  const wheelSamples: number[] = [];
  previous = performance.now();
  for (let index = 1; index <= 90; index += 1) {
    editor.setScrollTop(120 * index);
    editor.render(true);
    await nextFrame();
    const current = performance.now();
    wheelSamples.push(current - previous);
    previous = current;
  }

  const descendantNodes = parent.querySelectorAll('*').length;
  model.dispose();
  editor.dispose();
  parent.remove();

  return {
    coldDurationMs: initialSamples[0] ?? 0,
    descendantNodes,
    edit: summarize(editSamples.slice(EDIT_WARMUP)),
    initial: summarize(initialSamples.slice(MOUNT_WARMUP)),
    scroll: { frameTime: summarize(flingSamples) },
    scrollHeight,
    wheelScroll: { frameTime: summarize(wheelSamples), stepPx: 120 },
  };
}
