import {
  Component,
  useEffect,
  useRef,
  type ReactNode,
  type UIEvent,
} from 'react';

import type {
  PageSessionState,
  TabDescriptor,
} from '../../../shared/contracts';
import { getPageDefinition } from '../../pages/page-registry';
import type { Translate } from '../../pages/page-types';

interface PageHostProps {
  activeTabId: string;
  tabs: readonly TabDescriptor[];
  translate: Translate;
  onPageStateChange: (tabId: string, state: PageSessionState) => void;
  onScrollChange: (tabId: string, scrollTop: number) => void;
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
  active: boolean;
  descriptor: TabDescriptor;
  translate: Translate;
  onPageStateChange: (tabId: string, state: PageSessionState) => void;
  onScrollChange: (tabId: string, scrollTop: number) => void;
}

function PagePanel({
  active,
  descriptor,
  translate,
  onPageStateChange,
  onScrollChange,
}: PagePanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const definition = getPageDefinition(descriptor.pageId);
  const PageComponent = definition.component;

  useEffect(() => {
    const panel = panelRef.current;

    if (panel && panel.scrollTop !== descriptor.scrollTop) {
      panel.scrollTop = descriptor.scrollTop;
    }
  }, [descriptor.scrollTop]);

  function handleScroll(event: UIEvent<HTMLElement>): void {
    onScrollChange(descriptor.tabId, event.currentTarget.scrollTop);
  }

  return (
    <section
      aria-labelledby={`page-tab-${descriptor.tabId}`}
      className="page-panel"
      hidden={!active}
      id={`page-panel-${descriptor.tabId}`}
      onScroll={handleScroll}
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
        <PageComponent
          descriptor={descriptor}
          onStateChange={(state) =>
            onPageStateChange(descriptor.tabId, state)
          }
          title={translate(definition.titleKey)}
          translate={translate}
        />
      </PageErrorBoundary>
    </section>
  );
}

export function PageHost(props: PageHostProps) {
  return (
    <div className="page-host">
      {props.tabs.map((descriptor) => (
        <PagePanel
          active={descriptor.tabId === props.activeTabId}
          descriptor={descriptor}
          key={descriptor.tabId}
          onPageStateChange={props.onPageStateChange}
          onScrollChange={props.onScrollChange}
          translate={props.translate}
        />
      ))}
    </div>
  );
}
