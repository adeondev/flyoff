import {
  INTERNAL_PAGE_IDS,
  getTabTargetKey,
  isProjectTarget,
  WORKSPACE_MAX_PANES,
  type PageSessionState,
  type TabDescriptor,
  type TabTarget,
  type WorkspaceLayoutSnapshot,
  type WorkspacePaneSnapshot,
  type WorkspaceSplitDirection,
} from '../../../shared/contracts';
import {
  getPageDefinition,
  getTabTargetPageDefinition,
} from '../../pages/page-registry';
import { createDescriptor } from './tab-state';

export interface PaneWorkspaceState {
  root: WorkspaceLayoutSnapshot;
  activePaneId: string;
}

let workspaceInstanceSequence = 1;

function nextId(prefix: string): string {
  const id = `${prefix}-${workspaceInstanceSequence}`;
  workspaceInstanceSequence += 1;
  return id;
}

function collectLayoutIds(
  node: WorkspaceLayoutSnapshot,
  ids = new Set<string>(),
): ReadonlySet<string> {
  if (node.kind === 'pane') {
    ids.add(node.paneId);
    return ids;
  }

  ids.add(node.splitId);
  collectLayoutIds(node.first, ids);
  collectLayoutIds(node.second, ids);
  return ids;
}

function uniqueLayoutId(
  workspace: PaneWorkspaceState,
  prefix: 'pane' | 'split',
): string {
  const ids = collectLayoutIds(workspace.root);
  let candidate = nextId(prefix);
  while (ids.has(candidate)) {
    candidate = nextId(prefix);
  }
  return candidate;
}

export function createPaneWorkspace(
  tabs: readonly TabDescriptor[],
  paneId = nextId('pane'),
): PaneWorkspaceState {
  return {
    root: {
      kind: 'pane',
      paneId,
      tabs,
      activeTabId: tabs[0]?.tabId ?? null,
    },
    activePaneId: paneId,
  };
}

export function collectPanes(
  root: WorkspaceLayoutSnapshot,
): readonly WorkspacePaneSnapshot[] {
  if (root.kind === 'pane') {
    return [root];
  }

  return [...collectPanes(root.first), ...collectPanes(root.second)];
}

export function findPane(
  root: WorkspaceLayoutSnapshot,
  paneId: string,
): WorkspacePaneSnapshot | undefined {
  if (root.kind === 'pane') {
    return root.paneId === paneId ? root : undefined;
  }

  return findPane(root.first, paneId) ?? findPane(root.second, paneId);
}

function updatePane(
  node: WorkspaceLayoutSnapshot,
  paneId: string,
  update: (pane: WorkspacePaneSnapshot) => WorkspacePaneSnapshot,
): WorkspaceLayoutSnapshot {
  if (node.kind === 'pane') {
    return node.paneId === paneId ? update(node) : node;
  }

  const first = updatePane(node.first, paneId, update);
  const second = updatePane(node.second, paneId, update);
  return first === node.first && second === node.second
    ? node
    : { ...node, first, second };
}

function replacePane(
  node: WorkspaceLayoutSnapshot,
  paneId: string,
  replacement: WorkspaceLayoutSnapshot,
): WorkspaceLayoutSnapshot {
  if (node.kind === 'pane') {
    return node.paneId === paneId ? replacement : node;
  }

  const first = replacePane(node.first, paneId, replacement);
  const second = replacePane(node.second, paneId, replacement);
  return first === node.first && second === node.second
    ? node
    : { ...node, first, second };
}

function replaceSplitRatio(
  node: WorkspaceLayoutSnapshot,
  splitId: string,
  ratio: number,
): WorkspaceLayoutSnapshot {
  if (node.kind === 'pane') {
    return node;
  }
  if (node.splitId === splitId) {
    const bounded = Math.min(0.9, Math.max(0.1, ratio));
    return bounded === node.ratio ? node : { ...node, ratio: bounded };
  }

  const first = replaceSplitRatio(node.first, splitId, ratio);
  const second = replaceSplitRatio(node.second, splitId, ratio);
  return first === node.first && second === node.second
    ? node
    : { ...node, first, second };
}

