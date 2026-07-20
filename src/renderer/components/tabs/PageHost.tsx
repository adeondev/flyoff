import {
  Component,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from 'react';

import { useScrollPositionReporter } from '../../hooks/use-scroll-position-reporter';
import type {
  PageSessionState,
  TabDescriptor,
} from '../../../shared/contracts';
import { getPageRetention } from '../../pages/page-registry';
import type {
  PageRenderer,
  TabPresentation,
  Translate,
} from '../../pages/page-types';

interface PageHostProps {
  paneId?: string;
  activePane?: boolean;
  activeTabId: string | null;
  tabs: readonly TabDescriptor[];
  translate: Translate;
  getPresentation: (tab: TabDescriptor) => TabPresentation;
  renderPage: PageRenderer;
  onPageStateChange: (tabId: string, state: PageSessionState) => void;
  onScrollChange: (
    tabId: string,
    scrollTop: number,
    settled?: boolean,
  ) => void;
  emptyState?: ReactNode;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

class PageErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

interface PagePanelProps {
  paneId: string;
  active: boolean;
  pageActive: boolean;
  descriptor: TabDescriptor;
  presentation: TabPresentation;
  translate: Translate;
  renderPage: PageRenderer;
  onPageStateChange: (tabId: string, state: PageSessionState) => void;
  onScrollChange: (
    tabId: string,
    scrollTop: number,
    settled?: boolean,
  ) => void;
}

interface ActiveOnlyRetentionState {
  key: string;
  visited: ReadonlySet<string>;
}

function activeOnlyRetentionState(
  activeTabId: string | null,
  tabs: readonly TabDescriptor[],
  previous: ReadonlySet<string> = new Set(),
): ActiveOnlyRetentionState {
  const openTabIds = new Set(tabs.map(({ tabId }) => tabId));
  const visited = new Set(
    [...previous].filter((tabId) => openTabIds.has(tabId)),
  );
  const activeDescriptor = activeTabId
    ? tabs.find(({ tabId }) => tabId === activeTabId)
    : undefined;

  if (
    activeDescriptor &&
    getPageRetention(activeDescriptor.target) === 'active-only'
  ) {
    visited.add(activeDescriptor.tabId);
  }

  return {
    key: `${activeTabId ?? ''}\u0000${tabs.map(({ tabId }) => tabId).join('\u0000')}`,
    visited,
  };
}

function renderPanelPage(
  active: boolean,
  descriptor: TabDescriptor,
  presentation: TabPresentation,
  translate: Translate,
  renderPage: PageRenderer,
  onStateChange: (state: PageSessionState) => void,
  onScrollChange: (scrollTop: number, settled?: boolean) => void,
): ReactNode {
  return renderPage({
    active,
    descriptor,
    onStateChange,
    title: presentation.title,
    translate,
    onScrollChange,
  });
}

function PagePanel({
  active,
  pageActive,
  paneId,
  descriptor,
  presentation,
  translate,
  renderPage,
  onPageStateChange,
  onScrollChange,
}: PagePanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const scrollReporter = useScrollPositionReporter((scrollTop, settled) =>
    onScrollChange(descriptor.tabId, scrollTop, settled),
  );

  useEffect(() => {
    const panel = panelRef.current;

    if (panel && panel.scrollTop !== descriptor.scrollTop) {
      panel.scrollTop = descriptor.scrollTop;
    }
  }, [descriptor.scrollTop]);

  function handleScroll(event: UIEvent<HTMLElement>): void {
    if (event.target !== event.currentTarget) {
      return;
    }
    scrollReporter.reportScroll(event.currentTarget.scrollTop);
  }

  function handleScrollEnd(event: UIEvent<HTMLElement>): void {
    if (event.target !== event.currentTarget) {
      return;
    }
    scrollReporter.reportScrollEnd(event.currentTarget.scrollTop);
  }

  return (
    <section
      aria-labelledby={`page-tab-${paneId}-${descriptor.tabId}`}
      className="page-panel"
      hidden={!active}
      id={`page-panel-${paneId}-${descriptor.tabId}`}
      onScroll={handleScroll}
      onScrollEnd={handleScrollEnd}
      ref={panelRef}
      role="tabpanel"
      tabIndex={0}
    >
      <PageErrorBoundary
        fallback={
          <div className="page-error" role="alert">
            {translate('pages.failed')}
          </div>
        }
      >
        {renderPanelPage(
          pageActive,
          descriptor,
          presentation,
          translate,
          renderPage,
          (state) => onPageStateChange(descriptor.tabId, state),
          (scrollTop, settled) =>
            onScrollChange(descriptor.tabId, scrollTop, settled),
        )}
      </PageErrorBoundary>
    </section>
  );
}

export function PageHost({
  paneId = 'primary',
  activePane = true,
  activeTabId,
  tabs,
  translate,
  getPresentation,
  renderPage,
  onPageStateChange,
  onScrollChange,
  emptyState,
}: PageHostProps) {
  const [storedRetention, setStoredRetention] =
    useState<ActiveOnlyRetentionState>(() =>
      activeOnlyRetentionState(activeTabId, tabs),
    );
  let retention = storedRetention;
  const retentionKey = `${activeTabId ?? ''}\u0000${tabs
    .map(({ tabId }) => tabId)
    .join('\u0000')}`;

  if (storedRetention.key !== retentionKey) {
    retention = activeOnlyRetentionState(
      activeTabId,
      tabs,
      storedRetention.visited,
    );
    setStoredRetention(retention);
  }

  const retainedTabs = tabs.filter(
    (descriptor) =>
      descriptor.tabId === activeTabId ||
      getPageRetention(descriptor.target) === 'keep-alive' ||
      retention.visited.has(descriptor.tabId),
  );

  if (retainedTabs.length === 0 && emptyState) {
    return <div className="page-host">{emptyState}</div>;
  }

  return (
    <div className="page-host">
      {retainedTabs.map((descriptor) => (
        <PagePanel
          active={descriptor.tabId === activeTabId}
          descriptor={descriptor}
          key={`${paneId}:${descriptor.tabId}`}
          paneId={paneId}
          pageActive={activePane && descriptor.tabId === activeTabId}
          onPageStateChange={onPageStateChange}
          onScrollChange={onScrollChange}
          presentation={getPresentation(descriptor)}
          renderPage={renderPage}
          translate={translate}
        />
      ))}
    </div>
  );
}
