export type WorkspacePaneExitPlacement =
  | 'row-start'
  | 'row-end'
  | 'column-start'
  | 'column-end';

export const PANE_EXIT_DURATION_MS = 120;
const pendingPaneExits = new WeakMap<HTMLElement, Promise<void>>();

export function workspaceMotionReduced(): boolean {
  const preference = document.documentElement.dataset.motion;
  if (preference === 'reduced') {
    return true;
  }
  if (preference === 'full') {
    return false;
  }
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function resolveWorkspacePaneExitPlacement(
  pane: HTMLElement,
): WorkspacePaneExitPlacement | undefined {
  const split = pane.parentElement;
  if (!split?.classList.contains('workspace-split')) {
    return undefined;
  }
  const first = split.firstElementChild === pane;
  if (split.classList.contains('workspace-split--row')) {
    return first ? 'row-start' : 'row-end';
  }
  if (split.classList.contains('workspace-split--column')) {
    return first ? 'column-start' : 'column-end';
  }
  return undefined;
}

export function animateWorkspacePaneExit(
  pane: HTMLElement | null,
  durationMs = PANE_EXIT_DURATION_MS,
): Promise<void> {
  if (!pane || workspaceMotionReduced()) {
    return Promise.resolve();
  }
  const existing = pendingPaneExits.get(pane);
  if (existing) {
    return existing;
  }
  const split = pane.parentElement;
  const placement = resolveWorkspacePaneExitPlacement(pane);
  if (!split || !placement) {
    return Promise.resolve();
  }

  const pending = new Promise<void>((resolve) => {
    let settled = false;
    let timeout = 0;
    const retainCollapsedFrame = (): void => {
      window.setTimeout(() => {
        if (split.isConnected) {
          split.removeAttribute('data-split-exit');
          pane.removeAttribute('data-pane-exiting');
        }
      }, durationMs);
    };
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeout);
      split.removeEventListener('animationend', handleAnimationEnd);
      pendingPaneExits.delete(pane);
      retainCollapsedFrame();
      resolve();
    };
    const handleAnimationEnd = (event: AnimationEvent): void => {
      if (event.target === split) {
        finish();
      }
    };

    split.addEventListener('animationend', handleAnimationEnd);
    pane.setAttribute('data-pane-exiting', 'true');
    split.removeAttribute('data-split-entry');
    split.style.setProperty(
      '--workspace-pane-exit-duration',
      `${durationMs}ms`,
    );
    split.setAttribute('data-split-exit', placement);
    timeout = window.setTimeout(finish, durationMs + 80);
  });
  pendingPaneExits.set(pane, pending);
  return pending;
}

export function waitForWorkspaceMotion(delayMs: number): Promise<void> {
  if (workspaceMotionReduced()) {
    return Promise.resolve();
  }
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}
