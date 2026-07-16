// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../src/renderer/App';
import {
  TAB_SESSION_VERSION,
  WORKSPACE_SESSION_VERSION,
  type BootstrapState,
  type FlyoffApi,
  type MarkdownDocument,
  type ProjectSummary,
  type ProjectTreeNode,
  type WorkspaceSessionSnapshot,
} from '../../src/shared/contracts';

const projectId = 'cdb39a1a-0339-4c75-91ea-78fbbcb2f97a';
const noteId = 'ffbf978c-43d7-4135-a3ea-f6e4e3ec76fb';
const folderId = 'f44fd7c7-e84d-4b31-8d23-c268c1be446d';
const nestedFolderId = 'adb5e1f7-85e8-4236-9f26-abfc7d0fa425';
const revision = '1'.repeat(64);

const bootstrap: BootstrapState = {
  platform: 'win32',
  uiLocale: 'en-US',
  nativeCore: { coreVersion: '0.1.0', protocolVersion: 1 },
  spellcheck: {
    provider: 'chromium-hunspell',
    canSelectLanguages: true,
    downloadsDictionaries: true,
  },
};

const project: ProjectSummary = {
  projectId,
  name: 'Launch Plan',
  location: 'D:\\Projects\\Launch Plan',
  formatVersion: 1,
};

const note: ProjectTreeNode = {
  nodeId: noteId,
  parentId: null,
  name: 'Roadmap',
  kind: 'page',
  pageType: 'markdown',
};

const markdownDocument: MarkdownDocument = {
  nodeId: noteId,
  content: '# Roadmap',
  revision,
};

function failure(message = 'Unavailable') {
  return {
    ok: false as const,
    error: { code: 'not-found' as const, message },
  };
}

function installProjectApi(
  overrides: Partial<FlyoffApi> = {},
  restorable: WorkspaceSessionSnapshot | null = null,
): FlyoffApi {
  const api: FlyoffApi = {
    controlWindow: vi.fn(async () => ({ maximized: false })),
    executeMenuCommand: vi.fn(async () => undefined),
    getBootstrapState: vi.fn(async () => bootstrap),
    getRestorableTabSession: vi.fn(async () => restorable),
    getWindowState: vi.fn(async () => ({ maximized: false })),
    onCloseRequested: vi.fn(() => () => undefined),
    onRendererMenuCommand: vi.fn(() => () => undefined),
    onWindowStateChanged: vi.fn(() => () => undefined),
    resolveRestorableTabSession: vi.fn(async () => undefined),
    respondToCloseRequest: vi.fn(async () => undefined),
    saveTabSession: vi.fn(async () => undefined),
    selectProjectCreateLocation: vi.fn(async () => ({
      ok: true,
      value: {
        token: '94ad6b94-3a3e-414a-9d54-b8b7ad30d395',
        location: 'D:\\Projects',
        expiresAt: '2030-01-01T00:00:00.000Z',
      },
    })),
    createProject: vi.fn(async () => ({ ok: true, value: project })),
    openProject: vi.fn(async () => ({ ok: true, value: project })),
    restoreProject: vi.fn(async () => ({ ok: true, value: project })),
    closeProject: vi.fn(async () => ({ ok: true, value: null })),
    listProjectChildren: vi.fn(async () => ({ ok: true, value: [note] })),
    getProjectNode: vi.fn(async () => ({ ok: true, value: note })),
    createProjectNode: vi.fn(async () => failure()),
    renameProjectNode: vi.fn(async () => failure()),
    moveProjectNode: vi.fn(async () => failure()),
    trashProjectNode: vi.fn(async () => failure()),
    readMarkdownDocument: vi.fn(async () => ({
      ok: true,
      value: markdownDocument,
    })),
    saveMarkdownDocument: vi.fn(async (request) => ({
      ok: true,
      value: {
        ...markdownDocument,
        content: request.content,
      },
    })),
    ...overrides,
  };

  Object.defineProperty(window, 'flyoff', {
    configurable: true,
    value: api,
  });

  return api;
}

