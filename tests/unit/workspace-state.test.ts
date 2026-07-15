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
    expect(state.project?.activeTabId).toBe(`project:${PROJECT_ID}:overview`);
  });

  it('routes tab actions to the active project workspace', () => {
    const state = workspaceReducer(openProject(), {
      type: 'open-target',
      target: contentTarget,
    });

    expect(state.project?.tabs).toHaveLength(2);
    expect(state.project?.activeTabId).toBe(`project:${PROJECT_ID}:node:${NODE_ID}`);
    expect(state.home.tabs).toHaveLength(1);
  });

  it('keeps an empty project workspace when the last tab is closed', () => {
    const opened = openProject();
    const closed = workspaceReducer(opened, {
      type: 'close-tab',
      tabId: opened.project!.activeTabId!,
    });

    expect(closed.project).not.toBeNull();
    expect(closed.project?.tabs).toHaveLength(0);
    expect(closed.project?.activeTabId).toBeNull();
    expect(selectActiveContext(closed)).toBe('project');
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
    expect(home.home.tabs).toHaveLength(2);
  });

  it('still blocks closing the last home tab', () => {
    const state = createInitialWorkspaceState();
    const next = workspaceReducer(state, {
      type: 'close-tab',
      tabId: state.home.activeTabId,
    });

    expect(next).toBe(state);
    expect(next.home.tabs).toHaveLength(1);
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
});
