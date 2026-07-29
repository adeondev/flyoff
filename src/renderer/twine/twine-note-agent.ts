import type {
  MarkdownDocument,
  ProjectPageNode,
  ProjectResult,
  ProjectTreeNode,
  TwineDocumentToolResult,
} from '../../shared/contracts';
import {
  applyNoteAgentOperations,
  NOTE_AGENT_MAX_TOOL_RESULT_BYTES,
  type NoteAgentChangeRequest,
  type NoteAgentProposal,
  type NoteAgentToolCall,
} from '../../shared/markdown';
import type { MarkdownDocumentController } from '../projects/markdown-document-controller';
import type { TwineDocumentAgentExecutionOptions } from './twine-agent-types';

export interface TwineNoteAgent {
  available: boolean;
  currentNoteNodeId?: string;
  execute(
    call: NoteAgentToolCall,
    options: TwineDocumentAgentExecutionOptions,
  ): Promise<TwineDocumentToolResult>;
}

export interface CreateTwineNoteAgentOptions {
  controller: MarkdownDocumentController;
  getCurrentNoteNodeId: () => string | undefined;
  listChildren: (
    parentId: string | null,
  ) => Promise<ProjectResult<readonly ProjectTreeNode[]>>;
  projectAvailable: boolean;
  readDocument: (
    nodeId: string,
  ) => Promise<ProjectResult<MarkdownDocument>>;
}

function failure(text: string): TwineDocumentToolResult {
  return { ok: false, text };
}

function resultText(value: unknown): TwineDocumentToolResult {
  const text = JSON.stringify(value);
  if (
    new TextEncoder().encode(text).byteLength >
    NOTE_AGENT_MAX_TOOL_RESULT_BYTES
  ) {
    return failure(
      'A nota excede o limite de contexto da IA. Reduza o escopo ou edite-a manualmente.',
    );
  }
  return { ok: true, text };
}

function yieldToRenderer(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      queueMicrotask(resolve);
    }
  });
}

