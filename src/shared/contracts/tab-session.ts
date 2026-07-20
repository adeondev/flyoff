import { isProjectIdentifier } from './projects';

export const TAB_SESSION_VERSION = 2 as const;
export const WORKSPACE_SESSION_VERSION = 4 as const;
export const TAB_SESSION_MAX_TABS = 100;
export const TAB_SESSION_MAX_BYTES = 2 * 1024 * 1024;
export const WORKSPACE_MAX_PANES = 5;

const LEGACY_TAB_SESSION_VERSION = 1 as const;
const LEGACY_WORKSPACE_SESSION_VERSION = 3 as const;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_PAGE_TYPE_LENGTH = 64;
const MAX_WORKSPACE_DEPTH = 8;
const MIN_SPLIT_RATIO = 0.1;
const MAX_SPLIT_RATIO = 0.9;

export const INTERNAL_PAGE_IDS = {
  home: 'home',
  thisDevice: 'this-device',
  settings: 'settings',
  help: 'help',
  updateApp: 'update-app',
  newTab: 'new-tab',
} as const;

export type InternalPageId =
  (typeof INTERNAL_PAGE_IDS)[keyof typeof INTERNAL_PAGE_IDS];

export interface InternalTabTarget {
  type: 'internal';
  pageId: InternalPageId;
  instanceKey?: string;
}

export interface ProjectOverviewTabTarget {
  type: 'project-overview';
  projectId: string;
}

export interface ProjectGraphTabTarget {
  type: 'project-graph';
  projectId: string;
}

export interface ProjectContentTabTarget {
  type: 'project-content';
  projectId: string;
  nodeId: string;
  pageType: string;
}

export type ProjectTabTarget =
  | ProjectOverviewTabTarget
  | ProjectGraphTabTarget
  | ProjectContentTabTarget;

export type TabTarget = InternalTabTarget | ProjectTabTarget;

export type JsonValue =
  | boolean
  | number
  | string
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface PageSessionState {
  version: number;
  data: JsonValue;
}

export interface TabDescriptor {
  tabId: string;
  target: TabTarget;
  scrollTop: number;
  pageState: PageSessionState;
}

export interface TabSessionSnapshot {
  version: typeof TAB_SESSION_VERSION;
  tabs: readonly TabDescriptor[];
  activeTabId: string;
}

export interface WorkspacePaneSnapshot {
  kind: 'pane';
  paneId: string;
  tabs: readonly TabDescriptor[];
  activeTabId: string | null;
}

export type WorkspaceSplitDirection = 'row' | 'column';

export interface WorkspaceSplitSnapshot {
  kind: 'split';
  splitId: string;
  direction: WorkspaceSplitDirection;
  ratio: number;
  first: WorkspaceLayoutSnapshot;
  second: WorkspaceLayoutSnapshot;
}

export type WorkspaceLayoutSnapshot =
  | WorkspacePaneSnapshot
  | WorkspaceSplitSnapshot;

export interface PaneWorkspaceSnapshot {
  root: WorkspaceLayoutSnapshot;
  activePaneId: string;
}

export interface ProjectWorkspaceSnapshot extends PaneWorkspaceSnapshot {
  projectId: string;
}

export interface WorkspaceSessionSnapshot {
  version: typeof WORKSPACE_SESSION_VERSION;
  home: PaneWorkspaceSnapshot;
  project: ProjectWorkspaceSnapshot | null;
}

export type TabSessionRestoreDecision = 'restore' | 'ignore';

export const GET_RESTORABLE_TAB_SESSION_CHANNEL =
  'flyoff:tabs:restore:get' as const;
export const RESOLVE_RESTORABLE_TAB_SESSION_CHANNEL =
  'flyoff:tabs:restore:resolve' as const;
export const SAVE_TAB_SESSION_CHANNEL = 'flyoff:tabs:session:save' as const;

const internalPageIds = new Set<string>(Object.values(INTERNAL_PAGE_IDS));

export function isInternalPageId(value: unknown): value is InternalPageId {
  return typeof value === 'string' && internalPageIds.has(value);
}

function isSafeIdentifier(
  value: unknown,
  maximumLength = MAX_IDENTIFIER_LENGTH,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength &&
    /^[a-zA-Z0-9:_-]+$/.test(value)
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === keys.length &&
    actualKeys.every((key) => keys.includes(key))
  );
}

