import type { TwineGenerationRequest } from '../../shared/contracts';
import type {
  TwineGenerateContentChunk,
  TwineGenerateContentParams,
  TwineModelClient,
  TwineModelClientFactory,
  TwinePart,
} from './twine-generation-service';

export const TWINE_E2E_MODEL_SCENARIOS = ['document-live-edit'] as const;

export type TwineE2eModelScenario =
  (typeof TWINE_E2E_MODEL_SCENARIOS)[number];

function stream(
  ...chunks: readonly TwineGenerateContentChunk[]
): AsyncGenerator<TwineGenerateContentChunk> {
  return (async function* () {
    for (const chunk of chunks) {
      yield chunk;
    }
  })();
}

function chunk(...parts: readonly TwinePart[]): TwineGenerateContentChunk {
  return {
    candidates: [{ content: { parts: [...parts] } }],
  };
}

function latestToolOutput(params: TwineGenerateContentParams): unknown {
  const output = params.contents
    .at(-1)
    ?.parts.find(({ functionResponse }) => functionResponse)
    ?.functionResponse?.response.output;
  if (typeof output !== 'string') {
    throw new Error('The scripted Twine model expected a document tool result.');
  }
  return JSON.parse(output) as unknown;
}

function noteRevision(value: unknown): string {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof (value as { revision?: unknown }).revision !== 'string'
  ) {
    throw new Error('The scripted Twine model received an invalid note revision.');
  }
  return (value as { revision: string }).revision;
}

function diagramElementId(value: unknown, name: string): string {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !(value as { document?: unknown }).document ||
    typeof (value as { document: unknown }).document !== 'object' ||
    Array.isArray((value as { document: unknown }).document)
  ) {
    throw new Error('The scripted Twine model received an invalid diagram.');
  }
  const elements = (
    (value as { document: { elements?: unknown } }).document
  ).elements;
  if (!Array.isArray(elements)) {
    throw new Error('The scripted Twine model received invalid diagram elements.');
  }
  const element = elements.find(
    (candidate) =>
      candidate &&
      typeof candidate === 'object' &&
      !Array.isArray(candidate) &&
      (candidate as { name?: unknown }).name === name &&
      typeof (candidate as { id?: unknown }).id === 'string',
  ) as { id: string } | undefined;
  if (!element) {
    throw new Error(`The scripted Twine model could not find ${name}.`);
  }
  return element.id;
}

function pauseForLiveAssertion(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 120);
  });
}

class TwineDocumentLiveEditClient implements TwineModelClient {
  private round = 0;

  constructor(private readonly request: TwineGenerationRequest) {}

  readonly models = {
    generateContentStream: async (
      params: TwineGenerateContentParams,
    ): Promise<AsyncGenerator<TwineGenerateContentChunk>> => {
      const target = this.request.documentAgent?.currentTarget;
      const round = this.round;
      this.round += 1;

      if (!target) {
        return stream(chunk({ text: 'Nenhum documento atual foi autorizado.' }));
      }
      if (round === 0) {
        return stream(
          chunk({
            functionCall: {
              id: `e2e-read-${target.pageType}`,
              name: target.pageType === 'markdown' ? 'read_note' : 'read_diagram',
              args: { nodeId: target.nodeId },
            },
          }),
        );
      }
      if (round === 1 && target.pageType === 'markdown') {
        return stream(
          chunk({
            functionCall: {
              id: 'e2e-update-note',
              name: 'propose_note_changes',
              args: {
                nodeId: target.nodeId,
                expectedRevision: noteRevision(latestToolOutput(params)),
                summary: 'Atualizar a nota em tempo real',
                operations: [
                  {
                    type: 'replace',
                    oldText: 'Status: rascunho',
                    newText: 'Status: revisado pelo Twine',
                  },
                ],
              },
            },
          }),
        );
      }
      if (round === 2 && target.pageType === 'markdown') {
        await pauseForLiveAssertion();
        return stream(
          chunk({
            functionCall: {
              id: 'e2e-extend-note',
              name: 'propose_note_changes',
              args: {
                nodeId: target.nodeId,
                expectedRevision: noteRevision(latestToolOutput(params)),
                summary: 'Adicionar o próximo passo',
                operations: [
                  {
                    type: 'insert',
                    position: 'end',
                    text: '\n\n## Próximo passo\n\nValidar a entrega automatizada.',
                  },
                ],
              },
            },
          }),
        );
      }
      if (round === 1 && target.pageType === 'diagram') {
        latestToolOutput(params);
        return stream(
          chunk({
            functionCall: {
              id: 'e2e-update-diagram',
              name: 'propose_diagram_changes',
              args: {
                nodeId: target.nodeId,
                summary: 'Criar estrutura de pedidos',
                operations: [
                  {
                    type: 'add-element',
                    ref: 'customer',
                    kind: 'class',
                    changes: {
                      name: 'Cliente',
                      bounds: { x: 120, y: 140, width: 240, height: 180 },
                      color: '#8f72c7',
                    },
                  },
                ],
              },
            },
          }),
        );
      }
      if (
        (round === 2 || round === 4) &&
        target.pageType === 'diagram'
      ) {
        await pauseForLiveAssertion();
        return stream(
          chunk({
            functionCall: {
              id: `e2e-reread-diagram-${round}`,
              name: 'read_diagram',
              args: { nodeId: target.nodeId },
            },
          }),
        );
      }
      if (round === 3 && target.pageType === 'diagram') {
        latestToolOutput(params);
        return stream(
          chunk({
            functionCall: {
              id: 'e2e-add-order',
              name: 'propose_diagram_changes',
              args: {
                nodeId: target.nodeId,
                summary: 'Adicionar a classe Pedido',
                operations: [
                  {
                    type: 'add-element',
                    ref: 'order',
                    kind: 'class',
                    changes: {
                      name: 'Pedido',
                      bounds: { x: 500, y: 140, width: 240, height: 180 },
                    },
                  },
                ],
              },
            },
          }),
        );
      }
      if (round === 5 && target.pageType === 'diagram') {
        const document = latestToolOutput(params);
        return stream(
          chunk({
            functionCall: {
              id: 'e2e-connect-classes',
              name: 'propose_diagram_changes',
              args: {
                nodeId: target.nodeId,
                summary: 'Conectar Cliente e Pedido',
                operations: [
                  {
                    type: 'add-relationship',
                    ref: 'customer-orders',
                    kind: 'association',
                    sourceRef: diagramElementId(document, 'Cliente'),
                    targetRef: diagramElementId(document, 'Pedido'),
                    changes: {
                      name: 'realiza',
                      sourceMultiplicity: '1',
                      targetMultiplicity: '0..*',
                    },
                  },
                ],
              },
            },
          }),
        );
      }
      return stream(
        chunk({
          text:
            target.pageType === 'markdown'
              ? 'Nota atualizada e salva.'
              : 'Diagrama atualizado e salvo.',
        }),
      );
    },
  };
}

export function createTwineE2eModelClientFactory(
  scenario: string | undefined,
): TwineModelClientFactory | undefined {
  if (!scenario) {
    return undefined;
  }
  if (
    !TWINE_E2E_MODEL_SCENARIOS.includes(
      scenario as TwineE2eModelScenario,
    )
  ) {
    throw new Error(`Unknown Twine E2E model scenario: ${scenario}`);
  }
  return async (_apiKey, request) =>
    new TwineDocumentLiveEditClient(request);
}