export function createTwineNoteAgent({
  controller,
  getCurrentNoteNodeId,
  listChildren,
  projectAvailable,
  readDocument,
}: CreateTwineNoteAgentOptions): TwineNoteAgent {
  async function listNotes(): Promise<
    ProjectResult<readonly ProjectPageNode[]>
  > {
    const notes: ProjectPageNode[] = [];
    const queue: Array<string | null> = [null];
    const visited = new Set<string | null>();
    while (queue.length > 0 && visited.size < 2_000) {
      const parentId = queue.shift()!;
      if (visited.has(parentId)) {
        continue;
      }
      visited.add(parentId);
      const result = await listChildren(parentId);
      if (!result.ok) {
        return result;
      }
      for (const node of result.value) {
        if (node.kind === 'folder') {
          queue.push(node.nodeId);
        } else if (node.pageType === 'markdown') {
          notes.push(node);
        }
      }
    }
    if (queue.length > 0) {
      return {
        ok: false,
        error: {
          code: 'size-exceeded',
          message:
            'O projeto tem pastas demais para uma única operação da IA.',
        },
      };
    }
    return { ok: true, value: notes };
  }

  async function authorizedNote(
    nodeId: string,
    scope: 'current' | 'project',
  ): Promise<ProjectResult<ProjectPageNode>> {
    if (scope === 'current' && nodeId !== getCurrentNoteNodeId()) {
      return {
        ok: false,
        error: {
          code: 'invalid-operation',
          message: 'A nota solicitada não é a página atual autorizada.',
        },
      };
    }
    const result = await listNotes();
    if (!result.ok) {
      return result;
    }
    const note = result.value.find((candidate) => candidate.nodeId === nodeId);
    return note
      ? { ok: true, value: note }
      : {
          ok: false,
          error: {
            code: 'not-found',
            message: 'A nota solicitada não existe neste projeto.',
          },
        };
  }

  async function document(
    nodeId: string,
  ): Promise<ProjectResult<MarkdownDocument>> {
    const snapshot = controller.getSnapshot(nodeId);
    return snapshot
      ? {
          ok: true,
          value: {
            nodeId,
            content: snapshot.content,
            revision: snapshot.revision,
            readOnly: snapshot.readOnly,
          },
        }
      : readDocument(nodeId);
  }

  async function approve(
    proposal: NoteAgentProposal,
    options: TwineDocumentAgentExecutionOptions,
  ): Promise<boolean> {
    if (options.approvalMode === 'full') {
      return true;
    }
    if (
      options.approvalMode === 'automatic' &&
      !proposal.operationSummary.destructive
    ) {
      return true;
    }
    return options.requestApproval({ proposal });
  }

  async function changeNote(
    request: NoteAgentChangeRequest,
    options: TwineDocumentAgentExecutionOptions,
  ): Promise<TwineDocumentToolResult> {
    const node = await authorizedNote(request.nodeId, options.scope);
    if (!node.ok) {
      return failure(node.error.message);
    }
    const source = await document(request.nodeId);
    if (!source.ok) {
      return failure(source.error.message);
    }
    if (source.value.readOnly) {
      return failure('A nota está em modo somente leitura.');
    }
    if (source.value.revision !== request.expectedRevision) {
      return failure(
        `A nota mudou desde a última leitura. Leia novamente. Revisão atual: ${source.value.revision}`,
      );
    }
    let plan;
    try {
      plan = applyNoteAgentOperations(
        source.value.content,
        request.operations,
      );
    } catch (error) {
      return failure(
        error instanceof Error
          ? error.message
          : 'A proposta de edição da nota é inválida.',
      );
    }
    const proposal: NoteAgentProposal = {
      description: request.summary,
      id: `note-proposal-${crypto.randomUUID()}`,
      kind: 'note',
      nodeId: request.nodeId,
      operationSummary: plan.summary,
      title: `Alterar nota: ${request.summary}`,
    };
    if (!(await approve(proposal, options))) {
      return failure('O usuário rejeitou a alteração da nota.');
    }
    const current = controller.getSnapshot(request.nodeId);
    if (
      current &&
      (current.revision !== source.value.revision ||
        current.content !== source.value.content)
    ) {
      return failure(
        'A nota mudou enquanto a proposta aguardava aprovação. Leia novamente antes de alterar.',
      );
    }
    if (!current) {
      controller.open(source.value);
    }
    let expectedContent = source.value.content;
    for (const nextContent of plan.snapshots) {
      if (!options.shouldContinue()) {
        return failure('A alteração da nota foi cancelada.');
      }
      if (
        !controller.applyAgentContent(
          request.nodeId,
          expectedContent,
          nextContent,
          options.historyGroup,
        )
      ) {
        return failure(
          'A nota mudou durante a execução. Leia novamente antes de continuar.',
        );
      }
      expectedContent = nextContent;
      await yieldToRenderer();
    }
    if (!(await controller.flush(request.nodeId))) {
      return failure(
        controller.getSnapshot(request.nodeId)?.error?.message ??
          'Não foi possível salvar a nota.',
      );
    }
    const saved = controller.getSnapshot(request.nodeId);
    return resultText({
      status: 'applied',
      nodeId: request.nodeId,
      name: node.value.name,
      changes: plan.summary,
      revision: saved?.revision,
      undoAvailable: controller.canUndo(request.nodeId),
    });
  }

  return {
    available: projectAvailable,
    get currentNoteNodeId() {
      return getCurrentNoteNodeId();
    },
    async execute(call, options) {
      if (!projectAvailable) {
        return failure('Abra um projeto antes de usar o agente de notas.');
      }
      switch (call.name) {
        case 'list_project_notes': {
          if (options.scope === 'current' && call.args.scope === 'project') {
            return failure(
              'O acesso a todas as notas não foi autorizado.',
            );
          }
          const result = await listNotes();
          if (!result.ok) {
            return failure(result.error.message);
          }
          const currentId = getCurrentNoteNodeId();
          const notes =
            options.scope === 'current'
              ? result.value.filter(({ nodeId }) => nodeId === currentId)
              : result.value;
          return resultText({
            notes: notes.map(({ nodeId, name, parentId, pageType }) => ({
              nodeId,
              name,
              parentId,
              pageType,
              current: nodeId === currentId,
            })),
          });
        }
        case 'read_note': {
          const node = await authorizedNote(call.args.nodeId, options.scope);
          if (!node.ok) {
            return failure(node.error.message);
          }
          const result = await document(call.args.nodeId);
          if (!result.ok) {
            return failure(result.error.message);
          }
          return resultText({
            node: {
              nodeId: node.value.nodeId,
              name: node.value.name,
              parentId: node.value.parentId,
            },
            revision: result.value.revision,
            content: result.value.content,
            readOnly: result.value.readOnly,
          });
        }
        case 'propose_note_changes':
          return changeNote(call.args, options);
      }
    },
  };
}