function normalizedSplitRatio(ratio = 0.5): number {
  return Number.isFinite(ratio)
    ? Math.min(0.9, Math.max(0.1, ratio))
    : 0.5;
}

function collapsePane(
  node: WorkspaceLayoutSnapshot,
  paneId: string,
): WorkspaceLayoutSnapshot | undefined {
  if (node.kind === 'pane') {
    return node.paneId === paneId ? undefined : node;
  }

  const first = collapsePane(node.first, paneId);
  const second = collapsePane(node.second, paneId);
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }
  return first === node.first && second === node.second
    ? node
    : { ...node, first, second };
}

function uniqueTabId(
  workspace: PaneWorkspaceState,
  candidate: string,
): string {
  const ids = new Set(
    collectPanes(workspace.root).flatMap(({ tabs }) =>
      tabs.map(({ tabId }) => tabId),
    ),
  );
  if (!ids.has(candidate)) {
    return candidate;
  }

  let next = `${candidate}:${nextId('instance')}`;
  while (ids.has(next)) {
    next = `${candidate}:${nextId('instance')}`;
  }
  return next;
}

function createNewTabDescriptor(
  workspace: PaneWorkspaceState,
): TabDescriptor {
  const descriptor = createDescriptor({
    type: 'internal',
    pageId: INTERNAL_PAGE_IDS.newTab,
    instanceKey: nextId('new-tab'),
  });
  return {
    ...descriptor,
    tabId: uniqueTabId(workspace, descriptor.tabId),
  };
}

function addTabToPane(
  pane: WorkspacePaneSnapshot,
  tab: TabDescriptor,
): WorkspacePaneSnapshot {
  return {
    ...pane,
    tabs: [...pane.tabs, tab],
    activeTabId: tab.tabId,
  };
}

function targetIsWorkspaceUnique(target: TabTarget): boolean {
  if (target.type === 'internal') {
    return getPageDefinition(target.pageId).singleton;
  }
  return (
    target.type === 'project-overview' ||
    target.type === 'project-graph' ||
    target.type === 'project-content'
  );
}

function selectPaneAndTab(
  workspace: PaneWorkspaceState,
  paneId: string,
  tabId: string,
): PaneWorkspaceState {
  const root = updatePane(workspace.root, paneId, (pane) =>
    pane.activeTabId === tabId ? pane : { ...pane, activeTabId: tabId },
  );
  return root === workspace.root && workspace.activePaneId === paneId
    ? workspace
    : { root, activePaneId: paneId };
}

export function openPaneTarget(
  workspace: PaneWorkspaceState,
  target: TabTarget,
  paneId = workspace.activePaneId,
  initialPageState?: PageSessionState,
): PaneWorkspaceState {
  if (targetIsWorkspaceUnique(target)) {
    const targetKey = getTabTargetKey(target);
    for (const pane of collectPanes(workspace.root)) {
      const existing = pane.tabs.find(
        ({ target: current }) => getTabTargetKey(current) === targetKey,
      );
      if (existing) {
        return selectPaneAndTab(workspace, pane.paneId, existing.tabId);
      }
    }
  }

  const pane = findPane(workspace.root, paneId);
  if (!pane) {
    return workspace;
  }
  const targetKey = getTabTargetKey(target);
  const existing = pane.tabs.find(
    ({ target: current }) => getTabTargetKey(current) === targetKey,
  );
  if (existing) {
    return selectPaneAndTab(workspace, paneId, existing.tabId);
  }

  const descriptor = createDescriptor(target, initialPageState);
  const tab = {
    ...descriptor,
    tabId: uniqueTabId(workspace, descriptor.tabId),
  };
  const root = updatePane(workspace.root, paneId, (current) => ({
    ...current,
    tabs: [...current.tabs, tab],
    activeTabId: tab.tabId,
  }));
  return { root, activePaneId: paneId };
}

