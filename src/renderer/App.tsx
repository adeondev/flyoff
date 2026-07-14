import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

import flyoffLogo from '../../public/images/flyoff/flyoff-logo.svg';
import {
  APPLICATION_MENU_DEFINITIONS,
  INTERNAL_PAGE_IDS,
  RENDERER_MENU_COMMANDS,
  hasRestorablePages,
  isApplicationMenuCommand,
  isRendererMenuCommand,
  ptBR,
  type ApplicationMenuEntryDefinition,
  type CloseRequest,
  type CloseResponse,
  type FlyoffApi,
  type FlyoffPlatform,
  type InternalPageId,
  type RendererMenuCommand,
  type TabSessionRestoreDecision,
  type TabSessionSnapshot,
  type TranslationCatalog,
  type TranslationKey,
  type WindowControlAction,
  type WindowState,
} from '../shared';
import { CloseConfirmationDialog } from './components/dialog/CloseConfirmationDialog';
import { SessionRestoreToast } from './components/dialog/SessionRestoreToast';
import {
  MenuBar,
  type MenuBarItem,
  type MenuItem,
} from './components/menu';
import { Sidebar } from './components/Sidebar';
import { PageHost } from './components/tabs/PageHost';
import { TabBar } from './components/tabs/TabBar';
import {
  createInitialTabState,
  hasNonHomeTabs,
  normalizeRendererTabSession,
  tabReducer,
  type TabAction,
} from './components/tabs/tab-state';
import {
  WindowControls,
  type WindowControlLabels,
} from './components/WindowControls';
import { initializeRendererI18n } from './i18n';
import type { Translate } from './pages/page-types';

function translateCatalog(
  catalog: TranslationCatalog,
  key: TranslationKey,
): string {
  const [section, entry] = key.split('.') as [
    keyof TranslationCatalog,
    string,
  ];
  const values = catalog[section] as unknown as Record<string, string>;
  return values[entry] ?? key;
}

const fallbackTranslate: Translate = (key) => translateCatalog(ptBR, key);

function createMenuItems(
  entries: readonly ApplicationMenuEntryDefinition[],
  translate: Translate,
): readonly MenuItem[] {
  return entries.map((entry) => {
    if (entry.kind === 'separator') {
      return { id: entry.id, kind: 'separator' };
    }

    if (entry.kind === 'submenu') {
      return {
        id: entry.id,
        kind: 'submenu',
        label: translate(entry.labelKey),
        children: createMenuItems(entry.children, translate),
        disabled: entry.disabled,
      };
    }

    return {
      id: entry.command,
      kind: 'action',
      label: translate(entry.labelKey),
      shortcut: entry.shortcut?.display,
    };
  });
}

function createMenuBarItems(translate: Translate): readonly MenuBarItem[] {
  return APPLICATION_MENU_DEFINITIONS.map((menu) => ({
    id: menu.id,
    label: translate(menu.labelKey),
    items: createMenuItems(menu.children, translate),
  }));
}

interface TitlebarProps {
  menus: readonly MenuBarItem[];
  platform?: FlyoffPlatform;
  windowControlLabels: WindowControlLabels;
  windowState: WindowState;
  onMenuAction: (id: string) => void;
  onWindowAction: (action: WindowControlAction) => void;
}

function Titlebar({
  menus,
  platform,
  windowControlLabels,
  windowState,
  onMenuAction,
  onWindowAction,
}: TitlebarProps) {
  const isMacOS = platform === 'darwin';

  return (
    <header
      className={`titlebar${isMacOS ? ' titlebar--macos' : ''}`}
      aria-label="Flyoff"
    >
      <div className="titlebar__brand">
        <img src={flyoffLogo} alt="" aria-hidden="true" />
        <span>Flyoff</span>
      </div>
      {!isMacOS && menus.length > 0 ? (
        <MenuBar
          ariaLabel="Flyoff"
          className="titlebar__menu"
          menus={menus}
          onAction={onMenuAction}
        />
      ) : null}
      <div className="titlebar__drag-space" />
      <WindowControls
        labels={windowControlLabels}
        maximized={windowState.maximized}
        onAction={onWindowAction}
      />
    </header>
  );
}

