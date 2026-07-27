// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MediaGalleryPanel } from '../../src/renderer/projects/MediaGalleryPanel';
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

function renderGallery(overrides: Record<string, unknown> = {}) {
  Object.defineProperty(window, 'flyoff', {
    configurable: true,
    value: {
      getMediaGallery: vi.fn().mockResolvedValue({ ok: true, value: snapshot }),
      cancelProjectMediaImport: vi.fn(),
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
});