function activeNewTab(
  workspace: PaneWorkspaceState,
  paneId: string,
): TabDescriptor | undefined {
  const pane = findPane(workspace.root, paneId);
  const active = pane?.tabs.find(({ tabId }) => tabId === pane.activeTabId);
  return active?.target.type === 'internal' &&
    active.target.pageId === INTERNAL_PAGE_IDS.newTab
    ? active
    : undefined;
}

function replacePaneTabTarget(
  workspace: PaneWorkspaceState,
  paneId: string,
  tabId: string,
  target: TabTarget,
  initialPageState?: PageSessionState,
): PaneWorkspaceState {
  const descriptor = createDescriptor(target, initialPageState);
  const root = updatePane(workspace.root, paneId, (pane) => ({
    ...pane,
    activeTabId: tabId,
    tabs: pane.tabs.map((tab) =>
      tab.tabId === tabId ? { ...descriptor, tabId } : tab,
    ),
  }));
  return root === workspace.root
    ? workspace
    : { root, activePaneId: paneId };
}

export function openPaneTargetReusingNewTab(
  workspace: PaneWorkspaceState,
  target: TabTarget,
  paneId = workspace.activePaneId,
  initialPageState?: PageSessionState,
): PaneWorkspaceState {
  const placeholder = activeNewTab(workspace, paneId);
  if (!placeholder) {
    return openPaneTarget(workspace, target, paneId, initialPageState);
  }

  const targetKey = getTabTargetKey(target);
  for (const pane of collectPanes(workspace.root)) {
    const existing = pane.tabs.find(
      ({ target: current }) => getTabTargetKey(current) === targetKey,
    );
    if (existing) {
      const withoutPlaceholder = closePaneTab(
        workspace,
        paneId,
        placeholder.tabId,
      );
      return selectPaneAndTab(
        withoutPlaceholder,
        pane.paneId,
        existing.tabId,
      );
    }
  }

  return replacePaneTabTarget(
    workspace,
    paneId,
    placeholder.tabId,
    target,
    initialPageState,
  );
}

export function moveOrOpenPaneTarget(
  workspace: PaneWorkspaceState,
  target: TabTarget,
  paneId: string,
  initialPageState?: PageSessionState,
): PaneWorkspaceState {
  const destination = findPane(workspace.root, paneId);
  if (!destination) {
    return workspace;
  }
  const targetKey = getTabTargetKey(target);
  const destinationTab = destination.tabs.find(
    ({ target: current }) => getTabTargetKey(current) === targetKey,
  );
  if (destinationTab) {
    return selectPaneAndTab(workspace, paneId, destinationTab.tabId);
  }
  for (const pane of collectPanes(workspace.root)) {
    if (pane.paneId === paneId) {
      continue;
    }
    const existing = pane.tabs.find(
      ({ target: current }) => getTabTargetKey(current) === targetKey,
    );
    if (existing) {
      return moveTabBetweenPanes(
        workspace,
        pane.paneId,
        paneId,
        existing.tabId,
      );
    }
  }
  return openPaneTarget(workspace, target, paneId, initialPageState);
}