export function isTabTarget(value: unknown): value is TabTarget {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const target = value as Record<string, unknown>;

  if (target.type === 'internal') {
    return (
      Object.keys(target).every((key) =>
        ['type', 'pageId', 'instanceKey'].includes(key),
      ) &&
      isInternalPageId(target.pageId) &&
      (target.instanceKey === undefined ||
        (target.pageId === INTERNAL_PAGE_IDS.newTab &&
          isSafeIdentifier(target.instanceKey)))
    );
  }

  if (target.type === 'project-overview') {
    return (
      hasOnlyKeys(target, ['type', 'projectId']) &&
      isProjectIdentifier(target.projectId)
    );
  }

  if (target.type === 'project-graph') {
    return (
      hasOnlyKeys(target, ['type', 'projectId']) &&
      isProjectIdentifier(target.projectId)
    );
  }

  return (
    target.type === 'project-content' &&
    hasOnlyKeys(target, ['type', 'projectId', 'nodeId', 'pageType']) &&
    isProjectIdentifier(target.projectId) &&
    isProjectIdentifier(target.nodeId) &&
    isSafeIdentifier(target.pageType, MAX_PAGE_TYPE_LENGTH)
  );
}

export function isProjectTarget(
  target: TabTarget,
): target is ProjectTabTarget {
  return target.type !== 'internal';
}

export function isProjectWorkspaceInternalTarget(
  target: TabTarget,
): target is InternalTabTarget {
  return (
    target.type === 'internal' &&
    (target.pageId === INTERNAL_PAGE_IDS.newTab ||
      target.pageId === INTERNAL_PAGE_IDS.settings)
  );
}

export function isHomeTarget(target: TabTarget): boolean {
  return (
    target.type === 'internal' && target.pageId === INTERNAL_PAGE_IDS.home
  );
}

export function getTabTargetKey(target: TabTarget): string {
  switch (target.type) {
    case 'internal':
      return `internal:${target.pageId}${
        target.instanceKey ? `:${target.instanceKey}` : ''
      }`;
    case 'project-overview':
      return `project-overview:${target.projectId}`;
    case 'project-graph':
      return `project-graph:${target.projectId}`;
    case 'project-content':
      return `project-content:${target.projectId}:${target.nodeId}`;
  }
}

export function createTabIdForTarget(target: TabTarget): string {
  switch (target.type) {
    case 'internal':
      return `page:${target.pageId}${
        target.instanceKey ? `:${target.instanceKey}` : ''
      }`;
    case 'project-overview':
      return `project:${target.projectId}:overview`;
    case 'project-graph':
      return `project:${target.projectId}:graph`;
    case 'project-content':
      return `project:${target.projectId}:node:${target.nodeId}`;
  }
}

function isJsonValue(
  value: unknown,
  depth = 0,
  budget = { remaining: 10_000 },
): value is JsonValue {
  if (depth > 20 || budget.remaining <= 0) {
    return false;
  }

  budget.remaining -= 1;

  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return true;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every((entry) => isJsonValue(entry, depth + 1, budget));
  }

  if (!value || typeof value !== 'object') {
    return false;
  }

  return Object.entries(value).every(
    ([key, entry]) =>
      key.length <= MAX_IDENTIFIER_LENGTH &&
      isJsonValue(entry, depth + 1, budget),
  );
}

function readPageState(
  value: unknown,
  recoverInvalid: boolean,
): PageSessionState | undefined {
  const state =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : undefined;

  if (
    state &&
    (recoverInvalid || hasOnlyKeys(state, ['version', 'data'])) &&
    Number.isSafeInteger(state.version) &&
    (state.version as number) >= 1 &&
    isJsonValue(state.data)
  ) {
    return {
      version: state.version as number,
      data: state.data,
    };
  }

  return recoverInvalid ? { version: 1, data: null } : undefined;
}

function readDescriptorFields(
  value: Record<string, unknown>,
  recoverInvalidPageState: boolean,
): Pick<TabDescriptor, 'tabId' | 'scrollTop' | 'pageState'> | undefined {
  const pageState = readPageState(value.pageState, recoverInvalidPageState);

  if (
    !isSafeIdentifier(value.tabId) ||
    typeof value.scrollTop !== 'number' ||
    !Number.isFinite(value.scrollTop) ||
    value.scrollTop < 0 ||
    value.scrollTop > 10_000_000 ||
    !pageState
  ) {
    return undefined;
  }

  return {
    tabId: value.tabId,
    scrollTop: value.scrollTop,
    pageState,
  };
}

