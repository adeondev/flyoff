// @vitest-environment jsdom

import { useState, type ReactNode } from 'react';
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
import {
  FlyoffPreferencesProvider,
  type FlyoffPreferencesContextValue,
} from '../../src/renderer/preferences';
import { MarkdownReadingView } from '../../src/renderer/projects/MarkdownReadingView';
import { MarkdownDocumentController } from '../../src/renderer/projects/markdown-document-controller';
import {
  clearWorkspaceDrag,
  setWorkspaceDragActive,
} from '../../src/renderer/components/tabs/workspace-drag';
import {
  readSelection,
  readSource,
  writeSelection,
} from '../../src/renderer/projects/source-caret';
import { CreateProjectDialog } from '../../src/renderer/projects/CreateProjectDialog';
import { MarkdownLockedView } from '../../src/renderer/projects/MarkdownLockedView';
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
import {
  createDefaultFlyoffPreferences,
  normalizeFlyoffPreferences,
} from '../../src/shared/contracts';

const translate: Translate = (key) => key;
const project: ProjectSummary = {
  projectId: 'cdb39a1a-0339-4c75-91ea-78fbbcb2f97a',
  name: 'Flyoff',
  location: 'D:\\Projects\\Flyoff',
  formatVersion: 1,
};
const folder: ProjectTreeNode = {
  canContainChildren: true,
  hasChildren: true,
  nodeId: '56ef1bfa-1355-4ba0-ac9b-b66da816006c',
  parentId: null,
  name: 'Docs',
  kind: 'folder',
};
const note: ProjectTreeNode = {
  canContainChildren: true,
  hasChildren: false,
  nodeId: 'ffbf978c-43d7-4135-a3ea-f6e4e3ec76fb',
  parentId: null,
  name: 'Todo',
  kind: 'page',
  pageType: 'markdown',
};
const nestedNote: ProjectTreeNode = {
  canContainChildren: true,
  hasChildren: false,
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

function preferenceContext(
  preferences = createDefaultFlyoffPreferences(),
): FlyoffPreferencesContextValue {
  return {
    preferences,
    ready: true,
    resetAll: vi.fn(),
    resetSection: vi.fn(),
    restartApplication: vi.fn(async () => undefined),
    runtime: { hardwareAccelerationEnabled: true },
    saveStatus: 'idle',
    spellcheck: {
      activeLanguages: [],
      availableLanguages: [],
      engine: 'unavailable',
      reason: 'unavailable',
      supported: false,
    },
    update: vi.fn(),
  };
}

function StatefulPreferencesProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [preferences, setPreferences] = useState(
    createDefaultFlyoffPreferences,
  );
  const value = preferenceContext(preferences);
  value.update = (updater) => {
    setPreferences((current) =>
      normalizeFlyoffPreferences(updater(current)),
    );
  };
  return (
    <FlyoffPreferencesProvider value={value}>
      {children}
    </FlyoffPreferencesProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('locked Markdown note', () => {
  it('shows the security illustration and unlocks from the password pill', async () => {
    const onUnlock = vi.fn(async () => ({
      ok: true as const,
      value: {
        content: '# Secret',
        nodeId: note.nodeId,
        readOnly: false,
        revision: '1'.repeat(64),
      },
    }));
    const { container } = render(
      <MarkdownLockedView
        onUnlock={onUnlock}
        title={note.name}
        translate={translate}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'projects.lockedGreeting' }),
    ).toBeTruthy();
    expect(screen.queryByText('projects.lockedPrompt')).toBeNull();
    expect(container.querySelector('.markdown-locked__illustration')).toBeTruthy();

    fireEvent.change(
      screen.getByLabelText('projects.propertiesPassword'),
      { target: { value: 'secret' } },
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'projects.submitPassword' }),
    );

    await waitFor(() => expect(onUnlock).toHaveBeenCalledWith('secret'));
  });
});