export function moveOrOpenPaneTargetReusingNewTab(
  workspace: PaneWorkspaceState,
  target: TabTarget,
  paneId: string,
  initialPageState?: PageSessionState,
): PaneWorkspaceState {
  const placeholder = activeNewTab(workspace, paneId);
  if (!placeholder) {
    return moveOrOpenPaneTarget(
      workspace,
      target,
      paneId,
      initialPageState,
    );
  }

  const targetKey = getTabTargetKey(target);
  const destination = findPane(workspace.root, paneId);
  const destinationTab = destination?.tabs.find(
    ({ target: current }) => getTabTargetKey(current) === targetKey,
  );
  if (destinationTab) {
    const withoutPlaceholder = closePaneTab(
      workspace,
      paneId,
      placeholder.tabId,
      true,
    );
    return selectPaneAndTab(
      withoutPlaceholder,
      paneId,
      destinationTab.tabId,
    );
  }

  for (const pane of collectPanes(workspace.root)) {
    if (pane.paneId === paneId) {
      continue;
    }
    const existing = pane.tabs.find(
      ({ target: current }) => getTabTargetKey(current) === targetKey,
    );
    if (existing) {
      const withoutPlaceholder = closePaneTab(
        workspace,
        paneId,
        placeholder.tabId,
        true,
      );
      return moveTabBetweenPanes(
        withoutPlaceholder,
        pane.paneId,
        paneId,
        existing.tabId,
      );
    }
  }

  return replacePaneTabTarget(
    workspace,
    paneId,
    placeholder.tabId,
    target,
    initialPageState,
  );
}

export function selectPane(
  workspace: PaneWorkspaceState,
  paneId: string,
): PaneWorkspaceState {
  return findPane(workspace.root, paneId) &&
    workspace.activePaneId !== paneId
    ? { ...workspace, activePaneId: paneId }
    : workspace;
}

export function selectPaneTab(
  workspace: PaneWorkspaceState,
  paneId: string,
  tabId: string,
): PaneWorkspaceState {
  const pane = findPane(workspace.root, paneId);
  return pane?.tabs.some((tab) => tab.tabId === tabId)
    ? selectPaneAndTab(workspace, paneId, tabId)
    : workspace;
}

export function closePaneTab(
  workspace: PaneWorkspaceState,
  paneId: string,
  tabId: string,
  preservePane = false,
  emptyPaneTarget?: TabTarget,
): PaneWorkspaceState {
  const pane = findPane(workspace.root, paneId);
  const index = pane?.tabs.findIndex((tab) => tab.tabId === tabId) ?? -1;
  if (!pane || index < 0) {
    return workspace;
  }
  let tabs = pane.tabs.filter((tab) => tab.tabId !== tabId);
  if (tabs.length === 0) {
    if (!preservePane && collectPanes(workspace.root).length > 1) {
      return closeWorkspacePane(workspace, paneId);
    }
    if (emptyPaneTarget) {
      const closingTab = pane.tabs[index];
      if (
        closingTab &&
        getTabTargetKey(closingTab.target) ===
          getTabTargetKey(emptyPaneTarget)
      ) {
        return workspace;
      }
      const fallback = createDescriptor(emptyPaneTarget);
      tabs = [{
        ...fallback,
        tabId: uniqueTabId(workspace, fallback.tabId),
      }];
    }
  }
  const activeTabId =
    pane.activeTabId === tabId
      ? (tabs[Math.min(index, tabs.length - 1)]?.tabId ?? null)
      : pane.activeTabId;
  const root = updatePane(workspace.root, paneId, (current) => ({
    ...current,
    tabs,
    activeTabId,
  }));
  return root === workspace.root ? workspace : { ...workspace, root };
}

export function closeAllPaneTabs(
  workspace: PaneWorkspaceState,
): PaneWorkspaceState {
  const panes = collectPanes(workspace.root);
  const activePane =
    panes.find(({ paneId }) => paneId === workspace.activePaneId) ??
    panes[0];
  if (!activePane) {
    return workspace;
  }
  if (
    panes.length === 1 &&
    activePane.tabs.length === 0 &&
    activePane.activeTabId === null
  ) {
    return workspace;
  }
  return {
    activePaneId: activePane.paneId,
    root: {
      kind: 'pane',
      paneId: activePane.paneId,
      tabs: [],
      activeTabId: null,
    },
  };
}

