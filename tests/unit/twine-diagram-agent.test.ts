import { describe, expect, it, vi } from 'vitest';

import {
  applyDiagramAgentOperations,
  createDiagramDocument,
  type DiagramAgentToolCall,
} from '../../src/shared/diagram';
import type {
  DiagramDocumentEnvelope,
  ProjectPageNode,
  ProjectResult,
  ProjectTreeNode,
  SaveDiagramDocumentRequest,
} from '../../src/shared/contracts';
import { DiagramController } from '../../src/renderer/projects/diagram/diagram-controller';
import { createTwineDiagramAgent } from '../../src/renderer/twine';

const NODE_ID = '10000000-0000-4000-8000-000000000001';
const NEW_NODE_ID = '10000000-0000-4000-8000-000000000002';
const REVISION = 'a'.repeat(64);

function ids() {
  let value = 10;
  return () =>
    `00000000-0000-4000-8000-${String(++value).padStart(12, '0')}`;
}

function classEnvelope(nodeId = NODE_ID): DiagramDocumentEnvelope {
  const result = applyDiagramAgentOperations(
    createDiagramDocument(
      'class',
      () => '20000000-0000-4000-8000-000000000001',
    ),
    [
      {
        type: 'add-element',
        ref: 'class',
        kind: 'class',
        changes: { name: 'Before' },
      },
    ],
    { createId: ids() },
  );
  return {
    nodeId,
    document: result.document,
    revision: REVISION,
  };
}

function page(nodeId = NODE_ID, name = 'Domain'): ProjectPageNode {
  return {
    canContainChildren: false,
    hasChildren: false,
    kind: 'page',
    name,
    nodeId,
    pageType: 'diagram',
    parentId: null,
  };
}

function setup() {
  const source = classEnvelope();
  const save = vi.fn(
    async (
      request: SaveDiagramDocumentRequest,
    ): Promise<ProjectResult<DiagramDocumentEnvelope>> => ({
      ok: true,
      value: {
        nodeId: request.nodeId,
        document: request.document,
        revision: 'b'.repeat(64),
      },
    }),
  );
  const controller = new DiagramController({
    debounceMs: 10_000,
    reload: vi.fn().mockResolvedValue({ ok: true, value: source }),
    save,
  });
  controller.open(source);
  const readDocument = vi.fn(async (nodeId: string) => ({
    ok: true as const,
    value: nodeId === NODE_ID ? source : classEnvelope(NEW_NODE_ID),
  }));
  const createDocument = vi.fn(async () => ({
    ok: true as const,
    value: page(NEW_NODE_ID, 'Generated'),
  }));
  const onCreated = vi.fn();
  const agent = createTwineDiagramAgent({
    controller,
    createDocument,
    getCurrentDiagramNodeId: () => NODE_ID,
    listChildren: vi.fn(
      async (): Promise<ProjectResult<readonly ProjectTreeNode[]>> => ({
        ok: true,
        value: [page()],
      }),
    ),
    onCreated,
    projectAvailable: true,
    readDocument,
  });
  return { agent, controller, createDocument, onCreated, save, source };
}

function renameCall(name: string): DiagramAgentToolCall {
  return {
    id: 'call-1',
    name: 'propose_diagram_changes',
    args: {
      nodeId: NODE_ID,
      summary: 'Rename class',
      operations: [
        {
          type: 'update-element',
          elementRef:
            '00000000-0000-4000-8000-000000000011',
          changes: { name },
        },
      ],
    },
  };
}

