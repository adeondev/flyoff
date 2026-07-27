import type {
  ProjectWorkspaceSnapshot,
  TabDescriptor,
  WorkspaceLayoutSnapshot,
  WorkspacePaneSnapshot,
  WorkspaceSessionSnapshot,
} from '../../../shared/contracts';
import { createDescriptor } from './tab-state';

function activeTabAfterFilter(
  pane: WorkspacePaneSnapshot,
  tabs: readonly TabDescriptor[],
): string | null {
  if (!pane.activeTabId || tabs.length === 0) {
    return tabs[0]?.tabId ?? null;
  }
  if (tabs.some(({ tabId }) => tabId === pane.activeTabId)) {
    return pane.activeTabId;
  }
  const activeIndex = pane.tabs.findIndex(
    ({ tabId }) => tabId === pane.activeTabId,
  );
  for (let distance = 1; distance <= pane.tabs.length; distance += 1) {
    const right = pane.tabs[activeIndex + distance];
    if (right && tabs.some(({ tabId }) => tabId === right.tabId)) {
      return right.tabId;
    }
    const left = pane.tabs[activeIndex - distance];
    if (left && tabs.some(({ tabId }) => tabId === left.tabId)) {
      return left.tabId;
    }
  }
  return tabs[0]?.tabId ?? null;
}

function sanitizeLayout(
  layout: WorkspaceLayoutSnapshot,
  validContent: ReadonlyMap<string, string>,
): WorkspaceLayoutSnapshot | null {
  if (layout.kind === 'pane') {
    const tabs = layout.tabs.filter(({ target }) => {
      if (target.type !== 'project-content') {
        return true;
      }
      return validContent.get(target.nodeId) === target.pageType;
    });
    return tabs.length === 0
      ? null
      : {
          ...layout,
          tabs,
          activeTabId: activeTabAfterFilter(layout, tabs),
        };
  }
  const first = sanitizeLayout(layout.first, validContent);
  const second = sanitizeLayout(layout.second, validContent);
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }
  return { ...layout, first, second };
}

function paneIds(layout: WorkspaceLayoutSnapshot): readonly string[] {
  return layout.kind === 'pane'
    ? [layout.paneId]
    : [...paneIds(layout.first), ...paneIds(layout.second)];
}

export function sanitizeRestoredWorkspace(
  snapshot: WorkspaceSessionSnapshot,
  validContent: ReadonlyMap<string, string>,
): WorkspaceSessionSnapshot {
  const project = snapshot.project;
  if (!project) {
    return snapshot;
  }
  const sanitized = sanitizeLayout(project.root, validContent);
  if (!sanitized) {
    const overview = createDescriptor({
      type: 'project-overview',
      projectId: project.projectId,
    });
    const fallback: ProjectWorkspaceSnapshot = {
      projectId: project.projectId,
      activePaneId: 'project-pane-1',
      root: {
        kind: 'pane',
        paneId: 'project-pane-1',
        tabs: [overview],
        activeTabId: overview.tabId,
      },
    };
    return { ...snapshot, project: fallback };
  }
  const survivingPaneIds = paneIds(sanitized);
  return {
    ...snapshot,
    project: {
      ...project,
      root: sanitized,
      activePaneId: survivingPaneIds.includes(project.activePaneId)
        ? project.activePaneId
        : survivingPaneIds[0]!,
    },
  };
}