export function movePaneTab(
  workspace: PaneWorkspaceState,
  paneId: string,
  tabId: string,
  toIndex: number,
): PaneWorkspaceState {
  const pane = findPane(workspace.root, paneId);
  const fromIndex = pane?.tabs.findIndex((tab) => tab.tabId === tabId) ?? -1;
  if (!pane || fromIndex < 0) {
    return workspace;
  }
  const bounded = Math.max(
    0,
    Math.min(Math.trunc(toIndex), pane.tabs.length - 1),
  );
  if (bounded === fromIndex) {
    return workspace;
  }
  const tabs = [...pane.tabs];
  const [tab] = tabs.splice(fromIndex, 1);
  if (!tab) {
    return workspace;
  }
  tabs.splice(bounded, 0, tab);
  return {
    ...workspace,
    root: updatePane(workspace.root, paneId, (current) => ({
      ...current,
      tabs,
    })),
  };
}

export function updatePaneTab(
  workspace: PaneWorkspaceState,
  paneId: string,
  tabId: string,
  update: (tab: TabDescriptor) => TabDescriptor,
): PaneWorkspaceState {
  const root = updatePane(workspace.root, paneId, (pane) => {
    const index = pane.tabs.findIndex((tab) => tab.tabId === tabId);
    const current = pane.tabs[index];
    if (!current) {
      return pane;
    }
    const next = update(current);
    if (next === current) {
      return pane;
    }
    const tabs = [...pane.tabs];
    tabs[index] = next;
    return { ...pane, tabs };
  });
  return root === workspace.root ? workspace : { ...workspace, root };
}

export function splitPane(
  workspace: PaneWorkspaceState,
  paneId: string,
  direction: WorkspaceSplitDirection,
): PaneWorkspaceState {
  if (collectPanes(workspace.root).length >= WORKSPACE_MAX_PANES) {
    return workspace;
  }
  const pane = findPane(workspace.root, paneId);
  if (!pane) {
    return workspace;
  }
  const placeholder = createNewTabDescriptor(workspace);
  const newPane: WorkspacePaneSnapshot = {
    kind: 'pane',
    paneId: uniqueLayoutId(workspace, 'pane'),
    tabs: [placeholder],
    activeTabId: placeholder.tabId,
  };
  const split: WorkspaceLayoutSnapshot = {
    kind: 'split',
    splitId: uniqueLayoutId(workspace, 'split'),
    direction,
    ratio: 0.5,
    first: pane,
    second: newPane,
  };
  return {
    root: replacePane(workspace.root, paneId, split),
    activePaneId: newPane.paneId,
  };
}

export function moveTabBetweenPanes(
  workspace: PaneWorkspaceState,
  fromPaneId: string,
  toPaneId: string,
  tabId: string,
): PaneWorkspaceState {
  if (fromPaneId === toPaneId) {
    return workspace;
  }
  const source = findPane(workspace.root, fromPaneId);
  const destination = findPane(workspace.root, toPaneId);
  const tab = source?.tabs.find((entry) => entry.tabId === tabId);
  if (!source || !destination || !tab) {
    return workspace;
  }
  const targetKey = getTabTargetKey(tab.target);
  const existing = destination.tabs.find(
    ({ target }) => getTabTargetKey(target) === targetKey,
  );
  let next = closePaneTab(workspace, fromPaneId, tabId);
  if (existing) {
    return selectPaneAndTab(next, toPaneId, existing.tabId);
  }
  next = {
    ...next,
    root: updatePane(next.root, toPaneId, (pane) =>
      addTabToPane(pane, tab),
    ),
    activePaneId: toPaneId,
  };
  return next;
}

