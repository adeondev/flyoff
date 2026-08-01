export type DiagnosticControlKind =
  | 'left'
  | 'opacity'
  | 'transform'
  | 'transform-js';

export interface RendererPerformanceDiagnosticConfig {
  lineCount: number;
  refreshRate: number;
}

export interface DiagnosticRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface DiagnosticScrollbarGeometry {
  end: { x: number; y: number };
  initialScrollTop: number;
  maximumScrollTop: number;
  start: { x: number; y: number };
}

export interface DiagnosticReactCommit {
  actualDuration: number;
  baseDuration: number;
  commitTime: number;
  phase: string;
  scenario: string | null;
  startTime: number;
}

export interface DiagnosticCadenceReport {
  durationMs: number;
  frames: number;
  longestMs: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  near16: number;
  near33: number;
  near50: number;
  near66: number;
  beyond75: number;
  refreshBuckets: readonly {
    multiple: number;
    frames: number;
    targetMs: number;
  }[];
  longTasks: number;
  longTaskMs: number;
  react: {
    actualDurationMs: number;
    commits: number;
    longestCommitMs: number;
  };
}

export interface RendererDiagnosticEnvironment {
  devicePixelRatio: number;
  documentVisibility: DocumentVisibilityState;
  editor: {
    clientHeight: number;
    clientWidth: number;
    descendantNodes: number;
    mountedLines: number;
    scrollHeight: number;
  };
  prefersReducedMotion: boolean;
  screen: {
    availHeight: number;
    availWidth: number;
    colorDepth: number;
    height: number;
    pixelDepth: number;
    width: number;
  };
  userAgent: string;
}

export interface RendererPerformanceDiagnosticController {
  click(selector: string, index?: number): void;
  environment(): RendererDiagnosticEnvironment;
  finish(label: string): DiagnosticCadenceReport;
  focusEditor(): void;
  rect(selector: string, index?: number): DiagnosticRect;
  runControl(kind: DiagnosticControlKind, durationMs: number): Promise<void>;
  scrollbarGeometry(): DiagnosticScrollbarGeometry;
  start(label: string): void;
  tabRects(): DiagnosticRect[];
  wait(milliseconds: number): Promise<void>;
}

declare global {
  interface Window {
    __flyoffPerformanceDiagnostic?: RendererPerformanceDiagnosticController;
    __flyoffPerformanceReactCommits?: DiagnosticReactCommit[];
  }
}

