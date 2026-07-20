import type { TabTarget } from '../../../shared/contracts';

export const WORKSPACE_TAB_DRAG_TYPE = 'application/x-flyoff-tab';
export const WORKSPACE_PROJECT_NODE_DRAG_TYPE =
  'application/x-flyoff-project-node';
const WORKSPACE_DRAG_RESET_EVENT = 'flyoff:workspace-drag-reset';
const WORKSPACE_POINTER_DRAG_MOVE_EVENT =
  'flyoff:workspace-pointer-drag-move';
const WORKSPACE_POINTER_DRAG_DROP_EVENT =
  'flyoff:workspace-pointer-drag-drop';

export interface WorkspaceTabDragPayload {
  kind: 'tab';
  paneId: string;
  sessionId: string;
  tabId: string;
  targetKey: string;
}

export interface WorkspaceProjectNodeDragPayload {
  kind: 'project-node';
  sessionId: string;
  targets: readonly Extract<TabTarget, { type: 'project-content' }>[];
}

export type WorkspaceDragPayload =
  | WorkspaceTabDragPayload
  | WorkspaceProjectNodeDragPayload;

let activeWorkspaceDrag: WorkspaceDragPayload | undefined;
let pointerDragCandidate:
  | {
      payload: WorkspaceDragPayload;
      pointerId: number;
      startX: number;
      startY: number;
    }
  | undefined;
let workspaceDragSequence = 0;
const consumedWorkspaceDragIds = new Set<string>();

function nextWorkspaceDragId(): string {
  workspaceDragSequence += 1;
  return `workspace-drag-${workspaceDragSequence}`;
}

function rememberConsumedDrag(sessionId: string): void {
  consumedWorkspaceDragIds.add(sessionId);
  if (consumedWorkspaceDragIds.size <= 64) {
    return;
  }
  const oldest = consumedWorkspaceDragIds.values().next().value;
  if (oldest) {
    consumedWorkspaceDragIds.delete(oldest);
  }
}

export function isWorkspaceDragActive(): boolean {
  return document.documentElement.dataset.workspaceDragging === 'true';
}

export function clearWorkspaceDrag(): void {
  const hadActiveSession =
    Boolean(activeWorkspaceDrag) || isWorkspaceDragActive();
  activeWorkspaceDrag = undefined;
  pointerDragCandidate = undefined;
  delete document.documentElement.dataset.workspaceDragging;
  if (hadActiveSession) {
    document.dispatchEvent(new Event(WORKSPACE_DRAG_RESET_EVENT));
  }
}

export function installWorkspaceDragLifecycle(): () => void {
  const handleDragStart = () => {
    activeWorkspaceDrag = pointerDragCandidate?.payload;
    if (activeWorkspaceDrag) {
      document.documentElement.dataset.workspaceDragging = 'true';
    } else {
      clearWorkspaceDrag();
    }
  };
  const handleDragEnd = () => clearWorkspaceDrag();
  const handleDrop = () => queueMicrotask(clearWorkspaceDrag);
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      clearWorkspaceDrag();
    }
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      clearWorkspaceDrag();
    }
  };
  const handlePointerEnd = (event: PointerEvent) => {
    const candidate = pointerDragCandidate;
    if (!candidate || candidate.pointerId !== event.pointerId) {
      return;
    }
    if (isWorkspaceDragActive()) {
      document.dispatchEvent(
        new CustomEvent<WorkspacePointerDragDetail>(
          WORKSPACE_POINTER_DRAG_DROP_EVENT,
          {
            detail: {
              clientX: event.clientX,
              clientY: event.clientY,
              payload: candidate.payload,
            },
          },
        ),
      );
    }
    pointerDragCandidate = undefined;
  };
  const handlePointerMove = (event: PointerEvent) => {
    const candidate = pointerDragCandidate;
    if (!candidate || candidate.pointerId !== event.pointerId) {
      return;
    }
    if (
      Math.hypot(
        event.clientX - candidate.startX,
        event.clientY - candidate.startY,
      ) < 7
    ) {
      return;
    }
    const pointed = document.elementFromPoint(event.clientX, event.clientY);
    if (
      candidate.payload.kind === 'tab' &&
      pointed?.closest('.pages-bar') &&
      pointed.closest<HTMLElement>('.workspace-pane')?.dataset.paneId ===
        candidate.payload.paneId
    ) {
      return;
    }
    activeWorkspaceDrag = candidate.payload;
    document.documentElement.dataset.workspaceDragging = 'true';
    document.dispatchEvent(
      new CustomEvent<WorkspacePointerDragDetail>(
        WORKSPACE_POINTER_DRAG_MOVE_EVENT,
        {
          detail: {
            clientX: event.clientX,
            clientY: event.clientY,
            payload: candidate.payload,
          },
        },
      ),
    );
  };
  const handlePointerCancel = (event: PointerEvent) => {
    if (pointerDragCandidate?.pointerId === event.pointerId) {
      pointerDragCandidate = undefined;
    }
  };

  document.addEventListener('dragstart', handleDragStart, true);
  document.addEventListener('dragend', handleDragEnd, true);
  document.addEventListener('drop', handleDrop, true);
  document.addEventListener('keydown', handleKeyDown, true);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  document.addEventListener('pointermove', handlePointerMove, true);
  document.addEventListener('pointerup', handlePointerEnd, true);
  document.addEventListener('pointercancel', handlePointerCancel, true);

  return () => {
    document.removeEventListener('dragstart', handleDragStart, true);
    document.removeEventListener('dragend', handleDragEnd, true);
    document.removeEventListener('drop', handleDrop, true);
    document.removeEventListener('keydown', handleKeyDown, true);
    document.removeEventListener(
      'visibilitychange',
      handleVisibilityChange,
    );
    document.removeEventListener('pointermove', handlePointerMove, true);
    document.removeEventListener('pointerup', handlePointerEnd, true);
    document.removeEventListener('pointercancel', handlePointerCancel, true);
    clearWorkspaceDrag();
  };
}

