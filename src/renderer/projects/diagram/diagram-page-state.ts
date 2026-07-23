import type { PageSessionState } from '../../../shared/contracts';
import type { DiagramViewport } from '../../../shared/diagram';

export const DIAGRAM_PAGE_STATE_VERSION = 1;
const DEFAULT_VIEWPORT: DiagramViewport = { x: 80, y: 72, zoom: 1 };

export function readDiagramViewport(state: PageSessionState): DiagramViewport {
  if (
    state.version !== DIAGRAM_PAGE_STATE_VERSION ||
    !state.data ||
    typeof state.data !== 'object' ||
    Array.isArray(state.data)
  ) {
    return DEFAULT_VIEWPORT;
  }
  const viewport = (state.data as { viewport?: unknown }).viewport;
  if (!viewport || typeof viewport !== 'object' || Array.isArray(viewport)) {
    return DEFAULT_VIEWPORT;
  }
  const candidate = viewport as Record<string, unknown>;
  return typeof candidate.x === 'number' &&
    Number.isFinite(candidate.x) &&
    typeof candidate.y === 'number' &&
    Number.isFinite(candidate.y) &&
    typeof candidate.zoom === 'number' &&
    Number.isFinite(candidate.zoom) &&
    candidate.zoom >= 0.15 &&
    candidate.zoom <= 4
    ? { x: candidate.x, y: candidate.y, zoom: candidate.zoom }
    : DEFAULT_VIEWPORT;
}

export function updateDiagramViewportState(
  state: PageSessionState,
  viewport: DiagramViewport,
): PageSessionState {
  return {
    version: DIAGRAM_PAGE_STATE_VERSION,
    data: {
      ...(state.version === DIAGRAM_PAGE_STATE_VERSION &&
      state.data &&
      typeof state.data === 'object' &&
      !Array.isArray(state.data)
        ? state.data
        : {}),
      viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
    },
  };
}
