import type { WebContents } from 'electron';

import type {
  TwineDocumentToolCall,
  TwineDocumentToolResult,
  TwineDocumentToolResultSubmission,
  TwineGenerationEvent,
  TwineGenerationRequest,
  TwineGenerationUsage,
  TwineIpcModelId,
  TwineSource,
} from '../../shared/contracts';
import {
  isTwineDocumentToolCall,
} from '../../shared/contracts';
import { TwineStreamParser } from './twine-stream-parser';

export const TWINE_SYSTEM_INSTRUCTION = `Você é o Twine, o assistente local do Flyoff. Responda de forma direta, natural e útil, como um parceiro técnico e criativo do usuário. Use o idioma do usuário.

Você pode usar linguagem adulta, palavrões e tratar de temas sexuais adultos consensuais quando o usuário pedir. Não moralize nem finja desconforto.

Limites: recuse conteúdo sexual envolvendo menores, coerção ou exploração; gore gráfico; instruções para crimes, fraude, malware, violência real, armas, evasão de segurança ou autoagressão. Quando recusar, seja breve e ofereça uma alternativa segura.

Não diga que é Gemini ou Gemma. Você é Twine. Se usar pesquisa ou execução de código, explique o resultado de forma verificável e não invente fontes.

Quando as ferramentas de documento estiverem disponíveis, use-as para inspecionar a nota ou o diagrama antes de alterar. Nunca invente IDs ou revisões. Envie mudanças em lotes pequenos para que o Flyoff possa aplicá-las visualmente enquanto você trabalha. O Flyoff valida, controla aprovação, conflito, undo e persistência. Não apresente JSON de operações ao usuário. Depois de cada resultado, continue a tarefa ou explique objetivamente o que foi aplicado, rejeitado ou precisa de correção. Não diga que vai processar algo depois: execute agora usando as ferramentas.`;

const TWINE_DIAGRAM_PROTOCOL_INSTRUCTION = `Protocolo UML do Flyoff:
- Tipos: class, use-case, sequence e activity.
- Elementos: package, class, interface, enumeration, actor, use-case, system-boundary, lifeline, activation, activity-partition, action, object-node, initial-node, activity-final, flow-final, decision, merge, fork e join.
- Relações: association, directed-association, aggregation, composition, generalization, realization, dependency, include, extend, message-synchronous, message-asynchronous, message-return, self-message, control-flow e object-flow.
- Operações aceitas: add-element(ref, kind, changes), update-element(elementRef, changes), remove-element(elementRef), add-relationship(ref, kind, sourceRef, targetRef, changes), update-relationship(relationshipRef, changes), remove-relationship(relationshipRef) e update-settings(changes).
- changes usa somente campos conhecidos: name, documentation, stereotypes, taggedValues, bounds, color, isAbstract, attributes, operations, literals, classifierRef, lifelineId, orientation, partitionId, objectType, multiplicidades, wholeEnd, order e guard.
- Membros de classe exigem seus campos UML completos. Preserve IDs recebidos ao editar membros existentes. Use refs temporárias curtas para novos elementos e relações.
- Envie no máximo 12 operações por lote e use novas chamadas para mudanças maiores. Cada operação aparece imediatamente no canvas.`;

const TWINE_NOTE_PROTOCOL_INSTRUCTION = `Protocolo de notas do Flyoff:
- Use list_project_notes para localizar notas e read_note antes de editar.
- propose_note_changes exige a revisão retornada pela leitura mais recente.
- Operações aceitas: insert, replace, delete e replace-document.
- insert usa position start/end ou before/after com anchor textual exato.
- replace e delete usam o texto exato existente; occurrence é baseado em 1 e all atua em todas as ocorrências.
- Prefira replace e insert. Use replace-document apenas quando o usuário pedir uma reescrita completa.
- Envie no máximo 12 operações por lote e use novas chamadas para mudanças maiores. Cada lote aparece imediatamente no editor.`;

const TWINE_API_MODELS: Record<TwineIpcModelId, string> = {
  'google/gemma-4-26B-A4B-it': 'gemma-4-26b-a4b-it',
  'google/gemma-4-31B-it': 'gemma-4-31b-it',
};