export function splitPaneWithTab(
  workspace: PaneWorkspaceState,
  fromPaneId: string,
  targetPaneId: string,
  tabId: string,
  direction: WorkspaceSplitDirection,
  before: boolean,
  ratio?: number,
): PaneWorkspaceState {
  if (collectPanes(workspace.root).length >= WORKSPACE_MAX_PANES) {
    return workspace;
  }
  const source = findPane(workspace.root, fromPaneId);
  const target = findPane(workspace.root, targetPaneId);
  const tab = source?.tabs.find((entry) => entry.tabId === tabId);
  if (!source || !target || !tab) {
    return workspace;
  }
  const without = closePaneTab(
    workspace,
    fromPaneId,
    tabId,
    fromPaneId === targetPaneId,
  );
  const currentTarget = findPane(without.root, targetPaneId);
  if (!currentTarget) {
    return workspace;
  }
  const newPane: WorkspacePaneSnapshot = {
    kind: 'pane',
    paneId: uniqueLayoutId(without, 'pane'),
    tabs: [tab],
    activeTabId: tab.tabId,
  };
  const split: WorkspaceLayoutSnapshot = {
    kind: 'split',
    splitId: uniqueLayoutId(without, 'split'),
    direction,
    ratio: normalizedSplitRatio(ratio),
    first: before ? newPane : currentTarget,
    second: before ? currentTarget : newPane,
  };
  return {
    root: replacePane(without.root, targetPaneId, split),
    activePaneId: newPane.paneId,
  };
}

export function splitPaneWithTarget(
  workspace: PaneWorkspaceState,
  targetPaneId: string,
  target: TabTarget,
  direction: WorkspaceSplitDirection,
  before: boolean,
  initialPageState?: PageSessionState,
  ratio?: number,
): PaneWorkspaceState {
  if (collectPanes(workspace.root).length >= WORKSPACE_MAX_PANES) {
    return workspace;
  }
  const targetKey = getTabTargetKey(target);
  for (const pane of collectPanes(workspace.root)) {
    const existing = pane.tabs.find(
      ({ target: current }) => getTabTargetKey(current) === targetKey,
    );
    if (existing) {
      return splitPaneWithTab(
        workspace,
        pane.paneId,
        targetPaneId,
        existing.tabId,
        direction,
        before,
        ratio,
      );
    }
  }
  const targetPane = findPane(workspace.root, targetPaneId);
  if (!targetPane) {
    return workspace;
  }
  const descriptor = createDescriptor(target, initialPageState);
  const tab = {
    ...descriptor,
    tabId: uniqueTabId(workspace, descriptor.tabId),
  };
  const newPane: WorkspacePaneSnapshot = {
    kind: 'pane',
    paneId: uniqueLayoutId(workspace, 'pane'),
    tabs: [tab],
    activeTabId: tab.tabId,
  };
  const split: WorkspaceLayoutSnapshot = {
    kind: 'split',
    splitId: uniqueLayoutId(workspace, 'split'),
    direction,
    ratio: normalizedSplitRatio(ratio),
    first: before ? newPane : targetPane,
    second: before ? targetPane : newPane,
  };
  return {
    root: replacePane(workspace.root, targetPaneId, split),
    activePaneId: newPane.paneId,
  };
}

export function splitPaneWithTargets(
  workspace: PaneWorkspaceState,
  targetPaneId: string,
  targets: readonly TabTarget[],
  direction: WorkspaceSplitDirection,
  before: boolean,
): PaneWorkspaceState {
  const [first, ...remaining] = targets;
  if (!first) {
    return workspace;
  }
  let next = splitPaneWithTarget(
    workspace,
    targetPaneId,
    first,
    direction,
    before,
  );
  const destinationPaneId = next.activePaneId;
  for (const target of remaining) {
    next = moveOrOpenPaneTargetReusingNewTab(
      next,
      target,
      destinationPaneId,
    );
  }
  return next;
}

export function closeWorkspacePane(
  workspace: PaneWorkspaceState,
  paneId: string,
): PaneWorkspaceState {
  const panes = collectPanes(workspace.root);
  if (panes.length <= 1 || !panes.some((pane) => pane.paneId === paneId)) {
    return workspace;
  }
  const root = collapsePane(workspace.root, paneId);
  if (!root) {
    return workspace;
  }
  const remaining = collectPanes(root);
  const activePaneId =
    workspace.activePaneId === paneId
      ? (remaining[0]?.paneId ?? workspace.activePaneId)
      : workspace.activePaneId;
  return { root, activePaneId };
}

