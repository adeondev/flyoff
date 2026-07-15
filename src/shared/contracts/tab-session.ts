import { isProjectIdentifier } from './projects';

export const TAB_SESSION_VERSION = 2 as const;
export const TAB_SESSION_MAX_TABS = 100;
export const TAB_SESSION_MAX_BYTES = 2 * 1024 * 1024;

const LEGACY_TAB_SESSION_VERSION = 1 as const;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_PAGE_TYPE_LENGTH = 64;

export const INTERNAL_PAGE_IDS = {
  home: 'home',
  thisDevice: 'this-device',
  settings: 'settings',
  help: 'help',
  updateApp: 'update-app',
} as const;

export type InternalPageId =
  (typeof INTERNAL_PAGE_IDS)[keyof typeof INTERNAL_PAGE_IDS];

export interface InternalTabTarget {
  type: 'internal';
  pageId: InternalPageId;
}

export interface ProjectOverviewTabTarget {
  type: 'project-overview';
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
      hasOnlyKeys(target, ['type', 'pageId']) &&
      isInternalPageId(target.pageId)
    );
  }

  if (target.type === 'project-overview') {
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

export function isHomeTarget(target: TabTarget): boolean {
  return (
    target.type === 'internal' && target.pageId === INTERNAL_PAGE_IDS.home
  );
}

export function getTabTargetKey(target: TabTarget): string {
  switch (target.type) {
    case 'internal':
      return `internal:${target.pageId}`;
    case 'project-overview':
      return `project-overview:${target.projectId}`;
    case 'project-content':
      return `project-content:${target.projectId}:${target.nodeId}`;
  }
}

export function createTabIdForTarget(target: TabTarget): string {
  switch (target.type) {
    case 'internal':
      return `page:${target.pageId}`;
    case 'project-overview':
      return `project:${target.projectId}:overview`;
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

export function normalizeTabSessionSnapshot(
  value: unknown,
): TabSessionSnapshot | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const snapshot = value as Record<string, unknown>;

  try {
    if (
      new TextEncoder().encode(JSON.stringify(value)).byteLength >
      TAB_SESSION_MAX_BYTES
    ) {
      return undefined;
    }
  } catch {
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
