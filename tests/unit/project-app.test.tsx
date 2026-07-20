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
  RENDERER_MENU_COMMANDS,
  WORKSPACE_SESSION_VERSION,
  type BootstrapState,
  type FlyoffApi,
  type MarkdownDocument,
  type ProjectPageProperties,
  type ProjectSummary,
  type ProjectTreeNode,
  type RendererMenuCommand,
  type TabDescriptor,
  type WorkspaceSessionSnapshot,
} from '../../src/shared/contracts';

const projectId = 'cdb39a1a-0339-4c75-91ea-78fbbcb2f97a';
const noteId = 'ffbf978c-43d7-4135-a3ea-f6e4e3ec76fb';
const plainNoteId = '2b4aa17c-9c6e-4f99-99af-b729c77c7603';
const folderId = 'f44fd7c7-e84d-4b31-8d23-c268c1be446d';
const nestedFolderId = 'adb5e1f7-85e8-4236-9f26-abfc7d0fa425';
const revision = '1'.repeat(64);
const nextRevision = '2'.repeat(64);
const finalRevision = '3'.repeat(64);

function paneWorkspace(
  tabs: readonly TabDescriptor[],
  activeTabId: string | null,
  paneId: string,
) {
  return {
    root: { kind: 'pane' as const, paneId, tabs, activeTabId },
    activePaneId: paneId,
  };
}

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
  canContainChildren: true,
  hasChildren: false,
  nodeId: noteId,
  parentId: null,
  name: 'Roadmap',
  kind: 'page',
  pageType: 'markdown',
};

const markdownDocument: MarkdownDocument = {
  nodeId: noteId,
  content: '# Roadmap',
  readOnly: false,
  revision,
};

