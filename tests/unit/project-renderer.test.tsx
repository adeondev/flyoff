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

import { MarkdownEditor } from '../../src/renderer/projects/MarkdownEditor';
import { MarkdownDocumentController } from '../../src/renderer/projects/markdown-document-controller';
import {
  readSelection,
  readSource,
  writeSelection,
} from '../../src/renderer/projects/source-caret';
import { CreateProjectDialog } from '../../src/renderer/projects/CreateProjectDialog';
import {
  projectNodeDisplayName,
  projectNodeInputName,
} from '../../src/renderer/projects/project-node-name';
import { ProjectSidebar } from '../../src/renderer/projects/ProjectSidebar';
import type { Translate } from '../../src/renderer/pages/page-types';
import type {
  MarkdownDocument,
  ProjectSummary,
  ProjectTreeNode,
} from '../../src/shared/contracts';

const translate: Translate = (key) => key;
const project: ProjectSummary = {
  projectId: 'cdb39a1a-0339-4c75-91ea-78fbbcb2f97a',
  name: 'Flyoff',
  location: 'D:\\Projects\\Flyoff',
  formatVersion: 1,
};
const folder: ProjectTreeNode = {
  nodeId: '56ef1bfa-1355-4ba0-ac9b-b66da816006c',
  parentId: null,
  name: 'Docs',
  kind: 'folder',
};
const note: ProjectTreeNode = {
  nodeId: 'ffbf978c-43d7-4135-a3ea-f6e4e3ec76fb',
  parentId: null,
  name: 'Todo',
  kind: 'page',
  pageType: 'markdown',
};
const nestedNote: ProjectTreeNode = {
  nodeId: 'fa1a9d28-9cb3-45fe-a11c-28e8fe3cfb8b',
  parentId: folder.nodeId,
  name: 'Plan',
  kind: 'page',
  pageType: 'markdown',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function successfulSave() {
  return vi.fn(async (request: { content: string; nodeId: string }) => ({
    ok: true as const,
    value: {
      content: request.content,
      nodeId: request.nodeId,
      readOnly: false,
      revision: '2'.repeat(64),
    },
  }));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('project sidebar', () => {
  it('loads folders lazily and creates a Markdown note inline', async () => {
    let rootNodes: readonly ProjectTreeNode[] = [folder, note];
    const created: ProjectTreeNode = {
      ...note,
      nodeId: '9dfad5c6-80ac-4e7e-b18c-fe23a48c3a2e',
      name: 'Meeting',
    };
    const loadChildren = vi.fn(async ({ parentId }: { parentId: string | null }) => ({
      ok: true as const,
      value: parentId === folder.nodeId ? [nestedNote] : rootNodes,
    }));
    const onCreateNode = vi.fn(async () => {
      rootNodes = [...rootNodes, created];
      return { ok: true as const, value: created };
    });
    const onOpenNode = vi.fn();

    render(
      <ProjectSidebar
        loadChildren={loadChildren}
        onCreateNode={onCreateNode}
        onMoveNode={vi.fn()}
        onOpenNode={onOpenNode}
        onOpenOverview={vi.fn()}
        onRenameNode={vi.fn()}
        onTrashNode={vi.fn()}
        project={project}
        translate={translate}
      />,
    );

    const folderButton = await screen.findByRole('button', { name: 'Docs' });
    expect(loadChildren).toHaveBeenCalledWith({ parentId: null });
    expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull();
    fireEvent.click(folderButton);

    expect(await screen.findByRole('button', { name: 'Plan' })).toBeTruthy();
    expect(screen.queryByText('Plan.md')).toBeNull();
    expect(loadChildren).toHaveBeenCalledWith({ parentId: folder.nodeId });

    fireEvent.click(
      screen.getByRole('button', { name: 'projects.addInstance' }),
    );
    fireEvent.click(
      await screen.findByRole('option', { name: /projects.instanceNote/ }),
    );
    const input = screen.getByRole('textbox', { name: 'projects.name' });
    fireEvent.change(input, { target: { value: 'Meeting' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(onCreateNode).toHaveBeenCalledWith({
        kind: 'page',
        name: 'Meeting',
        pageType: 'markdown',
        parentId: null,
      });
      expect(onOpenNode).toHaveBeenCalledWith(created);
    });
  });

  it('keeps an empty expanded folder stable while its children load', async () => {
    const nestedLoad = deferred<{
      ok: true;
      value: readonly ProjectTreeNode[];
    }>();
    const loadChildren = vi.fn(({ parentId }: { parentId: string | null }) =>
      parentId === null
        ? Promise.resolve({ ok: true as const, value: [folder] })
        : nestedLoad.promise,
    );
    const { container } = render(
      <ProjectSidebar
        loadChildren={loadChildren}
        onCreateNode={vi.fn()}
        onMoveNode={vi.fn()}
        onOpenNode={vi.fn()}
        onOpenOverview={vi.fn()}
        onRenameNode={vi.fn()}
        onTrashNode={vi.fn()}
        project={project}
        translate={translate}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Docs' }));
    const group = container.querySelector<HTMLElement>(
      `[data-project-parent-id="${folder.nodeId}"]`,
    );
    expect(group?.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText('projects.loading')).toBeNull();

    await act(async () => {
      nestedLoad.resolve({ ok: true, value: [] });
      await nestedLoad.promise;
    });

    expect(group?.hasAttribute('aria-busy')).toBe(false);
    expect(group?.children).toHaveLength(0);
    expect(screen.queryByText('projects.loading')).toBeNull();
  });

  it('publishes all loaded folder children in one render', async () => {
    const secondNestedNote: ProjectTreeNode = {
      ...nestedNote,
      nodeId: '68eb7d8e-d121-4827-b0bc-742852cad53c',
      name: 'Decisions',
    };
    const nestedLoad = deferred<{
      ok: true;
      value: readonly ProjectTreeNode[];
    }>();
    const loadChildren = vi.fn(({ parentId }: { parentId: string | null }) =>
      parentId === null
        ? Promise.resolve({ ok: true as const, value: [folder] })
        : nestedLoad.promise,
    );
    const { container } = render(
      <ProjectSidebar
        loadChildren={loadChildren}
        onCreateNode={vi.fn()}
        onMoveNode={vi.fn()}
        onOpenNode={vi.fn()}
        onOpenOverview={vi.fn()}
        onRenameNode={vi.fn()}
        onTrashNode={vi.fn()}
        project={project}
        translate={translate}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Docs' }));
    const group = container.querySelector<HTMLElement>(
      `[data-project-parent-id="${folder.nodeId}"]`,
    );
    expect(group?.querySelectorAll('[role="treeitem"]')).toHaveLength(0);
    expect(screen.queryByText('projects.loading')).toBeNull();

    await act(async () => {
      nestedLoad.resolve({
        ok: true,
        value: [nestedNote, secondNestedNote],
      });
      await nestedLoad.promise;
    });

    expect(
      [...(group?.querySelectorAll('[role="treeitem"]') ?? [])].map(
        (item) => item.textContent,
      ),
    ).toEqual([
      expect.stringContaining('Plan'),
      expect.stringContaining('Decisions'),
    ]);
    expect(group?.hasAttribute('aria-busy')).toBe(false);
  });

  it('moves through the accessible dialog and confirms trash explicitly', async () => {
    const loadChildren = vi.fn(async ({ parentId }: { parentId: string | null }) => ({
      ok: true as const,
      value: parentId === null ? [folder, note] : [],
    }));
    const moved = { ...note, parentId: folder.nodeId };
    const onMoveNode = vi.fn(async () => ({ ok: true as const, value: moved }));
    const onTrashNode = vi.fn(async () => ({
      ok: true as const,
      value: { nodeIds: [note.nodeId] },
    }));

    render(
      <ProjectSidebar
        loadChildren={loadChildren}
        onCreateNode={vi.fn()}
        onMoveNode={onMoveNode}
        onOpenNode={vi.fn()}
        onOpenOverview={vi.fn()}
        onRenameNode={vi.fn()}
        onTrashNode={onTrashNode}
        project={project}
        translate={translate}
      />,
    );

    await screen.findByRole('button', { name: 'Todo' });
    fireEvent.click(
      screen.getByRole('button', { name: 'projects.moreActions: Todo' }),
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'projects.moveTo' }),
    );

    const moveDialog = screen.getByRole('dialog', {
      name: 'projects.moveTitle',
    });
    fireEvent.click(within(moveDialog).getByRole('button', { name: 'Docs' }));
    fireEvent.click(
      within(moveDialog).getByRole('button', { name: 'projects.move' }),
    );
    await waitFor(() => {
      expect(onMoveNode).toHaveBeenCalledWith({
        nodeId: note.nodeId,
        parentId: folder.nodeId,
      });
    });
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'projects.moveTitle' }),
      ).toBeNull(),
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'projects.moreActions: Todo' }),
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'projects.trash' }),
    );
    const trashDialog = screen.getByRole('dialog', {
      name: 'projects.deleteTitle',
    });
    expect(
      within(trashDialog).getByText('projects.deletePageDescription'),
    ).toBeTruthy();
    fireEvent.click(
      within(trashDialog).getByRole('button', { name: 'projects.delete' }),
    );
    await waitFor(() =>
      expect(onTrashNode).toHaveBeenCalledWith({ nodeId: note.nodeId }),
    );
  });

  it('opens the item menu from the keyboard without activating the node', async () => {
    const onOpenNode = vi.fn();
    render(
      <ProjectSidebar
        loadChildren={vi.fn(async () => ({ ok: true as const, value: [note] }))}
        onCreateNode={vi.fn()}
        onMoveNode={vi.fn()}
        onOpenNode={onOpenNode}
        onOpenOverview={vi.fn()}
        onRenameNode={vi.fn()}
        onTrashNode={vi.fn()}
        project={project}
        translate={translate}
      />,
    );

    const nodeButton = await screen.findByRole('button', { name: 'Todo' });
    const treeItem = nodeButton.closest<HTMLElement>('[role="treeitem"]');
    expect(treeItem).not.toBeNull();
    treeItem?.focus();
    fireEvent.keyDown(treeItem!, { key: 'F10', shiftKey: true });

    expect(
      await screen.findByRole('menuitem', { name: 'projects.rename' }),
    ).toBeTruthy();
    expect(onOpenNode).not.toHaveBeenCalled();
  });

  it('never starts rename from repeated pointer clicks', async () => {
    render(
      <ProjectSidebar
        loadChildren={vi.fn(async ({ parentId }) => ({
          ok: true as const,
          value: parentId === null ? [folder] : [],
        }))}
        onCreateNode={vi.fn()}
        onMoveNode={vi.fn()}
        onOpenNode={vi.fn()}
        onOpenOverview={vi.fn()}
        onRenameNode={vi.fn()}
        onTrashNode={vi.fn()}
        project={project}
        translate={translate}
      />,
    );

    const folderButton = await screen.findByRole('button', { name: 'Docs' });
    const treeItem = folderButton.closest<HTMLElement>('[role="treeitem"]')!;
    fireEvent.click(folderButton);
    fireEvent.click(folderButton);
    fireEvent.doubleClick(treeItem);
    expect(screen.queryByRole('textbox', { name: 'projects.name' })).toBeNull();

    fireEvent.keyDown(treeItem, { key: 'F2' });
    expect(screen.getByRole('textbox', { name: 'projects.name' })).toBeTruthy();
  });

  it('reuses the searchable instance picker from folders and empty space', async () => {
    render(
      <ProjectSidebar
        loadChildren={vi.fn(async ({ parentId }) => ({
          ok: true as const,
          value: parentId === null ? [folder] : [],
        }))}
        onCreateNode={vi.fn()}
        onMoveNode={vi.fn()}
        onOpenNode={vi.fn()}
        onOpenOverview={vi.fn()}
        onRenameNode={vi.fn()}
        onTrashNode={vi.fn()}
        project={project}
        translate={translate}
      />,
    );

    await screen.findByRole('button', { name: 'Docs' });
    fireEvent.click(
      screen.getByRole('button', { name: 'projects.moreActions: Docs' }),
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'projects.addInstance' }),
    );

    const picker = await screen.findByRole('dialog', {
      name: 'projects.addInstance',
    });
    expect(
      (
        within(picker).getByRole('option', {
          name: /projects.instanceChecklist/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    const search = within(picker).getByRole('searchbox', {
      name: 'projects.searchInstances',
    });
    fireEvent.change(search, { target: { value: 'nothing' } });
    expect(within(picker).getByText('projects.noInstances')).toBeTruthy();
    fireEvent.keyDown(picker, { key: 'Escape' });

    const tree = screen.getByRole('tree', { name: 'projects.navigation' });
    fireEvent.contextMenu(tree, { clientX: 80, clientY: 120 });
    expect(screen.queryByRole('dialog', { name: 'projects.addInstance' })).toBeNull();
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'projects.newInstance' }),
    );
    expect(
      (
        await screen.findByRole('dialog', { name: 'projects.addInstance' })
      ).getAttribute('data-parent-id'),
    ).toBe('root');
    expect(screen.queryByText('projects.empty')).toBeNull();
  });

  it('opens root actions from the scrollable blank area without acting on left click', async () => {
    const { container } = render(
      <ProjectSidebar
        loadChildren={vi.fn(async () => ({ ok: true as const, value: [] }))}
        onCreateNode={vi.fn()}
        onMoveNode={vi.fn()}
        onOpenNode={vi.fn()}
        onOpenOverview={vi.fn()}
        onRenameNode={vi.fn()}
        onTrashNode={vi.fn()}
        project={project}
        translate={translate}
      />,
    );

    await screen.findByRole('tree', { name: 'projects.navigation' });
    const scroll = container.querySelector('.project-sidebar__tree-scroll')!;
    fireEvent.click(scroll);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.contextMenu(scroll, { clientX: 91, clientY: 143 });
    expect(
      await screen.findByRole('menu', { name: 'projects.branchActions' }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'projects.newInstance' }),
    );
    expect(
      screen
        .getByRole('dialog', { name: 'projects.addInstance' })
        .getAttribute('data-parent-id'),
    ).toBe('root');
  });

  it('targets the nested branch for creation and native path actions', async () => {
    const onCopyPath = vi.fn(async () => ({ ok: true as const, value: null }));
    const onRevealPath = vi.fn(async () => ({ ok: true as const, value: null }));
    const onCreateNode = vi.fn(async ({ name }: { name: string }) => ({
      ok: true as const,
      value: {
        kind: 'folder' as const,
        name,
        nodeId: 'a61c9a34-c1d1-4e1c-acd4-8402170b2b68',
        parentId: folder.nodeId,
      },
    }));
    const { container } = render(
      <ProjectSidebar
        loadChildren={vi.fn(async ({ parentId }) => ({
          ok: true as const,
          value: parentId === null ? [folder] : [],
        }))}
        onCopyPath={onCopyPath}
        onCreateNode={onCreateNode}
        onMoveNode={vi.fn()}
        onOpenNode={vi.fn()}
        onOpenOverview={vi.fn()}
        onRenameNode={vi.fn()}
        onRevealPath={onRevealPath}
        onTrashNode={vi.fn()}
        platform="win32"
        project={project}
        translate={translate}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Docs' }));
    const group = container.querySelector<HTMLElement>(
      `[data-project-parent-id="${folder.nodeId}"]`,
    )!;
    await waitFor(() => expect(group.hasAttribute('aria-busy')).toBe(false));
    fireEvent.contextMenu(group, { clientX: 40, clientY: 80 });
    expect(
      screen
        .getByRole('menuitem', { name: 'projects.expandAll' })
        .getAttribute('aria-disabled'),
    ).toBe('true');
    expect(
      screen
        .getByRole('menuitem', { name: 'projects.collapseAll' })
        .hasAttribute('aria-disabled'),
    ).toBe(false);

    fireEvent.click(screen.getByRole('menuitem', { name: 'projects.copyPath' }));
    await waitFor(() =>
      expect(onCopyPath).toHaveBeenCalledWith({ nodeId: folder.nodeId }),
    );

    fireEvent.contextMenu(group, { clientX: 40, clientY: 80 });
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'projects.revealInExplorer' }),
    );
    await waitFor(() =>
      expect(onRevealPath).toHaveBeenCalledWith({ nodeId: folder.nodeId }),
    );

    fireEvent.contextMenu(group, { clientX: 40, clientY: 80 });
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'projects.newFolder' }),
    );
    const nameInput = await screen.findByRole('textbox', {
      name: 'projects.name',
    });
    fireEvent.change(nameInput, { target: { value: 'Archive' } });
    fireEvent.submit(nameInput.closest('form')!);
    await waitFor(() =>
      expect(onCreateNode).toHaveBeenCalledWith({
        kind: 'folder',
        name: 'Archive',
        parentId: folder.nodeId,
      }),
    );
  });

  it('expands and collapses the root branch from its context menu', async () => {
    render(
      <ProjectSidebar
        loadChildren={vi.fn(async ({ parentId }) => ({
          ok: true as const,
          value: parentId === null ? [folder] : [nestedNote],
        }))}
        onCreateNode={vi.fn()}
        onMoveNode={vi.fn()}
        onOpenNode={vi.fn()}
        onOpenOverview={vi.fn()}
        onRenameNode={vi.fn()}
        onTrashNode={vi.fn()}
        project={project}
        translate={translate}
      />,
    );

    const tree = await screen.findByRole('tree', {
      name: 'projects.navigation',
    });
    fireEvent.contextMenu(tree, { clientX: 30, clientY: 60 });
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'projects.expandAll' }),
    );
    expect(await screen.findByRole('button', { name: 'Plan' })).toBeTruthy();

    fireEvent.contextMenu(tree, { clientX: 30, clientY: 60 });
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'projects.collapseAll' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull(),
    );
  });

  it('routes folder loading failures to the global notice host callback', async () => {
    const onError = vi.fn();
    render(
      <ProjectSidebar
        loadChildren={vi.fn(async () => ({
          ok: false as const,
          error: { code: 'io-error' as const, message: 'Folder unavailable' },
        }))}
        onCreateNode={vi.fn()}
        onError={onError}
        onMoveNode={vi.fn()}
        onOpenNode={vi.fn()}
        onOpenOverview={vi.fn()}
        onRenameNode={vi.fn()}
        onTrashNode={vi.fn()}
        project={project}
        translate={translate}
      />,
    );

    await screen.findByRole('button', { name: 'projects.loadFailed' });
    expect(onError).toHaveBeenCalledWith('Folder unavailable');
  });

  it('cancels F2 on outside blur and keeps context separate from active selection', async () => {
    render(
      <ProjectSidebar
        activeNodeId={note.nodeId}
        loadChildren={vi.fn(async () => ({ ok: true as const, value: [note] }))}
        onCreateNode={vi.fn()}
        onMoveNode={vi.fn()}
        onOpenNode={vi.fn()}
        onOpenOverview={vi.fn()}
        onRenameNode={vi.fn()}
        onTrashNode={vi.fn()}
        project={project}
        translate={translate}
      />,
    );

    const node = await screen.findByRole('button', { name: 'Todo' });
    const item = node.closest<HTMLElement>('[role="treeitem"]')!;
    fireEvent.contextMenu(item, { clientX: 20, clientY: 20 });
    expect(item.classList.contains('project-tree__item--active')).toBe(true);
    expect(item.classList.contains('project-tree__item--context')).toBe(true);
    fireEvent.keyDown(
      screen.getByRole('menuitem', { name: 'projects.rename' }),
      { key: 'Escape' },
    );
    await waitFor(() => {
      expect(item.classList.contains('project-tree__item--context')).toBe(false);
      expect(item.classList.contains('project-tree__item--active')).toBe(true);
    });

    item.focus();
    fireEvent.keyDown(item, { key: 'F2' });
    const input = screen.getByRole('textbox', { name: 'projects.name' });
    fireEvent.blur(input, { relatedTarget: document.body });
    expect(
      screen.queryByRole('textbox', { name: 'projects.name' }),
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Todo' })).toBeTruthy();
  });

  it('moves a node onto a folder with drag and drop', async () => {
    const moved = { ...note, parentId: folder.nodeId };
    const onMoveNode = vi.fn(async () => ({
      ok: true as const,
      value: moved,
    }));
    render(
      <ProjectSidebar
        loadChildren={vi.fn(async ({ parentId }) => ({
          ok: true as const,
          value: parentId === null ? [folder, note] : [],
        }))}
        onCreateNode={vi.fn()}
        onMoveNode={onMoveNode}
        onOpenNode={vi.fn()}
        onOpenOverview={vi.fn()}
        onRenameNode={vi.fn()}
        onTrashNode={vi.fn()}
        project={project}
        translate={translate}
      />,
    );

    const noteItem = (await screen.findByRole('button', { name: 'Todo' })).closest(
      '[role="treeitem"]',
    );
    const folderItem = screen
      .getByRole('button', { name: 'Docs' })
      .closest('[role="treeitem"]');
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      getData: vi.fn(() => note.nodeId),
      setData: vi.fn(),
    };

    fireEvent.dragStart(noteItem!, { dataTransfer });
    fireEvent.dragOver(folderItem!, { dataTransfer });
    fireEvent.drop(folderItem!, { dataTransfer });

    await waitFor(() => {
      expect(onMoveNode).toHaveBeenCalledWith({
        nodeId: note.nodeId,
        parentId: folder.nodeId,
      });
    });
  });

  it('expands a hovered folder and reorders siblings with Alt+Arrow', async () => {
    const loadChildren = vi.fn(async ({ parentId }) => ({
      ok: true as const,
      value: parentId === null ? [folder, note] : [],
    }));
    const onMoveNode = vi.fn(async () => ({
      ok: true as const,
      value: note,
    }));
    render(
      <ProjectSidebar
        loadChildren={loadChildren}
        onCreateNode={vi.fn()}
        onMoveNode={onMoveNode}
        onOpenNode={vi.fn()}
        onOpenOverview={vi.fn()}
        onRenameNode={vi.fn()}
        onTrashNode={vi.fn()}
        project={project}
        translate={translate}
      />,
    );

    const noteItem = (await screen.findByRole('button', { name: 'Todo' })).closest(
      '[role="treeitem"]',
    )!;
    const folderItem = screen
      .getByRole('button', { name: 'Docs' })
      .closest('[role="treeitem"]')!;
    fireEvent.keyDown(noteItem, { altKey: true, key: 'ArrowUp' });
    await waitFor(() => {
      expect(onMoveNode).toHaveBeenCalledWith({
        nodeId: note.nodeId,
        parentId: null,
        beforeNodeId: folder.nodeId,
      });
    });

    vi.useFakeTimers();
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      getData: vi.fn(() => note.nodeId),
      setData: vi.fn(),
    };
    fireEvent.dragStart(noteItem, { dataTransfer });
    fireEvent.dragOver(folderItem, { dataTransfer });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(loadChildren).toHaveBeenCalledWith({ parentId: folder.nodeId });
    fireEvent.dragEnd(noteItem, { dataTransfer });
  });
});