function readCurrentTabDescriptor(
  value: unknown,
  recoverInvalidPageState = false,
): TabDescriptor | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const tab = value as Record<string, unknown>;
  const fields = readDescriptorFields(tab, recoverInvalidPageState);

  if (
    (!recoverInvalidPageState &&
      !hasOnlyKeys(tab, ['tabId', 'target', 'scrollTop', 'pageState'])) ||
    !fields ||
    !isTabTarget(tab.target)
  ) {
    return undefined;
  }

  return { ...fields, target: tab.target };
}

function readLegacyTabDescriptor(
  value: unknown,
  recoverInvalidPageState = false,
): TabDescriptor | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const tab = value as Record<string, unknown>;
  const fields = readDescriptorFields(tab, recoverInvalidPageState);

  if (!fields || !isInternalPageId(tab.pageId)) {
    return undefined;
  }

  if (
    tab.instanceKey !== undefined &&
    !isSafeIdentifier(tab.instanceKey)
  ) {
    return undefined;
  }

  return {
    ...fields,
    target: { type: 'internal', pageId: tab.pageId },
  };
}

function shouldKeepCurrentRawTab(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return true;
  }

  const target = (value as Record<string, unknown>).target;

  if (!target || typeof target !== 'object') {
    return true;
  }

  const rawTarget = target as Record<string, unknown>;

  if (typeof rawTarget.type !== 'string') {
    return true;
  }

  if (rawTarget.type === 'internal') {
    return (
      typeof rawTarget.pageId !== 'string' ||
      isInternalPageId(rawTarget.pageId)
    );
  }

  return (
    rawTarget.type === 'project-overview' ||
    rawTarget.type === 'project-graph' ||
    rawTarget.type === 'project-content'
  );
}

function shouldKeepLegacyRawTab(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return true;
  }

  const pageId = (value as Record<string, unknown>).pageId;
  return typeof pageId !== 'string' || isInternalPageId(pageId);
}

function hasUniqueDescriptors(tabs: readonly TabDescriptor[]): boolean {
  const tabIds = new Set(tabs.map(({ tabId }) => tabId));
  const targetKeys = new Set(tabs.map(({ target }) => getTabTargetKey(target)));

  return tabIds.size === tabs.length && targetKeys.size === tabs.length;
}

function exceedsByteCap(value: unknown): boolean {
  try {
    return (
      new TextEncoder().encode(JSON.stringify(value)).byteLength >
      TAB_SESSION_MAX_BYTES
    );
  } catch {
    return true;
  }
}

export function normalizeTabSessionSnapshot(
  value: unknown,
): TabSessionSnapshot | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const snapshot = value as Record<string, unknown>;

  if (exceedsByteCap(value)) {
    return undefined;
  }

  if (
    (snapshot.version !== TAB_SESSION_VERSION &&
      snapshot.version !== LEGACY_TAB_SESSION_VERSION) ||
    !Array.isArray(snapshot.tabs) ||
    snapshot.tabs.length === 0 ||
    snapshot.tabs.length > TAB_SESSION_MAX_TABS ||
    !isSafeIdentifier(snapshot.activeTabId)
  ) {
    return undefined;
  }

  const legacy = snapshot.version === LEGACY_TAB_SESSION_VERSION;
  const rawTabs = snapshot.tabs.filter(
    legacy ? shouldKeepLegacyRawTab : shouldKeepCurrentRawTab,
  );
  const parsedTabs = rawTabs.map((tab) =>
    legacy
      ? readLegacyTabDescriptor(tab, true)
      : readCurrentTabDescriptor(tab, true),
  );

  if (parsedTabs.some((tab) => !tab)) {
    return undefined;
  }

  const tabs = parsedTabs.filter(
    (tab): tab is TabDescriptor => tab !== undefined,
  );
  const firstTab = tabs[0];

  if (!firstTab || !hasUniqueDescriptors(tabs)) {
    return undefined;
  }

  const tabIds = new Set(tabs.map(({ tabId }) => tabId));

  return {
    version: TAB_SESSION_VERSION,
    tabs,
    activeTabId: tabIds.has(snapshot.activeTabId)
      ? snapshot.activeTabId
      : firstTab.tabId,
  };
}

export function isTabSessionSnapshot(
  value: unknown,
): value is TabSessionSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const snapshot = value as Record<string, unknown>;

  if (
    snapshot.version !== TAB_SESSION_VERSION ||
    !Array.isArray(snapshot.tabs)
  ) {
    return false;
  }

  const normalized = normalizeTabSessionSnapshot(value);

  return (
    normalized !== undefined &&
    normalized.tabs.length === snapshot.tabs.length &&
    normalized.activeTabId === snapshot.activeTabId &&
    snapshot.tabs.every(
      (tab) => readCurrentTabDescriptor(tab) !== undefined,
    )
  );
}

