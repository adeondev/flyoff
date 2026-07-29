// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PageHost } from '../../src/renderer/components/tabs/PageHost';
import {
  TabBar,
  tabReorderShift,
  type TabBarHandle,
} from '../../src/renderer/components/tabs/TabBar';
import { findNewWorkspaceTabIds } from '../../src/renderer/components/tabs/WorkspacePaneHost';
import { NewTabPage } from '../../src/renderer/pages/NewTabPage';
import { ProjectEmptyState } from '../../src/renderer/projects/ProjectEmptyState';
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
  Reflect.deleteProperty(HTMLElement.prototype, 'animate');
});

function installElementAnimations() {
  const animations: Array<{
    finish: () => void;
    keyframes: Keyframe[];
    options: KeyframeAnimationOptions;
  }> = [];
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: vi.fn(
      (
        keyframes: Keyframe[],
        options: KeyframeAnimationOptions,
      ) => {
        const listeners = new Map<string, EventListener>();
        const animation = {
          addEventListener: (
            type: string,
            listener: EventListener,
          ) => listeners.set(type, listener),
        } as unknown as Animation;
        animations.push({
          finish: () =>
            listeners.get('finish')?.(new Event('finish')),
          keyframes,
          options,
        });
        return animation;
      },
    ),
  });
  return animations;
}

