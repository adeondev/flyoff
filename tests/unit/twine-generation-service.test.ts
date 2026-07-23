import type { WebContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const googleGenAiMocks = vi.hoisted(() => ({
  generateContentStream: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    readonly models = {
      generateContentStream: googleGenAiMocks.generateContentStream,
    };
  },
}));

import type { TwineGenerationEvent } from '../../src/shared/contracts';
import {
  createTwineGenerateContentConfig,
  TwineGenerationService,
  TWINE_RESEARCH_INSTRUCTION,
  TWINE_RESEARCH_RETRY_INSTRUCTION,
} from '../../src/main/twine';

const baseRequest = {
  approvalMode: 'request',
  messages: [{ role: 'user', text: 'Oi' }],
  modelId: 'google/gemma-4-31B-it',
  requestId: 'twine-request-1',
  researchEnabled: false,
  thinkingLevel: 'low',
} as const;

const currentDate = new Date('2026-07-23T00:00:00.000Z');

function chunkStream(...chunks: unknown[]): AsyncGenerator<unknown> {
  return (async function* generateChunks() {
    for (const chunk of chunks) {
      yield chunk;
    }
  })();
}

function createEventTarget(): {
  events: TwineGenerationEvent[];
  terminal: Promise<void>;
  webContents: WebContents;
} {
  const events: TwineGenerationEvent[] = [];
  let resolveTerminal: (() => void) | undefined;
  const terminal = new Promise<void>((resolve) => {
    resolveTerminal = resolve;
  });
  const webContents = {
    isDestroyed: () => false,
    send: (_channel: string, event: TwineGenerationEvent) => {
      events.push(event);
      if (event.type === 'done' || event.type === 'error') {
        resolveTerminal?.();
      }
    },
  } as unknown as WebContents;

  return { events, terminal, webContents };
}

describe('Twine generation config', () => {
  it('provides search and code execution in normal mode', () => {
    const config = createTwineGenerateContentConfig(baseRequest, {
      currentDate,
    });

    expect(config.systemInstruction).toContain('Você é o Twine');
    expect(config.systemInstruction).toContain('A data atual é 2026-07-23');
    expect(config.systemInstruction).toContain(
      'O Google Search está disponível mesmo fora do Modo Pesquisa',
    );
    expect(config.systemInstruction).toContain(
      'contagens longas, cálculos sujeitos a erro',
    );
    expect(config.systemInstruction).toContain(
      'Imprimir a data do sistema, fabricar dados ou calcular algo sem consultar fontes não constitui pesquisa',
    );
    expect(config.systemInstruction).not.toContain(TWINE_RESEARCH_INSTRUCTION);
    expect(config.thinkingConfig.thinkingLevel).toBe('MINIMAL');
    expect(config.thinkingConfig.includeThoughts).toBe(false);
    expect(config.tools).toEqual([
      { googleSearch: {} },
      { codeExecution: {} },
    ]);
    expect(config.safetySettings).toContainEqual({
      category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
      threshold: 'BLOCK_MEDIUM_AND_ABOVE',
    });
  });

  it('requires grounded research and strengthens the retry instruction', () => {
    const config = createTwineGenerateContentConfig(
      {
        ...baseRequest,
        researchEnabled: true,
        thinkingLevel: 'high',
      },
      { currentDate, researchRetry: true },
    );

    expect(config.thinkingConfig.thinkingLevel).toBe('HIGH');
    expect(config.thinkingConfig.includeThoughts).toBe(true);
    expect(config.systemInstruction).toContain(TWINE_RESEARCH_INSTRUCTION);
    expect(config.systemInstruction).toContain(
      TWINE_RESEARCH_RETRY_INSTRUCTION,
    );
    expect(config.systemInstruction).toContain(
      'A resposta final deve estar sustentada por pelo menos uma fonte web verificável',
    );
  });
});

