export const TAB_SESSION_VERSION = 1 as const;
export const TAB_SESSION_MAX_TABS = 100;
export const TAB_SESSION_MAX_BYTES = 2 * 1024 * 1024;

export const INTERNAL_PAGE_IDS = {
  home: 'home',
  thisDevice: 'this-device',
  settings: 'settings',
  help: 'help',
  updateApp: 'update-app',
} as const;

export type InternalPageId =
  (typeof INTERNAL_PAGE_IDS)[keyof typeof INTERNAL_PAGE_IDS];

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
  pageId: InternalPageId;
  instanceKey?: string;
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

function isSafeIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    /^[a-zA-Z0-9:_-]+$/.test(value)
  );
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
      key.length <= 256 && isJsonValue(entry, depth + 1, budget),
  );
}

function readTabDescriptor(
  value: unknown,
  recoverInvalidPageState = false,
): (Omit<TabDescriptor, 'pageId'> & { pageId: string }) | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const tab = value as Record<string, unknown>;
  const rawPageState = tab.pageState;
  const pageState =
    rawPageState && typeof rawPageState === 'object'
      ? (rawPageState as Record<string, unknown>)
      : undefined;
  const validPageState =
    pageState &&
    Number.isSafeInteger(pageState.version) &&
    (pageState.version as number) >= 1 &&
    isJsonValue(pageState.data)
      ? {
          version: pageState.version as number,
          data: pageState.data,
        }
      : undefined;

  if (
    !isSafeIdentifier(tab.tabId) ||
    typeof tab.pageId !== 'string' ||
    tab.pageId.length === 0 ||
    tab.pageId.length > 128 ||
    (tab.instanceKey !== undefined && !isSafeIdentifier(tab.instanceKey)) ||
    typeof tab.scrollTop !== 'number' ||
    !Number.isFinite(tab.scrollTop) ||
    tab.scrollTop < 0 ||
    tab.scrollTop > 10_000_000 ||
    (!validPageState && !recoverInvalidPageState)
  ) {
    return undefined;
  }

  return {
    tabId: tab.tabId,
    pageId: tab.pageId,
    ...(tab.instanceKey === undefined
      ? {}
      : { instanceKey: tab.instanceKey as string }),
    scrollTop: tab.scrollTop,
    pageState: validPageState ?? { version: 1, data: null },
  };
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
    snapshot.version !== TAB_SESSION_VERSION ||
    !Array.isArray(snapshot.tabs) ||
    snapshot.tabs.length === 0 ||
    snapshot.tabs.length > TAB_SESSION_MAX_TABS ||
    !isSafeIdentifier(snapshot.activeTabId)
  ) {
    return undefined;
  }

  const knownRawTabs = snapshot.tabs.filter((tab) => {
    if (!tab || typeof tab !== 'object') {
      return true;
    }

    const pageId = (tab as Record<string, unknown>).pageId;
    return typeof pageId !== 'string' || isInternalPageId(pageId);
  });
  const parsedTabs = knownRawTabs.map((tab) =>
    readTabDescriptor(tab, true),
  );

  if (parsedTabs.some((tab) => !tab)) {
    return undefined;
  }

  const knownTabs = parsedTabs.filter(
    (tab): tab is Omit<TabDescriptor, 'pageId'> & { pageId: InternalPageId } =>
      Boolean(tab && isInternalPageId(tab.pageId)),
  );

  if (knownTabs.length === 0) {
    return undefined;
  }

  const firstKnownTab = knownTabs[0];

  if (!firstKnownTab) {
    return undefined;
  }

  const tabIds = new Set(knownTabs.map(({ tabId }) => tabId));

  if (tabIds.size !== knownTabs.length) {
    return undefined;
  }

  const activeTabId = tabIds.has(snapshot.activeTabId)
    ? snapshot.activeTabId
    : firstKnownTab.tabId;

  return {
    version: TAB_SESSION_VERSION,
    tabs: knownTabs,
    activeTabId,
  };
}

export function isTabSessionSnapshot(
  value: unknown,
): value is TabSessionSnapshot {
  const normalized = normalizeTabSessionSnapshot(value);
  const snapshot = value as { activeTabId?: unknown; tabs?: readonly unknown[] };

  return (
    normalized !== undefined &&
    normalized.tabs.length === (snapshot.tabs?.length ?? -1) &&
    normalized.activeTabId === snapshot.activeTabId &&
    snapshot.tabs?.every((tab) => {
      const descriptor = readTabDescriptor(tab);
      return Boolean(descriptor && isInternalPageId(descriptor.pageId));
    }) === true
  );
}

export function isTabSessionRestoreDecision(
  value: unknown,
): value is TabSessionRestoreDecision {
  return value === 'restore' || value === 'ignore';
}

export function hasRestorablePages(
  snapshot: TabSessionSnapshot,
): boolean {
  return snapshot.tabs.some(({ pageId }) => pageId !== INTERNAL_PAGE_IDS.home);
}