describe('project sidebar', () => {
  it('offers advanced search operators by pointer and keyboard', async () => {
    render(
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

    const search = await screen.findByRole('searchbox', {
      name: 'projects.searchProject',
    });
    fireEvent.focus(search);
    const options = screen.getByRole('listbox', {
      name: 'projects.searchOptions',
    });
    expect(within(options).getAllByRole('option')).toHaveLength(6);
    expect(
      within(options).getByRole('option', {
        name: /projects.searchLineDescription/,
      }),
    ).toBeTruthy();

    fireEvent.change(search, { target: { value: 'roadmap' } });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.change(search, { target: { value: '' } });
    expect(
      screen.getByRole('listbox', {
        name: 'projects.searchOptions',
      }),
    ).toBeTruthy();
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect((search as HTMLInputElement).value).toBe('path:');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('searches the full lazy tree and restores its expansion state when cleared', async () => {
    const loadChildren = vi.fn(async ({ parentId }: { parentId: string | null }) => ({
      ok: true as const,
      value:
        parentId === null
          ? [folder, note]
          : parentId === folder.nodeId
            ? [nestedNote]
            : [],
    }));

    render(
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

    await screen.findByRole('button', { name: 'Todo' });
    expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull();

    fireEvent.change(
      screen.getByRole('searchbox', { name: 'projects.searchProject' }),
      { target: { value: 'plán' } },
    );
    expect(await screen.findByRole('button', { name: 'Plan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Docs' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Todo' })).toBeNull();

    fireEvent.change(
      screen.getByRole('searchbox', { name: 'projects.searchProject' }),
      { target: { value: '' } },
    );
    expect(await screen.findByRole('button', { name: 'Todo' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull();
  });

  it('shows the matching content line below a search result', async () => {
    const { container } = render(
      <ProjectSidebar
        loadChildren={vi.fn(async () => ({
          ok: true as const,
          value: [note],
        }))}
        onCreateNode={vi.fn()}
        onMoveNode={vi.fn()}
        onOpenNode={vi.fn()}
        onOpenOverview={vi.fn()}
        onRenameNode={vi.fn()}
        onSearch={vi.fn(async () => ({
          ok: true as const,
          value: {
            nodeIds: [note.nodeId],
            previews: [
              {
                excerpt: 'Teste 1234',
                line: 1,
                nodeId: note.nodeId,
              },
            ],
            skippedLockedNodeIds: [],
          },
        }))}
        onTrashNode={vi.fn()}
        project={project}
        translate={translate}
      />,
    );

    fireEvent.change(
      await screen.findByRole('searchbox', {
        name: 'projects.searchProject',
      }),
      { target: { value: 'teste' } },
    );

    await waitFor(() => {
      expect(
        container.querySelector('.project-tree__preview')?.textContent,
      ).toBe('1·Teste 1234');
    });
    expect(
      container.querySelector('.project-tree__preview-match')?.textContent,
    ).toBe('Teste');
  });

  it('places the project name and icon-only app actions in the footer', async () => {
    const onOpenAbout = vi.fn();
    const onOpenSettings = vi.fn();
    const { container } = render(
      <ProjectSidebar
        loadChildren={vi.fn(async () => ({ ok: true as const, value: [] }))}
        onCreateNode={vi.fn()}
        onMoveNode={vi.fn()}
        onOpenAbout={onOpenAbout}
        onOpenNode={vi.fn()}
        onOpenOverview={vi.fn()}
        onOpenSettings={onOpenSettings}
        onRenameNode={vi.fn()}
        onTrashNode={vi.fn()}
        project={project}
        translate={translate}
      />,
    );

    await screen.findByRole('tree', { name: 'projects.navigation' });
    const footer = container.querySelector('.project-sidebar__footer')!;
    expect(within(footer).getByRole('button', { name: project.name })).toBeTruthy();
    expect(footer.querySelector('.project-sidebar__project-mark')).toBeNull();

    fireEvent.click(
      within(footer).getByRole('button', { name: 'menu.about' }),
    );
    fireEvent.click(
      within(footer).getByRole('button', { name: 'pages.settings' }),
    );
    expect(onOpenAbout).toHaveBeenCalledOnce();
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

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

  it('executes actions from a node context menu without starting marquee selection', async () => {
    render(
      <ProjectSidebar
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
    const rename = screen.getByRole('menuitem', { name: 'projects.rename' });
    fireEvent.pointerDown(rename, {
      button: 0,
      clientX: 24,
      clientY: 24,
      isPrimary: true,
      pointerId: 8,
      pointerType: 'mouse',
    });
    fireEvent.click(rename);

    expect(
      screen.getByRole('textbox', { name: 'projects.name' }),
    ).toBeTruthy();
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
  it('uses focus chrome by default and keeps the classic header available', () => {
    const original: MarkdownDocument = {
      nodeId: note.nodeId,
      content: '# Todo',
      readOnly: false,
      revision: '1'.repeat(64),
    };
    const controller = new MarkdownDocumentController({
      reload: vi.fn(),
      save: successfulSave(),
    });
    const view = render(
      <MarkdownEditor
        controller={controller}
        document={original}
        title="Todo"
        translate={translate}
      />,
    );

    expect(view.container.querySelector('.markdown-editor__header')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'projects.editorModeMenu' }),
    ).toBeTruthy();
    expect(screen.queryByText('projects.saved')).toBeNull();
    const shelfFrame = view.container.querySelector(
      '.markdown-editor__shelf-frame',
    );
    expect(shelfFrame).toBeTruthy();
    expect(
      shelfFrame?.querySelectorAll('.markdown-editor__shelf-outline'),
    ).toHaveLength(3);
    const [curve, top, bottom] = [
      ...shelfFrame!.querySelectorAll<SVGGeometryElement>(
        '.markdown-editor__shelf-outline',
      ),
    ];
    expect(curve?.getAttribute('d')).toMatch(/^M24 \.5.*\.5 25\.5$/);
    expect(top?.getAttribute('x1')).toBe('24');
    expect(top?.getAttribute('y1')).toBe('.5');
    expect(bottom?.getAttribute('x1')).toBe('.5');
    expect(bottom?.getAttribute('y1')).toBe('25.5');

    const preferences = createDefaultFlyoffPreferences();
    preferences.editor.chromeLayout = 'classic';
    view.rerender(
      <FlyoffPreferencesProvider value={preferenceContext(preferences)}>
        <MarkdownEditor
          controller={controller}
          document={original}
          title="Todo"
          translate={translate}
        />
      </FlyoffPreferencesProvider>,
    );

    expect(view.container.querySelector('.markdown-editor__header')).toBeTruthy();
    expect(screen.getByText('projects.saved')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'projects.editorModeMenu' }),
    ).toBeNull();
  });

  it('synchronizes the focus toolbar globally and applies it to new editors', () => {
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
    function Fixture({ count }: { count: number }) {
      return (
        <StatefulPreferencesProvider>
          {Array.from({ length: count }, (_, index) => (
            <MarkdownEditor
              controller={controller}
              document={original}
              key={index}
              translate={translate}
              viewId={`view-${index}`}
            />
          ))}
        </StatefulPreferencesProvider>
      );
    }
    const view = render(<Fixture count={2} />);

    fireEvent.click(
      screen.getAllByRole('button', {
        name: 'projects.collapseToolbar',
      })[0]!,
    );
    expect(
      view.container.querySelectorAll(
        '.markdown-editor__toolbar-region[data-collapsed="true"]',
      ),
    ).toHaveLength(2);

    view.rerender(<Fixture count={3} />);
    expect(
      view.container.querySelectorAll(
        '.markdown-editor__toolbar-region[data-collapsed="true"]',
      ),
    ).toHaveLength(3);
    expect(
      screen.getAllByRole('button', {
        name: 'projects.expandToolbar',
      }),
    ).toHaveLength(3);

    fireEvent.click(
      screen.getAllByRole('button', {
        name: 'projects.expandToolbar',
      })[2]!,
    );
    expect(
      view.container.querySelectorAll(
        '.markdown-editor__toolbar-region[data-collapsed="true"]',
      ),
    ).toHaveLength(0);
  });

  it('renders line one immediately for a new empty note', () => {
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
    expect(editor.querySelectorAll(':scope > .md-line')).toHaveLength(1);
    expect(editor.querySelector('[data-md-gutter]')?.textContent).toBe('1');
    expect(editor.querySelectorAll('[data-md-placeholder]')).toHaveLength(1);
    expect(readSource(editor)).toBe('');
  });

  it('offers contextual Markdown, line, task and link actions in the raw editor', async () => {
    const openExternalLink = vi.fn(async () => ({ ok: true as const }));
    const executeMenuCommand = vi.fn(async () => undefined);
    Object.defineProperty(window, 'flyoff', {
      configurable: true,
      value: { executeMenuCommand, openExternalLink },
    });
    const original: MarkdownDocument = {
      nodeId: note.nodeId,
      content: '- [x] done\n[site](https://example.com)\nlast',
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
    const task = editor.querySelector('.md-tok-task')!;
    expect(task.classList.contains('md-tok-task--checked')).toBe(true);
    fireEvent.contextMenu(task, { clientX: 20, clientY: 20 });

    const toggle = await screen.findByRole('menuitemcheckbox', {
      name: 'projects.unmarkTask',
    });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(controller.getSnapshot(note.nodeId)?.content).toContain(
      '- [ ] done',
    );

    const link = editor.querySelector('.md-source-link')!;
    fireEvent.contextMenu(link, { clientX: 30, clientY: 30 });
    fireEvent.click(
      await screen.findByRole('menuitem', {
        name: 'projects.openLinkContext',
      }),
    );
    await waitFor(() => {
      expect(openExternalLink).toHaveBeenCalledWith({
        url: 'https://example.com',
      });
    });
    fireEvent.contextMenu(link, { clientX: 35, clientY: 35 });
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'projects.copyLink' }),
    );
    await waitFor(() => {
      expect(executeMenuCommand).toHaveBeenCalledWith('edit.copy');
    });

    const last = controller.getSnapshot(note.nodeId)!.content.indexOf('last');
    writeSelection(editor, last + 1);
    fireEvent.contextMenu(editor, { clientX: 40, clientY: 40 });
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'projects.lineActions' }),
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'projects.duplicateLine' }),
    );
    expect(controller.getSnapshot(note.nodeId)?.content).toContain(
      'last\nlast',
    );

    writeSelection(editor, 6, 10);
    fireEvent.contextMenu(editor, { clientX: 50, clientY: 50 });
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'projects.format' }),
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'toolbar.bold' }),
    );
    expect(controller.getSnapshot(note.nodeId)?.content).toContain('**done**');
  });

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
    fireEvent(editor, new Event('scrollend', { bubbles: true }));
    expect(onScrollChange).toHaveBeenCalledWith(144, true);
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

  it('reports grapheme line, column and selection status outside reading mode', async () => {
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

    await waitFor(() =>
      expect(
        screen.getByLabelText('projects.editorPosition').textContent,
      ).toContain('projects.line 2, projects.column 3'),
    );
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
    expect(
      screen.getByLabelText('projects.editorPosition').textContent,
    ).toBe('');
    expect(
      screen.getByRole('button', { name: 'projects.editorModeMenu' }),
    ).toBeTruthy();

    rerender(
      <MarkdownEditor
        controller={controller}
        document={original}
        mode="edit"
        translate={translate}
      />,
    );
    const reopenedEditor = screen.getByRole('textbox', {
      name: 'projects.editorLabel',
    });
    expect(document.activeElement).not.toBe(reopenedEditor);
    expect(controller.getSnapshot(note.nodeId)?.selection).toMatchObject({
      start: 2,
      end: original.content.length,
    });
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
    expect(fireEvent.mouseDown(editor, { button: 0, detail: 2 })).toBe(false);
    let selected = readSelection(editor);
    expect(content.slice(selected.start, selected.end)).toBe('informação42');

    const dateStart = content.indexOf('2026-07-16');
    writeSelection(editor, dateStart + 5, dateStart + 7);
    expect(fireEvent.mouseDown(editor, { button: 0, detail: 2 })).toBe(false);
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
    expect(fireEvent.mouseDown(editor, { button: 0, detail: 3 })).toBe(false);

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

  it('never inserts internal drag identifiers into Markdown', () => {
    const original: MarkdownDocument = {
      nodeId: note.nodeId,
      content: 'safe',
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
    writeSelection(editor, original.content.length);
    setWorkspaceDragActive(true);

    fireEvent(
      editor,
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'project:internal-tab-id',
        inputType: 'insertFromDrop',
      }),
    );
    fireEvent.drop(editor, {
      dataTransfer: {
        getData: () => 'project:internal-tab-id',
        types: [],
      },
    });
    clearWorkspaceDrag();

    expect(controller.getSnapshot(note.nodeId)?.content).toBe('safe');
  });

  it('opens internal links from reading mode by pointer and keyboard', () => {
    const onInternalLink = vi.fn();
    render(
      <MarkdownReadingView
        ariaLabel="Reading"
        content="[child](Folder/Note.md#Parent#Child)"
        onInternalLink={onInternalLink}
        translate={translate}
      />,
    );
    const link = screen.getByRole('link', { name: 'child' });

    fireEvent.click(link);
    fireEvent.keyDown(link, { key: 'Enter' });
    fireEvent.pointerOver(link, { ctrlKey: true });

    expect(onInternalLink).toHaveBeenNthCalledWith(
      1,
      {
        headingPath: ['Parent', 'Child'],
        path: 'Folder/Note.md',
        syntax: 'markdown',
      },
      { x: 0, y: 0 },
      'open',
    );
    expect(onInternalLink).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.any(Object),
      'open',
    );
    expect(onInternalLink).toHaveBeenNthCalledWith(
      3,
      expect.any(Object),
      expect.any(Object),
      'peek',
    );
  });

  it('keeps a large split preview stable and flushes the latest edit within the maximum lag', () => {
    vi.useFakeTimers();
    const first = `first ${'a'.repeat(100_000)}`;
    const second = `second ${'b'.repeat(100_000)}`;
    const latest = `latest ${'c'.repeat(100_000)}`;
    const view = render(
      <MarkdownReadingView
        ariaLabel="Reading"
        content="initial"
        translate={translate}
        updatePolicy="split"
      />,
    );

    view.rerender(
      <MarkdownReadingView
        ariaLabel="Reading"
        content={first}
        translate={translate}
        updatePolicy="split"
      />,
    );
    act(() => vi.advanceTimersByTime(50));
    view.rerender(
      <MarkdownReadingView
        ariaLabel="Reading"
        content={second}
        translate={translate}
        updatePolicy="split"
      />,
    );
    act(() => vi.advanceTimersByTime(50));
    view.rerender(
      <MarkdownReadingView
        ariaLabel="Reading"
        content={latest}
        translate={translate}
        updatePolicy="split"
      />,
    );

    expect(screen.getByRole('document').textContent).toBe('initial');
    act(() => vi.advanceTimersByTime(20));
    expect(screen.getByRole('document').textContent).toBe(latest);
  });

  it('shows the five internal-link commands and goes to the resolved heading', async () => {
    const target = {
      heading: { line: 2, offset: 9, path: ['Heading'] },
      locked: false,
      name: 'Target',
      nodeId: nestedNote.nodeId,
      path: 'Target',
    };
    const openTarget = vi.fn(async () => undefined);
    const resolve = vi.fn(async () => ({
      ok: true as const,
      value: { status: 'resolved' as const, target },
    }));
    const original: MarkdownDocument = {
      content: '[target](Target.md#Heading)',
      nodeId: note.nodeId,
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
        linkRuntime={{
          listBacklinks: vi.fn(),
          listTargets: vi.fn(),
          openTarget,
          renameTarget: vi.fn(),
          resolve,
        }}
        translate={translate}
      />,
    );
    const sourceLink = document.querySelector('.md-source-link')!;
    fireEvent.contextMenu(sourceLink, { clientX: 30, clientY: 40 });

    for (const name of [
      'projects.goToDefinition',
      'projects.peekDefinition',
      'projects.findReferences',
      'projects.renameSymbol',
      'projects.changeAllOccurrences',
    ]) {
      expect(screen.getByRole('menuitem', { name })).toBeTruthy();
    }
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'projects.goToDefinition' }),
    );

    await waitFor(() => {
      expect(resolve).toHaveBeenCalledWith({
        headingPath: ['Heading'],
        path: 'Target.md',
        sourceNodeId: note.nodeId,
        syntax: 'markdown',
      });
      expect(openTarget).toHaveBeenCalledWith(target);
    });
  });

  it('changes matching internal links as one undoable editor transaction', async () => {
    const target = {
      locked: false,
      name: 'Target',
      nodeId: nestedNote.nodeId,
      path: 'Target',
    };
    const other = {
      name: 'Other',
      nodeId: 'd2720f1b-6911-4713-95de-699b8eef9c64',
      path: 'Other',
    };
    const original: MarkdownDocument = {
      content: '[one](Target.md)\n[[Target]]',
      nodeId: note.nodeId,
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
        linkRuntime={{
          listBacklinks: vi.fn(),
          listTargets: vi.fn(async () => ({
            ok: true as const,
            value: [
              { name: 'Source', nodeId: note.nodeId, path: 'Source' },
              target,
              other,
            ],
          })),
          openTarget: vi.fn(),
          renameTarget: vi.fn(),
          resolve: vi.fn(async () => ({
            ok: true as const,
            value: { status: 'resolved' as const, target },
          })),
        }}
        translate={translate}
      />,
    );
    const editor = screen.getByRole('textbox', {
      name: 'projects.editorLabel',
    });
    writeSelection(editor, 2);
    fireEvent(document, new Event('selectionchange'));
    fireEvent.keyDown(editor, { ctrlKey: true, key: 'F2' });
    const dialog = await screen.findByRole('dialog', {
      name: 'projects.replaceLinkOccurrences',
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Other/ }));

    expect(controller.getSnapshot(note.nodeId)?.content).toBe(
      '[one](Other.md)\n[[Other]]',
    );
    fireEvent.keyDown(editor, { ctrlKey: true, key: 'z' });
    expect(controller.getSnapshot(note.nodeId)?.content).toBe(original.content);
  });
});