export function subscribeWorkspaceDragReset(
  listener: () => void,
): () => void {
  document.addEventListener(WORKSPACE_DRAG_RESET_EVENT, listener);
  return () =>
    document.removeEventListener(WORKSPACE_DRAG_RESET_EVENT, listener);
}

function parsePayload<T extends WorkspaceDragPayload>(
  value: string,
  validate: (parsed: Record<string, unknown>) => boolean,
): T | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    return validate(record) ? (record as T) : undefined;
  } catch {
    return undefined;
  }
}

export function readWorkspaceDrag(
  dataTransfer: DataTransfer,
): WorkspaceDragPayload | undefined {
  const tab = parsePayload<WorkspaceTabDragPayload>(
    dataTransfer.getData(WORKSPACE_TAB_DRAG_TYPE),
    (parsed) =>
      parsed.kind === 'tab' &&
      typeof parsed.paneId === 'string' &&
      typeof parsed.sessionId === 'string' &&
      typeof parsed.tabId === 'string' &&
      typeof parsed.targetKey === 'string',
  );
  if (tab) {
    activeWorkspaceDrag = tab;
    return tab;
  }

  const projectNode = parsePayload<WorkspaceProjectNodeDragPayload>(
    dataTransfer.getData(WORKSPACE_PROJECT_NODE_DRAG_TYPE),
    (parsed) => {
      const targets = parsed.targets;
      return (
        parsed.kind === 'project-node' &&
        typeof parsed.sessionId === 'string' &&
        Array.isArray(targets) &&
        targets.length > 0 &&
        targets.length <= 500 &&
        targets.every(
          (target) =>
            typeof target === 'object' &&
            target !== null &&
            (target as Record<string, unknown>).type === 'project-content' &&
            typeof (target as Record<string, unknown>).projectId === 'string' &&
            typeof (target as Record<string, unknown>).nodeId === 'string' &&
            typeof (target as Record<string, unknown>).pageType === 'string',
        )
      );
    },
  );
  if (projectNode) {
    activeWorkspaceDrag = projectNode;
  }
  return (
    projectNode ??
    (isWorkspaceDragActive() ? activeWorkspaceDrag : undefined)
  );
}

export function beginWorkspaceTabPointerDrag(
  paneId: string,
  tabId: string,
  targetKey: string,
  pointerId: number,
  clientX: number,
  clientY: number,
): void {
  pointerDragCandidate = {
    payload: {
      kind: 'tab',
      paneId,
      sessionId: nextWorkspaceDragId(),
      tabId,
      targetKey,
    },
    pointerId,
    startX: clientX,
    startY: clientY,
  };
}

export function beginWorkspaceProjectNodePointerDrag(
  targets: WorkspaceProjectNodeDragPayload['targets'],
  pointerId: number,
  clientX: number,
  clientY: number,
): void {
  pointerDragCandidate = {
    payload: {
      kind: 'project-node',
      sessionId: nextWorkspaceDragId(),
      targets,
    },
    pointerId,
    startX: clientX,
    startY: clientY,
  };
}