describe('project naming and creation dialog', () => {
  it('keeps names literal and requests a fresh location token after failure', async () => {
    const onCreated = vi.fn();
    const onCreate = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'invalid-name', message: 'Invalid name' },
      })
      .mockResolvedValueOnce({ ok: true, value: project });
    const onSelectLocation = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: {
          token: '94ad6b94-3a3e-414a-9d54-b8b7ad30d395',
          location: 'D:\\Projects',
          expiresAt: '2030-01-01T00:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          token: 'ec5a645a-c7fe-4e3e-8f4c-a00d44ce2d09',
          location: 'D:\\Projects',
          expiresAt: '2030-01-01T00:00:00.000Z',
        },
      });

    render(
      <CreateProjectDialog
        onCancel={vi.fn()}
        onCreate={onCreate}
        onCreated={onCreated}
        onSelectLocation={onSelectLocation}
        open
        translate={translate}
      />,
    );

    const name = screen.getByRole('textbox', {
      name: 'projects.projectName',
    });
    fireEvent.change(name, { target: { value: ' Project ' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'projects.chooseLocation' }),
    );
    await screen.findByText('D:\\Projects');
    fireEvent.click(screen.getByRole('button', { name: 'projects.create' }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith({
        name: ' Project ',
        selectionToken: '94ad6b94-3a3e-414a-9d54-b8b7ad30d395',
      });
    });
    expect(
      (
        screen.getByRole('button', {
          name: 'projects.create',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    fireEvent.change(name, { target: { value: 'Project' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'projects.chooseLocation' }),
    );
    await waitFor(() => expect(onSelectLocation).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'projects.create' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(project));
  });

  it('treats the Markdown suffix as presentation instead of sanitizing names', () => {
    expect(
      projectNodeDisplayName({ ...note, name: 'Roadmap.md' }),
    ).toBe('Roadmap.md');
    expect(projectNodeInputName('page', ' Roadmap ')).toBe(' Roadmap ');
  });
});

