// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MEDIA_ENTRY_TRANSFER,
  MediaGalleryPanel,
} from '../../src/renderer/projects/MediaGalleryPanel';
import type { MediaGallerySnapshot } from '../../src/shared/contracts';

const snapshot: MediaGallerySnapshot = {
  projectId: '123e4567-e89b-42d3-a456-426614174000',
  revision: 'revision',
  folders: [
    {
      folderId: '223e4567-e89b-42d3-a456-426614174001',
      parentId: null,
      name: 'Folder',
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
      sortOrder: 0,
    },
  ],
  assets: ['A', 'B', 'C'].map((name, index) => ({
    assetId: `323e4567-e89b-42d3-a456-42661417400${index}`,
    folderId: null,
    name,
    extension: '.png',
    kind: 'image' as const,
    mimeType: 'image/png',
    sizeBytes: 24,
    pixelWidth: 64,
    pixelHeight: 64,
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z',
    revision: 'a'.repeat(64),
    relativePath: `Media/${name}.png`,
  })),
};

function renderGallery(
  overrides: Record<string, unknown> = {},
  props: { onCloseProject?: () => void } = {},
) {
  Object.defineProperty(window, 'flyoff', {
    configurable: true,
    value: {
      getMediaGallery: vi.fn().mockResolvedValue({ ok: true, value: snapshot }),
      cancelProjectMediaImport: vi.fn(),
      onProjectMediaImportProgress: vi.fn(() => () => undefined),
      startDroppedProjectMediaImport: vi.fn().mockResolvedValue({
        ok: true,
        value: { operationId: 'import-operation' },
      }),
      createMediaFolder: vi.fn().mockResolvedValue({
        ok: true,
        value: snapshot,
      }),
      moveMediaEntries: vi.fn().mockResolvedValue({
        ok: true,
        value: snapshot,
      }),
      ...overrides,
    },
  });
  return render(
    <MediaGalleryPanel
      onCloseProject={props.onCloseProject}
      projectId={snapshot.projectId}
      translate={(key) => key}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('media gallery panel selection', () => {
  it('opens with the details view by default', async () => {
    const { container } = renderGallery();
    await screen.findByRole('gridcell', { name: 'Folder' });

    expect(
      container.querySelector('.media-gallery__grid--details'),
    ).toBeTruthy();
    expect(
      container.querySelector('.media-gallery__details-header'),
    ).toBeTruthy();
  });

  it('hides the details header when the current folder is empty', async () => {
    const emptySnapshot = {
      ...snapshot,
      assets: [],
      folders: [],
    };
    const { container } = renderGallery({
      getMediaGallery: vi
        .fn()
        .mockResolvedValue({ ok: true, value: emptySnapshot }),
    });

    await screen.findByText('projects.mediaEmpty');
    expect(
      container.querySelector('.media-gallery__details-header'),
    ).toBeNull();
  });

  it('supports Shift ranges, Ctrl toggles, select all and Escape', async () => {
    renderGallery();
    const folder = await screen.findByRole('gridcell', { name: 'Folder' });
    const second = screen.getByRole('gridcell', { name: 'B.png' });
    const third = screen.getByRole('gridcell', { name: 'C.png' });

    fireEvent.click(folder);
    fireEvent.click(second, { shiftKey: true });
    expect(folder.getAttribute('aria-selected')).toBe('true');
    expect(second.getAttribute('aria-selected')).toBe('true');

    fireEvent.click(third, { ctrlKey: true });
    expect(third.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(third, { ctrlKey: true, key: 'a' });
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('gridcell')
          .every((item) => item.getAttribute('aria-selected') === 'true'),
      ).toBe(true),
    );

    fireEvent.keyDown(third, { key: 'Escape' });
    expect(
      screen
        .getAllByRole('gridcell')
        .every((item) => item.getAttribute('aria-selected') === 'false'),
    ).toBe(true);
  });

  it('offers creation and import from the empty-space context menu', async () => {
    const { container } = renderGallery();
    await screen.findByRole('gridcell', { name: 'Folder' });
    fireEvent.contextMenu(container.querySelector('.media-gallery__grid')!, {
      clientX: 20,
      clientY: 20,
    });

    expect(await screen.findByText('projects.importMedia')).toBeTruthy();
    expect(screen.getByText('projects.newFolder')).toBeTruthy();
  });

  it('uses Flyoff search suggestions, sorting and the full gallery surface', async () => {
    const { container } = renderGallery();
    await screen.findByRole('gridcell', { name: 'Folder' });

    const search = screen.getByRole('searchbox', {
      name: 'projects.mediaSearch',
    });
    fireEvent.focus(search);
    expect(await screen.findByText('path:')).toBeTruthy();

    const sort = screen.getByRole('button', { name: 'projects.mediaSort' });
    fireEvent.click(sort);
    const sortOptions = await screen.findAllByRole('menuitemcheckbox', {
      name: /projects\.mediaSortName/u,
    });
    expect(sortOptions).toHaveLength(2);
    fireEvent.click(sortOptions[1]!);
    expect(container.querySelector('.media-gallery__filters select')).toBeNull();

    fireEvent.contextMenu(
      container.querySelector('.media-gallery')!,
      {
        clientX: 40,
        clientY: 400,
      },
    );
    expect(await screen.findByText('projects.importMedia')).toBeTruthy();
  });

  it('creates a temporary folder card and cancels it with Escape', async () => {
    const { container } = renderGallery();
    await screen.findByRole('gridcell', { name: 'Folder' });

    fireEvent.click(
      screen.getByRole('button', { name: 'projects.newFolder' }),
    );
    const input = await screen.findByRole('textbox', {
      name: 'projects.mediaFolderName',
    });

    expect(input.getAttribute('value')).toBe('projects.mediaNewFolderDefault');
    expect(
      container.querySelector('.media-gallery__item--draft'),
    ).toBeTruthy();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(
      container.querySelector('.media-gallery__item--draft'),
    ).toBeNull();
  });

  it('switches views without losing selection', async () => {
    const { container } = renderGallery();
    const first = await screen.findByRole('gridcell', { name: 'A.png' });
    fireEvent.click(first);

    fireEvent.click(
      screen.getByRole('button', { name: 'projects.mediaView' }),
    );
    fireEvent.click(
      await screen.findByRole('menuitemcheckbox', {
        name: 'projects.mediaViewDetails',
      }),
    );

    expect(
      container.querySelector('.media-gallery__grid--details'),
    ).toBeTruthy();
    expect(first.getAttribute('aria-selected')).toBe('true');
  });

  it('opens and closes the quick preview with Space', async () => {
    renderGallery();
    const first = await screen.findByRole('gridcell', { name: 'A.png' });

    fireEvent.keyDown(first, { key: ' ' });
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'A' })).toBeTruthy();

    fireEvent.keyDown(document, { key: ' ' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('moves an internal asset to the highlighted folder without opening it', async () => {
    const moveMediaEntries = vi.fn().mockResolvedValue({
      ok: true,
      value: snapshot,
    });
    renderGallery({ moveMediaEntries });
    const folder = await screen.findByRole('gridcell', { name: 'Folder' });
    const payload = JSON.stringify({
      projectId: snapshot.projectId,
      entries: [{ entryId: snapshot.assets[0]!.assetId, kind: 'asset' }],
      expectedRevision: snapshot.revision,
    });
    const dataTransfer = {
      dropEffect: 'none',
      files: [],
      getData: (type: string) =>
        type === MEDIA_ENTRY_TRANSFER ? payload : '',
      types: [MEDIA_ENTRY_TRANSFER],
    };

    vi.useFakeTimers();
    try {
      fireEvent.dragOver(folder, { dataTransfer });
      await vi.advanceTimersByTimeAsync(700);
      expect(folder.isConnected).toBe(true);
      expect(folder.classList.contains('media-gallery__item--drop-target')).toBe(
        true,
      );
      fireEvent.drop(folder, { dataTransfer });
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => expect(moveMediaEntries).toHaveBeenCalledTimes(1));
    expect(moveMediaEntries).toHaveBeenCalledWith({
      entries: [{ entryId: snapshot.assets[0]!.assetId, kind: 'asset' }],
      expectedRevision: snapshot.revision,
      parentId: snapshot.folders[0]!.folderId,
    });
  });

  it('imports external files into the folder that receives the drop', async () => {
    let reportProgress:
      | ((progress: {
          completed: number;
          currentName: string;
          failed: number;
          operationId: string;
          status: 'completed';
          total: number;
        }) => void)
      | undefined;
    const startDroppedProjectMediaImport = vi.fn().mockResolvedValue({
      ok: true,
      value: { operationId: 'import-operation' },
    });
    renderGallery({
      onProjectMediaImportProgress: vi.fn((callback) => {
        reportProgress = callback;
        return () => undefined;
      }),
      startDroppedProjectMediaImport,
    });
    const folder = await screen.findByRole('gridcell', { name: 'Folder' });
    const file = new File(['image'], 'external.png', { type: 'image/png' });
    const dataTransfer = {
      dropEffect: 'none',
      files: [file],
      getData: () => '',
      types: ['Files'],
    };

    fireEvent.dragOver(folder, { dataTransfer });
    fireEvent.drop(folder, { dataTransfer });

    await waitFor(() =>
      expect(startDroppedProjectMediaImport).toHaveBeenCalledTimes(1),
    );
    expect(startDroppedProjectMediaImport).toHaveBeenCalledWith([file], {
      folderId: snapshot.folders[0]!.folderId,
      parentId: null,
    });
    reportProgress?.({
      completed: 1,
      currentName: 'external.png',
      failed: 0,
      operationId: 'import-operation',
      status: 'completed',
      total: 1,
    });
  });

  it('goes to the parent folder before closing the project at the root', async () => {
    const onCloseProject = vi.fn();
    renderGallery({}, { onCloseProject });
    const folder = await screen.findByRole('gridcell', { name: 'Folder' });
    const close = screen.getByRole('button', {
      name: 'projects.closeProject',
    });

    fireEvent.click(close);
    expect(onCloseProject).toHaveBeenCalledTimes(1);

    fireEvent.doubleClick(folder);
    const back = await screen.findByRole('button', {
      name: 'projects.mediaBack',
    });
    fireEvent.click(back);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'projects.closeProject' }),
      ).toBeTruthy(),
    );
    expect(onCloseProject).toHaveBeenCalledTimes(1);
  });
});