describe('tab components', () => {
  it('opens an exact-width gap while reordering in either direction', () => {
    expect(
      [0, 1, 2, 3].map((index) =>
        tabReorderShift(index, 0, 3, 190),
      ),
    ).toEqual([0, -190, -190, -190]);
    expect(
      [0, 1, 2, 3].map((index) =>
        tabReorderShift(index, 3, 0, 144),
      ),
    ).toEqual([144, 144, 144, 0]);
    expect(tabReorderShift(1, 1, undefined, 176)).toBe(0);
  });

  it('renders the independent New tab search and activity sections', () => {
    const openNote = vi.fn();
    const { container } = render(
      <NewTabPage
        active
        descriptor={{
          tabId: 'page:new-tab:test',
          target: {
            type: 'internal',
            pageId: 'new-tab',
            instanceKey: 'test',
          },
          scrollTop: 0,
          pageState: { version: 1, data: {} },
        }}
        frequentNotes={[
          { nodeId: NODE_ID, name: 'Planning', path: '/Planning.md' },
        ]}
        recentNotes={[
          { nodeId: NODE_ID_2, name: 'Roadmap', path: '/Roadmap.md' },
        ]}
        onOpenNote={openNote}
        onScrollChange={vi.fn()}
        onStateChange={vi.fn()}
        title="Nova aba"
        translate={(key) => key}
      />,
    );

    expect(screen.getByRole('searchbox', { name: 'pages.searchDen' }))
      .toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'pages.frequentNotes' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'pages.recentlyClosed' }),
    ).toBeTruthy();
    expect(
      container.querySelector('.new-tab-page__books-frame'),
    ).toBeTruthy();
    expect(container.querySelector('.new-tab-page__books')).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: /Planning/ }));
    expect(openNote).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: NODE_ID }),
    );
  });

  it('searches the den and opens a result from the keyboard', async () => {
    vi.useFakeTimers();
    const openNote = vi.fn();
    const searchNotes = vi.fn().mockResolvedValue({
      results: [
        {
          nodeId: NODE_ID,
          name: 'Mission log',
          path: '/Logs/Mission log.md',
          excerpt: 'Apollo launch checklist',
          line: 12,
        },
      ],
      skippedLockedCount: 0,
    });
    render(
      <NewTabPage
        active={false}
        descriptor={{
          tabId: 'page:new-tab:search',
          target: {
            type: 'internal',
            pageId: 'new-tab',
            instanceKey: 'search',
          },
          scrollTop: 0,
          pageState: { version: 1, data: {} },
        }}
        onOpenNote={openNote}
        onSearch={searchNotes}
        onScrollChange={vi.fn()}
        onStateChange={vi.fn()}
        title="New tab"
        translate={(key) => key}
      />,
    );

    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'apollo' } });
    await act(async () => {
      vi.advanceTimersByTime(120);
      await Promise.resolve();
    });
    expect(searchNotes).toHaveBeenCalledWith('apollo');
    expect(screen.getByRole('option', { name: /Mission log/ }))
      .toBeTruthy();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(openNote).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: NODE_ID }),
    );
  });

  it('renders the illustrated empty workspace with its two actions', () => {
    const createNote = vi.fn();
    const search = vi.fn();
    const view = render(
      <ProjectEmptyState
        onCreateNote={createNote}
        onSearch={search}
        translate={(key) => key}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'pages.nothingOpenYet' }),
    ).toBeTruthy();
    expect(
      view.container.querySelector('.project-empty__illustration'),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'projects.newNote' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'pages.search' }));
    expect(createNote).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledOnce();
  });

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

  it('surfaces a page crash with its message and recovers on retry', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const state = { throwing: true };
    const CrashingPage = (): null => {
      if (state.throwing) {
        throw new Error('boom in note');
      }
      return null;
    };
    const properties = {
      tabs: [home, content],
      translate: (key: string) => key,
      getPresentation: (tab: TabDescriptor) => ({
        title: tab.tabId,
        icon: 'page.svg',
      }),
      renderPage: ({ descriptor }: { descriptor: TabDescriptor }) =>
        descriptor.tabId === content.tabId ? (
          <CrashingPage />
        ) : (
          <div data-testid={descriptor.tabId}>{descriptor.tabId}</div>
        ),
      onPageStateChange: vi.fn(),
      onScrollChange: vi.fn(),
    };
    render(<PageHost activeTabId={content.tabId} {...properties} />);

    expect(screen.getByText('pages.failed')).toBeTruthy();
    expect(screen.getByText('boom in note')).toBeTruthy();

    state.throwing = false;
    fireEvent.click(screen.getByRole('button', { name: 'pages.retry' }));

    expect(screen.queryByText('pages.failed')).toBeNull();
    consoleError.mockRestore();
  });

  it('clears a page crash when the tab is reactivated', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const state = { throwing: true };
    const CrashingPage = (): null => {
      if (state.throwing) {
        throw new Error('boom');
      }
      return null;
    };
    const properties = {
      tabs: [home, content],
      translate: (key: string) => key,
      getPresentation: (tab: TabDescriptor) => ({
        title: tab.tabId,
        icon: 'page.svg',
      }),
      renderPage: ({ descriptor }: { descriptor: TabDescriptor }) =>
        descriptor.tabId === content.tabId ? (
          <CrashingPage />
        ) : (
          <div data-testid={descriptor.tabId}>{descriptor.tabId}</div>
        ),
      onPageStateChange: vi.fn(),
      onScrollChange: vi.fn(),
    };
    const view = render(
      <PageHost activeTabId={content.tabId} {...properties} />,
    );
    expect(screen.getByText('pages.failed')).toBeTruthy();

    state.throwing = false;
    view.rerender(<PageHost activeTabId={home.tabId} {...properties} />);
    view.rerender(<PageHost activeTabId={content.tabId} {...properties} />);

    expect(screen.queryByText('pages.failed')).toBeNull();
    consoleError.mockRestore();
  });

  it('keeps the real tab mounted until its 120 ms exit finishes', async () => {
    const animations = installElementAnimations();
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
    let handle: TabBarHandle | null = null;
    const view = render(
      <TabBar
        {...properties}
        ref={(value) => {
          handle = value;
        }}
      />,
    );
    const pending = handle!.animateTabExit(content.tabId);
    const closing = view.container.querySelector<HTMLElement>(
      '.page-tab--closing',
    );
    expect(screen.getByRole('tab', { name: 'Planning' })).toBeTruthy();
    expect(closing?.getAttribute('aria-busy')).toBe('true');
    expect(closing?.hasAttribute('inert')).toBe(true);
    expect(closing?.style.position).toBe('');
    expect(closing?.style.opacity).toBe('');
    expect(
      screen
        .getByRole('tablist')
        .style.getPropertyValue('--page-tab-motion-duration'),
    ).toBe('120ms');
    expect(animations[0]?.options.duration).toBe(120);
    expect(animations[0]?.keyframes.at(-1)).toMatchObject({
      '--page-tab-reveal': '0',
      width: '0px',
      transform: 'translateX(-18px)',
    });

    animations[0]?.finish();
    await pending;
    view.rerender(
      <TabBar
        {...properties}
        activeTabId={content2.tabId}
        tabs={[overview, content2]}
      />,
    );
    expect(view.container.querySelector('.page-tab--closing')).toBeNull();
  });

  it('removes closed content immediately while retaining the real exiting tab', async () => {
    const animations = installElementAnimations();
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
    let handle: TabBarHandle | null = null;
    const view = render(
      <TabBar
        {...properties}
        ref={(value) => {
          handle = value;
        }}
      />,
    );

    const pending = handle!.animateTabExit(content.tabId);
    const exitingElement = screen
      .getByRole('tab', { name: 'Planning' })
      .closest('.page-tab');
    view.rerender(
      <TabBar
        {...properties}
        activeTabId={content2.tabId}
        tabs={[overview, content2]}
        ref={(value) => {
          handle = value;
        }}
      />,
    );

    expect(screen.getByRole('tab', { name: 'Planning' })).toBeTruthy();
    expect(
      screen.getByRole('tab', { name: 'Planning' }).closest('.page-tab'),
    ).toBe(exitingElement);
    expect(
      screen
        .getByRole('tab', { name: 'Roadmap' })
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen
        .getByRole('tab', { name: 'Planning' })
        .getAttribute('aria-selected'),
    ).toBe('false');

    await act(async () => {
      animations[0]?.finish();
      await pending;
    });
    expect(screen.queryByRole('tab', { name: 'Planning' })).toBeNull();
  });

  it('opens a new empty tab from the trailing tab control', () => {
    const onNewTab = vi.fn();
    render(
      <TabBar
        activeTabId={home.tabId}
        closeLabel="Close tab"
        getPresentation={() => ({ icon: 'home.svg', title: 'Home' })}
        navigationLabel="Pages"
        newTabLabel="New tab"
        onClose={vi.fn()}
        onMove={vi.fn()}
        onNewTab={onNewTab}
        onSelect={vi.fn()}
        tabs={[home]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'New tab' }));
    expect(onNewTab).toHaveBeenCalledOnce();
  });

  it('uses one reversible progress for the tab body and feet', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/renderer/styles.css'),
      'utf8',
    );

    expect(styles).toMatch(
      /@property --page-tab-reveal\s*{[^}]*syntax:\s*'<number>';[^}]*inherits:\s*true;[^}]*initial-value:\s*1;/s,
    );
    expect(styles).toMatch(
      /\.page-tab--entering\s*{[^}]*animation:\s*page-tab-reveal var\(--page-tab-motion-duration\) var\(--ease-out\)\s*both;/s,
    );
    expect(
      styles.match(/\.page-tab\s*{([^}]*)}/)?.[1],
    ).not.toContain('animation:');
    expect(styles).toMatch(
      /\.page-tab::before,[\s\S]*?\.page-tab::after\s*{[^}]*transform:\s*scaleX\(var\(--page-tab-reveal\)\);[^}]*transition:\s*box-shadow var\(--dur-micro\) var\(--ease-out\);/s,
    );
    expect(styles).toMatch(
      /\.page-tab--closing\s*{[^}]*pointer-events:\s*none;/s,
    );
    expect(styles).toMatch(
      /@keyframes page-tab-reveal\s*{[\s\S]*?--page-tab-reveal:\s*0;[\s\S]*?transform:\s*translateX\(-18px\);/,
    );
    expect(styles).not.toMatch(/@keyframes page-tab-(?:open|close|foot)/);
    const motion = readFileSync(
      resolve(
        process.cwd(),
        'src/renderer/components/tabs/tab-motion.ts',
      ),
      'utf8',
    );
    expect(motion).toContain("'--page-tab-reveal': '1'");
    expect(motion).toContain("'--page-tab-reveal': '0'");
  });

  it('keeps every tab curved and gives the close hover a circular hit area', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/renderer/styles.css'),
      'utf8',
    );

    expect(styles).toMatch(
      /\.page-tab\s*{[^}]*--page-tab-background:\s*var\(--color-background\);[^}]*margin-left:\s*14px;[^}]*border-radius:\s*12px 12px 0 0;/s,
    );
    expect(styles).toMatch(
      /\.page-tab::before,[\s\S]*?\.page-tab::after\s*{[^}]*width:\s*12px;[^}]*height:\s*12px;/,
    );
    expect(styles).toMatch(
      /\.page-tab--dragging\s*{[^}]*--page-tab-background:\s*color-mix\(/,
    );
    expect(styles).toMatch(
      /\.page-tab__close\s*{[^}]*width:\s*26px;[^}]*height:\s*26px;[^}]*border-radius:\s*999px;/s,
    );
    expect(styles).toMatch(
      /\.page-tab__content\s*{[^}]*overflow:\s*hidden;[^}]*border-radius:\s*inherit;/s,
    );
    expect(styles).toMatch(
      /\.page-tab--closing\s*{[^}]*z-index:\s*0;[^}]*pointer-events:\s*none;/s,
    );
    expect(styles).toMatch(
      /\.page-tab::before,[\s\S]*?\.page-tab::after\s*{[^}]*transform:\s*scaleX\(var\(--page-tab-reveal\)\);/s,
    );
    expect(styles).not.toContain('.page-tab--drop-before');
    expect(styles).not.toContain('.page-tab--drop-after');
    expect(styles).toMatch(
      /\.page-tab--drag-source\s*{[^}]*opacity:\s*0;/s,
    );
    const dragSourceRule = styles.match(
      /\.page-tab--drag-source\s*{([^}]*)}/,
    )?.[1];
    expect(dragSourceRule).not.toContain('visibility');
    expect(dragSourceRule).not.toContain('pointer-events');
    expect(styles).toMatch(
      /\.page-tab--drag-shift\s*{[^}]*transform:\s*translateX\(var\(--page-tab-drag-shift\)\);[^}]*transition:\s*transform 90ms var\(--ease-out\);/s,
    );
  });

  it('moves the pane drop preview and removes it with uniform opacity', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/renderer/styles.css'),
      'utf8',
    );
    const dropTargetRule = styles.match(
      /\.workspace-pane-host__drop-target\s*{([^}]*)}/,
    )?.[1];
    const previewRule = styles.match(
      /\.workspace-pane__drop-preview\s*{([^}]*)}/,
    )?.[1];

    expect(dropTargetRule).toMatch(
      /transition:\s*top 90ms var\(--ease-out\),\s*left 90ms var\(--ease-out\),\s*width 90ms var\(--ease-out\),\s*height 90ms var\(--ease-out\),\s*opacity 90ms linear;/s,
    );
    expect(styles).toMatch(
      /\.workspace-pane-host__drop-target--exiting\s*{[^}]*opacity:\s*0;[^}]*transition:\s*opacity 90ms linear;/s,
    );
    expect(previewRule).toMatch(
      /transition:\s*inset 90ms var\(--ease-out\),\s*border-radius 90ms var\(--ease-out\);/s,
    );
  });

  it('animates the complete split instead of only shifting the new pane', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/renderer/styles.css'),
      'utf8',
    );

    // Every pane and divider travels to its new box, so the whole split moves
    // rather than the entering pane sliding over its neighbours.
    expect(styles).toMatch(
      /\.workspace-pane-host\[data-workspace-motion\] \.workspace-pane,[\s\S]*?\.workspace-split__divider\s*{[^}]*transition:\s*top var\(--workspace-pane-motion-duration, 120ms\) var\(--ease-out\),\s*left var\(--workspace-pane-motion-duration, 120ms\) var\(--ease-out\),\s*width var\(--workspace-pane-motion-duration, 120ms\) var\(--ease-out\),\s*height var\(--workspace-pane-motion-duration, 120ms\) var\(--ease-out\);/s,
    );
    expect(styles).toMatch(
      /\.workspace-pane-host\[data-workspace-motion='exit'\] \.workspace-pane,[\s\S]*?\.workspace-split__divider\s*{[^}]*transition-timing-function:\s*var\(--ease-in\);/s,
    );
    expect(styles).toMatch(
      /\.workspace-pane\[data-pane-exiting\]\s*{[^}]*pointer-events:\s*none;/s,
    );
    // Panes are laid out flat so a split never reparents — and so never
    // remounts — the pane it grows out of.
    expect(styles).toMatch(
      /\.workspace-pane\s*{[^}]*position:\s*absolute;/s,
    );
    expect(styles).not.toContain('@keyframes workspace-split-enter-row-end');
    expect(styles).not.toContain('@keyframes workspace-pane-enter-right');
  });

  it('shrinks tabs before overflowing and maps the mouse wheel to horizontal scroll', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/renderer/styles.css'),
      'utf8',
    );
    const view = render(
      <TabBar
        activeTabId={content.tabId}
        closeLabel="Close tab"
        getPresentation={(tab) => ({
          title: tab.tabId,
          icon: 'page.svg',
        })}
        navigationLabel="Pages"
        onClose={vi.fn()}
        onMove={vi.fn()}
        onSelect={vi.fn()}
        tabs={[overview, content, content2]}
      />,
    );
    const tabList = screen.getByRole('tablist');
    Object.defineProperties(tabList, {
      clientWidth: { configurable: true, value: 320 },
      scrollWidth: { configurable: true, value: 528 },
    });

    fireEvent.wheel(tabList, { deltaY: 72 });

    expect(tabList.scrollLeft).toBe(72);
    expect(styles).toMatch(
      /:root\s*{[^}]*--page-tab-width:\s*176px;[^}]*--page-tab-min-width:\s*112px;[^}]*--page-tab-max-width:\s*220px;/s,
    );
    expect(styles).toMatch(
      /\.page-tab\s*{[^}]*width:\s*var\(--page-tab-width\);[^}]*min-width:\s*var\(--page-tab-min-width\);[^}]*max-width:\s*var\(--page-tab-max-width\);[^}]*flex:\s*0 1 var\(--page-tab-width\);/s,
    );
    expect(
      view.container.querySelectorAll('.page-tab'),
    ).toHaveLength(3);
  });

  it('deduplicates repeated exits and keeps consecutive closing tabs in their original slots', async () => {
    const animations = installElementAnimations();
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
    let handle: TabBarHandle | null = null;
    const view = render(
      <TabBar
        {...properties}
        ref={(value) => {
          handle = value;
        }}
      />,
    );
    const first = handle!.animateTabExit(content.tabId);
    const duplicate = handle!.animateTabExit(content.tabId);
    const second = handle!.animateTabExit(content2.tabId);

    expect(duplicate).toBe(first);
    expect(
      [...screen.getByRole('tablist').children].map((element) =>
        element.textContent?.replace(/Close tab/g, '').trim(),
      ),
    ).toEqual(['Overview', 'Planning', 'Roadmap']);
    expect(view.container.querySelectorAll('.page-tab--closing')).toHaveLength(2);
    expect(animations).toHaveLength(2);

    animations.forEach(({ finish }) => finish());
    await Promise.all([first, second]);
  });

  it('resolves a tab exit immediately when reduced motion is preferred', async () => {
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
    let handle: TabBarHandle | null = null;
    const view = render(
      <TabBar
        {...properties}
        ref={(value) => {
          handle = value;
        }}
      />,
    );

    await expect(handle!.animateTabExit(content.tabId)).resolves.toBeUndefined();
    expect(view.container.querySelector('.page-tab--closing')).toBeNull();
  });

  it('does not reconstruct removed tabs as hidden visual copies', () => {
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
    expect(
      view.container.querySelector('[aria-hidden="true"].page-tab'),
    ).toBeNull();

    view.rerender(
      <TabBar {...properties} activeTabId={home.tabId} tabs={[home]} />,
    );
    expect(view.container.querySelector('.page-tab--closing')).toBeNull();
  });

  it('marks only genuinely added tab ids for entry animation', () => {
    const initialRoot = {
      kind: 'pane' as const,
      paneId: 'left',
      tabs: [overview, content],
      activeTabId: content.tabId,
    };
    const splitRoot = {
      kind: 'split' as const,
      splitId: 'split-1',
      direction: 'row' as const,
      ratio: 0.5,
      first: {
        ...initialRoot,
        tabs: [overview],
        activeTabId: overview.tabId,
      },
      second: {
        kind: 'pane' as const,
        paneId: 'right',
        tabs: [content],
        activeTabId: content.tabId,
      },
    };
    const previous = new Set(initialRoot.tabs.map(({ tabId }) => tabId));

    expect(findNewWorkspaceTabIds(previous, splitRoot)).toEqual([]);
    expect(
      findNewWorkspaceTabIds(previous, {
        ...initialRoot,
        tabs: [...initialRoot.tabs, content2],
        activeTabId: content2.tabId,
      }),
    ).toEqual([content2.tabId]);
  });

  it('animates tab entry only when the host opts the real tab in', () => {
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
    let handle: TabBarHandle | null = null;
    const view = render(
      <TabBar
        {...properties}
        ref={(value) => {
          handle = value;
        }}
      />,
    );

    expect(view.container.querySelector('.page-tab--entering')).toBeNull();
    handle!.animateTabEntry(content.tabId);
    const entering = screen
      .getByRole('tab', { name: content.tabId })
      .closest('.page-tab');
    expect(entering?.classList.contains('page-tab--entering')).toBe(true);
    fireEvent.animationEnd(entering!);
    expect(entering?.classList.contains('page-tab--entering')).toBe(false);
  });
});
