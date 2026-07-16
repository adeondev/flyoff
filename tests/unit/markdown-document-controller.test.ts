import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MarkdownDocumentController,
  type MarkdownBufferSnapshot,
} from '../../src/renderer/projects/markdown-document-controller';
import type { SourceEditTransaction } from '../../src/renderer/projects/markdown-history';
import type {
  MarkdownDocument,
  SaveMarkdownDocumentRequest,
} from '../../src/shared/contracts';

const nodeId = '9aa3eb57-dbc1-4a85-8b04-f0abaf6f2939';
const firstRevision = 'a'.repeat(64);
const secondRevision = 'b'.repeat(64);

function document(content = '', revision = firstRevision): MarkdownDocument {
  return { nodeId, content, revision };
}

function edit(
  before: string,
  after: string,
  timestamp = 0,
): SourceEditTransaction {
  return {
    before: {
      content: before,
      selection: { start: before.length, end: before.length, direction: 'none' },
    },
    after: {
      content: after,
      selection: { start: after.length, end: after.length, direction: 'none' },
    },
    inputType: 'insertText',
    timestamp,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('MarkdownDocumentController', () => {
  it('keeps the buffer alive and saves it after 500 ms', async () => {
    vi.useFakeTimers();
    const save = vi.fn(
      async (request: SaveMarkdownDocumentRequest) => ({
        ok: true as const,
        value: document(request.content, secondRevision),
      }),
    );
    const controller = new MarkdownDocumentController({
      reload: vi.fn(),
      save,
    });
    const listener = vi.fn();

    controller.open(document('# First'));
    controller.subscribe(nodeId, listener);
    controller.update(nodeId, '# Updated');

    expect(controller.isDirty(nodeId)).toBe(true);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(499);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(save).toHaveBeenCalledWith({
      nodeId,
      content: '# Updated',
      expectedRevision: firstRevision,
    });
    expect(controller.getSnapshot(nodeId)).toMatchObject({
      content: '# Updated',
      dirty: false,
      revision: secondRevision,
      status: 'saved',
    } satisfies Partial<MarkdownBufferSnapshot>);
    expect(listener).toHaveBeenCalled();
    expect(controller.discardClean(nodeId)).toBe(true);
  });

  it('blocks autosave after a conflict until reload or overwrite is chosen', async () => {
    vi.useFakeTimers();
    const save = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'conflict',
          message: 'Changed externally',
          currentRevision: secondRevision,
        },
      })
      .mockImplementationOnce(async (request: SaveMarkdownDocumentRequest) => ({
        ok: true as const,
        value: document(request.content, secondRevision),
      }));
    const reload = vi.fn(async () => ({
      ok: true as const,
      value: document('# Disk', secondRevision),
    }));
    const controller = new MarkdownDocumentController({ reload, save });

    controller.open(document('# Original'));
    controller.update(nodeId, '# Mine');
    await vi.advanceTimersByTimeAsync(500);
    expect(controller.getSnapshot(nodeId)?.status).toBe('conflict');
    expect(await controller.flush(nodeId)).toBe(false);

    controller.update(nodeId, '# Mine again');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(save).toHaveBeenCalledTimes(1);

    expect(await controller.overwrite(nodeId)).toBe(true);
    expect(save).toHaveBeenLastCalledWith({
      nodeId,
      content: '# Mine again',
      expectedRevision: firstRevision,
      force: true,
    });
    expect(controller.isDirty(nodeId)).toBe(false);

    controller.update(nodeId, '# Another local edit');
    await controller.reload(nodeId);
    expect(controller.getSnapshot(nodeId)).toMatchObject({
      content: '# Disk',
      dirty: false,
      revision: secondRevision,
    });
  });

  it('saves the latest edit again when content changes during a write', async () => {
    let finishFirstSave: ((value: {
      ok: true;
      value: MarkdownDocument;
    }) => void) | undefined;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirstSave = resolve;
          }),
      )
      .mockImplementationOnce(async (request: SaveMarkdownDocumentRequest) => ({
        ok: true as const,
        value: document(request.content, 'c'.repeat(64)),
      }));
    const controller = new MarkdownDocumentController({
      debounceMs: 0,
      reload: vi.fn(),
      save,
    });

    controller.open(document('one'));
    controller.update(nodeId, 'two');
    const firstSave = controller.save(nodeId);
    controller.update(nodeId, 'three');
    finishFirstSave?.({ ok: true, value: document('two', secondRevision) });
    await firstSave;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(save).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot(nodeId)).toMatchObject({
      content: 'three',
      dirty: false,
    });
  });

  it('keeps overwrite available when reloading a conflicted file fails', async () => {
    const controller = new MarkdownDocumentController({
      reload: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: 'size-exceeded' as const,
          message: 'Too large to reload',
        },
      })),
      save: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: 'conflict' as const,
          message: 'Changed externally',
        },
      })),
    });

    controller.open(document('# Original'));
    controller.update(nodeId, '# Mine');
    await controller.save(nodeId);
    expect(await controller.reload(nodeId)).toBe(false);
    expect(controller.getSnapshot(nodeId)).toMatchObject({
      dirty: true,
      status: 'conflict',
    });
  });

  it('undoes and redoes editor transactions with their selections', () => {
    const controller = new MarkdownDocumentController({
      reload: vi.fn(),
      save: vi.fn(),
    });
    controller.open(document('one'));
    controller.commitEditorTransaction(nodeId, edit('one', 'one!'));

    expect(controller.canUndo(nodeId)).toBe(true);
    expect(controller.undo(nodeId)).toEqual({
      content: 'one',
      selection: { start: 3, end: 3, direction: 'none' },
    });
    expect(controller.getSnapshot(nodeId)).toMatchObject({
      content: 'one',
      dirty: false,
    });
    expect(controller.canRedo(nodeId)).toBe(true);
    expect(controller.redo(nodeId)).toEqual({
      content: 'one!',
      selection: { start: 4, end: 4, direction: 'none' },
    });
  });

  it('keeps history through autosave and a clean tab remount', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (request: SaveMarkdownDocumentRequest) => ({
      ok: true as const,
      value: document(request.content, secondRevision),
    }));
    const controller = new MarkdownDocumentController({
      reload: vi.fn(),
      save,
    });
    controller.open(document('one'));
    controller.commitEditorTransaction(nodeId, edit('one', 'one!'));
    await vi.advanceTimersByTimeAsync(500);

    expect(controller.discardClean(nodeId)).toBe(true);
    controller.open(document('one!', secondRevision));
    expect(controller.undo(nodeId)?.content).toBe('one');
    expect(controller.getSnapshot(nodeId)?.dirty).toBe(true);
  });

  it('resets history on external reload and clamps the saved selection', async () => {
    const reload = vi.fn(async () => ({
      ok: true as const,
      value: document('x', secondRevision),
    }));
    const controller = new MarkdownDocumentController({
      reload,
      save: vi.fn(),
    });
    controller.open(document('long'));
    controller.commitEditorTransaction(nodeId, edit('long', 'longer'));
    controller.setEditorSelection(nodeId, {
      start: 4,
      end: 6,
      direction: 'backward',
    });

    expect(await controller.reload(nodeId)).toBe(true);
    expect(controller.canUndo(nodeId)).toBe(false);
    expect(controller.getSnapshot(nodeId)?.selection).toEqual({
      start: 1,
      end: 1,
      direction: 'none',
    });
  });

  it('preserves local history when a conflict is overwritten', async () => {
    const save = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'conflict', message: 'External edit' },
      })
      .mockImplementationOnce(async (request: SaveMarkdownDocumentRequest) => ({
        ok: true as const,
        value: document(request.content, secondRevision),
      }));
    const controller = new MarkdownDocumentController({
      reload: vi.fn(),
      save,
    });
    controller.open(document('one'));
    controller.commitEditorTransaction(nodeId, edit('one', 'one!'));

    expect(await controller.save(nodeId)).toBe(false);
    expect(await controller.overwrite(nodeId)).toBe(true);
    expect(controller.canUndo(nodeId)).toBe(true);
    expect(controller.undo(nodeId)?.content).toBe('one');
  });
});
