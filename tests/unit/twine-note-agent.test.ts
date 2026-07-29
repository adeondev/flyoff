// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { MarkdownDocumentController } from '../../src/renderer/projects/markdown-document-controller';
import { createTwineNoteAgent } from '../../src/renderer/twine';
import type {
  MarkdownDocument,
  ProjectPageNode,
  SaveMarkdownDocumentRequest,
} from '../../src/shared/contracts';

const NODE_ID = 'note-1';
const FIRST_REVISION = 'a'.repeat(64);
const SAVED_REVISION = 'b'.repeat(64);

function page(): ProjectPageNode {
  return {
    canContainChildren: false,
    hasChildren: false,
    kind: 'page',
    name: 'Plano',
    nodeId: NODE_ID,
    pageType: 'markdown',
    parentId: null,
  };
}

function setup() {
  const source: MarkdownDocument = {
    nodeId: NODE_ID,
    content: '# Plano\n\nStatus: antigo\n',
    readOnly: false,
    revision: FIRST_REVISION,
  };
  const save = vi.fn(async (request: SaveMarkdownDocumentRequest) => ({
    ok: true as const,
    value: {
      nodeId: request.nodeId,
      content: request.content,
      readOnly: false,
      revision: SAVED_REVISION,
    },
  }));
  const controller = new MarkdownDocumentController({
    debounceMs: 10_000,
    reload: vi.fn().mockResolvedValue({ ok: true, value: source }),
    save,
  });
  controller.open(source);
  const agent = createTwineNoteAgent({
    controller,
    getCurrentNoteNodeId: () => NODE_ID,
    listChildren: vi.fn().mockResolvedValue({
      ok: true,
      value: [page()],
    }),
    projectAvailable: true,
    readDocument: vi.fn().mockResolvedValue({ ok: true, value: source }),
  });
  return { agent, controller, save };
}

function options(
  approvalMode: 'request' | 'automatic' | 'full' = 'full',
) {
  return {
    approvalMode,
    historyGroup: 'twine:request-1',
    requestApproval: vi.fn().mockResolvedValue(true),
    scope: 'current' as const,
    shouldContinue: () => true,
  };
}

describe('Twine note agent', () => {
  it('renders each operation live, saves, and groups the run into one undo', async () => {
    const { agent, controller, save } = setup();
    const observed: string[] = [];
    const unsubscribe = controller.subscribe(NODE_ID, () => {
      const content = controller.getSnapshot(NODE_ID)?.content;
      if (content && observed.at(-1) !== content) {
        observed.push(content);
      }
    });

    const result = await agent.execute(
      {
        id: 'call-1',
        name: 'propose_note_changes',
        args: {
          expectedRevision: FIRST_REVISION,
          nodeId: NODE_ID,
          summary: 'Atualizar plano',
          operations: [
            {
              type: 'replace',
              oldText: 'Status: antigo',
              newText: 'Status: atualizado',
            },
            {
              type: 'insert',
              position: 'end',
              text: '\n- [ ] Revisar',
            },
          ],
        },
      },
      options(),
    );

    unsubscribe();
    expect(result.ok).toBe(true);
    expect(observed).toContain('# Plano\n\nStatus: atualizado\n');
    expect(observed).toContain(
      '# Plano\n\nStatus: atualizado\n\n- [ ] Revisar',
    );
    expect(save).toHaveBeenCalledOnce();
    expect(controller.undo(NODE_ID)?.content).toBe(sourceContent());
  });

  it('coalesces separate live tool batches from the same generation', async () => {
    const { agent, controller } = setup();
    const first = await agent.execute(
      {
        id: 'call-1',
        name: 'propose_note_changes',
        args: {
          expectedRevision: FIRST_REVISION,
          nodeId: NODE_ID,
          summary: 'Atualizar status',
          operations: [
            {
              type: 'replace',
              oldText: 'antigo',
              newText: 'atualizado',
            },
          ],
        },
      },
      options(),
    );
    const second = await agent.execute(
      {
        id: 'call-2',
        name: 'propose_note_changes',
        args: {
          expectedRevision: SAVED_REVISION,
          nodeId: NODE_ID,
          summary: 'Adicionar tarefa',
          operations: [
            {
              type: 'insert',
              position: 'end',
              text: '\n- [ ] Revisar',
            },
          ],
        },
      },
      options(),
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(controller.undo(NODE_ID)?.content).toBe(sourceContent());
    expect(controller.canUndo(NODE_ID)).toBe(false);
  });

  it('rejects a stale revision without changing the editor', async () => {
    const { agent, controller } = setup();
    const result = await agent.execute(
      {
        id: 'call-1',
        name: 'propose_note_changes',
        args: {
          expectedRevision: 'c'.repeat(64),
          nodeId: NODE_ID,
          summary: 'Atualizar',
          operations: [
            {
              type: 'replace',
              oldText: 'antigo',
              newText: 'novo',
            },
          ],
        },
      },
      options(),
    );

    expect(result.ok).toBe(false);
    expect(result.text).toContain('Revisão atual');
    expect(controller.getSnapshot(NODE_ID)?.content).toBe(sourceContent());
  });

  it('stops between live operations without losing the applied undo point', async () => {
    const { agent, controller, save } = setup();
    let checks = 0;
    const result = await agent.execute(
      {
        id: 'call-cancel',
        name: 'propose_note_changes',
        args: {
          expectedRevision: FIRST_REVISION,
          nodeId: NODE_ID,
          summary: 'Atualizar em etapas',
          operations: [
            {
              type: 'replace',
              oldText: 'antigo',
              newText: 'parcial',
            },
            {
              type: 'insert',
              position: 'end',
              text: '\nNão deve entrar',
            },
          ],
        },
      },
      {
        ...options(),
        shouldContinue: () => {
          checks += 1;
          return checks === 1;
        },
      },
    );

    expect(result.ok).toBe(false);
    expect(controller.getSnapshot(NODE_ID)?.content).toContain('parcial');
    expect(controller.getSnapshot(NODE_ID)?.content).not.toContain(
      'Não deve entrar',
    );
    expect(save).not.toHaveBeenCalled();
    expect(controller.undo(NODE_ID)?.content).toBe(sourceContent());
    controller.dispose();
  });
});

function sourceContent(): string {
  return '# Plano\n\nStatus: antigo\n';
}