describe('Twine research enforcement', () => {
  beforeEach(() => {
    googleGenAiMocks.generateContentStream.mockReset();
  });

  it('keeps normal responses streaming without requiring a source', async () => {
    googleGenAiMocks.generateContentStream.mockReturnValueOnce(
      chunkStream({
        candidates: [{ content: { parts: [{ text: 'Resposta direta.' }] } }],
        usageMetadata: {
          candidatesTokenCount: 3,
          promptTokenCount: 4,
          totalTokenCount: 7,
        },
      }),
    );
    const target = createEventTarget();

    new TwineGenerationService().start(
      baseRequest,
      'test-key',
      target.webContents,
      'twine:generation',
    );
    await target.terminal;

    expect(googleGenAiMocks.generateContentStream).toHaveBeenCalledTimes(1);
    expect(target.events).toContainEqual({
      requestId: baseRequest.requestId,
      text: 'Resposta direta.',
      type: 'text-delta',
    });
    expect(target.events.at(-1)).toEqual({
      requestId: baseRequest.requestId,
      type: 'done',
      usage: {
        inputTokens: 4,
        outputTokens: 3,
        totalTokens: 7,
      },
    });
  });

  it('discards an ungrounded attempt and publishes the grounded retry', async () => {
    googleGenAiMocks.generateContentStream
      .mockReturnValueOnce(
        chunkStream({
          candidates: [
            { content: { parts: [{ text: 'Resposta antiga inventada.' }] } },
          ],
          usageMetadata: {
            candidatesTokenCount: 3,
            promptTokenCount: 4,
            totalTokenCount: 7,
          },
        }),
      )
      .mockReturnValueOnce(
        chunkStream({
          candidates: [
            {
              content: { parts: [{ text: 'Resposta atual verificada.' }] },
              groundingMetadata: {
                groundingChunks: [
                  {
                    web: {
                      title: 'Fonte oficial',
                      uri: 'https://example.com/oficial',
                    },
                  },
                ],
                webSearchQueries: ['informação atual'],
              },
            },
          ],
          usageMetadata: {
            candidatesTokenCount: 5,
            promptTokenCount: 6,
            totalTokenCount: 11,
          },
        }),
      );
    const target = createEventTarget();

    new TwineGenerationService().start(
      { ...baseRequest, researchEnabled: true },
      'test-key',
      target.webContents,
      'twine:generation',
    );
    await target.terminal;

    expect(googleGenAiMocks.generateContentStream).toHaveBeenCalledTimes(2);
    const secondConfig =
      googleGenAiMocks.generateContentStream.mock.calls[1]?.[0]?.config;
    expect(secondConfig.systemInstruction).toContain(
      TWINE_RESEARCH_RETRY_INSTRUCTION,
    );
    expect(target.events).not.toContainEqual(
      expect.objectContaining({ text: 'Resposta antiga inventada.' }),
    );
    expect(target.events).toContainEqual({
      requestId: baseRequest.requestId,
      text: 'Resposta atual verificada.',
      type: 'text-delta',
    });
    expect(target.events).toContainEqual({
      requestId: baseRequest.requestId,
      sources: [
        {
          title: 'Fonte oficial',
          url: 'https://example.com/oficial',
        },
      ],
      type: 'sources',
    });
    expect(target.events.at(-1)).toEqual({
      requestId: baseRequest.requestId,
      type: 'done',
      usage: {
        inputTokens: 10,
        outputTokens: 8,
        totalTokens: 18,
      },
    });
  });

  it('returns a clear error after two attempts without sources', async () => {
    googleGenAiMocks.generateContentStream
      .mockReturnValueOnce(
        chunkStream({
          candidates: [{ content: { parts: [{ text: 'Sem fonte 1' }] } }],
        }),
      )
      .mockReturnValueOnce(
        chunkStream({
          candidates: [{ content: { parts: [{ text: 'Sem fonte 2' }] } }],
        }),
      );
    const target = createEventTarget();

    new TwineGenerationService().start(
      { ...baseRequest, researchEnabled: true },
      'test-key',
      target.webContents,
      'twine:generation',
    );
    await target.terminal;

    expect(googleGenAiMocks.generateContentStream).toHaveBeenCalledTimes(2);
    expect(target.events).toHaveLength(2);
    expect(target.events[0]).toEqual({
      requestId: baseRequest.requestId,
      type: 'started',
    });
    expect(target.events[1]).toEqual({
      message:
        'O Modo Pesquisa não conseguiu obter fontes verificáveis. Tente novamente ou revise a conexão com o Google Search.',
      requestId: baseRequest.requestId,
      type: 'error',
    });
  });
});