export function isTabSessionRestoreDecision(
  value: unknown,
): value is TabSessionRestoreDecision {
  return value === 'restore' || value === 'ignore';
}

export function hasRestorablePages(snapshot: TabSessionSnapshot): boolean {
  return snapshot.tabs.some(({ target }) => !isHomeTarget(target));
}

function createHomeWorkspaceDescriptor(): TabDescriptor {
  const target: TabTarget = {
    type: 'internal',
    pageId: INTERNAL_PAGE_IDS.home,
  };

  return {
    tabId: createTabIdForTarget(target),
    target,
    scrollTop: 0,
    pageState: { version: 1, data: null },
  };
}

interface WorkspaceValidationState {
  paneIds: Set<string>;
  splitIds: Set<string>;
  tabIds: Set<string>;
  paneCount: number;
  tabCount: number;
}

function normalizePane(
  value: unknown,
  state: WorkspaceValidationState,
  acceptTab: (tab: TabDescriptor) => boolean,
  recoverInvalidPageState: boolean,
  depth = 0,
): WorkspaceLayoutSnapshot | undefined {
  if (
    !value ||
    typeof value !== 'object' ||
    depth > MAX_WORKSPACE_DEPTH
  ) {
    return undefined;
  }

  const raw = value as Record<string, unknown>;

  if (raw.kind === 'pane') {
    if (
      !hasOnlyKeys(raw, ['kind', 'paneId', 'tabs', 'activeTabId']) ||
      !isSafeIdentifier(raw.paneId) ||
      state.paneIds.has(raw.paneId) ||
      !Array.isArray(raw.tabs)
    ) {
      return undefined;
    }

    const parsed = raw.tabs.map((tab) =>
      readCurrentTabDescriptor(tab, recoverInvalidPageState),
    );
    if (parsed.some((tab) => !tab)) {
      return undefined;
    }

    const tabs = parsed.filter(
      (tab): tab is TabDescriptor => tab !== undefined,
    );
    const targetKeys = new Set<string>();
    for (const tab of tabs) {
      const targetKey = getTabTargetKey(tab.target);
      if (
        !acceptTab(tab) ||
        state.tabIds.has(tab.tabId) ||
        targetKeys.has(targetKey)
      ) {
        return undefined;
      }
      state.tabIds.add(tab.tabId);
      targetKeys.add(targetKey);
    }

    state.paneIds.add(raw.paneId);
    state.paneCount += 1;
    state.tabCount += tabs.length;
    if (
      state.paneCount > WORKSPACE_MAX_PANES ||
      state.tabCount > TAB_SESSION_MAX_TABS
    ) {
      return undefined;
    }

    const activeTabId =
      typeof raw.activeTabId === 'string' &&
      tabs.some(({ tabId }) => tabId === raw.activeTabId)
        ? raw.activeTabId
        : (tabs[0]?.tabId ?? null);
    if (
      !recoverInvalidPageState &&
      raw.activeTabId !== activeTabId
    ) {
      return undefined;
    }

    return { kind: 'pane', paneId: raw.paneId, tabs, activeTabId };
  }

  if (
    raw.kind !== 'split' ||
    !hasOnlyKeys(raw, [
      'kind',
      'splitId',
      'direction',
      'ratio',
      'first',
      'second',
    ]) ||
    !isSafeIdentifier(raw.splitId) ||
    state.splitIds.has(raw.splitId) ||
    (raw.direction !== 'row' && raw.direction !== 'column') ||
    typeof raw.ratio !== 'number' ||
    !Number.isFinite(raw.ratio)
  ) {
    return undefined;
  }

  const ratio = Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, raw.ratio));
  if (!recoverInvalidPageState && ratio !== raw.ratio) {
    return undefined;
  }

  state.splitIds.add(raw.splitId);
  const first = normalizePane(
    raw.first,
    state,
    acceptTab,
    recoverInvalidPageState,
    depth + 1,
  );
  const second = normalizePane(
    raw.second,
    state,
    acceptTab,
    recoverInvalidPageState,
    depth + 1,
  );

  return first && second
    ? {
        kind: 'split',
        splitId: raw.splitId,
        direction: raw.direction,
        ratio,
        first,
        second,
      }
    : undefined;
}

