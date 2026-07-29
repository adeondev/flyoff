import { createElement, createRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import {
  renderMarkdownInto,
  renderMarkdownIntoCooperatively,
} from "../src/renderer/projects/markdown-render";
import { reconcileSource } from "../src/renderer/projects/source-renderer";
import type { SourceTextChange } from "../src/renderer/projects/source-document-model";
import {
  renderSourceSpellingErrors,
  sourceSpellcheckViewportRange,
} from "../src/renderer/projects/source-spellcheck";
import { serializeImageDirective } from "../src/shared/markdown";
import { VirtualSourceEditor } from "../src/renderer/projects/VirtualSourceEditor";
import {
  writeSelection,
  type SourceSelection,
} from "../src/renderer/projects/source-caret";
import type { SourceEditTransaction } from "../src/renderer/projects/markdown-history";
import { resolveMarkdownTypingInput } from "../src/renderer/projects/source-typing-color";
import { sourcePositionStatus } from "../src/renderer/projects/source-status";

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

interface PaneMotionBenchmark {
  lockedLayout: BenchmarkResult;
  settleMs: number;
  sourceWidthAfterPx: number;
  sourceWidthDuringPx: number;
}

interface CooperativePreviewBenchmark {
  descendantNodes: number;
  durationMs: number;
  longTasks: BenchmarkResult;
}

interface InteractionBenchmark {
  backspace: BenchmarkResult;
  deleteWordBackward: BenchmarkResult;
  selectAllColdMs: number;
  selectAllWarm: BenchmarkResult;
}

interface VirtualSourceComparison {
  noMedia: RenderBenchmark;
  wrappedImage: RenderBenchmark;
}

declare global {
  interface Window {
    runVirtualSourceBenchmark(): Promise<VirtualSourceComparison>;
    runLargeNotesBenchmark(): Promise<{
      fixture: { characters: number; lines: number };
      paneMotion: PaneMotionBenchmark;
      virtualPaneMotion: PaneMotionBenchmark;
      cooperativePreview: CooperativePreviewBenchmark;
      interaction: InteractionBenchmark;
      stableLayoutValidated: boolean;
      preview: RenderBenchmark;
      source: RenderBenchmark;
      virtualSource: RenderBenchmark;
      virtualSourceNoMedia: RenderBenchmark;
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

function benchmarkHost(kind: "preview" | "source"): {
  host: HTMLElement;
  target: HTMLDivElement;
} {
  const host = document.createElement("main");
  const body = document.createElement("div");
  const target = document.createElement("div");
  host.className = "markdown-editor";
  host.style.width = "1000px";
  host.style.height = "650px";
  body.className = `markdown-editor__body markdown-editor__body--${
    kind === "source" ? "edit" : "reading"
  }`;
  if (kind === "source") {
    const source = document.createElement("div");
    source.className = "markdown-source";
    target.className = "markdown-source__editor";
    source.appendChild(target);
    body.appendChild(source);
  } else {
    target.className = "markdown-view";
    body.appendChild(target);
  }
  host.appendChild(body);
  document.body.appendChild(host);
  return { host, target };
}

class VirtualBenchmarkCapture {
  private transaction?: SourceEditTransaction;

  clear(): void {
    this.transaction = undefined;
  }

  read(): SourceEditTransaction | undefined {
    return this.transaction;
  }

  record(transaction: SourceEditTransaction): void {
    this.transaction = transaction;
  }
}

function VirtualBenchmarkController({
  capture,
  editorRef,
  initialSource,
}: {
  capture: VirtualBenchmarkCapture;
  editorRef: ReturnType<typeof createRef<HTMLDivElement>>;
  initialSource: string;
}) {
  const [state, setState] = useState(() => ({
    content: initialSource,
    selection: {
      direction: "none" as const,
      end: 0,
      start: 0,
    },
  }));
  return createElement(VirtualSourceEditor, {
    ariaLabel: "Benchmark editor",
    editorRef,
    nodeId: "benchmark-note",
    onRedo: () => undefined,
    onSelectionChange: () => undefined,
    onTransaction: (transaction) => {
      capture.record(transaction);
      setState(transaction.after);
    },
    onUndo: () => undefined,
    selection: state.selection,
    translate: (key) => key,
    value: state.content,
  });
}

function mountVirtualSource(source: string): {
  capture: VirtualBenchmarkCapture;
  editor: HTMLDivElement;
  host: HTMLElement;
  reactRoot: Root;
} {
  const host = document.createElement("main");
  const body = document.createElement("div");
  const mount = document.createElement("div");
  const editorRef = createRef<HTMLDivElement>();
  host.className = "markdown-editor";
  host.style.height = "650px";
  host.style.width = "1000px";
  body.className = "markdown-editor__body markdown-editor__body--edit";
  mount.style.display = "contents";
  body.appendChild(mount);
  host.appendChild(body);
  document.body.appendChild(host);
  const reactRoot = createRoot(mount);
  const capture = new VirtualBenchmarkCapture();
  flushSync(() => {
    reactRoot.render(
      createElement(VirtualBenchmarkController, {
        capture,
        editorRef,
        initialSource: source,
      }),
    );
  });
  const editor = editorRef.current;
  if (!editor) {
    throw new Error("Virtual source editor did not mount.");
  }
  return { capture, editor, host, reactRoot };
}

async function benchmarkVirtualSource(
  source: string,
): Promise<RenderBenchmark> {
  const initialSamples: number[] = [];
  for (let iteration = 0; iteration < 7; iteration += 1) {
    const startedAt = performance.now();
    const mounted = mountVirtualSource(source);
    forceLayout(mounted.editor);
    initialSamples.push(performance.now() - startedAt);
    flushSync(() => mounted.reactRoot.unmount());
    mounted.host.remove();
  }

  const mounted = mountVirtualSource(source);
  forceLayout(mounted.editor);
  const marker = "vida cotidiana";
  const markerOffset = source.indexOf(marker, Math.floor(source.length / 3));
  const initialSelection: SourceSelection = {
    direction: "none",
    end: markerOffset + marker.length,
    start: markerOffset + marker.length,
  };
  writeSelection(mounted.editor, initialSelection);
  const proxy = mounted.editor.querySelector<HTMLTextAreaElement>(
    ".virtual-source__proxy",
  );
  if (!proxy) {
    throw new Error("Virtual source proxy did not mount.");
  }
  const editSamples: number[] = [];
  for (let iteration = 0; iteration < 11; iteration += 1) {
    mounted.capture.clear();
    const startedAt = performance.now();
    const transfer = new DataTransfer();
    transfer.setData("text/plain", String(iteration % 10));
    proxy.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    );
    const transaction = mounted.capture.read();
    if (!transaction) {
      throw new Error("Virtual source input transaction was not published.");
    }
    forceLayout(mounted.editor);
    editSamples.push(performance.now() - startedAt);
  }
  const result = {
    descendantNodes: mounted.editor.querySelectorAll("*").length,
    edit: summarize(editSamples.slice(2)),
    initial: summarize(initialSamples.slice(2)),
    scroll: await benchmarkScroll(mounted.editor),
    scrollHeight: mounted.editor.scrollHeight,
  };
  flushSync(() => mounted.reactRoot.unmount());
  mounted.host.remove();
  return result;
}

function wrappedImageSource(
  align: "left" | "right" = "left",
  width = 320,
  height = 180,
  margin = 12,
): string {
  return serializeImageDirective({
    align,
    alt: "Benchmark",
    assetId: "123e4567-e89b-42d3-a456-426614174000",
    caption: "",
    height,
    instanceId: "223e4567-e89b-42d3-a456-426614174001",
    margin,
    maxWidth: 1200,
    minWidth: 96,
    mode: "wrap",
    path: "Media/benchmark.png",
    positionLock: false,
    ratioLock: true,
    version: 2,
    width,
  });
}

function representativeSource(includeWrappedImage = true): string {
  const lines: string[] = [];
  for (let index = 0; index < 20_000; index += 1) {
    if (includeWrappedImage && index === 10_000) {
      lines.push(wrappedImageSource());
    } else if (index % 9 === 0) {
      lines.push(
        `${"#".repeat((index % 5) + 1)} Seção ${index}: sociedade, religião e poder`,
      );
    } else if (index >= 220 && index < 280) {
      lines.push(`| Dinastia ${index - 219} | Período ${index} | Evidência |`);
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
  return lines.join("\n");
}

function validateStableLayout(): void {
  const sourceHost = benchmarkHost("source");
  reconcileSource(
    sourceHost.target,
    `before\n${wrappedImageSource()}\nbeside\n# Clear\nafter`,
  );
  forceLayout(sourceHost.target);
  const sourceImage = sourceHost.target.querySelector<HTMLElement>(
    ".md-source-image--wrap",
  )!;
  const sourceClear = sourceHost.target.children[3]!;
  const sourceValid =
    getComputedStyle(sourceImage).float === "left" &&
    getComputedStyle(sourceClear).clear === "both" &&
    getComputedStyle(sourceHost.target.children[4]!).contentVisibility ===
      "visible";
  sourceHost.host.remove();

  const previewHost = benchmarkHost("preview");
  renderMarkdownInto(
    previewHost.target,
    `${wrappedImageSource()}\n\nbeside\n\n# Clear\n\nafter`,
  );
  forceLayout(previewHost.target);
  const previewImage = previewHost.target.querySelector<HTMLElement>(
    ".markdown-image--wrap",
  )!;
  const previewClear = previewHost.target.children[2]!;
  const previewValid =
    getComputedStyle(previewImage).float === "left" &&
    getComputedStyle(previewClear).clear === "both" &&
    getComputedStyle(previewHost.target.children[3]!).contentVisibility ===
      "visible";
  previewHost.host.remove();

  if (!sourceValid || !previewValid) {
    throw new Error("Stable editor layout validation failed.");
  }

  const virtual = mountVirtualSource(
    [
      wrappedImageSource("left", 500, 100, 10),
      wrappedImageSource("right", 500, 100, 10),
      wrappedImageSource("left", 270, 100, 10),
      "after",
    ].join("\n"),
  );
  forceLayout(virtual.editor);
  const delayed = virtual.editor.querySelector<HTMLElement>(
    '[data-line="2"] .md-source-image--wrap',
  );
  const third = virtual.editor.querySelector<HTMLElement>(
    '[data-line="3"] .md-source-image--wrap',
  );
  if (!delayed || !third) {
    throw new Error("Virtual wrapped images did not mount.");
  }
  const delayedBounds = delayed.getBoundingClientRect();
  const thirdBounds = third.getBoundingClientRect();
  const virtualValid =
    getComputedStyle(delayed).position === "absolute" &&
    getComputedStyle(delayed).float === "none" &&
    Math.abs(delayedBounds.top - thirdBounds.top) < 1 &&
    thirdBounds.right <= delayedBounds.left + 1;
  flushSync(() => virtual.reactRoot.unmount());
  virtual.host.remove();
  if (!virtualValid) {
    throw new Error("Virtual wrapped image placement validation failed.");
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
    target.dispatchEvent(new Event("scroll"));
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
  kind: "preview" | "source",
): Promise<RenderBenchmark> {
  const render: (
    target: HTMLElement,
    value: string,
    change?: SourceTextChange,
  ) => void =
    kind === "source"
      ? (target, value, change) => reconcileSource(target, value, false, change)
      : (target, value) => renderMarkdownInto(target, value);
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
  const marker = "vida cotidiana";
  const editOffset = source.indexOf(marker, Math.floor(source.length / 3));
  const before = source.slice(0, editOffset);
  const after = source.slice(editOffset + marker.length);
  const editSamples: number[] = [];
  let previousInserted = marker;
  for (let iteration = 0; iteration < 11; iteration += 1) {
    const inserted = `${marker} ${iteration}`;
    const next = `${before}${inserted}${after}`;
    const change = {
      from: editOffset,
      insert: inserted,
      to: editOffset + previousInserted.length,
    };
    const startedAt = performance.now();
    render(target, next, change);
    forceLayout(target);
    editSamples.push(performance.now() - startedAt);
    previousInserted = inserted;
  }
  const result = {
    descendantNodes: target.querySelectorAll("*").length,
    edit: summarize(editSamples.slice(2)),
    initial: summarize(initialSamples.slice(2)),
    scroll: await benchmarkScroll(target),
    scrollHeight: target.scrollHeight,
  };
  host.remove();
  return result;
}

async function benchmarkCooperativePreview(
  source: string,
): Promise<CooperativePreviewBenchmark> {
  const { host, target } = benchmarkHost("preview");
  const observedTasks: PerformanceEntry[] = [];
  await nextFrame();
  const observer =
    typeof PerformanceObserver === "undefined"
      ? undefined
      : new PerformanceObserver((entries) => {
          observedTasks.push(...entries.getEntries());
        });
  observer?.observe({ entryTypes: ["longtask"] });
  await nextFrame();
  const startedAt = performance.now();
  await renderMarkdownIntoCooperatively(target, source);
  forceLayout(target);
  await nextFrame();
  const finishedAt = performance.now();
  await nextFrame();
  observedTasks.push(...(observer?.takeRecords() ?? []));
  observer?.disconnect();
  const longTasks = observedTasks
    .filter(
      (entry) =>
        entry.duration > 50 &&
        entry.startTime <= finishedAt &&
        entry.startTime + entry.duration >= startedAt,
    )
    .map((entry) => entry.duration);
  const result = {
    descendantNodes: target.querySelectorAll("*").length,
    durationMs: finishedAt - startedAt,
    longTasks: summarize(longTasks),
  };
  host.remove();
  return result;
}

function benchmarkSpellcheck(source: string): {
  fullDocument: SpellcheckBenchmark;
  visibleWindow: SpellcheckBenchmark;
} {
  const misspelled = [
    "administração",
    "comércio",
    "cotidiana",
    "evidência",
    "período",
    "política",
    "referências",
    "religião",
    "sociedade",
  ];
  const measure = (range?: {
    endLine: number;
    startLine: number;
  }): SpellcheckBenchmark => {
    const { host, target } = benchmarkHost("source");
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
      markers: target.querySelectorAll(".md-spelling-error").length,
      ...(range ? { range } : {}),
    };
    host.remove();
    return result;
  };

  const probe = benchmarkHost("source");
  reconcileSource(probe.target, source);
  forceLayout(probe.target);
  probe.target.scrollTop = probe.target.scrollHeight / 2;
  const range = sourceSpellcheckViewportRange(
    probe.target,
    source.split("\n").length,
  );
  probe.host.remove();
  return {
    fullDocument: measure(),
    visibleWindow: measure(range),
  };
}

function benchmarkInteractions(source: string): InteractionBenchmark {
  const marker = "vida cotidiana";
  const offset = source.indexOf(marker, Math.floor(source.length / 2));
  const selection = {
    direction: "none" as const,
    end: offset + marker.length,
    start: offset + marker.length,
  };
  const measureDelete = (inputType: string): BenchmarkResult => {
    const samples: number[] = [];
    for (let iteration = 0; iteration < 25; iteration += 1) {
      const startedAt = performance.now();
      const result = resolveMarkdownTypingInput(
        { content: source, selection },
        inputType,
        null,
        null,
      );
      if (!result || result.content === source) {
        throw new Error(`${inputType} did not update the benchmark source.`);
      }
      samples.push(performance.now() - startedAt);
    }
    return summarize(samples.slice(5));
  };
  const selectAll = {
    direction: "forward" as const,
    end: source.length,
    start: 0,
  };
  const coldStartedAt = performance.now();
  sourcePositionStatus(source, selectAll);
  const selectAllColdMs = performance.now() - coldStartedAt;
  const warmSamples: number[] = [];
  for (let iteration = 0; iteration < 25; iteration += 1) {
    const startedAt = performance.now();
    sourcePositionStatus(source, selectAll);
    warmSamples.push(performance.now() - startedAt);
  }
  return {
    backspace: measureDelete("deleteContentBackward"),
    deleteWordBackward: measureDelete("deleteWordBackward"),
    selectAllColdMs,
    selectAllWarm: summarize(warmSamples.slice(5)),
  };
}

function benchmarkPaneMotion(source: string): PaneMotionBenchmark {
  const { host, target } = benchmarkHost("source");
  host.remove();

  const pane = document.createElement("section");
  const bar = document.createElement("div");
  const content = document.createElement("div");
  pane.className = "workspace-pane";
  pane.style.position = "relative";
  pane.style.width = "1000px";
  pane.style.height = "650px";
  bar.className = "workspace-pane__bar";
  content.className = "workspace-pane__content";
  host.style.width = "100%";
  host.style.height = "100%";
  content.appendChild(host);
  pane.append(bar, content);
  document.body.appendChild(pane);

  reconcileSource(target, source);
  forceLayout(target);
  const contentBounds = content.getBoundingClientRect();
  content.dataset.motionLocked = "";
  content.style.width = `${contentBounds.width}px`;
  content.style.height = `${contentBounds.height}px`;
  forceLayout(content);

  const sourceWidthDuringPx = target.getBoundingClientRect().width;
  const samples: number[] = [];
  for (let frame = 1; frame <= 12; frame += 1) {
    const startedAt = performance.now();
    pane.style.width = `${1000 - (500 * frame) / 12}px`;
    forceLayout(pane);
    samples.push(performance.now() - startedAt);
  }

  const settleStartedAt = performance.now();
  delete content.dataset.motionLocked;
  content.style.removeProperty("width");
  content.style.removeProperty("height");
  forceLayout(target);
  const settleMs = performance.now() - settleStartedAt;
  const sourceWidthAfterPx = target.getBoundingClientRect().width;
  pane.remove();

  return {
    lockedLayout: summarize(samples),
    settleMs,
    sourceWidthAfterPx,
    sourceWidthDuringPx,
  };
}

function benchmarkVirtualPaneMotion(source: string): PaneMotionBenchmark {
  const mounted = mountVirtualSource(source);
  mounted.host.remove();
  const pane = document.createElement("section");
  const bar = document.createElement("div");
  const content = document.createElement("div");
  pane.className = "workspace-pane";
  pane.style.position = "relative";
  pane.style.width = "1000px";
  pane.style.height = "650px";
  bar.className = "workspace-pane__bar";
  content.className = "workspace-pane__content";
  mounted.host.style.width = "100%";
  mounted.host.style.height = "100%";
  content.appendChild(mounted.host);
  pane.append(bar, content);
  document.body.appendChild(pane);

  forceLayout(mounted.editor);
  const contentBounds = content.getBoundingClientRect();
  content.dataset.motionLocked = "";
  content.style.width = `${contentBounds.width}px`;
  content.style.height = `${contentBounds.height}px`;
  forceLayout(content);

  const sourceWidthDuringPx = mounted.editor.getBoundingClientRect().width;
  const samples: number[] = [];
  for (let frame = 1; frame <= 12; frame += 1) {
    const startedAt = performance.now();
    pane.style.width = `${1000 - (500 * frame) / 12}px`;
    forceLayout(pane);
    samples.push(performance.now() - startedAt);
  }

  const settleStartedAt = performance.now();
  delete content.dataset.motionLocked;
  content.style.removeProperty("width");
  content.style.removeProperty("height");
  forceLayout(mounted.editor);
  const settleMs = performance.now() - settleStartedAt;
  const sourceWidthAfterPx = mounted.editor.getBoundingClientRect().width;
  flushSync(() => mounted.reactRoot.unmount());
  pane.remove();
  return {
    lockedLayout: summarize(samples),
    settleMs,
    sourceWidthAfterPx,
    sourceWidthDuringPx,
  };
}

window.runVirtualSourceBenchmark = async () => {
  validateStableLayout();
  return {
    noMedia: await benchmarkVirtualSource(representativeSource(false)),
    wrappedImage: await benchmarkVirtualSource(representativeSource()),
  };
};

window.runLargeNotesBenchmark = async () => {
  document.body.style.margin = "0";
  const source = representativeSource();
  const sourceWithoutMedia = representativeSource(false);
  validateStableLayout();
  const result = {
    fixture: {
      characters: source.length,
      lines: source.split("\n").length,
    },
    paneMotion: benchmarkPaneMotion(source),
    virtualPaneMotion: benchmarkVirtualPaneMotion(source),
    cooperativePreview: await benchmarkCooperativePreview(source),
    interaction: benchmarkInteractions(source),
    stableLayoutValidated: true,
    preview: await benchmarkRender(source, "preview"),
    source: await benchmarkRender(source, "source"),
    virtualSourceNoMedia: await benchmarkVirtualSource(sourceWithoutMedia),
    virtualSource: await benchmarkVirtualSource(source),
    spellcheck: benchmarkSpellcheck(source),
    viewport: { height: 650, width: 1_000 },
  };
  return result;
};