afterEach(() => {
  cleanup();
  document.documentElement.lang = '';
  delete document.documentElement.dataset.platform;
});

describe('project workspace integration', () => {
  it('creates a project and activates its overview and sidebar', async () => {
    const api = installProjectApi();
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'New Project' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Create project' });
    fireEvent.change(
      within(dialog).getByRole('textbox', { name: 'Project name' }),
      { target: { value: project.name } },
    );
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Choose location' }),
    );
    await within(dialog).findByText('D:\\Projects');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(api.createProject).toHaveBeenCalledWith({
        name: project.name,
        selectionToken: '94ad6b94-3a3e-414a-9d54-b8b7ad30d395',
      });
      expect(
        screen.getByRole('complementary', { name: 'Project contents' }),
      ).toBeTruthy();
      expect(
        screen.getByRole('tab', { name: project.name }).getAttribute(
          'aria-selected',
        ),
      ).toBe('true');
    });
    expect(screen.getByRole('heading', { name: project.name })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'This Device' })).toBeNull();
  });

  it('opens a Markdown node and closes the project back to the global sidebar', async () => {
    const api = installProjectApi();
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Project' }),
    );

    expect(
      await screen.findByRole('complementary', { name: 'Project contents' }),
    ).toBeTruthy();
    expect(api.openProject).toHaveBeenCalledOnce();
    fireEvent.click(await screen.findByRole('button', { name: 'Roadmap' }));

    await waitFor(() => {
      expect(
        screen.getByRole('tab', { name: 'Roadmap' }).getAttribute(
          'aria-selected',
        ),
      ).toBe('true');
      expect(api.readMarkdownDocument).toHaveBeenCalledWith({ nodeId: noteId });
    });
    expect(screen.queryByRole('tab', { name: 'Roadmap.md' })).toBeNull();
    expect(
      (await screen.findByRole('textbox', { name: 'Markdown editor' }))
        .textContent,
    ).toContain('# Roadmap');

    fireEvent.click(screen.getByRole('button', { name: 'Close project' }));

    await waitFor(() => {
      expect(
        screen.getByRole('complementary', { name: 'Navigation' }),
      ).toBeTruthy();
      expect(screen.getByRole('button', { name: 'This Device' })).toBeTruthy();
    });
    expect(api.closeProject).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('complementary', { name: 'Project contents' }),
    ).toBeNull();
    expect(screen.queryByRole('tab', { name: project.name })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Roadmap' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Home' })).toBeTruthy();
  });

  it('waits for a pending trash operation before confirming window close', async () => {
    let closeListener:
      | Parameters<FlyoffApi['onCloseRequested']>[0]
      | undefined;
    let finishTrash:
      | ((result: {
          ok: true;
          value: { nodeIds: readonly string[] };
        }) => void)
      | undefined;
    const respondToCloseRequest = vi.fn(async () => undefined);
    const trashProjectNode = vi.fn(
      () =>
        new Promise<{
          ok: true;
          value: { nodeIds: readonly string[] };
        }>((resolve) => {
          finishTrash = resolve;
        }),
    );
    installProjectApi({
      onCloseRequested: vi.fn((listener) => {
        closeListener = listener;
        return () => undefined;
      }),
      respondToCloseRequest,
      trashProjectNode,
    });
    const appRoot = document.createElement('div');
    appRoot.id = 'root';
    document.body.append(appRoot);
    render(<App />, { container: appRoot });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Project' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Roadmap' }));
    await screen.findByRole('textbox', { name: 'Markdown editor' });
    fireEvent.click(
      screen.getByRole('button', { name: 'More actions: Roadmap' }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to trash' }));
    const trashDialog = screen.getByRole('dialog', {
      name: 'Move to trash?',
    });
    fireEvent.click(
      within(trashDialog).getByRole('button', { name: 'Move to trash' }),
    );

    await waitFor(() => expect(trashProjectNode).toHaveBeenCalledOnce());
    act(() => {
      closeListener?.({
        intent: 'window-close',
        requestId: 'close-trash-request',
      });
    });
    const closeDialog = screen.getByRole('dialog', {
      name: 'Close this window?',
    });
    fireEvent.click(
      within(closeDialog).getByRole('button', { name: 'Close window' }),
    );
    await Promise.resolve();
    expect(respondToCloseRequest).not.toHaveBeenCalled();

    await act(async () => {
      finishTrash?.({ ok: true, value: { nodeIds: [noteId] } });
    });

    await waitFor(() => {
      expect(respondToCloseRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: 'confirm',
          requestId: 'close-trash-request',
        }),
      );
    });
    const response = respondToCloseRequest.mock.calls[0]?.[0];
    expect(
      response?.decision === 'confirm'
        ? (response.session.project?.tabs ?? []).some(
            ({ target }) =>
              target.type === 'project-content' && target.nodeId === noteId,
          )
        : true,
    ).toBe(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(appRoot.inert).toBe(false);
    expect(appRoot.hasAttribute('aria-hidden')).toBe(false);
    appRoot.remove();
  });

  it('marks an externally removed node unavailable after refresh', async () => {
    let present = true;
    installProjectApi({
      listProjectChildren: vi.fn(async () => ({
        ok: true as const,
        value: present ? [note] : [],
      })),
    });
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Project' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Roadmap' }));
    await screen.findByRole('textbox', { name: 'Markdown editor' });

    present = false;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(
        screen.getByRole('tab', {
          name: 'This content is no longer available.',
        }),
      ).toBeTruthy();
      expect(
        screen.getByRole('alert').textContent,
      ).toContain('This content is no longer available.');
    });
  });

  it('updates an open tab title after an inline rename', async () => {
    const renamed = { ...note, name: 'Launch' };
    const renameProjectNode = vi.fn(async () => ({
      ok: true as const,
      value: renamed,
    }));
    installProjectApi({ renameProjectNode });
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Project' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Roadmap' }));
    await screen.findByRole('textbox', { name: 'Markdown editor' });
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Roadmap' }));
    const nameInput = screen.getByRole('textbox', { name: 'Name' });
    fireEvent.change(nameInput, { target: { value: 'Launch' } });
    fireEvent.submit(nameInput.closest('form')!);

    await waitFor(() => {
      expect(renameProjectNode).toHaveBeenCalledWith({
        nodeId: noteId,
        name: 'Launch',
      });
      expect(screen.getByRole('tab', { name: 'Launch' })).toBeTruthy();
    });
  });

  it('preserves lazy tree expansion across project tab switches', async () => {
    const folder: ProjectTreeNode = {
      nodeId: folderId,
      parentId: null,
      name: 'Notes',
      kind: 'folder',
    };
    const nestedNote: ProjectTreeNode = { ...note, parentId: folderId };
    const listProjectChildren = vi.fn(async ({ parentId }) => ({
      ok: true as const,
      value: parentId === null ? [folder] : [nestedNote],
    }));
    installProjectApi({ listProjectChildren });
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Project' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Notes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Roadmap' }));
    await screen.findByRole('textbox', { name: 'Markdown editor' });

    fireEvent.click(screen.getByRole('tab', { name: project.name }));
    fireEvent.click(screen.getByRole('tab', { name: 'Roadmap' }));

    expect(await screen.findByRole('button', { name: 'Roadmap' })).toBeTruthy();
    expect(
      listProjectChildren.mock.calls.filter(
        ([request]) => request.parentId === folderId,
      ),
    ).toHaveLength(1);
  });

  it('keeps only global tabs when the restored project is unavailable', async () => {
    const previous: WorkspaceSessionSnapshot = {
      version: WORKSPACE_SESSION_VERSION,
      home: {
        version: TAB_SESSION_VERSION,
        tabs: [
          {
            tabId: 'page:home',
            target: { type: 'internal', pageId: 'home' },
            scrollTop: 0,
            pageState: { version: 1, data: {} },
          },
        ],
        activeTabId: 'page:home',
      },
      project: {
        projectId,
        tabs: [
          {
            tabId: `project:${projectId}:node:${noteId}`,
            target: {
              type: 'project-content',
              projectId,
              nodeId: noteId,
              pageType: 'markdown',
            },
            scrollTop: 12,
            pageState: { version: 1, data: {} },
          },
        ],
        activeTabId: `project:${projectId}:node:${noteId}`,
      },
    };
    const restoreProject = vi.fn(async () => failure('Missing project'));
    const api = installProjectApi({ restoreProject }, previous);
    render(<App />);

    expect(
      await screen.findByText('Restore tabs from your last session?'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => {
      expect(restoreProject).toHaveBeenCalledWith({ projectId });
      expect(api.resolveRestorableTabSession).toHaveBeenCalledWith(
        'restore',
        expect.objectContaining({
          project: null,
          home: expect.objectContaining({
            activeTabId: 'page:home',
            tabs: [expect.objectContaining({ tabId: 'page:home' })],
          }),
        }),
      );
    });
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'Home' })).toBeTruthy();
    expect(
      screen.getByRole('alert').textContent,
    ).toContain('The project from the previous session could not be opened.');
    expect(screen.getByRole('button', { name: 'This Device' })).toBeTruthy();
  });

  it('consumes the restore prompt before awaiting a slow project restore', async () => {
    const previous: WorkspaceSessionSnapshot = {
      version: WORKSPACE_SESSION_VERSION,
      home: {
        version: TAB_SESSION_VERSION,
        tabs: [
          {
            tabId: 'page:home',
            target: { type: 'internal', pageId: 'home' },
            scrollTop: 0,
            pageState: { version: 1, data: {} },
          },
        ],
        activeTabId: 'page:home',
      },
      project: {
        projectId,
        tabs: [
          {
            tabId: `project:${projectId}:overview`,
            target: { type: 'project-overview', projectId },
            scrollTop: 0,
            pageState: { version: 1, data: {} },
          },
        ],
        activeTabId: `project:${projectId}:overview`,
      },
    };
    let finishRestore:
      | ((result: { ok: true; value: ProjectSummary }) => void)
      | undefined;
    const restoreProject = vi.fn(
      () =>
        new Promise<{ ok: true; value: ProjectSummary }>((resolve) => {
          finishRestore = resolve;
        }),
    );
    const api = installProjectApi({ restoreProject }, previous);
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Restore' }),
    );
    expect(
      screen.queryByText('Restore tabs from your last session?'),
    ).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Loading');

    fireEvent.click(screen.getByRole('button', { name: 'This Device' }));
    expect(api.resolveRestorableTabSession).not.toHaveBeenCalled();

    await act(async () => {
      finishRestore?.({ ok: true, value: project });
    });

    await waitFor(() => {
      expect(api.resolveRestorableTabSession).toHaveBeenCalledWith(
        'restore',
        expect.objectContaining({
          project: expect.objectContaining({
            activeTabId: `project:${projectId}:overview`,
          }),
        }),
      );
    });
    expect(
      screen.getByRole('tab', { name: project.name }).getAttribute(
        'aria-selected',
      ),
    ).toBe('true');
  });

  it('closes a restored deep note when an unexpanded ancestor is trashed', async () => {
    const nestedNote: ProjectTreeNode = {
      ...note,
      parentId: nestedFolderId,
    };
    const rootFolder: ProjectTreeNode = {
      nodeId: folderId,
      parentId: null,
      name: 'Archive',
      kind: 'folder',
    };
    const nestedFolder: ProjectTreeNode = {
      nodeId: nestedFolderId,
      parentId: folderId,
      name: 'Nested',
      kind: 'folder',
    };
    const previous: WorkspaceSessionSnapshot = {
      version: WORKSPACE_SESSION_VERSION,
      home: {
        version: TAB_SESSION_VERSION,
        tabs: [
          {
            tabId: 'page:home',
            target: { type: 'internal', pageId: 'home' },
            scrollTop: 0,
            pageState: { version: 1, data: {} },
          },
        ],
        activeTabId: 'page:home',
      },
      project: {
        projectId,
        tabs: [
          {
            tabId: `project:${projectId}:node:${noteId}`,
            target: {
              type: 'project-content',
              projectId,
              nodeId: noteId,
              pageType: 'markdown',
            },
            scrollTop: 0,
            pageState: { version: 1, data: {} },
          },
        ],
        activeTabId: `project:${projectId}:node:${noteId}`,
      },
    };
    const closeProject = vi.fn(async () => ({ ok: true as const, value: null }));
    installProjectApi(
      {
        closeProject,
        getProjectNode: vi.fn(async ({ nodeId }) => ({
          ok: true as const,
          value:
            nodeId === noteId
              ? nestedNote
              : nodeId === nestedFolderId
                ? nestedFolder
                : rootFolder,
        })),
        listProjectChildren: vi.fn(async ({ parentId }) => ({
          ok: true as const,
          value:
            parentId === null
              ? [rootFolder]
              : parentId === folderId
                ? [nestedFolder]
                : [nestedNote],
        })),
        trashProjectNode: vi.fn(async () => ({
          ok: true as const,
          value: { nodeIds: [folderId, nestedFolderId, noteId] },
        })),
      },
      previous,
    );
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    await screen.findByRole('textbox', { name: 'Markdown editor' });
    fireEvent.click(
      screen.getByRole('button', { name: 'More actions: Archive' }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to trash' }));
    const dialog = screen.getByRole('dialog', { name: 'Move to trash?' });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Move to trash' }),
    );

    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: 'Roadmap' })).toBeNull();
    });
    expect(closeProject).not.toHaveBeenCalled();
    expect(screen.getByText('No tab open.')).toBeTruthy();
  });

  it('switches the note view mode through page session state', async () => {
    installProjectApi();
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Project' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Roadmap' }));
    await screen.findByRole('textbox', { name: 'Markdown editor' });

    fireEvent.click(screen.getByRole('button', { name: 'Reading' }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Reading' }).getAttribute(
          'aria-pressed',
        ),
      ).toBe('true');
    });
    expect(
      screen.queryByRole('textbox', { name: 'Markdown editor' }),
    ).toBeNull();
    expect(screen.getByRole('document', { name: 'Reading' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Split' }));
    expect(
      await screen.findByRole('textbox', { name: 'Markdown editor' }),
    ).toBeTruthy();
    expect(screen.getByRole('document', { name: 'Reading' })).toBeTruthy();
  });

  it('switches project rail views between the tree and placeholders', async () => {
    installProjectApi();
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Project' }),
    );
    await screen.findByRole('complementary', { name: 'Project contents' });

    const rail = screen.getByRole('navigation', { name: 'Project sections' });
    expect(within(rail).getAllByRole('button')).toHaveLength(4);

    fireEvent.click(within(rail).getByRole('button', { name: 'Graph' }));
    await waitFor(() => {
      expect(screen.getByText('Coming soon.')).toBeTruthy();
    });
    expect(
      screen.queryByRole('complementary', { name: 'Project contents' }),
    ).toBeNull();

    fireEvent.click(within(rail).getByRole('button', { name: 'Project' }));
    expect(
      await screen.findByRole('complementary', { name: 'Project contents' }),
    ).toBeTruthy();
    expect(screen.queryByText('Coming soon.')).toBeNull();
  });
});