export function resizeWorkspaceSplit(
  workspace: PaneWorkspaceState,
  splitId: string,
  ratio: number,
): PaneWorkspaceState {
  if (!Number.isFinite(ratio)) {
    return workspace;
  }
  const root = replaceSplitRatio(workspace.root, splitId, ratio);
  return root === workspace.root ? workspace : { ...workspace, root };
}

export function migratePaneWorkspace(
  workspace: PaneWorkspaceState,
  requiredEmptyTarget?: TabTarget,
): PaneWorkspaceState {
  const panes = collectPanes(workspace.root);
  const preferredUniqueTabs = new Map<string, string>();

  for (const pane of [
    ...panes.filter(({ paneId }) => paneId === workspace.activePaneId),
    ...panes.filter(({ paneId }) => paneId !== workspace.activePaneId),
  ]) {
    const orderedTabs = [
      ...pane.tabs.filter(({ tabId }) => tabId === pane.activeTabId),
      ...pane.tabs.filter(({ tabId }) => tabId !== pane.activeTabId),
    ];
    for (const tab of orderedTabs) {
      if (!targetIsWorkspaceUnique(tab.target)) {
        continue;
      }
      const key = getTabTargetKey(tab.target);
      if (!preferredUniqueTabs.has(key)) {
        preferredUniqueTabs.set(key, tab.tabId);
      }
    }
  }

  function migrate(node: WorkspaceLayoutSnapshot): WorkspaceLayoutSnapshot {
    if (node.kind === 'pane') {
      const seen = new Set<string>();
      const tabs = node.tabs.flatMap((tab) => {
        const key = getTabTargetKey(tab.target);
        if (
          seen.has(key) ||
          (targetIsWorkspaceUnique(tab.target) &&
            preferredUniqueTabs.get(key) !== tab.tabId)
        ) {
          return [];
        }
        seen.add(key);
        return [{
          ...tab,
          pageState: getTabTargetPageDefinition(tab.target).migrateState(
            tab.pageState,
          ),
        }];
      });
      return {
        ...node,
        tabs,
        activeTabId: tabs.some(
          ({ tabId }) => tabId === node.activeTabId,
        )
          ? node.activeTabId
          : (tabs[0]?.tabId ?? null),
      };
    }
    return { ...node, first: migrate(node.first), second: migrate(node.second) };
  }
  let root = migrate(workspace.root);
  if (
    requiredEmptyTarget &&
    collectPanes(root).every(({ tabs }) => tabs.length === 0)
  ) {
    const pane =
      findPane(root, workspace.activePaneId) ?? collectPanes(root)[0];
    if (pane) {
      const descriptor = createDescriptor(requiredEmptyTarget);
      root = updatePane(root, pane.paneId, (current) => ({
        ...current,
        tabs: [descriptor],
        activeTabId: descriptor.tabId,
      }));
    }
  }
  return { ...workspace, root };
}

export function updateScroll(
  workspace: PaneWorkspaceState,
  paneId: string,
  tabId: string,
  scrollTop: number,
): PaneWorkspaceState {
  if (!Number.isFinite(scrollTop)) {
    return workspace;
  }
  const bounded = Math.min(10_000_000, Math.max(0, scrollTop));
  return updatePaneTab(workspace, paneId, tabId, (tab) =>
    tab.scrollTop === bounded ? tab : { ...tab, scrollTop: bounded },
  );
}

export function updatePageState(
  workspace: PaneWorkspaceState,
  paneId: string,
  tabId: string,
  pageState: PageSessionState,
): PaneWorkspaceState {
  return updatePaneTab(workspace, paneId, tabId, (tab) => ({
    ...tab,
    pageState: getTabTargetPageDefinition(tab.target).migrateState(pageState),
  }));
}

export function acceptsProjectTarget(
  projectId: string,
  target: TabTarget,
): boolean {
  return target.type === 'internal'
    ? getPageDefinition(target.pageId).availableInProject === true
    : isProjectTarget(target) && target.projectId === projectId;
}
