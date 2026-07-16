// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PageHost } from '../../src/renderer/components/tabs/PageHost';
import { TabBar } from '../../src/renderer/components/tabs/TabBar';
import type {
  ProjectTabTarget,
  TabDescriptor,
} from '../../src/shared/contracts';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const NODE_ID = '22222222-2222-4222-8222-222222222222';
const NODE_ID_2 = '33333333-3333-4333-8333-333333333333';

function createProjectTab(
  target: ProjectTabTarget,
  tabId: string,
): TabDescriptor {
  return {
    tabId,
    target,
    scrollTop: 0,
    pageState: { version: 1, data: {} },
  };
}

const home: TabDescriptor = {
  tabId: 'page:home',
  target: { type: 'internal', pageId: 'home' },
  scrollTop: 0,
  pageState: { version: 1, data: {} },
};

const overview = createProjectTab(
  { type: 'project-overview', projectId: PROJECT_ID },
  `project:${PROJECT_ID}:overview`,
);

const content = createProjectTab(
  {
    type: 'project-content',
    projectId: PROJECT_ID,
    nodeId: NODE_ID,
    pageType: 'markdown',
  },
  `project:${PROJECT_ID}:node:${NODE_ID}`,
);

const content2 = createProjectTab(
  {
    type: 'project-content',
    projectId: PROJECT_ID,
    nodeId: NODE_ID_2,
    pageType: 'markdown',
  },
  `project:${PROJECT_ID}:node:${NODE_ID_2}`,
);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('tab components', () => {
  it('renders titles and icons from presentations supplied by the workspace', () => {
    const presentations = new Map([
      [home.tabId, { title: 'Home', icon: 'home.svg' }],
      [content.tabId, { title: 'Planning', icon: 'markdown.svg' }],
    ]);
    const properties = {
      activeTabId: content.tabId,
      tabs: [home, content],
      closeLabel: 'Close tab',
      navigationLabel: 'Pages',
      getPresentation: (tab: TabDescriptor) => {
        const presentation = presentations.get(tab.tabId);

        if (!presentation) {
          throw new Error('Missing presentation.');
        }

        return presentation;
      },
      onClose: vi.fn(),
      onMove: vi.fn(),
      onSelect: vi.fn(),
    };
    const view = render(<TabBar {...properties} />);

    expect(screen.getByRole('tab', { name: 'Planning' })).toBeTruthy();

    presentations.set(content.tabId, {
      title: 'Roadmap',
      icon: 'markdown.svg',
    });
    view.rerender(<TabBar {...properties} />);

    expect(screen.getByRole('tab', { name: 'Roadmap' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Close tab: Roadmap' }),
    ).toBeTruthy();
  });

  it('keeps visited project content mounted without preloading unvisited tabs', () => {
    const renderPage = vi.fn(({ descriptor }: { descriptor: TabDescriptor }) => (
      <div data-testid={descriptor.tabId}>{descriptor.tabId}</div>
    ));
    const properties = {
      tabs: [home, overview, content, content2],
      translate: (key: string) => key,
      getPresentation: (tab: TabDescriptor) => ({
        title: tab.tabId,
        icon: 'page.svg',
      }),
      renderPage,
      onPageStateChange: vi.fn(),
      onScrollChange: vi.fn(),
    };
    const view = render(
      <PageHost activeTabId={content.tabId} {...properties} />,
    );

    expect(screen.getByTestId(overview.tabId)).toBeTruthy();
    const retainedContent = screen.getByTestId(content.tabId);
    expect(screen.queryByTestId(content2.tabId)).toBeNull();

    view.rerender(<PageHost activeTabId={home.tabId} {...properties} />);

    expect(screen.getByTestId(overview.tabId)).toBeTruthy();
    expect(
      screen.getByTestId(content.tabId).closest('.page-panel'),
    ).toHaveProperty('hidden', true);
    expect(screen.getByTestId(content.tabId)).toBe(retainedContent);
    expect(screen.queryByTestId(content2.tabId)).toBeNull();

    view.rerender(
      <PageHost activeTabId={content2.tabId} {...properties} />,
    );

    expect(screen.getByTestId(content.tabId)).toBeTruthy();
    expect(screen.getByTestId(content2.tabId)).toBeTruthy();

    view.rerender(
      <PageHost
        {...properties}
        activeTabId={content2.tabId}
        tabs={[home, overview, content2]}
      />,
    );
    expect(screen.queryByTestId(content.tabId)).toBeNull();
  });

  it('keeps a non-interactive closing visual after the real tab is removed', () => {
    vi.useFakeTimers();
    const presentations = new Map([
      [home.tabId, { title: 'Home', icon: 'home.svg' }],
      [content.tabId, { title: 'Planning', icon: 'markdown.svg' }],
    ]);
    const properties = {
      activeTabId: content.tabId,
      tabs: [home, content],
      closeLabel: 'Close tab',
      navigationLabel: 'Pages',
      getPresentation: (tab: TabDescriptor) => presentations.get(tab.tabId)!,
      onClose: vi.fn(),
      onMove: vi.fn(),
      onSelect: vi.fn(),
    };
    const view = render(<TabBar {...properties} />);

    view.rerender(
      <TabBar {...properties} activeTabId={home.tabId} tabs={[home]} />,
    );

    expect(screen.queryByRole('tab', { name: 'Planning' })).toBeNull();
    expect(
      view.container.querySelector('.page-tab--closing')?.textContent,
    ).toContain('Planning');

    act(() => vi.advanceTimersByTime(200));
    expect(view.container.querySelector('.page-tab--closing')).toBeNull();
  });
});