export interface WorkspacePointerDragDetail {
  clientX: number;
  clientY: number;
  payload: WorkspaceDragPayload;
}

export function subscribeWorkspacePointerDrag(
  onMove: (detail: WorkspacePointerDragDetail) => void,
  onDrop: (detail: WorkspacePointerDragDetail) => void,
): () => void {
  const handleMove = (event: Event) =>
    onMove((event as CustomEvent<WorkspacePointerDragDetail>).detail);
  const handleDrop = (event: Event) =>
    onDrop((event as CustomEvent<WorkspacePointerDragDetail>).detail);
  document.addEventListener(WORKSPACE_POINTER_DRAG_MOVE_EVENT, handleMove);
  document.addEventListener(WORKSPACE_POINTER_DRAG_DROP_EVENT, handleDrop);
  return () => {
    document.removeEventListener(
      WORKSPACE_POINTER_DRAG_MOVE_EVENT,
      handleMove,
    );
    document.removeEventListener(
      WORKSPACE_POINTER_DRAG_DROP_EVENT,
      handleDrop,
    );
  };
}

export function consumeWorkspacePointerDrag(
  payload: WorkspaceDragPayload,
): WorkspaceDragPayload | undefined {
  if (consumedWorkspaceDragIds.has(payload.sessionId)) {
    clearWorkspaceDrag();
    return undefined;
  }
  rememberConsumedDrag(payload.sessionId);
  clearWorkspaceDrag();
  return payload;
}

export function consumeWorkspaceDrag(
  dataTransfer: DataTransfer,
): WorkspaceDragPayload | undefined {
  const payload =
    readWorkspaceDrag(dataTransfer) ??
    (isWorkspaceDragActive() ? activeWorkspaceDrag : undefined);
  if (!payload || consumedWorkspaceDragIds.has(payload.sessionId)) {
    clearWorkspaceDrag();
    return undefined;
  }
  rememberConsumedDrag(payload.sessionId);
  clearWorkspaceDrag();
  return payload;
}

export function hasWorkspaceDrag(dataTransfer: DataTransfer): boolean {
  return (
    Boolean(activeWorkspaceDrag && isWorkspaceDragActive()) ||
    dataTransfer.types.includes(WORKSPACE_TAB_DRAG_TYPE) ||
    dataTransfer.types.includes(WORKSPACE_PROJECT_NODE_DRAG_TYPE)
  );
}

export function writeWorkspaceTabDrag(
  dataTransfer: DataTransfer,
  paneId: string,
  tabId: string,
  targetKey: string,
): void {
  const candidate = pointerDragCandidate?.payload;
  const payload: WorkspaceTabDragPayload =
    candidate?.kind === 'tab' &&
    candidate.paneId === paneId &&
    candidate.tabId === tabId
      ? candidate
      : {
          kind: 'tab',
          paneId,
          sessionId: nextWorkspaceDragId(),
          tabId,
          targetKey,
        };
  activeWorkspaceDrag = payload;
  dataTransfer.setData(WORKSPACE_TAB_DRAG_TYPE, JSON.stringify(payload));
}

export function writeWorkspaceProjectNodeDrag(
  dataTransfer: DataTransfer,
  targets: WorkspaceProjectNodeDragPayload['targets'],
): void {
  const candidate = pointerDragCandidate?.payload;
  const payload: WorkspaceProjectNodeDragPayload =
    candidate?.kind === 'project-node' &&
    getTargetKeys(candidate.targets) === getTargetKeys(targets)
      ? candidate
      : {
          kind: 'project-node',
          sessionId: nextWorkspaceDragId(),
          targets,
        };
  activeWorkspaceDrag = payload;
  dataTransfer.setData(
    WORKSPACE_PROJECT_NODE_DRAG_TYPE,
    JSON.stringify(payload),
  );
}

export function setWorkspaceDragActive(active: boolean): void {
  if (active) {
    document.documentElement.dataset.workspaceDragging = 'true';
  } else {
    clearWorkspaceDrag();
  }
}

function getTargetKeys(
  targets: WorkspaceProjectNodeDragPayload['targets'],
): string {
  return targets
    .map(
      (target) =>
        `${target.projectId}:${target.nodeId}:${target.pageType}`,
    )
    .join('|');
}
