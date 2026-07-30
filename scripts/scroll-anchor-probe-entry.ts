import { WindowedSourceView } from '../src/renderer/projects/source-engine/windowed-source-view';

interface AnchorReading {
  line: number;
  offsetWithinPx: number;
  scrollHeight: number;
  scrollTop: number;
  width: number;
}

interface PhaseReading extends AnchorReading {
  phase: string;
}

interface ProbeResult {
  fixture: { characters: number; lines: number };
  readings: PhaseReading[];
  hiddenRoundTrip: { lineDelta: number; readings: PhaseReading[] };
  paneSplit: { lineDelta: number; pixelDelta: number };
  paneSplitRestore: { lineDelta: number };
}

declare global {
  interface Window {
    runScrollAnchorProbe: (lineCount: number) => Promise<ProbeResult>;
  }
}

function representativeSource(lineCount: number): string {
  const lines: string[] = [];
  for (let index = 0; index < lineCount; index += 1) {
    if (index % 9 === 0) {
      lines.push(
        `${'#'.repeat((index % 5) + 1)} Seção ${index}: sociedade, religião e poder`,
      );
    } else if (index % 4 === 0) {
      lines.push(
        `- Item ${index}: administração, comércio e **vida cotidiana** com um trecho longo o bastante para quebrar em telas estreitas.`,
      );
    } else if (index % 33 === 0) {
      lines.push(
        `Consulte [fonte ${index}](https://example.com/${index}) e referências.`,
      );
    } else {
      lines.push(
        `Registro ${index}: política, religião e vida cotidiana no período, com detalhe suficiente para reagir à largura do painel.`,
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The line drawn at the top edge of the scroller, read from real geometry.
 *
 * Reading it from the height map would only report what the engine believes;
 * this probe exists to catch the engine believing the wrong thing.
 */
function readAnchor(
  target: HTMLElement,
  view: WindowedSourceView,
): AnchorReading {
  const rootRect = target.getBoundingClientRect();
  let best: { line: number; top: number } | undefined;
  for (const element of view.getVisibleLineElements()) {
    const line = Number.parseInt(element.dataset.line ?? '', 10);
    if (!Number.isFinite(line)) {
      continue;
    }
    const rect = element.getBoundingClientRect();
    if (rect.bottom <= rootRect.top + 0.5) {
      continue;
    }
    if (!best || rect.top < best.top) {
      best = { line, top: rect.top };
    }
  }
  return {
    line: best ? best.line : -1,
    offsetWithinPx: best ? rootRect.top - best.top : 0,
    scrollHeight: target.scrollHeight,
    scrollTop: target.scrollTop,
    width: target.clientWidth,
  };
}

async function settle(target: HTMLElement, frames = 14): Promise<void> {
  for (let index = 0; index < frames; index += 1) {
    await nextFrame();
  }
  // The view consolidates deferred measurement 80 ms after scrolling stops.
  await wait(160);
  await nextFrame();
  void target.scrollHeight;
}

/**
 * A pane split is a 120 ms `grid-template-columns` transition, so the editor
 * width changes on every frame of it rather than once.
 */
async function animateWidth(
  shell: HTMLElement,
  target: HTMLElement,
  view: WindowedSourceView,
  from: number,
  to: number,
  frames: number,
  trace: PhaseReading[],
  label: string,
): Promise<void> {
  for (let index = 1; index <= frames; index += 1) {
    const ratio = index / frames;
    shell.style.width = `${Math.round(from + (to - from) * ratio)}px`;
    await nextFrame();
    trace.push({ ...readAnchor(target, view), phase: `${label}:${index}` });
  }
}

window.runScrollAnchorProbe = async (lineCount) => {
  const source = representativeSource(lineCount);
  const shell = host();
  const view = new WindowedSourceView(shell.target, {
    ariaLabel: 'Probe',
    readOnly: false,
    selection: { direction: 'none', end: 0, start: 0 },
    source,
  });
  const readings: PhaseReading[] = [];
  try {
    await settle(shell.target);

    shell.target.scrollTop = Math.round(shell.target.scrollHeight * 0.42);
    await settle(shell.target);
    const before = readAnchor(shell.target, view);
    readings.push({ ...before, phase: 'before-split' });

    await animateWidth(
      shell.host,
      shell.target,
      view,
      1000,
      520,
      7,
      readings,
      'split',
    );
    await settle(shell.target);
    const afterSplit = readAnchor(shell.target, view);
    readings.push({ ...afterSplit, phase: 'after-split' });

    await animateWidth(
      shell.host,
      shell.target,
      view,
      520,
      1000,
      7,
      readings,
      'restore',
    );
    await settle(shell.target);
    const afterRestore = readAnchor(shell.target, view);
    readings.push({ ...afterRestore, phase: 'after-restore' });

    const hiddenReadings: PhaseReading[] = [];
    const beforeHide = readAnchor(shell.target, view);
    hiddenReadings.push({ ...beforeHide, phase: 'before-hide' });
    shell.host.style.display = 'none';
    await settle(shell.target, 6);
    shell.host.style.display = '';
    await settle(shell.target);
    const afterShow = readAnchor(shell.target, view);
    hiddenReadings.push({ ...afterShow, phase: 'after-show' });

    return {
      fixture: { characters: source.length, lines: lineCount },
      hiddenRoundTrip: {
        lineDelta: afterShow.line - beforeHide.line,
        readings: hiddenReadings,
      },
      paneSplit: {
        lineDelta: afterSplit.line - before.line,
        pixelDelta: afterSplit.scrollTop - before.scrollTop,
      },
      paneSplitRestore: { lineDelta: afterRestore.line - afterSplit.line },
      readings,
    };
  } finally {
    view.dispose();
    shell.host.remove();
  }
};