describe('Markdown editor', () => {
  it('saves with the primary shortcut and exposes conflict recovery', async () => {
    const firstRevision = '1'.repeat(64);
    const secondRevision = '2'.repeat(64);
    const original: MarkdownDocument = {
      nodeId: note.nodeId,
      content: '# Todo',
      readOnly: false,
      revision: firstRevision,
    };
    const save = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'conflict',
          message: 'External edit',
          currentRevision: secondRevision,
        },
      })
      .mockImplementationOnce(async (request) => ({
        ok: true as const,
        value: { ...original, content: request.content, revision: secondRevision },
      }));
    const controller = new MarkdownDocumentController({
      reload: vi.fn(async () => ({ ok: true as const, value: original })),
      save,
    });

    render(
      <MarkdownEditor
        controller={controller}
        document={original}
        title="Todo"
        translate={translate}
      />,
    );

    const editor = screen.getByRole('textbox', { name: 'projects.editorLabel' });
    editor.textContent = '# Changed';
    fireEvent.input(editor);
    fireEvent.keyDown(editor, { key: 's', ctrlKey: true });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({
      nodeId: note.nodeId,
      content: '# Changed',
      expectedRevision: firstRevision,
    });

    expect(
      screen.getAllByText('projects.conflictTitle').length,
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'projects.overwrite' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith({
      nodeId: note.nodeId,
      content: '# Changed',
      expectedRevision: firstRevision,
      force: true,
    });
  });

  it('keeps read-only notes selectable and readable while blocking every edit route', () => {
    vi.useFakeTimers();
    const original: MarkdownDocument = {
      nodeId: note.nodeId,
      content: 'Visible text',
      readOnly: true,
      revision: '1'.repeat(64),
    };
    const saveDocument = vi.fn();
    const controller = new MarkdownDocumentController({
      reload: vi.fn(),
      save: saveDocument,
    });
    const undo = vi.spyOn(controller, 'undo');
    const redo = vi.spyOn(controller, 'redo');
    const save = vi.spyOn(controller, 'save');
    const commit = vi.spyOn(controller, 'commitEditorTransaction');

    render(
      <MarkdownEditor
        controller={controller}
        document={original}
        mode="split"
        translate={translate}
      />,
    );

    const editor = screen.getByRole('textbox', {
      name: 'projects.editorLabel',
    });
    expect(editor.getAttribute('contenteditable')).toBe('false');
    expect(editor.getAttribute('aria-readonly')).toBe('true');
    expect(
      within(screen.getByRole('toolbar'))
        .getAllByRole<HTMLButtonElement>('button')
        .every((button) => button.disabled),
    ).toBe(true);

    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: '!',
      inputType: 'insertText',
    });
    fireEvent(editor, beforeInput);
    expect(beforeInput.defaultPrevented).toBe(true);

    editor.textContent = 'Injected input';
    fireEvent.input(editor, { inputType: 'insertText' });
    expect(readSource(editor)).toBe(original.content);

    const pasteData = { getData: vi.fn(() => 'Pasted') };
    expect(fireEvent.paste(editor, { clipboardData: pasteData })).toBe(false);
    expect(pasteData.getData).not.toHaveBeenCalled();

    const dropData = { getData: vi.fn(() => 'Dropped') };
    expect(fireEvent.drop(editor, { dataTransfer: dropData })).toBe(false);
    expect(dropData.getData).not.toHaveBeenCalled();

    writeSelection(editor, 0, 7);
    fireEvent(document, new Event('selectionchange'));
    expect(controller.getSnapshot(note.nodeId)?.selection).toMatchObject({
      start: 0,
      end: 7,
    });

    const cutSetData = vi.fn();
    expect(
      fireEvent.cut(editor, { clipboardData: { setData: cutSetData } }),
    ).toBe(false);
    expect(cutSetData).not.toHaveBeenCalled();
    expect(readSource(editor)).toBe(original.content);

    const copySetData = vi.fn();
    expect(
      fireEvent.copy(editor, { clipboardData: { setData: copySetData } }),
    ).toBe(false);
    expect(copySetData).toHaveBeenCalledWith('text/plain', 'Visible');

    const compositionStart = new CompositionEvent('compositionstart', {
      bubbles: true,
      cancelable: true,
      data: '字',
    });
    fireEvent(editor, compositionStart);
    expect(compositionStart.defaultPrevented).toBe(true);
    editor.textContent = 'Injected composition';
    fireEvent.compositionEnd(editor, { data: '字' });
    act(() => vi.runOnlyPendingTimers());
    expect(readSource(editor)).toBe(original.content);

    fireEvent.keyDown(editor, { ctrlKey: true, key: 'z' });
    fireEvent.keyDown(editor, { ctrlKey: true, key: 'z', shiftKey: true });
    fireEvent.keyDown(editor, { ctrlKey: true, key: 'y' });
    fireEvent.keyDown(editor, { ctrlKey: true, key: 's' });
    fireEvent(
      editor,
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'historyUndo',
      }),
    );
    fireEvent(
      editor,
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'historyRedo',
      }),
    );
    fireEvent.click(
      within(screen.getByRole('toolbar')).getAllByRole('button')[0]!,
    );

    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(saveDocument).not.toHaveBeenCalled();
    expect(controller.getSnapshot(note.nodeId)).toMatchObject({
      content: original.content,
      dirty: false,
      readOnly: true,
    });
    expect(document.querySelector('.markdown-view')?.textContent).toContain(
      original.content,
    );
  });

  it('restores and reports the source scroll position', () => {
    const original: MarkdownDocument = {
      nodeId: note.nodeId,
      content: Array.from({ length: 100 }, (_, index) => `Line ${index}`).join(
        '\n',
      ),
      readOnly: false,
      revision: '1'.repeat(64),
    };
    const controller = new MarkdownDocumentController({
      reload: vi.fn(async () => ({ ok: true as const, value: original })),
      save: vi.fn(async () => ({ ok: true as const, value: original })),
    });
    const onScrollChange = vi.fn();
    render(
      <MarkdownEditor
        controller={controller}
        document={original}
        onScrollChange={onScrollChange}
        scrollTop={72}
        translate={translate}
      />,
    );

    const editor = screen.getByRole('textbox', {
      name: 'projects.editorLabel',
    });
    expect(editor.scrollTop).toBe(72);
    editor.scrollTop = 144;
    fireEvent.scroll(editor);
    expect(onScrollChange).toHaveBeenCalledWith(144);
  });

  it('commits Enter and multiline paste as visible, undoable steps', async () => {
    const original: MarkdownDocument = {
      nodeId: note.nodeId,
      content: '==uau==',
      readOnly: false,
      revision: '1'.repeat(64),
    };
    const controller = new MarkdownDocumentController({
      reload: vi.fn(),
      save: successfulSave(),
    });
    render(
      <MarkdownEditor
        controller={controller}
        document={original}
        mode="split"
        translate={translate}
      />,
    );
    const editor = screen.getByRole('textbox', {
      name: 'projects.editorLabel',
    });
    writeSelection(editor, original.content.length);

    fireEvent(
      editor,
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertParagraph',
      }),
    );
    expect(controller.getSnapshot(note.nodeId)?.content).toBe('==uau==\n');

    fireEvent.paste(editor, {
      clipboardData: {
        getData: () => '[text](https://x.dev)\r\nlast',
      },
    });
    expect(controller.getSnapshot(note.nodeId)?.content).toBe(
      '==uau==\n[text](https://x.dev)\nlast',
    );
    await waitFor(() => {
      const reading = document.querySelector('.markdown-view')!;
      expect(reading.querySelectorAll('br')).toHaveLength(2);
      expect(reading.querySelector('mark')?.textContent).toBe('uau');
      expect(reading.querySelector('a')?.textContent).toBe('text');
    });

    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    expect(controller.getSnapshot(note.nodeId)?.content).toBe('==uau==\n');
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    expect(controller.getSnapshot(note.nodeId)?.content).toBe('==uau==');
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(controller.getSnapshot(note.nodeId)?.content).toBe('==uau==\n');
  });

  it('recovers line boundaries from HTML clipboard blocks without duplicate input', () => {
    const original: MarkdownDocument = {
      nodeId: note.nodeId,
      content: '',
      readOnly: false,
      revision: '1'.repeat(64),
    };
    const controller = new MarkdownDocumentController({
      reload: vi.fn(),
      save: successfulSave(),
    });
    render(
      <MarkdownEditor
        controller={controller}
        document={original}
        translate={translate}
      />,
    );
    const editor = screen.getByRole('textbox', {
      name: 'projects.editorLabel',
    });
    fireEvent.paste(editor, {
      clipboardData: {
        getData: (format: string) =>
          format === 'text/html'
            ? '<div>one</div><div>two</div><p>three</p>'
            : 'onetwothree',
      },
    });
    fireEvent.input(editor, { inputType: 'insertFromPaste' });

    expect(controller.getSnapshot(note.nodeId)?.content).toBe(
      'one\ntwo\nthree',
    );
    expect(editor.querySelectorAll(':scope > .md-line')).toHaveLength(3);
  });

  it('keeps rapid source punctuation in exact caret order', () => {
    const original: MarkdownDocument = {
      nodeId: note.nodeId,
      content: '',
      readOnly: false,
      revision: '1'.repeat(64),
    };
    const controller = new MarkdownDocumentController({
      reload: vi.fn(),
      save: successfulSave(),
    });
    render(
      <MarkdownEditor
        controller={controller}
        document={original}
        translate={translate}
      />,
    );
    const editor = screen.getByRole('textbox', {
      name: 'projects.editorLabel',
    });
    const source = '[text](https://x.dev)';

    for (const character of source) {
      fireEvent(
        editor,
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: character,
          inputType: 'insertText',
        }),
      );
    }

    expect(controller.getSnapshot(note.nodeId)?.content).toBe(source);
  });

  it('reports grapheme line, column and selection status outside reading mode', () => {
    const original: MarkdownDocument = {
      nodeId: note.nodeId,
      content: 'a\n😀x',
      readOnly: false,
      revision: '1'.repeat(64),
    };
    const controller = new MarkdownDocumentController({
      reload: vi.fn(),
      save: successfulSave(),
    });
    const { rerender } = render(
      <MarkdownEditor
        controller={controller}
        document={original}
        mode="edit"
        translate={translate}
      />,
    );
    const editor = screen.getByRole('textbox', {
      name: 'projects.editorLabel',
    });
    writeSelection(editor, 2, original.content.length);
    fireEvent(document, new Event('selectionchange'));

    expect(
      screen.getByLabelText('projects.editorPosition').textContent,
    ).toContain('projects.line 2, projects.column 3');
    expect(
      screen.getByLabelText('projects.editorPosition').textContent,
    ).toContain('2 projects.selectedMany');

    rerender(
      <MarkdownEditor
        controller={controller}
        document={original}
        mode="reading"
        translate={translate}
      />,
    );
    expect(screen.queryByLabelText('projects.editorPosition')).toBeNull();

    rerender(
      <MarkdownEditor
        controller={controller}
        document={original}
        mode="edit"
        translate={translate}
      />,
    );
    expect(
      readSelection(
        screen.getByRole('textbox', { name: 'projects.editorLabel' }),
      ),
    ).toMatchObject({ start: 2, end: original.content.length });
  });

  it('expands double-click selection across highlighted words and numbers', () => {
    const content = '**informação42** 2026-07-16';
    const original: MarkdownDocument = {
      nodeId: note.nodeId,
      content,
      readOnly: false,
      revision: '1'.repeat(64),
    };
    const controller = new MarkdownDocumentController({
      reload: vi.fn(),
      save: successfulSave(),
    });
    render(
      <MarkdownEditor
        controller={controller}
        document={original}
        translate={translate}
      />,
    );
    const editor = screen.getByRole('textbox', {
      name: 'projects.editorLabel',
    });
    const wordStart = content.indexOf('informação42');
    writeSelection(editor, wordStart + 3, wordStart + 6);
    fireEvent.doubleClick(editor);
    let selected = readSelection(editor);
    expect(content.slice(selected.start, selected.end)).toBe('informação42');

    const dateStart = content.indexOf('2026-07-16');
    writeSelection(editor, dateStart + 5, dateStart + 7);
    fireEvent.doubleClick(editor);
    selected = readSelection(editor);
    expect(content.slice(selected.start, selected.end)).toBe('2026-07-16');
    expect(controller.getSnapshot(note.nodeId)?.selection).toMatchObject(
      selected,
    );
  });

  it('expands a triple click to the complete logical Markdown line', () => {
    const line = '**Linha inteira** 2026-07-16.';
    const content = `Antes\n${line}\nDepois`;
    const original: MarkdownDocument = {
      nodeId: note.nodeId,
      content,
      readOnly: false,
      revision: '1'.repeat(64),
    };
    const controller = new MarkdownDocumentController({
      reload: vi.fn(),
      save: successfulSave(),
    });
    render(
      <MarkdownEditor
        controller={controller}
        document={original}
        mode="edit"
        translate={translate}
      />,
    );
    const editor = screen.getByRole('textbox', {
      name: 'projects.editorLabel',
    });
    const lineStart = content.indexOf(line);
    writeSelection(editor, lineStart + 4, lineStart + 9);
    fireEvent.click(editor, { detail: 3 });

    const selected = readSelection(editor);
    expect(content.slice(selected.start, selected.end)).toBe(line);
    expect(controller.getSnapshot(note.nodeId)?.selection).toMatchObject(
      selected,
    );
  });

  it('confirms external links before invoking the trusted bridge', async () => {
    const openExternalLink = vi.fn(async () => ({ ok: true as const }));
    Object.defineProperty(window, 'flyoff', {
      configurable: true,
      value: { openExternalLink },
    });
    const original: MarkdownDocument = {
      nodeId: note.nodeId,
      content: '[site](https://example.com)',
      readOnly: false,
      revision: '1'.repeat(64),
    };
    const controller = new MarkdownDocumentController({
      reload: vi.fn(),
      save: successfulSave(),
    });
    render(
      <MarkdownEditor
        controller={controller}
        document={original}
        mode="reading"
        translate={translate}
      />,
    );

    const link = screen.getByText('site');
    fireEvent.click(link);
    const dialog = screen.getByRole('dialog', {
      name: 'projects.linkRedirectTitle',
    });
    expect(within(dialog).getByText('https://example.com')).toBeTruthy();
    expect(openExternalLink).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'projects.openLink' }),
    );
    await waitFor(() => {
      expect(openExternalLink).toHaveBeenCalledWith({
        url: 'https://example.com',
      });
    });
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', {
          name: 'projects.linkRedirectTitle',
        }),
      ).toBeNull();
    });

    fireEvent.click(link);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', {
          name: 'projects.linkRedirectTitle',
        }),
      ).toBeNull();
      expect(document.activeElement).toBe(link);
    });
  });

  it('removes consecutive empty lines with Backspace without moving the gutter', () => {
    const original: MarkdownDocument = {
      nodeId: note.nodeId,
      content: 'a',
      readOnly: false,
      revision: '1'.repeat(64),
    };
    const controller = new MarkdownDocumentController({
      reload: vi.fn(),
      save: successfulSave(),
    });
    render(
      <MarkdownEditor
        controller={controller}
        document={original}
        translate={translate}
      />,
    );
    const editor = screen.getByRole('textbox', {
      name: 'projects.editorLabel',
    });
    writeSelection(editor, 1);

    const beforeInput = (inputType: string) =>
      fireEvent(
        editor,
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType,
        }),
      );
    beforeInput('insertParagraph');
    beforeInput('insertParagraph');

    expect(controller.getSnapshot(note.nodeId)?.content).toBe('a\n\n');
    expect(editor.querySelectorAll(':scope > .md-line')).toHaveLength(3);
    expect(editor.querySelectorAll('[data-md-placeholder]')).toHaveLength(2);
    expect(
      [...editor.querySelectorAll('[data-md-gutter]')].map(
        (element) => element.textContent,
      ),
    ).toEqual(['1', '2', '3']);

    beforeInput('deleteContentBackward');
    expect(controller.getSnapshot(note.nodeId)?.content).toBe('a\n');
    beforeInput('deleteContentBackward');
    expect(controller.getSnapshot(note.nodeId)?.content).toBe('a');
    expect(editor.querySelectorAll(':scope > .md-line')).toHaveLength(1);
    expect(editor.querySelector('[data-md-gutter]')?.textContent).toBe('1');
  });

  it('records IME composition once and keeps toolbar edits in history', async () => {
    const original: MarkdownDocument = {
      nodeId: note.nodeId,
      content: 'a',
      readOnly: false,
      revision: '1'.repeat(64),
    };
    const controller = new MarkdownDocumentController({
      reload: vi.fn(),
      save: successfulSave(),
    });
    render(
      <MarkdownEditor
        controller={controller}
        document={original}
        translate={translate}
      />,
    );
    const editor = screen.getByRole('textbox', {
      name: 'projects.editorLabel',
    });
    writeSelection(editor, 1);
    fireEvent.compositionStart(editor);
    editor.textContent = 'a字';
    fireEvent.input(editor, { inputType: 'insertCompositionText' });
    fireEvent.compositionEnd(editor);

    await waitFor(() => {
      expect(controller.getSnapshot(note.nodeId)?.content).toBe('a字');
    });
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    expect(controller.getSnapshot(note.nodeId)?.content).toBe('a');

    writeSelection(editor, 0, 1);
    fireEvent.click(screen.getByRole('button', { name: 'toolbar.bold' }));
    expect(controller.getSnapshot(note.nodeId)?.content).toBe('**a**');
    controller.undo(note.nodeId);
    expect(controller.getSnapshot(note.nodeId)?.content).toBe('a');
  });
});
