import { describe, expect, it } from 'vitest';

import {
  adoptWorkspaceSnapshot,
  createInitialWorkspaceState,
  hasRestorableWorkspace,
  selectActiveContext,
  selectActiveTabs,
  serializeWorkspace,
  workspaceReducer,
  type WorkspaceState,
} from '../../src/renderer/components/tabs/workspace-state';
import {
  collectPanes,
  findPane,
} from '../../src/renderer/components/tabs/pane-state';
import { createDescriptor } from '../../src/renderer/components/tabs/tab-state';
import {
  INTERNAL_PAGE_IDS,
  WORKSPACE_SESSION_VERSION,
  type TabTarget,
} from '../../src/shared/contracts';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const NODE_ID = '22222222-2222-4222-8222-222222222222';

const contentTarget: TabTarget = {
  type: 'project-content',
  projectId: PROJECT_ID,
  nodeId: NODE_ID,
  pageType: 'markdown',
};

function openProject(): WorkspaceState {
  return workspaceReducer(createInitialWorkspaceState(), {
    type: 'open-project-workspace',
    projectId: PROJECT_ID,
  });
}

describe('workspace reducer', () => {
  it('starts in the home context with only the home tab', () => {
    const state = createInitialWorkspaceState();

    expect(selectActiveContext(state)).toBe('home');
    expect(state.project).toBeNull();
    expect(selectActiveTabs(state).tabs).toHaveLength(1);
    expect(hasRestorableWorkspace(state)).toBe(false);
  });

  it('opens a project workspace with an overview tab', () => {
    const state = openProject();

    expect(selectActiveContext(state)).toBe('project');
    expect(state.project?.projectId).toBe(PROJECT_ID);
    expect(selectActiveTabs(state).tabs).toHaveLength(1);
    expect(selectActiveTabs(state).activeTabId).toBe(`project:${PROJECT_ID}:overview`);
  });

  it('routes tab actions to the active project workspace', () => {
    const state = workspaceReducer(openProject(), {
      type: 'open-target',
      target: contentTarget,
    });

    expect(selectActiveTabs(state).tabs).toHaveLength(2);
    expect(selectActiveTabs(state).activeTabId).toBe(`project:${PROJECT_ID}:node:${NODE_ID}`);
    expect(state.home.root).toMatchObject({ kind: 'pane', tabs: expect.any(Array) });
  });

  it('keeps the sole project pane empty after its last tab closes', () => {
    const opened = openProject();
    const closed = workspaceReducer(opened, {
      type: 'close-tab',
      tabId: selectActiveTabs(opened).activeTabId!,
    });

    expect(closed.project).not.toBeNull();
    expect(selectActiveTabs(closed).tabs).toEqual([]);
    expect(selectActiveTabs(closed).activeTabId).toBeNull();
    expect(selectActiveContext(closed)).toBe('project');
  });

  it('keeps New tab independent when opening a note', () => {
    const withNewTab = workspaceReducer(openProject(), {
      type: 'open-target',
      target: {
        type: 'internal',
        pageId: INTERNAL_PAGE_IDS.newTab,
        instanceKey: 'independent',
      },
    });
    const newTab = selectActiveTabs(withNewTab).tabs.at(-1)!;
    const opened = workspaceReducer(withNewTab, {
      type: 'open-target',
      target: contentTarget,
    });

    expect(selectActiveTabs(opened).tabs).toContainEqual(newTab);
    expect(selectActiveTabs(opened).tabs).toHaveLength(3);
    expect(selectActiveTabs(opened).activeTabId).toBe(
      `project:${PROJECT_ID}:node:${NODE_ID}`,
    );
  });

  it('opens each New tab instance independently in the active pane', () => {
    const targets = ['new-tab-a', 'new-tab-b', 'new-tab-c'].map(
      (instanceKey) =>
        ({
          type: 'internal',
          pageId: INTERNAL_PAGE_IDS.newTab,
          instanceKey,
        }) satisfies TabTarget,
    );
    const state = targets.reduce(
      (current, target) =>
        workspaceReducer(current, { type: 'open-target', target }),
      openProject(),
    );
    const newTabs = selectActiveTabs(state).tabs.filter(
      ({ target }) =>
        target.type === 'internal' &&
        target.pageId === INTERNAL_PAGE_IDS.newTab,
    );

    expect(newTabs).toHaveLength(3);
    expect(
      newTabs.map(({ target }) =>
        target.type === 'internal' ? target.instanceKey : undefined,
      ),
    ).toEqual(['new-tab-a', 'new-tab-b', 'new-tab-c']);
    expect(selectActiveTabs(state).activeTabId).toBe(newTabs[2]?.tabId);
  });

  it('keeps newly opened tabs isolated to the selected pane', () => {
    const initial = openProject();
    const sourcePaneId = selectActiveTabs(initial).paneId;
    let state = workspaceReducer(initial, {
      type: 'split-pane',
      paneId: sourcePaneId,
      direction: 'row',
    });
    const destinationPaneId = state.project!.activePaneId;
    for (const instanceKey of ['isolated-a', 'isolated-b']) {
      state = workspaceReducer(state, {
        type: 'open-target',
        paneId: destinationPaneId,
        target: {
          type: 'internal',
          pageId: INTERNAL_PAGE_IDS.newTab,
          instanceKey,
        },
      });
    }

    const source = findPane(state.project!.root, sourcePaneId);
    const destination = findPane(
      state.project!.root,
      destinationPaneId,
    );
    expect(source?.tabs).toHaveLength(1);
    expect(source?.tabs[0]?.target).toMatchObject({
      type: 'project-overview',
    });
    expect(destination?.tabs).toHaveLength(3);
    expect(
      destination?.tabs.map(({ tabId }) => tabId),
    ).toEqual([...new Set(destination?.tabs.map(({ tabId }) => tabId))]);
  });

  it('closes the project workspace and returns to preserved home tabs', () => {
    const withHomeTab = workspaceReducer(createInitialWorkspaceState(), {
      type: 'open-page',
      pageId: INTERNAL_PAGE_IDS.settings,
    });
    const inProject = workspaceReducer(withHomeTab, {
      type: 'open-project-workspace',
      projectId: PROJECT_ID,
    });
    const home = workspaceReducer(inProject, {
      type: 'close-project-workspace',
    });

    expect(home.project).toBeNull();
    expect(selectActiveContext(home)).toBe('home');
    expect(selectActiveTabs(home).tabs).toHaveLength(2);
  });

  it('preserves the mandatory last Home tab', () => {
    const state = createInitialWorkspaceState();
    const next = workspaceReducer(state, {
      type: 'close-tab',
      tabId: selectActiveTabs(state).activeTabId!,
    });

    expect(next).toBe(state);
    expect(selectActiveTabs(next).tabs[0]?.target).toMatchObject({
      type: 'internal',
      pageId: INTERNAL_PAGE_IDS.home,
    });
  });

  it('round-trips through serialize and adopt', () => {
    const state = workspaceReducer(openProject(), {
      type: 'open-target',
      target: contentTarget,
    });
    const snapshot = serializeWorkspace(state);

    expect(snapshot.version).toBe(WORKSPACE_SESSION_VERSION);
    expect(adoptWorkspaceSnapshot(snapshot)).toEqual(state);
  });

  it('opens application settings inside the active project workspace', () => {
    const state = workspaceReducer(openProject(), {
      type: 'open-page',
      pageId: INTERNAL_PAGE_IDS.settings,
    });

    expect(selectActiveTabs(state).tabs.at(-1)?.target).toEqual({
      type: 'internal',
      pageId: INTERNAL_PAGE_IDS.settings,
    });
    expect(selectActiveContext(state)).toBe('project');
  });

  it('applies the configured initial state only when a tab is created', () => {
    const readingState = { version: 1, data: { mode: 'reading' } };
    const opened = workspaceReducer(openProject(), {
      type: 'open-target',
      target: contentTarget,
      initialPageState: readingState,
    });
    const tab = selectActiveTabs(opened).tabs.find(
      ({ target }) => target.type === 'project-content',
    );

    expect(tab?.pageState).toEqual({
      version: 3,
      data: { mode: 'reading' },
    });

    const reopened = workspaceReducer(opened, {
      type: 'open-target',
      target: contentTarget,
      initialPageState: { version: 1, data: { mode: 'split' } },
    });

    expect(
      selectActiveTabs(reopened).tabs.find(
        ({ target }) => target.type === 'project-content',
      )?.pageState,
    ).toEqual({
      version: 3,
      data: { mode: 'reading' },
    });
  });

  it('splits in both directions with independent New tabs and collapses panes', () => {
    const initial = openProject();
    const firstPaneId = selectActiveTabs(initial).paneId;
    const sideBySide = workspaceReducer(initial, {
      type: 'split-pane',
      paneId: firstPaneId,
      direction: 'row',
    });
    const panes = collectPanes(sideBySide.project!.root);

    expect(sideBySide.project?.root).toMatchObject({
      kind: 'split',
      direction: 'row',
      ratio: 0.5,
    });
    expect(panes).toHaveLength(2);
    expect(panes[0]?.tabs[0]?.target).toMatchObject({
      type: 'project-overview',
    });
    expect(panes[1]?.tabs[0]?.target).toMatchObject({
      type: 'internal',
      pageId: INTERNAL_PAGE_IDS.newTab,
    });

    const below = workspaceReducer(sideBySide, {
      type: 'split-pane',
      paneId: panes[1]!.paneId,
      direction: 'column',
    });
    expect(collectPanes(below.project!.root)).toHaveLength(3);

    const closed = workspaceReducer(below, {
      type: 'close-pane',
      paneId: panes[0]!.paneId,
    });
    expect(collectPanes(closed.project!.root)).toHaveLength(2);
  });

  it('closes an extra pane when its last tab closes', () => {
    const initial = openProject();
    const firstPaneId = selectActiveTabs(initial).paneId;
    const split = workspaceReducer(initial, {
      type: 'split-pane',
      paneId: firstPaneId,
      direction: 'row',
    });
    const extraPane = findPane(
      split.project!.root,
      split.project!.activePaneId,
    )!;
    const closed = workspaceReducer(split, {
      type: 'close-tab',
      paneId: extraPane.paneId,
      tabId: extraPane.activeTabId!,
    });

    expect(collectPanes(closed.project!.root)).toHaveLength(1);
    expect(selectActiveTabs(closed).tabs[0]?.target).toMatchObject({
      type: 'project-overview',
    });
  });

  it('opens a sidebar target in a new split pane', () => {
    const initial = openProject();
    const targetPaneId = selectActiveTabs(initial).paneId;
    const split = workspaceReducer(initial, {
      type: 'split-pane-with-target',
      targetPaneId,
      target: contentTarget,
      direction: 'column',
      before: false,
    });
    const panes = collectPanes(split.project!.root);

    expect(panes).toHaveLength(2);
    expect(split.project?.root).toMatchObject({
      kind: 'split',
      direction: 'column',
    });
    expect(
      findPane(split.project!.root, split.project!.activePaneId)?.tabs[0]
        ?.target,
    ).toEqual(contentTarget);
  });

  it('moves an existing sidebar target into the chosen pane', () => {
    const opened = workspaceReducer(openProject(), {
      type: 'open-target',
      target: contentTarget,
    });
    const sourcePaneId = selectActiveTabs(opened).paneId;
    const split = workspaceReducer(opened, {
      type: 'split-pane',
      paneId: sourcePaneId,
      direction: 'row',
    });
    const destinationPaneId = split.project!.activePaneId;
    const moved = workspaceReducer(split, {
      type: 'move-or-open-target',
      paneId: destinationPaneId,
      target: contentTarget,
    });
    const panes = collectPanes(moved.project!.root);
    const occurrences = panes.flatMap(({ tabs }) =>
      tabs.filter(({ target }) => target === contentTarget),
    );

    expect(occurrences).toHaveLength(1);
    expect(
      findPane(moved.project!.root, destinationPaneId)?.tabs.some(
        ({ target }) => target === contentTarget,
      ),
    ).toBe(true);
    expect(
      findPane(moved.project!.root, destinationPaneId)?.activeTabId,
    ).toBe(`project:${PROJECT_ID}:node:${NODE_ID}`);
    expect(
      findPane(moved.project!.root, sourcePaneId)?.tabs.some(
        ({ target }) => target === contentTarget,
      ),
    ).toBe(false);
  });

  it('focuses an already open note instead of duplicating it in another pane', () => {
    const opened = workspaceReducer(openProject(), {
      type: 'open-target',
      target: contentTarget,
    });
    const notePaneId = selectActiveTabs(opened).paneId;
    const split = workspaceReducer(opened, {
      type: 'split-pane',
      paneId: notePaneId,
      direction: 'row',
    });
    const emptyPaneId = split.project!.activePaneId;
    const focused = workspaceReducer(split, {
      type: 'open-target',
      paneId: emptyPaneId,
      target: contentTarget,
    });
    const occurrences = collectPanes(focused.project!.root).flatMap(
      ({ tabs }) =>
        tabs.filter(
          ({ target }) =>
            target.type === 'project-content' &&
            target.nodeId === NODE_ID,
        ),
    );

    expect(occurrences).toHaveLength(1);
    expect(focused.project?.activePaneId).toBe(notePaneId);
    expect(findPane(focused.project!.root, emptyPaneId)?.tabs[0]?.target)
      .toMatchObject({
        type: 'internal',
        pageId: INTERNAL_PAGE_IDS.newTab,
      });
  });

  it('removes restored cross-pane note duplicates and preserves the active copy', () => {
    const tabId = `project:${PROJECT_ID}:node:${NODE_ID}`;
    const restored = adoptWorkspaceSnapshot({
      version: WORKSPACE_SESSION_VERSION,
      home: createInitialWorkspaceState().home,
      project: {
        projectId: PROJECT_ID,
        activePaneId: 'right',
        root: {
          kind: 'split',
          splitId: 'split-restore',
          direction: 'row',
          ratio: 0.5,
          first: {
            kind: 'pane',
            paneId: 'left',
            tabs: [
              {
                ...createDescriptor(contentTarget),
                tabId,
              },
            ],
            activeTabId: tabId,
          },
          second: {
            kind: 'pane',
            paneId: 'right',
            tabs: [
              {
                ...createDescriptor(contentTarget),
                tabId: `${tabId}:copy`,
              },
            ],
            activeTabId: `${tabId}:copy`,
          },
        },
      },
    });
    const panes = collectPanes(restored.project!.root);
    const occurrences = panes.flatMap(({ tabs }) =>
      tabs.filter(
        ({ target }) =>
          target.type === 'project-content' && target.nodeId === NODE_ID,
      ),
    );

    expect(occurrences).toHaveLength(1);
    expect(findPane(restored.project!.root, 'right')?.tabs[0]?.tabId).toBe(
      `${tabId}:copy`,
    );
    expect(findPane(restored.project!.root, 'left')).toMatchObject({
      tabs: [],
      activeTabId: null,
    });
  });

  it('stops at five panes and keeps resize ratios bounded', () => {
    let state = openProject();
    for (let index = 0; index < 7; index += 1) {
      state = workspaceReducer(state, {
        type: 'split-pane',
        paneId: selectActiveTabs(state).paneId,
        direction: index % 2 === 0 ? 'row' : 'column',
      });
    }
    expect(collectPanes(state.project!.root)).toHaveLength(5);

    const splitId =
      state.project?.root.kind === 'split'
        ? state.project.root.splitId
        : '';
    const resized = workspaceReducer(state, {
      type: 'resize-split',
      splitId,
      ratio: 3,
    });
    expect(resized.project?.root).toMatchObject({ ratio: 0.9 });
  });

  it('focuses an existing destination tab and removes the empty source pane', () => {
    const opened = openProject();
    const sourcePaneId = selectActiveTabs(opened).paneId;
    const split = workspaceReducer(opened, {
      type: 'split-pane',
      paneId: sourcePaneId,
      direction: 'row',
    });
    const destinationPaneId = split.project!.activePaneId;
    const sourceTab = findPane(
      split.project!.root,
      sourcePaneId,
    )!.tabs[0]!;
    const moved = workspaceReducer(split, {
      type: 'move-tab-between-panes',
      fromPaneId: sourcePaneId,
      toPaneId: destinationPaneId,
      tabId: sourceTab.tabId,
    });

    expect(collectPanes(moved.project!.root)).toHaveLength(1);
    expect(findPane(moved.project!.root, destinationPaneId)?.tabs).toHaveLength(
      2,
    );
  });

  it('closes every project tab into the active pane without touching Home', () => {
    const initial = workspaceReducer(openProject(), {
      type: 'open-target',
      target: contentTarget,
    });
    const firstPaneId = selectActiveTabs(initial).paneId;
    const split = workspaceReducer(initial, {
      type: 'split-pane',
      paneId: firstPaneId,
      direction: 'row',
    });
    const activePaneId = split.project!.activePaneId;
    const homeBefore = split.home;
    const closed = workspaceReducer(split, {
      type: 'close-all-project-tabs',
    });

    expect(closed.home).toBe(homeBefore);
    expect(closed.project).toMatchObject({
      projectId: PROJECT_ID,
      activePaneId,
      root: {
        kind: 'pane',
        paneId: activePaneId,
        tabs: [],
        activeTabId: null,
      },
    });
  });

  it('ignores close-all outside a project and restores an empty project', () => {
    const home = createInitialWorkspaceState();
    expect(
      workspaceReducer(home, { type: 'close-all-project-tabs' }),
    ).toBe(home);

    const closed = workspaceReducer(openProject(), {
      type: 'close-all-project-tabs',
    });
    const restored = adoptWorkspaceSnapshot(serializeWorkspace(closed));

    expect(selectActiveTabs(restored)).toMatchObject({
      tabs: [],
      activeTabId: null,
    });
  });

  it('repairs an empty restored Home workspace with its mandatory page', () => {
    const restored = adoptWorkspaceSnapshot({
      version: WORKSPACE_SESSION_VERSION,
      home: {
        root: {
          kind: 'pane',
          paneId: 'home-pane-empty',
          tabs: [],
          activeTabId: null,
        },
        activePaneId: 'home-pane-empty',
      },
      project: null,
    });

    expect(selectActiveTabs(restored)).toMatchObject({
      activeTabId: 'page:home',
      tabs: [
        expect.objectContaining({
          target: { type: 'internal', pageId: INTERNAL_PAGE_IDS.home },
        }),
      ],
    });
  });
});
