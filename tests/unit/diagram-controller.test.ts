import { describe, expect, it, vi } from 'vitest';

import { DiagramController } from '../../src/renderer/projects/diagram/diagram-controller';
import { DiagramHistoryStore } from '../../src/renderer/projects/diagram/diagram-history';
import { projectFailure, projectSuccess } from '../../src/shared/contracts';
import {
  createDiagramDocument,
  createDiagramElement,
} from '../../src/shared/diagram';

const nodeId = '11111111-1111-4111-8111-111111111111';
const initialRevision = 'a'.repeat(64);
const savedRevision = 'b'.repeat(64);

describe('diagram history and controller', () => {
  it('coalesces continuous edits and supports undo and redo', () => {
    const history = new DiagramHistoryStore();
    const first = createDiagramDocument('class');
    const second = {
      ...first,
      settings: { ...first.settings, showGrid: false },
    };
    const third = {
      ...second,
      settings: { ...second.settings, snapToGrid: false },
    };

    history.record(nodeId, first, second, 'drag:element', 100);
    history.record(nodeId, second, third, 'drag:element', 200);

    expect(history.undo(nodeId, third)).toBe(first);
    expect(history.canUndo(nodeId)).toBe(false);
    expect(history.redo(nodeId, first)).toBe(third);
  });

  it('autosaves structurally valid edits with the expected revision', async () => {
    vi.useFakeTimers();
    const baseDocument = createDiagramDocument('activity');
    const action = createDiagramElement('action');
    const document = {
      ...baseDocument,
      elements: [action.element],
      presentations: {
        nodes: [action.presentation],
        edges: [],
      },
    };
    const save = vi.fn(async (request) =>
      projectSuccess({
        nodeId,
        document: request.document,
        revision: savedRevision,
      }),
    );
    const controller = new DiagramController({
      debounceMs: 250,
      reload: vi.fn(),
      save,
    });
    controller.open({ nodeId, document, revision: initialRevision });

    expect(
      controller.update(nodeId, (current) => ({
        ...current,
        settings: { ...current.settings, showGrid: false },
        presentations: {
          ...current.presentations,
          nodes: current.presentations.nodes.map((presentation) => ({
            ...presentation,
            appearance: { color: '#8f4fc4' },
          })),
        },
      })),
    ).toBe(true);
    expect(controller.getSnapshot(nodeId)).toMatchObject({ dirty: true, status: 'dirty' });

    await vi.advanceTimersByTimeAsync(250);

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId,
        expectedRevision: initialRevision,
        document: expect.objectContaining({
          settings: expect.objectContaining({ showGrid: false }),
          presentations: expect.objectContaining({
            nodes: [
              expect.objectContaining({
                appearance: { color: '#8f4fc4' },
              }),
            ],
          }),
        }),
      }),
    );
    expect(controller.getSnapshot(nodeId)).toMatchObject({
      dirty: false,
      revision: savedRevision,
      status: 'saved',
    });
    controller.dispose();
    vi.useRealTimers();
  });

  it('holds conflicts until reload or an explicit force overwrite', async () => {
    const document = createDiagramDocument('sequence');
    const external = {
      ...document,
      settings: { ...document.settings, gridSize: 24 },
    };
    const save = vi
      .fn()
      .mockResolvedValueOnce(projectFailure('conflict', 'Changed externally.', 'c'.repeat(64)))
      .mockImplementationOnce(async (request) =>
        projectSuccess({ nodeId, document: request.document, revision: savedRevision }),
      );
    const reload = vi.fn(async () =>
      projectSuccess({ nodeId, document: external, revision: 'c'.repeat(64) }),
    );
    const controller = new DiagramController({ debounceMs: 60_000, reload, save });
    controller.open({ nodeId, document, revision: initialRevision });
    controller.update(nodeId, (current) => ({
      ...current,
      settings: { ...current.settings, showGrid: false },
    }));

    await expect(controller.flush(nodeId)).resolves.toBe(false);
    expect(controller.getSnapshot(nodeId)?.status).toBe('conflict');
    await expect(controller.overwrite(nodeId)).resolves.toBe(true);
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ force: true }));

    controller.update(nodeId, (current) => ({
      ...current,
      settings: { ...current.settings, snapToGrid: false },
    }));
    await expect(controller.reload(nodeId)).resolves.toBe(true);
    expect(controller.getSnapshot(nodeId)).toMatchObject({
      document: external,
      dirty: false,
      status: 'saved',
    });
    controller.dispose();
  });

  it('rejects invalid renderer mutations before scheduling persistence', () => {
    const document = createDiagramDocument('class');
    const controller = new DiagramController({ reload: vi.fn(), save: vi.fn() });
    controller.open({ nodeId, document, revision: initialRevision });

    expect(
      controller.update(nodeId, (current) => ({
        ...current,
        documentId: 'not-a-uuid',
      })),
    ).toBe(false);
    expect(controller.getSnapshot(nodeId)).toMatchObject({ dirty: false, document });
    controller.dispose();
  });
});
