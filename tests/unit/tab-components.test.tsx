// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  vi.unstubAllGlobals();
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

  it('keeps the closing tab in flow for exactly 90 ms without opacity', () => {
    vi.useFakeTimers();
    const presentations = new Map([
      [overview.tabId, { title: 'Overview', icon: 'project.svg' }],
      [content.tabId, { title: 'Planning', icon: 'markdown.svg' }],
      [content2.tabId, { title: 'Roadmap', icon: 'markdown.svg' }],
    ]);
    const properties = {
      activeTabId: content.tabId,
      tabs: [overview, content, content2],
      closeLabel: 'Close tab',
      navigationLabel: 'Pages',
      getPresentation: (tab: TabDescriptor) => presentations.get(tab.tabId)!,
      onClose: vi.fn(),
      onMove: vi.fn(),
      onSelect: vi.fn(),
    };
    const view = render(<TabBar {...properties} />);

    view.rerender(
      <TabBar
        {...properties}
        activeTabId={content2.tabId}
        tabs={[overview, content2]}
      />,
    );

    expect(screen.queryByRole('tab', { name: 'Planning' })).toBeNull();
    const tabList = screen.getByRole('tablist');
    const closing = view.container.querySelector<HTMLElement>(
      '.page-tab--closing',
    );
    expect([...tabList.children].map((element) => element.textContent)).toEqual([
      expect.stringContaining('Overview'),
      expect.stringContaining('Planning'),
      expect.stringContaining('Roadmap'),
    ]);
    expect(closing?.style.position).toBe('');
    expect(closing?.style.opacity).toBe('');
    expect(
      tabList.style.getPropertyValue('--page-tab-motion-duration'),
    ).toBe('90ms');

    act(() => vi.advanceTimersByTime(89));
    expect(view.container.querySelector('.page-tab--closing')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(view.container.querySelector('.page-tab--closing')).toBeNull();
  });

  it('uses the same ease-out curve for opening and closing tabs', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/renderer/styles.css'),
      'utf8',
    );

    expect(styles).toMatch(
      /animation:\s*page-tab-open var\(--page-tab-motion-duration\) var\(--ease-out\)/,
    );
    expect(styles).toMatch(
      /\.page-tab--closing\s*{[^}]*animation:\s*page-tab-close var\(--page-tab-motion-duration\) var\(--ease-out\) both;/,
    );
  });

  it('preserves visual order across consecutive closes', () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function getTabBounds() {
        const left = this.textContent?.includes('Planning')
          ? 200
          : this.textContent?.includes('Roadmap')
            ? 400
            : 0;
        return {
          bottom: 40,
          height: 40,
          left,
          right: left + 176,
          toJSON: () => undefined,
          top: 0,
          width: 176,
          x: left,
          y: 0,
        };
      },
    );
    const presentations = new Map([
      [overview.tabId, { title: 'Overview', icon: 'project.svg' }],
      [content.tabId, { title: 'Planning', icon: 'markdown.svg' }],
      [content2.tabId, { title: 'Roadmap', icon: 'markdown.svg' }],
    ]);
    const properties = {
      activeTabId: content.tabId,
      tabs: [overview, content, content2],
      closeLabel: 'Close tab',
      navigationLabel: 'Pages',
      getPresentation: (tab: TabDescriptor) => presentations.get(tab.tabId)!,
      onClose: vi.fn(),
      onMove: vi.fn(),
      onSelect: vi.fn(),
    };
    const view = render(<TabBar {...properties} />);

    view.rerender(
      <TabBar
        {...properties}
        activeTabId={content2.tabId}
        tabs={[overview, content2]}
      />,
    );
    view.rerender(
      <TabBar
        {...properties}
        activeTabId={overview.tabId}
        tabs={[overview]}
      />,
    );

    expect(
      [...screen.getByRole('tablist').children].map((element) =>
        element.textContent?.replace(/Close tab/g, '').trim(),
      ),
    ).toEqual(['Overview', 'Planning', 'Roadmap']);
    expect(view.container.querySelectorAll('.page-tab--closing')).toHaveLength(2);
  });

  it('removes a closed tab immediately when reduced motion is preferred', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    const properties = {
      activeTabId: content.tabId,
      tabs: [overview, content],
      closeLabel: 'Close tab',
      navigationLabel: 'Pages',
      getPresentation: (tab: TabDescriptor) => ({
        title: tab.tabId,
        icon: 'page.svg',
      }),
      onClose: vi.fn(),
      onMove: vi.fn(),
      onSelect: vi.fn(),
    };
    const view = render(<TabBar {...properties} />);

    view.rerender(
      <TabBar
        {...properties}
        activeTabId={overview.tabId}
        tabs={[overview]}
      />,
    );

    expect(view.container.querySelector('.page-tab--closing')).toBeNull();
  });

  it('does not carry an outgoing visual into another workspace', () => {
    vi.useFakeTimers();
    const properties = {
      activeTabId: content.tabId,
      tabs: [overview, content],
      closeLabel: 'Close tab',
      navigationLabel: 'Pages',
      getPresentation: (tab: TabDescriptor) => ({
        title: tab.tabId,
        icon: 'page.svg',
      }),
      onClose: vi.fn(),
      onMove: vi.fn(),
      onSelect: vi.fn(),
    };
    const view = render(<TabBar {...properties} />);

    view.rerender(
      <TabBar
        {...properties}
        activeTabId={overview.tabId}
        tabs={[overview]}
      />,
    );
    expect(view.container.querySelector('.page-tab--closing')).toBeTruthy();

    view.rerender(
      <TabBar {...properties} activeTabId={home.tabId} tabs={[home]} />,
    );
    expect(view.container.querySelector('.page-tab--closing')).toBeNull();
  });
});