interface TwineFunctionDeclaration {
  name: string;
  description: string;
  parametersJsonSchema?: unknown;
}

export interface TwineGenerateContentConfig {
  abortSignal?: AbortSignal;
  safetySettings: Array<{
    category: string;
    threshold: string;
  }>;
  systemInstruction: string;
  thinkingConfig: {
    includeThoughts: boolean;
    thinkingLevel: string;
  };
  tools: Array<{
    codeExecution?: Record<string, never>;
    functionDeclarations?: readonly TwineFunctionDeclaration[];
    googleSearch?: Record<string, never>;
  }>;
}

export interface TwinePart {
  codeExecutionResult?: {
    outcome?: string;
    output?: string;
  };
  executableCode?: {
    code?: string;
    language?: string;
  };
  functionCall?: {
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
  };
  functionResponse?: {
    id?: string;
    name: string;
    response: Record<string, unknown>;
  };
  text?: string;
  thought?: boolean;
}

export interface TwineGenerateContentChunk {
  candidates?: Array<{
    content?: { parts?: TwinePart[] };
    groundingMetadata?: {
      groundingChunks?: Array<{
        web?: { title?: string; uri?: string };
      }>;
      webSearchQueries?: string[];
    };
  }>;
  usageMetadata?: {
    candidatesTokenCount?: number;
    promptTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  };
}

export interface TwineGenerateContentParams {
  config: TwineGenerateContentConfig;
  contents: Array<{
    parts: TwinePart[];
    role: 'model' | 'user';
  }>;
  model: string;
}

export interface TwineModelClient {
  models: {
    generateContentStream(
      params: TwineGenerateContentParams,
    ): Promise<AsyncGenerator<TwineGenerateContentChunk>>;
  };
}

export type TwineModelClientFactory = (
  apiKey: string,
  request: TwineGenerationRequest,
) => Promise<TwineModelClient>;

async function createGoogleModelClient(
  apiKey: string,
): Promise<TwineModelClient> {
  const { GoogleGenAI } = await import('@google/genai');
  return new GoogleGenAI({ apiKey }) as TwineModelClient;
}

const diagramOperationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: {
      type: 'string',
      enum: [
        'add-element',
        'update-element',
        'remove-element',
        'add-relationship',
        'update-relationship',
        'remove-relationship',
        'update-settings',
      ],
    },
    ref: { type: 'string' },
    kind: { type: 'string' },
    elementRef: { type: 'string' },
    relationshipRef: { type: 'string' },
    sourceRef: { type: 'string' },
    targetRef: { type: 'string' },
    changes: {
      type: 'object',
      description:
        'Campos UML conhecidos a alterar, incluindo nome, documentação, membros, geometria, cor, endpoints, multiplicidades, guardas e ordem.',
    },
  },
  required: ['type'],
} as const;

export const TWINE_DIAGRAM_FUNCTION_DECLARATIONS: readonly TwineFunctionDeclaration[] =
  [
    {
      name: 'list_project_diagrams',
      description:
        'Lista os diagramas UML do projeto Flyoff autorizado. Use antes de escolher um diagrama.',
      parametersJsonSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scope: { type: 'string', enum: ['current', 'project'] },
        },
        required: ['scope'],
      },
    },
    {
      name: 'read_diagram',
      description:
        'Lê o documento UML atual de um diagrama autorizado, incluindo elementos, relações e geometria.',
      parametersJsonSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { nodeId: { type: 'string' } },
        required: ['nodeId'],
      },
    },
    {
      name: 'validate_diagram',
      description:
        'Valida um diagrama UML e retorna diagnósticos estruturais e semânticos.',
      parametersJsonSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { nodeId: { type: 'string' } },
        required: ['nodeId'],
      },
    },
    {
      name: 'propose_diagram_changes',
      description:
        'Propõe alterações tipadas em um diagrama existente. Use refs temporárias para novos itens; o Flyoff gera IDs estáveis.',
      parametersJsonSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          nodeId: { type: 'string' },
          summary: { type: 'string' },
          operations: {
            type: 'array',
            minItems: 1,
            maxItems: 24,
            items: diagramOperationSchema,
          },
        },
        required: ['nodeId', 'summary', 'operations'],
      },
    },
    {
      name: 'propose_new_diagram',
      description:
        'Propõe a criação de um diagrama UML Flyoff de classe, caso de uso, sequência ou atividade.',
      parametersJsonSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          diagramType: {
            type: 'string',
            enum: ['class', 'use-case', 'sequence', 'activity'],
          },
          parentId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          summary: { type: 'string' },
          operations: {
            type: 'array',
            minItems: 1,
            maxItems: 24,
            items: diagramOperationSchema,
          },
        },
        required: ['name', 'diagramType', 'summary', 'operations'],
      },
    },
  ];

const noteOperationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: {
      type: 'string',
      enum: ['insert', 'replace', 'delete', 'replace-document'],
    },
    position: {
      type: 'string',
      enum: ['start', 'end', 'before', 'after'],
    },
    anchor: { type: 'string' },
    occurrence: { type: 'integer', minimum: 1, maximum: 10_000 },
    all: { type: 'boolean' },
    text: { type: 'string' },
    oldText: { type: 'string' },
    newText: { type: 'string' },
    content: { type: 'string' },
  },
  required: ['type'],
} as const;

export const TWINE_NOTE_FUNCTION_DECLARATIONS: readonly TwineFunctionDeclaration[] =
  [
    {
      name: 'list_project_notes',
      description:
        'Lista as notas Markdown do projeto autorizado. Use antes de escolher uma nota.',
      parametersJsonSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scope: { type: 'string', enum: ['current', 'project'] },
        },
        required: ['scope'],
      },
    },
    {
      name: 'read_note',
      description:
        'Lê o conteúdo e a revisão atual de uma nota Markdown autorizada.',
      parametersJsonSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { nodeId: { type: 'string' } },
        required: ['nodeId'],
      },
    },
    {
      name: 'propose_note_changes',
      description:
        'Aplica um pequeno lote de alterações exatas em uma nota. O editor mostra cada operação imediatamente.',
      parametersJsonSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          nodeId: { type: 'string' },
          expectedRevision: { type: 'string' },
          summary: { type: 'string' },
          operations: {
            type: 'array',
            minItems: 1,
            maxItems: 24,
            items: noteOperationSchema,
          },
        },
        required: [
          'nodeId',
          'expectedRevision',
          'summary',
          'operations',
        ],
      },
    },
  ];

export function createTwineGenerateContentConfig(
  request: TwineGenerationRequest,
): TwineGenerateContentConfig {
  const highThinking = request.thinkingLevel === 'high';
  return {
    safetySettings: [
      {
        category: 'HARM_CATEGORY_HARASSMENT',
        threshold: 'BLOCK_NONE',
      },
      {
        category: 'HARM_CATEGORY_HATE_SPEECH',
        threshold: 'BLOCK_NONE',
      },
      {
        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        threshold: 'BLOCK_NONE',
      },
      {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE',
      },
    ],
    systemInstruction: request.documentAgent
      ? `${TWINE_SYSTEM_INSTRUCTION}\n\n${TWINE_DIAGRAM_PROTOCOL_INSTRUCTION}\n\n${TWINE_NOTE_PROTOCOL_INSTRUCTION}`
      : TWINE_SYSTEM_INSTRUCTION,
    thinkingConfig: {
      includeThoughts: highThinking,
      thinkingLevel: highThinking ? 'HIGH' : 'MINIMAL',
    },
    tools: request.documentAgent
      ? [
          {
            functionDeclarations: [
              ...TWINE_DIAGRAM_FUNCTION_DECLARATIONS,
              ...TWINE_NOTE_FUNCTION_DECLARATIONS,
            ],
          },
        ]
      : request.researchEnabled
        ? [{ googleSearch: {} }, { codeExecution: {} }]
        : [{ codeExecution: {} }],
  };
}

