import type {
  CreateDiagramDocumentRequest,
  DiagramDocumentEnvelope,
  ProjectPageNode,
  ProjectResult,
  ProjectTreeNode,
} from '../../shared/contracts';
import {
  applyDiagramAgentOperations,
  createDiagramDocument,
  DIAGRAM_AGENT_MAX_TOOL_RESULT_BYTES,
  validateUmlSemantics,
  type DiagramAgentChangeRequest,
  type DiagramAgentContextScope,
  type DiagramAgentCreateRequest,
  type DiagramAgentProposal,
  type DiagramAgentToolCall,
  type DiagramAgentToolResult,
} from '../../shared/diagram';
import type { DiagramController } from '../projects/diagram/diagram-controller';
import type {
  TwineDocumentAgentApprovalRequest,
  TwineDocumentAgentExecutionOptions,
} from './twine-agent-types';

export type TwineDiagramAgentApprovalRequest =
  TwineDocumentAgentApprovalRequest;
export type TwineDiagramAgentExecutionOptions =
  TwineDocumentAgentExecutionOptions;

export interface TwineDiagramAgent {
  available: boolean;
  currentDiagramNodeId?: string;
  execute(
    call: DiagramAgentToolCall,
    options: TwineDiagramAgentExecutionOptions,
  ): Promise<DiagramAgentToolResult>;
}

export interface CreateTwineDiagramAgentOptions {
  controller: DiagramController;
  createDocument: (
    request: CreateDiagramDocumentRequest,
  ) => Promise<ProjectResult<ProjectTreeNode>>;
  getCurrentDiagramNodeId: () => string | undefined;
  listChildren: (
    parentId: string | null,
  ) => Promise<ProjectResult<readonly ProjectTreeNode[]>>;
  onCreated: (node: ProjectPageNode) => void;
  projectAvailable: boolean;
  readDocument: (
    nodeId: string,
  ) => Promise<ProjectResult<DiagramDocumentEnvelope>>;
}

interface DiagramNodeIndex {
  diagrams: readonly ProjectPageNode[];
  folders: ReadonlyMap<string, ProjectTreeNode>;
}

function resultText(value: unknown): DiagramAgentToolResult {
  const text = JSON.stringify(value);
  if (
    new TextEncoder().encode(text).byteLength >
    DIAGRAM_AGENT_MAX_TOOL_RESULT_BYTES
  ) {
    return {
      ok: false,
      text:
        'O diagrama excede o limite de contexto da IA. Reduza o escopo ou edite-o manualmente.',
    };
  }
  return { ok: true, text };
}

function failure(message: string): DiagramAgentToolResult {
  return { ok: false, text: message };
}

function proposalTitle(
  request: DiagramAgentChangeRequest | DiagramAgentCreateRequest,
): string {
  return 'nodeId' in request
    ? `Alterar diagrama: ${request.summary}`
    : `Criar ${request.name}: ${request.summary}`;
}

