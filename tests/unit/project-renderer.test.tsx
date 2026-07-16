// @vitest-environment jsdom

import {
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

    fireEvent.click(screen.getByRole('button', { name: 'projects.add' }));
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'projects.newNote' }),
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

  it('restores and reports the source scroll position', () => {
    const original: MarkdownDocument = {
      nodeId: note.nodeId,
      content: Array.from({ length: 100 }, (_, index) => `Line ${index}`).join(
        '\n',
      ),
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
});