function rendererPerformanceDiagnosticBootstrap(
  config: RendererPerformanceDiagnosticConfig,
): Promise<RendererDiagnosticEnvironment> {
  return (async () => {
    const delay = (milliseconds: number) =>
      new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
    const visible = (element: Element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const bounds = element.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    };
    const waitFor = async <T>(
      read: () => T | null | undefined | false,
      description: string,
      timeoutMs = 30_000,
    ): Promise<T> => {
      const started = performance.now();
      while (performance.now() - started < timeoutMs) {
        const value = read();
        if (value) {
          return value;
        }
        await delay(16);
      }
      throw new Error(`Timed out waiting for ${description}.`);
    };
    const queryVisible = (selector: string): HTMLElement | undefined =>
      Array.from(document.querySelectorAll(selector)).find(visible);
    const setInputValue = (
      input: HTMLInputElement,
      value: string,
    ): void => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };

    await waitFor(
      () => ['en-US', 'pt-BR'].includes(document.documentElement.lang),
      'the renderer locale',
    );
    const newProject = await waitFor(
      () => queryVisible('.home__action-list button:first-child'),
      'the new project control',
    );
    newProject.click();

    const projectForm = await waitFor(
      () => queryVisible('.flyoff-dialog__form'),
      'the project form',
    );
    const projectName = projectForm.querySelector('input');
    if (!(projectName instanceof HTMLInputElement)) {
      throw new Error('The project name input is unavailable.');
    }
    setInputValue(projectName, 'Cadence');
    const chooseLocation = projectForm.querySelector(
      '.create-project-dialog__location button',
    );
    if (!(chooseLocation instanceof HTMLButtonElement)) {
      throw new Error('The project location control is unavailable.');
    }
    chooseLocation.click();
    const createProject = await waitFor(
      () => {
        const button = queryVisible(
          '.flyoff-dialog__button--primary[form]',
        );
        return button instanceof HTMLButtonElement && !button.disabled
          ? button
          : undefined;
      },
      'the enabled project creation control',
    );
    createProject.click();

    const addInstance = await waitFor(
      () =>
        queryVisible(
          '.project-sidebar__tools button[aria-haspopup="dialog"]',
        ),
      'the add instance control',
      60_000,
    );
    addInstance.click();
    const markdownOption = await waitFor(
      () => queryVisible('[data-instance-type="markdown"]'),
      'the Markdown instance option',
    );
    markdownOption.click();

    const inlineForm = await waitFor(
      () => queryVisible('.project-tree__inline-editor'),
      'the note name form',
    );
    const noteName = inlineForm.querySelector('input');
    if (!(noteName instanceof HTMLInputElement)) {
      throw new Error('The note name input is unavailable.');
    }
    setInputValue(noteName, 'Long note');
    if (!(inlineForm instanceof HTMLFormElement)) {
      throw new Error('The note name form is invalid.');
    }
    inlineForm.requestSubmit();

    const editor = await waitFor(
      () => queryVisible('.markdown-source__editor'),
      'the Markdown source editor',
      60_000,
    );
    const source = Array.from({ length: config.lineCount }, (_, index) => {
      if (index % 47 === 0) {
        return `## Section ${index}`;
      }
      if (index % 4 === 0) {
        return `- Item ${index}: **Markdown** with enough text on the line that a narrower pane forces it to wrap onto a second row.`;
      }
      return `Line ${index}: political, religious and everyday record with enough text to react to the pane width.`;
    }).join('\n');
    editor.focus();
    editor.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: source,
        inputType: 'insertFromPaste',
      }),
    );

    const windowedEditor = await waitFor(
      () => {
        const candidate = queryVisible(
          '.markdown-source__editor[data-windowed="true"]',
        );
        return candidate?.dataset.sourceLineCount === String(config.lineCount)
          ? candidate
          : undefined;
      },
      'the windowed editor fixture',
      60_000,
    );
    windowedEditor.scrollTop = Math.round(windowedEditor.scrollHeight * 0.35);
    await delay(900);

    const state = {
      intervals: [] as number[],
      label: '',
      last: 0,
      longTasks: [] as number[],
      reactStart: 0,
      recording: false,
      started: 0,
    };
    const commits = (window.__flyoffPerformanceReactCommits ??= []);
    const traceMarker = (label: string, edge: 'end' | 'start') => {
      const marker = `flyoff-diagnostic:${label}:${edge}`;
      performance.mark(marker);
      console.timeStamp(marker);
    };
    const tick = (now: number) => {
      if (state.recording && state.last > 0) {
        state.intervals.push(now - state.last);
      }
      state.last = state.recording ? now : 0;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    try {
      new PerformanceObserver((list) => {
        if (!state.recording) {
          return;
        }
        for (const entry of list.getEntries()) {
          state.longTasks.push(entry.duration);
        }
      }).observe({ entryTypes: ['longtask'] });
    } catch {
      // Frame cadence remains available when Long Tasks are unsupported.
    }

    const round = (value: number): number => Number(value.toFixed(2));
    const percentile = (sorted: readonly number[], share: number): number =>
      sorted.length === 0
        ? 0
        : (sorted[
            Math.min(sorted.length - 1, Math.floor(sorted.length * share))
          ] ?? 0);
    const bucket = (
      intervals: readonly number[],
      centre: number,
      tolerance: number,
    ): number =>
      intervals.filter((value) => Math.abs(value - centre) <= tolerance)
        .length;
    const toRect = (element: Element): DiagnosticRect => {
      const bounds = element.getBoundingClientRect();
      return {
        height: bounds.height,
        width: bounds.width,
        x: bounds.x,
        y: bounds.y,
      };
    };
    const selected = (selector: string, index = 0): HTMLElement => {
      const elements = Array.from(document.querySelectorAll(selector)).filter(
        visible,
      );
      const element = elements[index];
      if (!element) {
        throw new Error(`Diagnostic element not found: ${selector}[${index}]`);
      }
      return element;
    };
    const currentEditor = (): HTMLElement =>
      selected('.markdown-source__editor');

    window.__flyoffPerformanceDiagnostic = {
      click(selector, index = 0) {
        selected(selector, index).click();
      },
      environment() {
        const activeEditor = currentEditor();
        return {
          devicePixelRatio: window.devicePixelRatio,
          documentVisibility: document.visibilityState,
          editor: {
            clientHeight: activeEditor.clientHeight,
            clientWidth: activeEditor.clientWidth,
            descendantNodes: activeEditor.querySelectorAll('*').length,
            mountedLines: activeEditor.querySelectorAll('[data-line]').length,
            scrollHeight: activeEditor.scrollHeight,
          },
          prefersReducedMotion: window.matchMedia(
            '(prefers-reduced-motion: reduce)',
          ).matches,
          screen: {
            availHeight: screen.availHeight,
            availWidth: screen.availWidth,
            colorDepth: screen.colorDepth,
            height: screen.height,
            pixelDepth: screen.pixelDepth,
            width: screen.width,
          },
          userAgent: navigator.userAgent,
        };
      },
      finish(label) {
        if (!state.recording || state.label !== label) {
          throw new Error(`Diagnostic scenario is not active: ${label}`);
        }
        state.recording = false;
        traceMarker(label, 'end');
        delete document.documentElement.dataset.performanceDiagnosticScenario;
        const sorted = [...state.intervals].sort((left, right) => left - right);
        const scenarioCommits = commits.slice(state.reactStart);
        const refreshInterval = 1_000 / Math.max(1, config.refreshRate);
        const refreshTolerance = refreshInterval / 2;
        return {
          beyond75: sorted.filter((value) => value > 75).length,
          durationMs: round(performance.now() - state.started),
          frames: sorted.length,
          longTaskMs: round(
            state.longTasks.reduce((total, value) => total + value, 0),
          ),
          longTasks: state.longTasks.length,
          longestMs: round(sorted.at(-1) ?? 0),
          medianMs: round(percentile(sorted, 0.5)),
          near16: bucket(sorted, 16.67, 8.33),
          near33: bucket(sorted, 33.33, 8.33),
          near50: bucket(sorted, 50, 8.33),
          near66: bucket(sorted, 66.67, 8.33),
          p95Ms: round(percentile(sorted, 0.95)),
          p99Ms: round(percentile(sorted, 0.99)),
          react: {
            actualDurationMs: round(
              scenarioCommits.reduce(
                (total, commit) => total + commit.actualDuration,
                0,
              ),
            ),
            commits: scenarioCommits.length,
            longestCommitMs: round(
              Math.max(0, ...scenarioCommits.map(({ actualDuration }) =>
                actualDuration,
              )),
            ),
          },
          refreshBuckets: [1, 2, 3, 4].map((multiple) => ({
            frames: bucket(
              sorted,
              refreshInterval * multiple,
              refreshTolerance,
            ),
            multiple,
            targetMs: round(refreshInterval * multiple),
          })),
        };
      },
      focusEditor() {
        const activeEditor = currentEditor();
        const input = activeEditor.querySelector('textarea');
        (input instanceof HTMLElement ? input : activeEditor).focus();
      },
      rect(selector, index = 0) {
        return toRect(selected(selector, index));
      },
      async runControl(kind, durationMs) {
        const probe = document.createElement('div');
        probe.style.cssText =
          'position:fixed;top:4px;left:4px;width:40px;height:40px;' +
          'background:#8b5cf6;contain:strict;z-index:2147483647;' +
          'pointer-events:none;';
        if (kind === 'opacity') {
          probe.style.willChange = 'opacity';
        } else if (kind !== 'left') {
          probe.style.willChange = 'transform';
        }
        document.body.appendChild(probe);
        try {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          if (kind === 'transform-js') {
            const started = performance.now();
            await new Promise<void>((resolve) => {
              const step = () => {
                const elapsed = performance.now() - started;
                const offset = Math.round(
                  Math.sin(elapsed / 120) * 120 + 130,
                );
                probe.style.transform = `translate3d(${offset}px,0,0)`;
                if (elapsed < durationMs) {
                  requestAnimationFrame(step);
                } else {
                  resolve();
                }
              };
              requestAnimationFrame(step);
            });
            return;
          }
          const keyframes: Keyframe[] =
            kind === 'opacity'
              ? [{ opacity: 1 }, { opacity: 0.25 }, { opacity: 1 }]
              : kind === 'left'
                ? [{ left: '4px' }, { left: '260px' }, { left: '4px' }]
                : [
                    { transform: 'translate3d(0,0,0)' },
                    { transform: 'translate3d(256px,0,0)' },
                    { transform: 'translate3d(0,0,0)' },
                  ];
          await probe.animate(keyframes, {
            duration: durationMs,
            easing: 'linear',
          }).finished;
        } finally {
          probe.remove();
        }
      },
      scrollbarGeometry() {
        const activeEditor = currentEditor();
        const bounds = activeEditor.getBoundingClientRect();
        const maximumScrollTop = Math.max(
          0,
          activeEditor.scrollHeight - activeEditor.clientHeight,
        );
        const thumbHeight = Math.max(
          20,
          (activeEditor.clientHeight * activeEditor.clientHeight) /
            activeEditor.scrollHeight,
        );
        const travel = Math.max(1, activeEditor.clientHeight - thumbHeight);
        const ratio =
          maximumScrollTop > 0 ? activeEditor.scrollTop / maximumScrollTop : 0;
        const startY = bounds.top + ratio * travel + thumbHeight / 2;
        const endY = Math.min(
          bounds.bottom - thumbHeight / 2,
          startY + travel * 0.35,
        );
        return {
          end: { x: bounds.right - 4, y: endY },
          initialScrollTop: activeEditor.scrollTop,
          maximumScrollTop,
          start: { x: bounds.right - 4, y: startY },
        };
      },
      start(label) {
        if (state.recording) {
          throw new Error(`Diagnostic scenario is already active: ${state.label}`);
        }
        state.intervals.length = 0;
        state.label = label;
        state.last = 0;
        state.longTasks.length = 0;
        state.reactStart = commits.length;
        state.recording = true;
        state.started = performance.now();
        document.documentElement.dataset.performanceDiagnosticScenario = label;
        traceMarker(label, 'start');
      },
      tabRects() {
        return Array.from(document.querySelectorAll('.page-tab__trigger'))
          .filter(visible)
          .map(toRect);
      },
      wait: delay,
    };

    return window.__flyoffPerformanceDiagnostic.environment();
  })();
}

export function rendererPerformanceDiagnosticSource(
  config: RendererPerformanceDiagnosticConfig,
): string {
  return `(${rendererPerformanceDiagnosticBootstrap.toString()})(${JSON.stringify(
    config,
  )})`;
}