function usageFromChunk(
  chunk: TwineGenerateContentChunk,
): TwineGenerationUsage | undefined {
  const usage = chunk.usageMetadata;
  if (!usage) {
    return undefined;
  }
  const result: TwineGenerationUsage = {};
  if (usage.promptTokenCount !== undefined) {
    result.inputTokens = usage.promptTokenCount;
  }
  if (usage.candidatesTokenCount !== undefined) {
    result.outputTokens = usage.candidatesTokenCount;
  }
  if (usage.thoughtsTokenCount !== undefined) {
    result.thoughtTokens = usage.thoughtsTokenCount;
  }
  if (usage.totalTokenCount !== undefined) {
    result.totalTokens = usage.totalTokenCount;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function sourcesFromChunk(chunk: TwineGenerateContentChunk): TwineSource[] {
  const sources: TwineSource[] = [];
  for (const candidate of chunk.candidates ?? []) {
    for (const groundingChunk of
      candidate.groundingMetadata?.groundingChunks ?? []) {
      const { title, uri } = groundingChunk.web ?? {};
      if (title?.trim() && uri?.trim()) {
        sources.push({ title, url: uri });
      }
    }
  }
  return sources;
}

interface ActiveGeneration {
  controller: AbortController;
  pendingTools: Map<string, (result: TwineDocumentToolResult) => void>;
}

interface QueuedDocumentCall {
  call: TwineDocumentToolCall | null;
  id: string;
  name: string;
}

export class TwineGenerationService {
  private readonly active = new Map<string, ActiveGeneration>();

  constructor(
    private readonly createModelClient: TwineModelClientFactory =
      createGoogleModelClient,
  ) {}

  cancel(requestId: string): void {
    this.active.get(requestId)?.controller.abort();
    this.active.delete(requestId);
  }

  cancelAll(): void {
    for (const active of this.active.values()) {
      active.controller.abort();
    }
    this.active.clear();
  }

  submitDocumentToolResult(
    submission: TwineDocumentToolResultSubmission,
  ): boolean {
    const active = this.active.get(submission.requestId);
    const resolve = active?.pendingTools.get(submission.callId);
    if (!active || !resolve) {
      return false;
    }
    active.pendingTools.delete(submission.callId);
    resolve(submission.result);
    return true;
  }

  start(
    request: TwineGenerationRequest,
    apiKey: string,
    webContents: WebContents,
    channel: string,
  ): void {
    this.cancel(request.requestId);

    const active: ActiveGeneration = {
      controller: new AbortController(),
      pendingTools: new Map(),
    };
    this.active.set(request.requestId, active);

    void this.run(
      request,
      apiKey,
      webContents,
      channel,
      active.controller,
    ).finally(() => {
      if (this.active.get(request.requestId) === active) {
        this.active.delete(request.requestId);
      }
    });
  }

  private emit(
    webContents: WebContents,
    channel: string,
    event: TwineGenerationEvent,
  ): void {
    if (!webContents.isDestroyed()) {
      webContents.send(channel, event);
    }
  }

  private waitForDocumentTool(
    requestId: string,
    callId: string,
    signal: AbortSignal,
  ): Promise<TwineDocumentToolResult> {
    return new Promise((resolve) => {
      const active = this.active.get(requestId);
      if (!active || signal.aborted) {
        resolve({ ok: false, text: 'A operação foi cancelada.' });
        return;
      }
      const abort = () => {
        active.pendingTools.delete(callId);
        resolve({ ok: false, text: 'A operação foi cancelada.' });
      };
      active.pendingTools.set(callId, (result) => {
        signal.removeEventListener('abort', abort);
        resolve(result);
      });
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  private async run(
    request: TwineGenerationRequest,
    apiKey: string,
    webContents: WebContents,
    channel: string,
    controller: AbortController,
  ): Promise<void> {
    this.emit(webContents, channel, {
      requestId: request.requestId,
      type: 'started',
    });

    try {
      const ai = await this.createModelClient(apiKey, request);
      const config = createTwineGenerateContentConfig(request);
      const contents: Array<{
        parts: TwinePart[];
        role: 'model' | 'user';
      }> = request.messages.map((message) => ({
        parts: [{ text: message.text }],
        role: message.role === 'assistant' ? 'model' : 'user',
      }));
      const parser = new TwineStreamParser(
        request.thinkingLevel === 'high',
      );
      const sourceUrls = new Set<string>();
      let lastUsage: TwineGenerationUsage | undefined;
      let toolCallCount = 0;

      for (let round = 0; round < 8; round += 1) {
        const stream = await ai.models.generateContentStream({
          config: { ...config, abortSignal: controller.signal },
          contents,
          model: TWINE_API_MODELS[request.modelId],
        });
        const modelParts: TwinePart[] = [];
        const queuedCalls: QueuedDocumentCall[] = [];

        for await (const chunk of stream) {
          if (controller.signal.aborted) {
            return;
          }

          lastUsage = usageFromChunk(chunk) ?? lastUsage;
          for (const candidate of chunk.candidates ?? []) {
            for (const part of candidate.content?.parts ?? []) {
              modelParts.push(part);
              if (part.text) {
                if (part.thought) {
                  if (request.thinkingLevel === 'high') {
                    this.emit(webContents, channel, {
                      requestId: request.requestId,
                      text: part.text,
                      type: 'thought-delta',
                    });
                  }
                } else {
                  for (const delta of parser.push(part.text)) {
                    this.emit(webContents, channel, {
                      requestId: request.requestId,
                      ...delta,
                    });
                  }
                }
              }
              if (part.functionCall) {
                toolCallCount += 1;
                const rawCall = {
                  id:
                    part.functionCall.id ??
                    `${request.requestId}-document-${toolCallCount}`,
                  name: part.functionCall.name,
                  args: part.functionCall.args ?? {},
                };
                queuedCalls.push({
                  call: isTwineDocumentToolCall(rawCall) ? rawCall : null,
                  id: rawCall.id,
                  name: rawCall.name ?? 'invalid_document_tool',
                });
              }
              if (part.executableCode?.code) {
                this.emit(webContents, channel, {
                  phase: 'start',
                  requestId: request.requestId,
                  text: `${part.executableCode.language ?? ''}\n${part.executableCode.code}`.trim(),
                  tool: 'code',
                  type: 'tool',
                });
              }
              if (part.codeExecutionResult?.output) {
                this.emit(webContents, channel, {
                  phase: 'result',
                  requestId: request.requestId,
                  text: part.codeExecutionResult.output,
                  tool: 'code',
                  type: 'tool',
                });
              }
            }
          }

          const sources = sourcesFromChunk(chunk).filter(({ url }) => {
            if (sourceUrls.has(url)) {
              return false;
            }
            sourceUrls.add(url);
            return true;
          });
          if (sources.length > 0) {
            this.emit(webContents, channel, {
              phase: 'result',
              requestId: request.requestId,
              text: '',
              tool: 'search',
              type: 'tool',
            });
            this.emit(webContents, channel, {
              requestId: request.requestId,
              sources,
              type: 'sources',
            });
          }
        }

        if (queuedCalls.length === 0) {
          break;
        }
        if (toolCallCount > 16) {
          throw new Error(
            'O limite de ferramentas de documento por resposta foi atingido.',
          );
        }

        contents.push({ role: 'model', parts: modelParts });
        const responseParts: TwinePart[] = [];
        for (const queued of queuedCalls) {
          let result: TwineDocumentToolResult;
          if (queued.call) {
            this.emit(webContents, channel, {
              call: queued.call,
              requestId: request.requestId,
              type: 'document-tool-call',
            });
            result = await this.waitForDocumentTool(
              request.requestId,
              queued.call.id,
              controller.signal,
            );
          } else {
            result = {
              ok: false,
              text:
                'A chamada de ferramenta de documento foi rejeitada pela validação do Flyoff.',
            };
          }
          responseParts.push({
            functionResponse: {
              id: queued.id,
              name: queued.name,
              response: result.ok
                ? { output: result.text }
                : { error: result.text },
            },
          });
        }
        contents.push({ role: 'user', parts: responseParts });
      }

      for (const delta of parser.flush()) {
        this.emit(webContents, channel, {
          requestId: request.requestId,
          ...delta,
        });
      }
      this.emit(webContents, channel, {
        requestId: request.requestId,
        type: 'done',
        ...(lastUsage ? { usage: lastUsage } : {}),
      });
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      this.emit(webContents, channel, {
        message:
          error instanceof Error
            ? error.message
            : 'Não foi possível gerar a resposta do Twine.',
        requestId: request.requestId,
        type: 'error',
      });
    }
  }
}