const noteProperties: ProjectPageProperties = {
  nodeId: noteId,
  pageType: 'markdown',
  contentSizeBytes: 9,
  diskSizeBytes: 9,
  createdAt: '2026-01-02T03:04:05.000Z',
  modifiedAt: '2026-02-03T04:05:06.000Z',
  revision,
  readOnly: false,
  passwordProtected: false,
  locked: false,
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
    getProjectPageProperties: vi.fn(async () => ({
      ok: true,
      value: noteProperties,
    })),
    setProjectPageReadOnly: vi.fn(async (request) => ({
      ok: true,
      value: {
        ...noteProperties,
        readOnly: request.readOnly,
        revision: nextRevision,
      },
    })),
    protectProjectPage: vi.fn(async () => ({
      ok: true,
      value: {
        ...noteProperties,
        passwordProtected: true,
        revision: nextRevision,
      },
    })),
    changeProjectPagePassword: vi.fn(async () => ({
      ok: true,
      value: { ...noteProperties, passwordProtected: true },
    })),
    removeProjectPagePassword: vi.fn(async () => ({
      ok: true,
      value: noteProperties,
    })),
    unlockProjectPage: vi.fn(async () => ({
      ok: true,
      value: markdownDocument,
    })),
    lockProjectPage: vi.fn(async () => ({ ok: true, value: null })),
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
  it('persists editor scroll only after the movement settles', async () => {
    const api = installProjectApi();
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open den' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Roadmap' }));
    const editor = await screen.findByRole('textbox', {
      name: 'Markdown editor',
    });
    await new Promise((resolve) => window.setTimeout(resolve, 240));
    vi.mocked(api.saveTabSession!).mockClear();

    editor.scrollTop = 24;
    fireEvent.scroll(editor);
    editor.scrollTop = 48;
    fireEvent.scroll(editor);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(api.saveTabSession).not.toHaveBeenCalled();

    fireEvent(editor, new Event('scrollend', { bubbles: true }));
    await waitFor(() => expect(api.saveTabSession).toHaveBeenCalledOnce());
    const saved = vi.mocked(api.saveTabSession!).mock.calls[0]![0];
    const projectPane = saved.project?.root;
    expect(projectPane?.kind).toBe('pane');
    if (projectPane?.kind === 'pane') {
      expect(
        projectPane.tabs.find(
          ({ target }) =>
            target.type === 'project-content' && target.nodeId === noteId,
        )?.scrollTop,
      ).toBe(48);
    }
  });

  it('records real note activation and closure without counting workspace setup', async () => {
    const recordProjectNoteActivity = vi.fn(async (event) => ({
      ok: true as const,
      value: {
        projectId,
        nodeId: event.nodeId,
        activationCount: 1,
        lastActivatedAt: '2026-03-01T10:00:00.000Z',
        lastClosedAt:
          event.type === 'closed'
            ? '2026-03-01T10:05:00.000Z'
            : null,
      },
    }));
    installProjectApi({
      getProjectNoteActivity: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      listProjectLinkTargets: vi.fn(async () => ({
        ok: true,
        value: [
          {
            nodeId: noteId,
            name: 'Roadmap',
            path: '/Roadmap.md',
          },
        ],
      })),
      recordProjectNoteActivity,
    });
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open den' }),
    );
    expect(recordProjectNoteActivity).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Roadmap' }));
    await waitFor(() => {
      expect(recordProjectNoteActivity).toHaveBeenCalledWith({
        type: 'activated',
        nodeId: noteId,
      });
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Close tab: Roadmap' }),
    );
    await waitFor(() => {
      expect(recordProjectNoteActivity).toHaveBeenCalledWith({
        type: 'closed',
        nodeId: noteId,
      });
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'New tab', exact: true }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Recently closed' }),
    ).toBeTruthy();
    expect(
      await screen.findByRole('option', { name: /Roadmap/ }),
    ).toBeTruthy();
  });

  it('creates a project and activates its overview and sidebar', async () => {
    const api = installProjectApi();
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'New den' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Create den' });
    fireEvent.change(
      within(dialog).getByRole('textbox', { name: 'Den name' }),
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
        screen.getByRole('complementary', { name: 'Den contents' }),
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
      await screen.findByRole('button', { name: 'Open den' }),
    );

    expect(
      await screen.findByRole('complementary', { name: 'Den contents' }),
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
    expect(
      screen
        .getByRole('main', { name: 'Markdown editor' })
        .getAttribute('data-chrome-layout'),
    ).toBe('focus');
    fireEvent.click(screen.getByRole('button', { name: 'Note options' }));
    expect(await screen.findByText('/Roadmap')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });

    fireEvent.click(screen.getByRole('button', { name: 'Close den' }));

    await waitFor(() => {
      expect(
        screen.getByRole('complementary', { name: 'Navigation' }),
      ).toBeTruthy();
      expect(screen.getByRole('button', { name: 'This Device' })).toBeTruthy();
    });
    expect(api.closeProject).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('complementary', { name: 'Den contents' }),
    ).toBeNull();
    expect(screen.queryByRole('tab', { name: project.name })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Roadmap' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Home' })).toBeTruthy();
  });

  it('cancels note close when a pending save fails and preserves the draft', async () => {
    let finishSave:
      | ((result: {
          ok: false;
          error: { code: 'io-error'; message: string };
        }) => void)
      | undefined;
    const saveMarkdownDocument = vi.fn(
      () =>
        new Promise<{
          ok: false;
          error: { code: 'io-error'; message: string };
        }>((resolve) => {
          finishSave = resolve;
        }),
    );
    const api = installProjectApi({ saveMarkdownDocument });
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open den' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Roadmap' }));
    const editor = await screen.findByRole('textbox', {
      name: 'Markdown editor',
    });
    await waitFor(() => expect(document.activeElement).toBe(editor));
    editor.textContent = '# Changed';
    fireEvent.input(editor);
    fireEvent.keyDown(editor, { ctrlKey: true, key: 's' });
    await waitFor(() => expect(saveMarkdownDocument).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('tab', { name: project.name }));
    expect(
      screen
        .getByRole('tab', { name: project.name })
        .getAttribute('aria-selected'),
    ).toBe('true');
    fireEvent.click(
      screen.getByRole('button', { name: 'Close tab: Roadmap' }),
    );
    expect(screen.getByRole('tab', { name: 'Roadmap' })).toBeTruthy();
    expect(api.lockProjectPage).not.toHaveBeenCalled();

    await act(async () => {
      finishSave?.({
        ok: false,
        error: {
          code: 'io-error',
          message: 'Background save failed',
        },
      });
    });
    expect(screen.getByRole('alert').textContent).toContain(
      'Background save failed',
    );
    expect(screen.getByRole('tab', { name: 'Roadmap' })).toBeTruthy();
    expect(api.lockProjectPage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Roadmap' }));
    expect(
      (await screen.findByRole('textbox', { name: 'Markdown editor' }))
        .textContent,
    ).toContain('# Changed');
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
      await screen.findByRole('button', { name: 'Open den' }),
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
      await screen.findByRole('button', { name: 'Open den' }),
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
      value: {
        node: renamed,
        skippedLockedNodeIds: [plainNoteId],
        updatedDocumentNodeIds: [],
      },
    }));
    installProjectApi({ renameProjectNode });
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open den' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Roadmap' }));
    await screen.findByRole('textbox', { name: 'Markdown editor' });
    const treeItem = screen
      .getByRole('button', { name: 'Roadmap' })
      .closest<HTMLElement>('[role="treeitem"]')!;
    fireEvent.keyDown(treeItem, { key: 'F2' });
    const nameInput = screen.getByRole('textbox', { name: 'Name' });
    fireEvent.change(nameInput, { target: { value: 'Launch' } });
    fireEvent.submit(nameInput.closest('form')!);

    await waitFor(() => {
      expect(renameProjectNode).toHaveBeenCalledWith({
        nodeId: noteId,
        name: 'Launch',
      });
      expect(screen.getByRole('tab', { name: 'Launch' })).toBeTruthy();
      expect(screen.queryByRole('status')).toBeNull();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Note options' }));
    expect(await screen.findByText('/Launch')).toBeTruthy();
  });

  it('updates an open note path after an ancestor rename', async () => {
    const folder: ProjectTreeNode = {
      canContainChildren: true,
      hasChildren: true,
      nodeId: folderId,
      parentId: null,
      name: 'Notes',
      kind: 'folder',
    };
    const nestedNote: ProjectTreeNode = { ...note, parentId: folderId };
    const renameProjectNode = vi.fn(async () => ({
      ok: true as const,
      value: {
        node: { ...folder, name: 'Archive' },
        skippedLockedNodeIds: [],
        updatedDocumentNodeIds: [],
      },
    }));
    installProjectApi({
      listProjectChildren: vi.fn(async ({ parentId }) => ({
        ok: true as const,
        value: parentId === null ? [folder] : [nestedNote],
      })),
      renameProjectNode,
    });
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open den' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Notes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Roadmap' }));
    await screen.findByRole('textbox', { name: 'Markdown editor' });

    const folderItem = screen
      .getByRole('button', { name: 'Notes' })
      .closest<HTMLElement>('[role="treeitem"]')!;
    fireEvent.keyDown(folderItem, { key: 'Escape' });
    fireEvent.keyDown(folderItem, { key: ' ', ctrlKey: true });
    fireEvent.keyDown(folderItem, { key: 'F2' });
    const nameInput = screen.getByRole('textbox', { name: 'Name' });
    fireEvent.change(nameInput, { target: { value: 'Archive' } });
    fireEvent.submit(nameInput.closest('form')!);

    await waitFor(() => {
      expect(renameProjectNode).toHaveBeenCalledWith({
        nodeId: folderId,
        name: 'Archive',
      });
    });
    expect(screen.getByRole('tab', { name: 'Roadmap' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Note options' }));
    expect(await screen.findByText('/Archive/Roadmap')).toBeTruthy();
  });

  it('opens properties immediately with Alt+Enter and applies read-only after flushing the current revision', async () => {
    let finishProperties:
      | ((result: { ok: true; value: ProjectPageProperties }) => void)
      | undefined;
    const getProjectPageProperties = vi.fn(
      () =>
        new Promise<{ ok: true; value: ProjectPageProperties }>((resolve) => {
          finishProperties = resolve;
        }),
    );
    const saveMarkdownDocument = vi.fn(async (request) => ({
      ok: true as const,
      value: {
        ...markdownDocument,
        content: request.content,
        revision: nextRevision,
      },
    }));
    const setProjectPageReadOnly = vi.fn(async (request) => ({
      ok: true as const,
      value: {
        ...noteProperties,
        readOnly: request.readOnly,
        revision: finalRevision,
      },
    }));
    installProjectApi({
      getProjectPageProperties,
      saveMarkdownDocument,
      setProjectPageReadOnly,
    });
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open den' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Roadmap' }));
    const editor = await screen.findByRole('textbox', {
      name: 'Markdown editor',
    });
    await waitFor(() => expect(document.activeElement).toBe(editor));
    editor.textContent = '# Current draft';
    fireEvent.input(editor, { inputType: 'insertText' });
    fireEvent.keyDown(editor, { altKey: true, key: 'Enter' });

    const dialog = screen.getByRole('dialog', { name: 'Note properties' });
    expect(
      dialog.querySelector('.project-page-properties')?.getAttribute(
        'aria-busy',
      ),
    ).toBe('true');
    expect(getProjectPageProperties).toHaveBeenCalledWith({ nodeId: noteId });

    await act(async () => {
      finishProperties?.({ ok: true, value: noteProperties });
    });
    const readOnly = within(dialog).getByRole('checkbox', {
      name: /Read-only/,
    });
    fireEvent.click(readOnly);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));

    await waitFor(
      () => {
        expect(saveMarkdownDocument).toHaveBeenCalledWith({
          nodeId: noteId,
          content: '# Current draft',
          expectedRevision: revision,
        });
        expect(setProjectPageReadOnly).toHaveBeenCalledWith({
          nodeId: noteId,
          expectedRevision: nextRevision,
          readOnly: true,
        });
        expect(editor.getAttribute('contenteditable')).toBe('false');
      },
      { timeout: 5_000 },
    );
    expect(
      (screen.getByRole('button', { name: 'Bold' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('opens Markdown note properties from the final context-menu group', async () => {
    const api = installProjectApi();
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open den' }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'More actions: Roadmap' }),
    );
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Properties…' }),
    );

    expect(
      await screen.findByRole('dialog', { name: 'Note properties' }),
    ).toBeTruthy();
    expect(api.getProjectPageProperties).toHaveBeenCalledWith({
      nodeId: noteId,
    });
  });

  it('removes plaintext from the DOM while locking and restores the note after unlock', async () => {
    const protectedProperties = {
      ...noteProperties,
      passwordProtected: true,
      locked: false,
    };
    const lockProjectPage = vi.fn(async () => ({
      ok: true as const,
      value: null,
    }));
    const unlockProjectPage = vi.fn(async () => ({
      ok: true as const,
      value: markdownDocument,
    }));
    installProjectApi({
      getProjectPageProperties: vi.fn(async () => ({
        ok: true as const,
        value: protectedProperties,
      })),
      lockProjectPage,
      unlockProjectPage,
    });
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open den' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Roadmap' }));
    const editor = await screen.findByRole('textbox', {
      name: 'Markdown editor',
    });
    fireEvent.keyDown(editor, { altKey: true, key: 'Enter' });
    const dialog = await screen.findByRole('dialog', {
      name: 'Note properties',
    });
    await within(dialog).findByRole('button', { name: 'Lock now' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lock now' }));

    await waitFor(() => {
      expect(lockProjectPage).toHaveBeenCalledWith({ nodeId: noteId });
      expect(
        screen.queryByRole('textbox', { name: 'Markdown editor' }),
      ).toBeNull();
      expect(document.body.textContent).not.toContain('# Roadmap');
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Unlock' }));
    fireEvent.change(
      within(dialog).getByLabelText('Password'),
      { target: { value: 'correct horse battery staple' } },
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unlock' }));

    expect(
      (await screen.findByRole('textbox', { name: 'Markdown editor' }))
        .textContent,
    ).toContain('# Roadmap');
    expect(unlockProjectPage).toHaveBeenCalledWith({
      nodeId: noteId,
      password: 'correct horse battery staple',
    });
  });

  it('keeps an unprotected note accessible after reopening a protected note', async () => {
    const protectedNote = { ...note, name: '123' };
    const plainNote: ProjectTreeNode = {
      ...note,
      nodeId: plainNoteId,
      name: 'aaaa',
    };
    const protectedDocument = {
      ...markdownDocument,
      content: '# Secret',
    };
    const plainDocument: MarkdownDocument = {
      ...markdownDocument,
      nodeId: plainNoteId,
      content: '',
    };
    let protectedLocked = false;
    const readMarkdownDocument = vi.fn(async ({ nodeId }) =>
      nodeId === noteId && protectedLocked
        ? {
            ok: false as const,
            error: {
              code: 'password-required' as const,
              message: 'Password required',
            },
          }
        : {
            ok: true as const,
            value:
              nodeId === noteId ? protectedDocument : plainDocument,
          },
    );
    const lockProjectPage = vi.fn(async ({ nodeId }) => {
      if (nodeId === noteId) {
        protectedLocked = true;
      }
      return { ok: true as const, value: null };
    });
    const unlockProjectPage = vi.fn(async ({ nodeId }) =>
      nodeId === noteId
        ? { ok: true as const, value: protectedDocument }
        : {
            ok: false as const,
            error: {
              code: 'invalid-operation' as const,
              message: 'This note is not protected by a password.',
            },
          },
    );
    installProjectApi({
      listProjectChildren: vi.fn(async () => ({
        ok: true as const,
        value: [protectedNote, plainNote],
      })),
      lockProjectPage,
      readMarkdownDocument,
      unlockProjectPage,
    });
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open den' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: '123' }));
    await screen.findByRole('textbox', { name: 'Markdown editor' });
    fireEvent.click(screen.getByRole('button', { name: 'aaaa' }));
    await screen.findByRole('textbox', { name: 'Markdown editor' });

    fireEvent.click(screen.getByRole('button', { name: 'Close tab: 123' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close tab: aaaa' }));
    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: '123' })).toBeNull();
      expect(screen.queryByRole('tab', { name: 'aaaa' })).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: '123' }));
    await screen.findByRole('button', { name: 'Submit' });
    fireEvent.click(screen.getByRole('button', { name: 'aaaa' }));

    expect(
      await screen.findByRole('textbox', { name: 'Markdown editor' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
    expect(unlockProjectPage).not.toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: plainNoteId }),
    );
  });

  it('preserves a dirty buffer when autosave discovers that a note requires a password', async () => {
    const saveMarkdownDocument = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: 'password-required' as const,
        message: 'Password required',
      },
    }));
    const unlockProjectPage = vi.fn(async () => ({
      ok: true as const,
      value: markdownDocument,
    }));
    installProjectApi({ saveMarkdownDocument, unlockProjectPage });
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open den' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Roadmap' }));
    const editor = await screen.findByRole('textbox', {
      name: 'Markdown editor',
    });
    editor.textContent = '# Unsaved secret';
    fireEvent.input(editor, { inputType: 'insertText' });
    fireEvent.keyDown(editor, { ctrlKey: true, key: 's' });

    const password = await screen.findByLabelText('Password');
    expect(document.body.textContent).not.toContain('# Unsaved secret');
    fireEvent.click(screen.getByRole('button', { name: 'Close tab: Roadmap' }));
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Roadmap' })).toBeTruthy();
      expect(screen.getByLabelText('Password')).toBeTruthy();
    });
    fireEvent.change(password, {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(
      (await screen.findByRole('textbox', { name: 'Markdown editor' }))
        .textContent,
    ).toContain('# Unsaved secret');
  });

  it('cancels closing an unlocked protected tab when locking fails', async () => {
    let failLock = true;
    const lockProjectPage = vi.fn(async () =>
      failLock
        ? {
            ok: false as const,
            error: { code: 'io-error' as const, message: 'Lock failed' },
          }
        : { ok: true as const, value: null },
    );
    installProjectApi({
      readMarkdownDocument: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: 'password-required' as const,
          message: 'Password required',
        },
      })),
      lockProjectPage,
    });
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open den' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Roadmap' }));
    fireEvent.change(await screen.findByLabelText('Password'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByRole('textbox', { name: 'Markdown editor' });

    fireEvent.click(screen.getByRole('button', { name: 'Close tab: Roadmap' }));
    await waitFor(() => expect(lockProjectPage).toHaveBeenCalledOnce());
    expect(screen.getByRole('tab', { name: 'Roadmap' })).toBeTruthy();
    expect(
      screen.getByRole('textbox', { name: 'Markdown editor' }).getAttribute(
        'contenteditable',
      ),
    ).not.toBe('false');

    failLock = false;
    fireEvent.click(screen.getByRole('button', { name: 'Close tab: Roadmap' }));
    await waitFor(() => {
      expect(lockProjectPage).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('tab', { name: 'Roadmap' })).toBeNull();
      expect(document.body.textContent).not.toContain('# Roadmap');
    });
  });

  it('preserves lazy tree expansion across project tab switches', async () => {
    const folder: ProjectTreeNode = {
      canContainChildren: true,
      hasChildren: true,
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
      await screen.findByRole('button', { name: 'Open den' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Notes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Roadmap' }));
    await screen.findByRole('textbox', { name: 'Markdown editor' });
    expect(screen.getByRole('tab', { name: 'Roadmap' })).toBeTruthy();

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
      home: paneWorkspace(
        [
          {
            tabId: 'page:home',
            target: { type: 'internal', pageId: 'home' },
            scrollTop: 0,
            pageState: { version: 1, data: {} },
          },
        ],
        'page:home',
        'home-pane-1',
      ),
      project: {
        projectId,
        ...paneWorkspace(
          [{
            tabId: `project:${projectId}:node:${noteId}`,
            target: {
              type: 'project-content',
              projectId,
              nodeId: noteId,
              pageType: 'markdown',
            },
            scrollTop: 12,
            pageState: { version: 1, data: {} },
          }],
          `project:${projectId}:node:${noteId}`,
          'project-pane-1',
        ),
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
            activePaneId: 'home-pane-1',
            root: expect.objectContaining({
              activeTabId: 'page:home',
              tabs: [expect.objectContaining({ tabId: 'page:home' })],
            }),
          }),
        }),
      );
    });
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'Home' })).toBeTruthy();
    expect(
      screen.getByRole('alert').textContent,
    ).toContain('The den from the previous session could not be opened.');
    expect(screen.getByRole('button', { name: 'This Device' })).toBeTruthy();
  });

  it('renders each restored pane from its own active note', async () => {
    const secondNote: ProjectTreeNode = {
      ...note,
      nodeId: plainNoteId,
      name: 'Release Notes',
    };
    const firstTabId = `project:${projectId}:node:${noteId}`;
    const secondTabId = `project:${projectId}:node:${plainNoteId}`;
    const previous: WorkspaceSessionSnapshot = {
      version: WORKSPACE_SESSION_VERSION,
      home: paneWorkspace(
        [
          {
            tabId: 'page:home',
            target: { type: 'internal', pageId: 'home' },
            scrollTop: 0,
            pageState: { version: 1, data: {} },
          },
        ],
        'page:home',
        'home-pane-1',
      ),
      project: {
        projectId,
        activePaneId: 'project-pane-right',
        root: {
          kind: 'split',
          splitId: 'project-split',
          direction: 'row',
          ratio: 0.5,
          first: {
            kind: 'pane',
            paneId: 'project-pane-left',
            tabs: [
              {
                tabId: firstTabId,
                target: {
                  type: 'project-content',
                  projectId,
                  nodeId: noteId,
                  pageType: 'markdown',
                },
                scrollTop: 0,
                pageState: { version: 1, data: { mode: 'edit' } },
              },
            ],
            activeTabId: firstTabId,
          },
          second: {
            kind: 'pane',
            paneId: 'project-pane-right',
            tabs: [
              {
                tabId: secondTabId,
                target: {
                  type: 'project-content',
                  projectId,
                  nodeId: plainNoteId,
                  pageType: 'markdown',
                },
                scrollTop: 0,
                pageState: { version: 1, data: { mode: 'edit' } },
              },
            ],
            activeTabId: secondTabId,
          },
        },
      },
    };
    installProjectApi(
      {
        getProjectNode: vi.fn(async ({ nodeId }) => ({
          ok: true as const,
          value: nodeId === noteId ? note : secondNote,
        })),
        listProjectChildren: vi.fn(async () => ({
          ok: true as const,
          value: [note, secondNote],
        })),
        readMarkdownDocument: vi.fn(async ({ nodeId }) => ({
          ok: true as const,
          value:
            nodeId === noteId
              ? markdownDocument
              : {
                  ...markdownDocument,
                  nodeId: plainNoteId,
                  content: '# Release Notes',
                },
        })),
      },
      previous,
    );
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Restore' }),
    );
    const panes = await waitFor(() => {
      const values = document.querySelectorAll<HTMLElement>(
        '.workspace-pane',
      );
      expect(values).toHaveLength(2);
      return values;
    });
    const left = within(panes[0]!);
    const right = within(panes[1]!);

    fireEvent.click(
      await left.findByRole('button', { name: 'Note options' }),
    );
    expect(await screen.findByText('/Roadmap')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(
      await right.findByRole('button', { name: 'Note options' }),
    );
    expect(await screen.findByText('/Release Notes')).toBeTruthy();
    expect(
      left
        .getByRole('textbox', { name: 'Markdown editor' })
        .getAttribute('data-markdown-node-id'),
    ).toBe(noteId);
    expect(
      right
        .getByRole('textbox', { name: 'Markdown editor' })
        .getAttribute('data-markdown-node-id'),
    ).toBe(plainNoteId);
  });

  it('consumes the restore prompt before awaiting a slow project restore', async () => {
    const previous: WorkspaceSessionSnapshot = {
      version: WORKSPACE_SESSION_VERSION,
      home: paneWorkspace(
        [
          {
            tabId: 'page:home',
            target: { type: 'internal', pageId: 'home' },
            scrollTop: 0,
            pageState: { version: 1, data: {} },
          },
        ],
        'page:home',
        'home-pane-1',
      ),
      project: {
        projectId,
        ...paneWorkspace(
          [{
            tabId: `project:${projectId}:overview`,
            target: { type: 'project-overview', projectId },
            scrollTop: 0,
            pageState: { version: 1, data: {} },
          }],
          `project:${projectId}:overview`,
          'project-pane-1',
        ),
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
            root: expect.objectContaining({
              activeTabId: `project:${projectId}:overview`,
            }),
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
      canContainChildren: true,
      hasChildren: true,
      nodeId: folderId,
      parentId: null,
      name: 'Archive',
      kind: 'folder',
    };
    const nestedFolder: ProjectTreeNode = {
      canContainChildren: true,
      hasChildren: true,
      nodeId: nestedFolderId,
      parentId: folderId,
      name: 'Nested',
      kind: 'folder',
    };
    const previous: WorkspaceSessionSnapshot = {
      version: WORKSPACE_SESSION_VERSION,
      home: paneWorkspace(
        [
          {
            tabId: 'page:home',
            target: { type: 'internal', pageId: 'home' },
            scrollTop: 0,
            pageState: { version: 1, data: {} },
          },
        ],
        'page:home',
        'home-pane-1',
      ),
      project: {
        projectId,
        ...paneWorkspace(
          [{
            tabId: `project:${projectId}:node:${noteId}`,
            target: {
              type: 'project-content',
              projectId,
              nodeId: noteId,
              pageType: 'markdown',
            },
            scrollTop: 0,
            pageState: { version: 1, data: {} },
          }],
          `project:${projectId}:node:${noteId}`,
          'project-pane-1',
        ),
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
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(
      screen.getByRole('heading', { name: 'Nothing open yet' }),
    ).toBeTruthy();
  });

  it('switches the note view mode through page session state', async () => {
    installProjectApi();
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open den' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Roadmap' }));
    await screen.findByRole('textbox', { name: 'Markdown editor' });

    fireEvent.click(screen.getByRole('button', { name: 'Note options' }));
    fireEvent.click(
      await screen.findByRole('menuitemcheckbox', { name: 'Reading' }),
    );

    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'Markdown editor' })).toBeNull();
    });
    expect(screen.getByRole('document', { name: 'Reading' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Note options' }));
    fireEvent.click(
      await screen.findByRole('menuitemcheckbox', { name: 'Split' }),
    );
    expect(
      await screen.findByRole('textbox', { name: 'Markdown editor' }),
    ).toBeTruthy();
    expect(screen.getByRole('document', { name: 'Reading' })).toBeTruthy();
  });

  it('routes menu undo to the last active Markdown editor with native fallback', async () => {
    let menuListener:
      | ((command: RendererMenuCommand) => void)
      | undefined;
    const api = installProjectApi({
      onRendererMenuCommand: vi.fn((listener) => {
        menuListener = listener;
        return () => undefined;
      }),
    });
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open den' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Roadmap' }));
    const editor = await screen.findByRole('textbox', {
      name: 'Markdown editor',
    });
    fireEvent.focus(editor);
    editor.textContent = '# Changed';
    fireEvent.input(editor, { inputType: 'insertText' });
    await waitFor(() => expect(editor.textContent).toContain('# Changed'));

    act(() => menuListener?.(RENDERER_MENU_COMMANDS.undo));
    await waitFor(() => expect(editor.textContent).toContain('# Roadmap'));
    await waitFor(() => expect(document.activeElement).toBe(editor));
    act(() => menuListener?.(RENDERER_MENU_COMMANDS.redo));
    await waitFor(() => expect(editor.textContent).toContain('# Changed'));

    const input = document.createElement('input');
    document.body.append(input);
    fireEvent.focus(input);
    act(() => menuListener?.(RENDERER_MENU_COMMANDS.undo));
    await waitFor(() => {
      expect(api.executeMenuCommand).toHaveBeenCalledWith('edit.undo');
    });
  });

  it('restores the centered project rail and keeps footer app actions', async () => {
    const api = installProjectApi();
    const { container } = render(<App />);

    expect(screen.getByRole('banner', { name: 'Flyoff' })).toBeTruthy();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open den' }),
    );
    await screen.findByRole('complementary', { name: 'Den contents' });

    expect(screen.queryByRole('banner', { name: 'Flyoff' })).toBeNull();
    expect(container.querySelector('.app-shell')?.getAttribute('data-context')).toBe(
      'project',
    );
    expect(container.querySelector('.project-sidebar__header')).not.toBeNull();
    expect(container.querySelector('.pages-bar')).not.toBeNull();
    const rail = screen.getByRole('navigation', {
      name: 'Den sections',
    });
    expect(within(rail).getAllByRole('button')).toHaveLength(5);
    expect(screen.getByRole('searchbox', { name: 'Search this den' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'About Flyoff' }));
    expect(api.executeMenuCommand).toHaveBeenCalledWith('help.about');

    fireEvent.click(within(rail).getByRole('button', { name: 'Settings' }));
    expect(await screen.findByText('Coming soon.')).toBeTruthy();
    expect(
      screen.queryByRole('complementary', { name: 'Den contents' }),
    ).toBeNull();

    fireEvent.click(within(rail).getByRole('button', { name: 'Den' }));
    expect(screen.queryByText('Coming soon.')).toBeNull();
    expect(screen.getByRole('heading', { name: project.name })).toBeTruthy();
  });
});