function createStableIds(): {
  record: () => string;
  replay: () => () => string;
} {
  const ids: string[] = [];
  return {
    record: () => {
      const id = crypto.randomUUID();
      ids.push(id);
      return id;
    },
    replay: () => {
      let index = 0;
      return () => {
        const id = ids[index];
        if (!id) {
          throw new TypeError('The UML operation generated an unstable ID.');
        }
        index += 1;
        return id;
      };
    },
  };
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

export function createTwineDiagramAgent({
  controller,
  createDocument: createDocumentPage,
  getCurrentDiagramNodeId,
  listChildren,
  onCreated,
  projectAvailable,
  readDocument,
}: CreateTwineDiagramAgentOptions): TwineDiagramAgent {
  async function indexProject(): Promise<
    ProjectResult<DiagramNodeIndex>
  > {
    const diagrams: ProjectPageNode[] = [];
    const folders = new Map<string, ProjectTreeNode>();
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
          folders.set(node.nodeId, node);
          queue.push(node.nodeId);
        } else if (node.pageType === 'diagram') {
          diagrams.push(node);
        }
      }
    }

    if (queue.length > 0) {
      return {
        ok: false,
        error: {
          code: 'size-exceeded',
          message: 'O projeto tem pastas demais para uma única operação da IA.',
        },
      };
    }
    return { ok: true, value: { diagrams, folders } };
  }

  async function authorizedDiagram(
    nodeId: string,
    scope: DiagramAgentContextScope,
  ): Promise<ProjectResult<ProjectPageNode>> {
    const currentDiagramNodeId = getCurrentDiagramNodeId();
    if (scope === 'current') {
      if (!currentDiagramNodeId || nodeId !== currentDiagramNodeId) {
        return {
          ok: false,
          error: {
            code: 'invalid-operation',
            message:
              'O diagrama solicitado não é o diagrama atual autorizado.',
          },
        };
      }
    }
    const index = await indexProject();
    if (!index.ok) {
      return index;
    }
    const node = index.value.diagrams.find(
      (candidate) => candidate.nodeId === nodeId,
    );
    return node
      ? { ok: true, value: node }
      : {
          ok: false,
          error: {
            code: 'not-found',
            message: 'O diagrama solicitado não existe neste projeto.',
          },
        };
  }

  async function envelope(
    nodeId: string,
  ): Promise<ProjectResult<DiagramDocumentEnvelope>> {
    const snapshot = controller.getSnapshot(nodeId);
    if (snapshot) {
      return {
        ok: true,
        value: {
          nodeId,
          document: snapshot.document,
          revision: snapshot.revision,
        },
      };
    }
    return readDocument(nodeId);
  }

  async function approve(
    proposal: DiagramAgentProposal,
    options: TwineDiagramAgentExecutionOptions,
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

  async function changeExisting(
    request: DiagramAgentChangeRequest,
    options: TwineDiagramAgentExecutionOptions,
  ): Promise<DiagramAgentToolResult> {
    const node = await authorizedDiagram(request.nodeId, options.scope);
    if (!node.ok) {
      return failure(node.error.message);
    }
    const source = await envelope(request.nodeId);
    if (!source.ok) {
      return failure(source.error.message);
    }
    let plan;
    const stableIds = createStableIds();
    try {
      plan = applyDiagramAgentOperations(
        source.value.document,
        request.operations,
        { createId: stableIds.record },
      );
    } catch (error) {
      return failure(
        error instanceof Error ? error.message : 'A proposta UML é inválida.',
      );
    }
    const proposal: DiagramAgentProposal = {
      id: `diagram-proposal-${crypto.randomUUID()}`,
      kind: 'diagram',
      title: proposalTitle(request),
      description: request.summary,
      nodeId: request.nodeId,
      diagramType: source.value.document.diagramType,
      diagnosticsBefore: validateUmlSemantics(source.value.document),
      diagnosticsAfter: plan.diagnostics,
      operationSummary: plan.summary,
    };
    if (!(await approve(proposal, options))) {
      return failure('O usuário rejeitou a proposta de alteração UML.');
    }

    const current = controller.getSnapshot(request.nodeId);
    if (
      current &&
      (current.revision !== source.value.revision ||
        current.document !== source.value.document)
    ) {
      return failure(
        'O diagrama mudou enquanto a proposta aguardava aprovação. Leia novamente antes de tentar aplicar.',
      );
    }
    if (!current) {
      controller.open(source.value);
    }
    let expectedDocument = source.value.document;
    for (let index = 1; index <= request.operations.length; index += 1) {
      if (!options.shouldContinue()) {
        return failure('A alteração UML foi cancelada.');
      }
      const snapshot = controller.getSnapshot(request.nodeId);
      if (!snapshot || snapshot.document !== expectedDocument) {
        return failure(
          'O diagrama mudou durante a execução. Leia novamente antes de continuar.',
        );
      }
      const partial = applyDiagramAgentOperations(
        source.value.document,
        request.operations.slice(0, index),
        { createId: stableIds.replay() },
      );
      if (partial.document !== expectedDocument) {
        const updated = controller.update(
          request.nodeId,
          () => partial.document,
          options.historyGroup,
          true,
        );
        if (!updated) {
          return failure('O Flyoff rejeitou uma alteração UML.');
        }
        expectedDocument = partial.document;
        await yieldToRenderer();
      }
    }
    if (!(await controller.flush(request.nodeId))) {
      return failure(
        controller.getSnapshot(request.nodeId)?.error?.message ??
          'Não foi possível salvar a proposta UML.',
      );
    }
    return resultText({
      status: 'applied',
      nodeId: request.nodeId,
      diagramType: plan.document.diagramType,
      changes: plan.summary,
      diagnostics: plan.diagnostics,
      undoAvailable: controller.canUndo(request.nodeId),
      revision: controller.getSnapshot(request.nodeId)?.revision,
    });
  }

  async function createNew(
    request: DiagramAgentCreateRequest,
    options: TwineDiagramAgentExecutionOptions,
  ): Promise<DiagramAgentToolResult> {
    const index = await indexProject();
    if (!index.ok) {
      return failure(index.error.message);
    }
    const currentNodeId = getCurrentDiagramNodeId();
    const currentNode = index.value.diagrams.find(
      ({ nodeId }) => nodeId === currentNodeId,
    );
    const requestedParentId =
      request.parentId === undefined && options.scope === 'current'
        ? currentNode?.parentId ?? null
        : request.parentId ?? null;
    if (
      requestedParentId !== null &&
      !index.value.folders.has(requestedParentId)
    ) {
      return failure(
        'A pasta de destino não pertence ao projeto autorizado.',
      );
    }
    if (
      options.scope === 'current' &&
      (!currentNodeId ||
        requestedParentId !== (currentNode?.parentId ?? null))
    ) {
      return failure(
        'O escopo atual só permite criar ao lado do diagrama autorizado.',
      );
    }

    let preview;
    const stableIds = createStableIds();
    try {
      preview = applyDiagramAgentOperations(
        createDiagramDocument(request.diagramType),
        request.operations,
        { createId: stableIds.record },
      );
    } catch (error) {
      return failure(
        error instanceof Error ? error.message : 'A proposta UML é inválida.',
      );
    }
    const proposal: DiagramAgentProposal = {
      id: `diagram-proposal-${crypto.randomUUID()}`,
      kind: 'diagram',
      title: proposalTitle(request),
      description: request.summary,
      diagramType: request.diagramType,
      diagnosticsBefore: [],
      diagnosticsAfter: preview.diagnostics,
      operationSummary: preview.summary,
    };
    if (!(await approve(proposal, options))) {
      return failure('O usuário rejeitou a criação do diagrama UML.');
    }

    const created = await createDocumentPage({
      parentId: requestedParentId,
      name: request.name,
      diagramType: request.diagramType,
    });
    if (!created.ok) {
      return failure(created.error.message);
    }
    if (created.value.kind !== 'page') {
      return failure('O Flyoff retornou um nó incompatível para o diagrama.');
    }
    const source = await readDocument(created.value.nodeId);
    if (!source.ok) {
      return failure(source.error.message);
    }
    controller.open(source.value);
    onCreated(created.value);
    let expectedDocument = source.value.document;
    for (let index = 1; index <= request.operations.length; index += 1) {
      if (!options.shouldContinue()) {
        return failure('A criação UML foi cancelada.');
      }
      const partial = applyDiagramAgentOperations(
        source.value.document,
        request.operations.slice(0, index),
        { createId: stableIds.replay() },
      );
      const updated = controller.update(
        created.value.nodeId,
        () => partial.document,
        options.historyGroup,
        true,
      );
      if (!updated && partial.document !== expectedDocument) {
        return failure('O Flyoff rejeitou uma alteração UML.');
      }
      expectedDocument = partial.document;
      await yieldToRenderer();
    }
    if (!(await controller.flush(created.value.nodeId))) {
      return failure(
        controller.getSnapshot(created.value.nodeId)?.error?.message ??
          'Não foi possível salvar o novo diagrama.',
      );
    }
    return resultText({
      status: 'created',
      nodeId: created.value.nodeId,
      name: created.value.name,
      diagramType: preview.document.diagramType,
      changes: preview.summary,
      diagnostics: preview.diagnostics,
      revision: controller.getSnapshot(created.value.nodeId)?.revision,
    });
  }

  return {
    available: projectAvailable,
    get currentDiagramNodeId() {
      return getCurrentDiagramNodeId();
    },
    async execute(call, options) {
      if (!projectAvailable) {
        return failure('Abra um projeto antes de usar o agente UML.');
      }
      switch (call.name) {
        case 'list_project_diagrams': {
          if (options.scope === 'current' && call.args.scope === 'project') {
            return failure(
              'O acesso a todos os diagramas não foi autorizado.',
            );
          }
          const index = await indexProject();
          if (!index.ok) {
            return failure(index.error.message);
          }
          const currentId = getCurrentDiagramNodeId();
          const diagrams =
            options.scope === 'current'
              ? index.value.diagrams.filter(
                  ({ nodeId }) => nodeId === currentId,
                )
              : index.value.diagrams;
          return resultText({
            diagrams: diagrams.map(
              ({ nodeId, name, parentId, pageType }) => ({
                nodeId,
                name,
                parentId,
                pageType,
                current: nodeId === currentId,
              }),
            ),
          });
        }
        case 'read_diagram': {
          const node = await authorizedDiagram(
            call.args.nodeId,
            options.scope,
          );
          if (!node.ok) {
            return failure(node.error.message);
          }
          const result = await envelope(call.args.nodeId);
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
            document: result.value.document,
            diagnostics: validateUmlSemantics(result.value.document),
          });
        }
        case 'validate_diagram': {
          const node = await authorizedDiagram(
            call.args.nodeId,
            options.scope,
          );
          if (!node.ok) {
            return failure(node.error.message);
          }
          const result = await envelope(call.args.nodeId);
          if (!result.ok) {
            return failure(result.error.message);
          }
          const diagnostics = validateUmlSemantics(result.value.document);
          return resultText({
            valid: diagnostics.every(
              ({ severity }) => severity !== 'error',
            ),
            diagnostics,
          });
        }
        case 'propose_diagram_changes':
          return changeExisting(call.args, options);
        case 'propose_new_diagram':
          return createNew(call.args, options);
      }
    },
  };
}