function normalizePaneWorkspace(
  value: unknown,
  acceptTab: (tab: TabDescriptor) => boolean,
  recoverInvalidPageState: boolean,
): PaneWorkspaceSnapshot | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  if (
    !hasOnlyKeys(raw, ['root', 'activePaneId']) ||
    !isSafeIdentifier(raw.activePaneId)
  ) {
    return undefined;
  }

  const state: WorkspaceValidationState = {
    paneIds: new Set(),
    splitIds: new Set(),
    tabIds: new Set(),
    paneCount: 0,
    tabCount: 0,
  };
  const root = normalizePane(
    raw.root,
    state,
    acceptTab,
    recoverInvalidPageState,
  );
  if (!root) {
    return undefined;
  }

  const activePaneId = state.paneIds.has(raw.activePaneId)
    ? raw.activePaneId
    : state.paneIds.values().next().value;
  if (
    typeof activePaneId !== 'string' ||
    (!recoverInvalidPageState && activePaneId !== raw.activePaneId)
  ) {
    return undefined;
  }

  return { root, activePaneId };
}

function createSinglePaneWorkspace(
  tabs: readonly TabDescriptor[],
  activeTabId: string | null,
  paneId: string,
): PaneWorkspaceSnapshot {
  return {
    root: {
      kind: 'pane',
      paneId,
      tabs,
      activeTabId:
        activeTabId && tabs.some(({ tabId }) => tabId === activeTabId)
          ? activeTabId
          : (tabs[0]?.tabId ?? null),
    },
    activePaneId: paneId,
  };
}

function countWorkspaceTabs(root: WorkspaceLayoutSnapshot): number {
  return root.kind === 'pane'
    ? root.tabs.length
    : countWorkspaceTabs(root.first) + countWorkspaceTabs(root.second);
}

function migrateVersionThreeWorkspace(
  value: Record<string, unknown>,
): WorkspaceSessionSnapshot | undefined {
  const home = normalizeTabSessionSnapshot(value.home);
  if (!home) {
    return undefined;
  }

  let project: ProjectWorkspaceSnapshot | null = null;
  if (value.project !== null && value.project !== undefined) {
    const rawProject = value.project as Record<string, unknown>;
    if (
      !rawProject ||
      !isProjectIdentifier(rawProject.projectId) ||
      !Array.isArray(rawProject.tabs)
    ) {
      return undefined;
    }
    const parsed = rawProject.tabs.map((tab) =>
      readCurrentTabDescriptor(tab, true),
    );
    if (parsed.some((tab) => !tab)) {
      return undefined;
    }
    const tabs = parsed.filter(
      (tab): tab is TabDescriptor => tab !== undefined,
    );
    if (
      !hasUniqueDescriptors(tabs) ||
      !tabs.every(
        ({ target }) =>
          (isProjectTarget(target) &&
            target.projectId === rawProject.projectId) ||
          isProjectWorkspaceInternalTarget(target),
      )
    ) {
      return undefined;
    }
    project = {
      projectId: rawProject.projectId,
      ...createSinglePaneWorkspace(
        tabs,
        typeof rawProject.activeTabId === 'string'
          ? rawProject.activeTabId
          : null,
        'project-pane-1',
      ),
    };
  }

  const migrated = {
    version: WORKSPACE_SESSION_VERSION,
    home: createSinglePaneWorkspace(
      home.tabs,
      home.activeTabId,
      'home-pane-1',
    ),
    project,
  } satisfies WorkspaceSessionSnapshot;
  return countWorkspaceTabs(migrated.home.root) +
    (migrated.project ? countWorkspaceTabs(migrated.project.root) : 0) <=
    TAB_SESSION_MAX_TABS
    ? migrated
    : undefined;
}

function splitFlatSnapshot(flat: TabSessionSnapshot): WorkspaceSessionSnapshot {
  const internalTabs = flat.tabs.filter(({ target }) => !isProjectTarget(target));
  const projectTabsAll = flat.tabs.filter(({ target }) => isProjectTarget(target));
  const firstProjectTarget = projectTabsAll[0]?.target;
  const projectId =
    firstProjectTarget && isProjectTarget(firstProjectTarget)
      ? firstProjectTarget.projectId
      : undefined;

  const homeTabs =
    internalTabs.length > 0 ? internalTabs : [createHomeWorkspaceDescriptor()];
  const home = createSinglePaneWorkspace(
    homeTabs,
    internalTabs.some(({ tabId }) => tabId === flat.activeTabId)
      ? flat.activeTabId
      : homeTabs[0]?.tabId ?? null,
    'home-pane-1',
  );

  let project: ProjectWorkspaceSnapshot | null = null;

  if (projectId) {
    const projectTabs = projectTabsAll.filter(
      ({ target }) => isProjectTarget(target) && target.projectId === projectId,
    );

    if (projectTabs.length > 0) {
      project = {
        projectId,
        ...createSinglePaneWorkspace(
          projectTabs,
          projectTabs.some(({ tabId }) => tabId === flat.activeTabId)
            ? flat.activeTabId
            : projectTabs[0]?.tabId ?? null,
          'project-pane-1',
        ),
      };
    }
  }

  return { version: WORKSPACE_SESSION_VERSION, home, project };
}