describe('Twine UML agent bridge', () => {
  it('applies an approved proposal through the diagram controller and keeps undo', async () => {
    const { agent, controller, save } = setup();
    const requestApproval = vi.fn().mockResolvedValue(true);

    const result = await agent.execute(renameCall('After'), {
      approvalMode: 'request',
      historyGroup: 'twine:request-1',
      scope: 'current',
      requestApproval,
      shouldContinue: () => true,
    });

    expect(result.ok).toBe(true);
    expect(requestApproval).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
    expect(controller.getSnapshot(NODE_ID)?.document.elements[0]?.name).toBe(
      'After',
    );
    expect(controller.canUndo(NODE_ID)).toBe(true);
  });

  it('publishes each UML operation and keeps the live batch in one undo entry', async () => {
    const { agent, controller, source } = setup();
    const observed: Array<{ count: number; name?: string }> = [];
    const unsubscribe = controller.subscribe(NODE_ID, () => {
      const document = controller.getSnapshot(NODE_ID)?.document;
      if (document) {
        observed.push({
          count: document.elements.length,
          name: document.elements[0]?.name,
        });
      }
    });

    const result = await agent.execute(
      {
        id: 'call-live',
        name: 'propose_diagram_changes',
        args: {
          nodeId: NODE_ID,
          summary: 'Atualizar o modelo',
          operations: [
            {
              type: 'update-element',
              elementRef:
                '00000000-0000-4000-8000-000000000011',
              changes: { name: 'Live' },
            },
            {
              type: 'add-element',
              ref: 'second',
              kind: 'class',
              changes: {
                name: 'Second',
                bounds: { x: 320, y: 40, width: 220, height: 140 },
              },
            },
          ],
        },
      },
      {
        approvalMode: 'full',
        historyGroup: 'twine:live',
        requestApproval: vi.fn(),
        scope: 'current',
        shouldContinue: () => true,
      },
    );

    unsubscribe();
    expect(result.ok).toBe(true);
    expect(observed).toContainEqual({ count: 1, name: 'Live' });
    expect(observed).toContainEqual({ count: 2, name: 'Live' });
    expect(controller.undo(NODE_ID)).toBe(true);
    expect(controller.getSnapshot(NODE_ID)?.document).toEqual(
      source.document,
    );
    expect(controller.canUndo(NODE_ID)).toBe(false);
  });

  it('does not mutate a rejected proposal', async () => {
    const { agent, controller, save } = setup();

    const result = await agent.execute(renameCall('Rejected'), {
      approvalMode: 'request',
      historyGroup: 'twine:request-1',
      scope: 'current',
      requestApproval: vi.fn().mockResolvedValue(false),
      shouldContinue: () => true,
    });

    expect(result.ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(controller.getSnapshot(NODE_ID)?.document.elements[0]?.name).toBe(
      'Before',
    );
  });

  it('auto-applies non-destructive changes but asks before deletion', async () => {
    const { agent, save } = setup();
    const requestApproval = vi.fn().mockResolvedValue(false);

    const renamed = await agent.execute(renameCall('Automatic'), {
      approvalMode: 'automatic',
      historyGroup: 'twine:request-1',
      scope: 'current',
      requestApproval,
      shouldContinue: () => true,
    });
    expect(renamed.ok).toBe(true);
    expect(requestApproval).not.toHaveBeenCalled();

    const removal = await agent.execute(
      {
        id: 'call-2',
        name: 'propose_diagram_changes',
        args: {
          nodeId: NODE_ID,
          summary: 'Remove class',
          operations: [
            {
              type: 'remove-element',
              elementRef:
                '00000000-0000-4000-8000-000000000011',
            },
          ],
        },
      },
      {
        approvalMode: 'automatic',
        historyGroup: 'twine:request-1',
        scope: 'current',
        requestApproval,
        shouldContinue: () => true,
      },
    );

    expect(removal.ok).toBe(false);
    expect(requestApproval).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
  });

  it('creates a new native diagram only after validation', async () => {
    const { agent, createDocument, onCreated, save } = setup();

    const result = await agent.execute(
      {
        id: 'call-create',
        name: 'propose_new_diagram',
        args: {
          name: 'Generated',
          diagramType: 'class',
          summary: 'Create model',
          operations: [
            {
              type: 'add-element',
              ref: 'model',
              kind: 'class',
              changes: { name: 'Model' },
            },
          ],
        },
      },
      {
        approvalMode: 'full',
        historyGroup: 'twine:request-1',
        scope: 'current',
        requestApproval: vi.fn(),
        shouldContinue: () => true,
      },
    );

    expect(result.ok).toBe(true);
    expect(createDocument).toHaveBeenCalledWith({
      parentId: null,
      name: 'Generated',
      diagramType: 'class',
    });
    expect(save).toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledWith(page(NEW_NODE_ID, 'Generated'));
  });
});