function getApi(): Partial<FlyoffApi> {
  return window.flyoff as Partial<FlyoffApi>;
}

export function App() {
  const [platform, setPlatform] = useState<FlyoffPlatform>();
  const [translator, setTranslator] = useState<{ translate: Translate }>({
    translate: fallbackTranslate,
  });
  const [windowState, setWindowState] = useState<WindowState>({
    maximized: false,
  });
  const [tabState, dispatchTabs] = useReducer(
    tabReducer,
    undefined,
    createInitialTabState,
  );
  const [restoreCandidate, setRestoreCandidate] =
    useState<TabSessionSnapshot | null>(null);
  const [sessionReady, setSessionReady] = useState(
    () => !getApi().getRestorableTabSession,
  );
  const [closeRequest, setCloseRequest] = useState<CloseRequest | null>(null);
  const [closeResponsePendingId, setCloseResponsePendingId] = useState<
    string | null
  >(null);
  const tabStateRef = useRef(tabState);
  const restoreCandidateRef = useRef<TabSessionSnapshot | null>(null);
  const closeRequestRef = useRef<CloseRequest | null>(null);
  const closeResponsePendingIdRef = useRef<string | null>(null);
  const userInteractedRef = useRef(false);
  const restoreRequestStartedRef = useRef(false);
  const translate = translator.translate;

  const menus = useMemo(
    () => createMenuBarItems(translate),
    [translate],
  );
  const windowControlLabels = useMemo<WindowControlLabels>(
    () => ({
      minimize: translate('windowControls.minimize'),
      maximize: translate('windowControls.maximize'),
      restore: translate('windowControls.restore'),
      close: translate('windowControls.close'),
    }),
    [translate],
  );

  const resolveRestoreCandidate = useCallback(
    (
      decision: TabSessionRestoreDecision,
      current: TabSessionSnapshot,
    ): void => {
      const candidate = restoreCandidateRef.current;

      if (!candidate) {
        return;
      }

      const resolved = decision === 'restore' ? candidate : current;
      restoreCandidateRef.current = null;
      setRestoreCandidate(null);

      if (decision === 'restore') {
        tabStateRef.current = resolved;
        dispatchTabs({ type: 'restore-session', session: resolved });
      }

      const api = getApi();
      void api
        .resolveRestorableTabSession?.(decision, resolved)
        .catch(() => undefined);
    },
    [],
  );

  const dispatchUserAction = useCallback(
    (action: TabAction): void => {
      if (closeRequestRef.current) {
        return;
      }

      const current = tabStateRef.current;
      const next = tabReducer(current, action);

      if (next === current) {
        return;
      }

      userInteractedRef.current = true;
      resolveRestoreCandidate('ignore', next);
      tabStateRef.current = next;
      dispatchTabs(action);
    },
    [resolveRestoreCandidate],
  );

  const closeActiveTab = useCallback((): void => {
    dispatchUserAction({
      type: 'close-tab',
      tabId: tabStateRef.current.activeTabId,
    });
  }, [dispatchUserAction]);

  const controlWindow = useCallback(
    (action: WindowControlAction): void => {
      void getApi()
        .controlWindow?.(action)
        .then(setWindowState)
        .catch(() => undefined);
    },
    [],
  );

  const executeMenuCommand = useCallback(
    (command: string): void => {
      if (isRendererMenuCommand(command)) {
        if (command === RENDERER_MENU_COMMANDS.closeTab) {
          closeActiveTab();
        }
        return;
      }

      if (isApplicationMenuCommand(command)) {
        void getApi().executeMenuCommand?.(command).catch(() => undefined);
      }
    },
    [closeActiveTab],
  );

  const respondToClose = useCallback(
    async (response: CloseResponse): Promise<void> => {
      const respond = getApi().respondToCloseRequest;

      if (!respond) {
        throw new Error('The close confirmation bridge is unavailable.');
      }

      await respond(response);
    },
    [],
  );

  const submitCloseResponse = useCallback(
    (response: CloseResponse): void => {
      if (closeResponsePendingIdRef.current) {
        return;
      }

      closeResponsePendingIdRef.current = response.requestId;
      setCloseResponsePendingId(response.requestId);

      void respondToClose(response)
        .then(() => {
          if (closeRequestRef.current?.requestId === response.requestId) {
            closeRequestRef.current = null;
            setCloseRequest(null);
          }
        })
        .catch(() => {
          const request = closeRequestRef.current;

          if (request?.requestId === response.requestId) {
            setCloseRequest(request);
          }
        })
        .finally(() => {
          if (closeResponsePendingIdRef.current === response.requestId) {
            closeResponsePendingIdRef.current = null;
            setCloseResponsePendingId(null);
          }
        });
    },
    [respondToClose],
  );

  const cancelClose = useCallback((): void => {
    const request = closeRequestRef.current;

    if (!request) {
      return;
    }

    submitCloseResponse({
      requestId: request.requestId,
      decision: 'cancel',
    });
  }, [submitCloseResponse]);

  const confirmClose = useCallback((): void => {
    const request = closeRequestRef.current;

    if (!request) {
      return;
    }

    const session = tabStateRef.current;
    submitCloseResponse({
      requestId: request.requestId,
      decision: 'confirm',
      session,
    });
  }, [submitCloseResponse]);

  useEffect(() => {
    const removeStateListener = getApi().onWindowStateChanged?.((state) => {
      setWindowState(state);
    });

    void getApi()
      .getWindowState?.()
      .then(setWindowState)
      .catch(() => undefined);

    return () => {
      removeStateListener?.();
    };
  }, []);

  useEffect(() => {
    let active = true;

    void getApi()
      .getBootstrapState?.()
      .then((state) => {
        if (!active) {
          return;
        }

        document.documentElement.lang = state.uiLocale;
        document.documentElement.dataset.platform = state.platform;
        setPlatform(state.platform);
        void initializeRendererI18n(state.uiLocale)
          .then((i18n) => {
            if (active) {
              setTranslator({ translate: (key) => i18n.t(key) });
            }
          })
          .catch(() => undefined);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (restoreRequestStartedRef.current) {
      return;
    }

    restoreRequestStartedRef.current = true;
    const api = getApi();

    if (!api.getRestorableTabSession) {
      return;
    }

    void api
      .getRestorableTabSession()
      .then((candidate) => {
        setSessionReady(true);

        if (!candidate || !hasRestorablePages(candidate)) {
          return;
        }

        const normalized = normalizeRendererTabSession(candidate);

        if (!hasNonHomeTabs(normalized)) {
          return;
        }

        if (userInteractedRef.current) {
          void api
            .resolveRestorableTabSession?.(
              'ignore',
              tabStateRef.current,
            )
            .catch(() => undefined);
          return;
        }

        restoreCandidateRef.current = normalized;
        setRestoreCandidate(normalized);
      })
      .catch(() => {
        setSessionReady(true);
      });
  }, []);

  useEffect(() => {
    if (!restoreCandidate) {
      return;
    }

    const timeout = window.setTimeout(() => {
      resolveRestoreCandidate('ignore', tabStateRef.current);
    }, 8_000);

    return () => window.clearTimeout(timeout);
  }, [resolveRestoreCandidate, restoreCandidate]);

  useEffect(() => {
    if (!sessionReady || restoreCandidateRef.current) {
      return;
    }

    const api = getApi();

    if (!api.saveTabSession) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void api.saveTabSession?.(tabState).catch(() => undefined);
    }, 200);

    return () => window.clearTimeout(timeout);
  }, [sessionReady, tabState]);

  useEffect(() => {
    const api = getApi();
    const removeCloseListener = api.onCloseRequested?.((request) => {
      resolveRestoreCandidate('ignore', tabStateRef.current);

      const previous = closeRequestRef.current;
      if (previous && previous.requestId !== request.requestId) {
        if (closeResponsePendingIdRef.current === previous.requestId) {
          closeResponsePendingIdRef.current = null;
          setCloseResponsePendingId(null);
        }

        void respondToClose({
          requestId: previous.requestId,
          decision: 'cancel',
        }).catch(() => undefined);
      }

      closeRequestRef.current = request;

      if (!hasNonHomeTabs(tabStateRef.current)) {
        submitCloseResponse({
          requestId: request.requestId,
          decision: 'confirm',
          session: tabStateRef.current,
        });
        return;
      }

      setCloseRequest(request);
    });
    const removeMenuListener = api.onRendererMenuCommand?.(
      (command: RendererMenuCommand) => {
        if (command === RENDERER_MENU_COMMANDS.closeTab) {
          closeActiveTab();
        }
      },
    );

    return () => {
      removeCloseListener?.();
      removeMenuListener?.();
    };
  }, [
    closeActiveTab,
    resolveRestoreCandidate,
    respondToClose,
    submitCloseResponse,
  ]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }

      const primary = platform === 'darwin' ? event.metaKey : event.ctrlKey;

      if (event.ctrlKey && event.key === 'Tab') {
        event.preventDefault();
        const state = tabStateRef.current;
        const activeIndex = state.tabs.findIndex(
          ({ tabId }) => tabId === state.activeTabId,
        );
        const offset = event.shiftKey ? -1 : 1;
        const nextIndex =
          (activeIndex + offset + state.tabs.length) % state.tabs.length;
        const nextTab = state.tabs[nextIndex];
        if (nextTab) {
          dispatchUserAction({
            type: 'select-tab',
            tabId: nextTab.tabId,
          });
        }
        return;
      }

      if (primary && !event.altKey && /^[1-9]$/.test(event.key)) {
        event.preventDefault();
        const state = tabStateRef.current;
        const requestedIndex = Number(event.key) - 1;
        const index =
          requestedIndex === 8
            ? state.tabs.length - 1
            : requestedIndex;
        const requested = state.tabs[index];
        if (requested) {
          dispatchUserAction({
            type: 'select-tab',
            tabId: requested.tabId,
          });
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [dispatchUserAction, platform]);

  const activeTab =
    tabState.tabs.find(({ tabId }) => tabId === tabState.activeTabId) ??
    tabState.tabs[0];
  const activePageId: InternalPageId =
    activeTab?.pageId ?? INTERNAL_PAGE_IDS.home;

  return (
    <div className="app-shell">
      <Titlebar
        menus={menus}
        platform={platform}
        windowControlLabels={windowControlLabels}
        windowState={windowState}
        onMenuAction={executeMenuCommand}
        onWindowAction={controlWindow}
      />
      <div className="workspace">
        <Sidebar
          activePageId={activePageId}
          onOpenPage={(pageId) =>
            dispatchUserAction({ type: 'open-page', pageId })
          }
          translate={translate}
        />
        <div className="page-workspace">
          <TabBar
            activeTabId={tabState.activeTabId}
            onClose={(tabId) =>
              dispatchUserAction({ type: 'close-tab', tabId })
            }
            onMove={(tabId, toIndex) =>
              dispatchUserAction({ type: 'move-tab', tabId, toIndex })
            }
            onSelect={(tabId) =>
              dispatchUserAction({ type: 'select-tab', tabId })
            }
            tabs={tabState.tabs}
            translate={translate}
          />
          <PageHost
            activeTabId={tabState.activeTabId}
            onPageStateChange={(tabId, pageState) =>
              dispatchUserAction({
                type: 'update-page-state',
                tabId,
                pageState,
              })
            }
            onScrollChange={(tabId, scrollTop) =>
              dispatchUserAction({
                type: 'update-scroll',
                tabId,
                scrollTop,
              })
            }
            tabs={tabState.tabs}
            translate={translate}
          />
        </div>
      </div>
      {restoreCandidate ? (
        <SessionRestoreToast
          onIgnore={() =>
            resolveRestoreCandidate('ignore', tabStateRef.current)
          }
          onRestore={() =>
            resolveRestoreCandidate('restore', tabStateRef.current)
          }
          translate={translate}
        />
      ) : null}
      {closeRequest ? (
        <CloseConfirmationDialog
          intent={closeRequest.intent}
          onCancel={cancelClose}
          onConfirm={confirmClose}
          pending={closeResponsePendingId === closeRequest.requestId}
          translate={translate}
        />
      ) : null}
    </div>
  );
}