export function normalizeWorkspaceSessionSnapshot(
  value: unknown,
): WorkspaceSessionSnapshot | undefined {
  if (!value || typeof value !== 'object' || exceedsByteCap(value)) {
    return undefined;
  }

  const raw = value as Record<string, unknown>;

  if (raw.version === WORKSPACE_SESSION_VERSION) {
    const home = normalizePaneWorkspace(
      raw.home,
      ({ target }) => !isProjectTarget(target),
      true,
    );

    if (!home) {
      return undefined;
    }

    let project: ProjectWorkspaceSnapshot | null = null;

    if (raw.project !== null && raw.project !== undefined) {
      const rawProject = raw.project as Record<string, unknown>;
      if (!isProjectIdentifier(rawProject.projectId)) {
        return undefined;
      }
      const normalizedProject = normalizePaneWorkspace(
        {
          root: rawProject.root,
          activePaneId: rawProject.activePaneId,
        },
        ({ target }) =>
          (isProjectTarget(target) &&
            target.projectId === rawProject.projectId) ||
          isProjectWorkspaceInternalTarget(target),
        true,
      );

      if (!normalizedProject) {
        return undefined;
      }

      project = {
        projectId: rawProject.projectId,
        ...normalizedProject,
      };
    }

    if (
      countWorkspaceTabs(home.root) +
        (project ? countWorkspaceTabs(project.root) : 0) >
      TAB_SESSION_MAX_TABS
    ) {
      return undefined;
    }

    return { version: WORKSPACE_SESSION_VERSION, home, project };
  }

  if (raw.version === LEGACY_WORKSPACE_SESSION_VERSION) {
    return migrateVersionThreeWorkspace(raw);
  }

  const flat = normalizeTabSessionSnapshot(value);

  return flat ? splitFlatSnapshot(flat) : undefined;
}

export function isWorkspaceSessionSnapshot(
  value: unknown,
): value is WorkspaceSessionSnapshot {
  if (!value || typeof value !== 'object' || exceedsByteCap(value)) {
    return false;
  }

  const raw = value as Record<string, unknown>;

  if (
    !hasOnlyKeys(raw, ['version', 'home', 'project']) ||
    raw.version !== WORKSPACE_SESSION_VERSION
  ) {
    return false;
  }

  const home = normalizePaneWorkspace(
    raw.home,
    ({ target }) => !isProjectTarget(target),
    false,
  );
  if (!home) {
    return false;
  }

  if (raw.project === null) {
    return true;
  }
  if (!raw.project || typeof raw.project !== 'object') {
    return false;
  }
  const project = raw.project as Record<string, unknown>;
  if (
    !hasOnlyKeys(project, ['projectId', 'root', 'activePaneId']) ||
    !isProjectIdentifier(project.projectId)
  ) {
    return false;
  }
  const normalizedProject = normalizePaneWorkspace(
      { root: project.root, activePaneId: project.activePaneId },
      ({ target }) =>
        (isProjectTarget(target) &&
          target.projectId === project.projectId) ||
        isProjectWorkspaceInternalTarget(target),
      false,
    );
  return Boolean(
    normalizedProject &&
      countWorkspaceTabs(home.root) +
        countWorkspaceTabs(normalizedProject.root) <=
        TAB_SESSION_MAX_TABS,
  );
}

export function hasRestorableWorkspaceSnapshot(
  snapshot: WorkspaceSessionSnapshot,
): boolean {
  if (snapshot.project !== null) {
    return true;
  }

  const stack: WorkspaceLayoutSnapshot[] = [snapshot.home.root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (node.kind === 'pane') {
      if (node.tabs.some(({ target }) => !isHomeTarget(target))) {
        return true;
      }
    } else {
      stack.push(node.first, node.second);
    }
  }
  return false;
}
