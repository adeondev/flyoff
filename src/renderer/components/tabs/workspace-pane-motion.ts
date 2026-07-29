export const PANE_EXIT_DURATION_MS = 120;

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

export function waitForWorkspaceMotion(delayMs: number): Promise<void> {
  if (workspaceMotionReduced()) {
    return Promise.resolve();
  }
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}
