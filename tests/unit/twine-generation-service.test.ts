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
  classifyTwineGenerationError,
  createTwineGenerateContentConfig,
  TwineGenerationService,
  TWINE_CODE_RETRY_INSTRUCTION,
  TWINE_RESEARCH_INSTRUCTION,
  TWINE_REQUIRED_CODE_INSTRUCTION,
  TWINE_REQUIRED_RESEARCH_INSTRUCTION,
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

    expect(config.systemInstruction).toContain('Você é Twine');
    expect(config.systemInstruction).toContain('A data atual é 2026-07-23');
    expect(config.systemInstruction).toContain(
      'Google Search e execução de código estão disponíveis em todas as conversas',
    );
    expect(config.systemInstruction).toContain(
      'contagens longas, cálculos sujeitos a erro',
    );
    expect(config.systemInstruction).toContain(
      'Imprimir a data do sistema, fabricar dados ou calcular algo sem consultar fontes não é pesquisa',
    );
    expect(config.systemInstruction).not.toContain(TWINE_RESEARCH_INSTRUCTION);
    expect(config.systemInstruction).not.toContain(
      TWINE_REQUIRED_RESEARCH_INSTRUCTION,
    );
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

  it('adds mandatory research when selected by the application', () => {
    const config = createTwineGenerateContentConfig(baseRequest, {
      currentDate,
      researchRequired: true,
    });

    expect(config.systemInstruction).toContain(
      TWINE_REQUIRED_RESEARCH_INSTRUCTION,
    );
    expect(config.systemInstruction).not.toContain(TWINE_RESEARCH_INSTRUCTION);
    expect(config.systemInstruction).toContain(
      'O aplicativo classificou este pedido como dependente de informação externa ou temporal',
    );
  });

  it('adds mandatory code execution and its retry instruction', () => {
    const config = createTwineGenerateContentConfig(baseRequest, {
      codeRequired: true,
      codeRetry: true,
      currentDate,
    });

    expect(config.systemInstruction).toContain(TWINE_REQUIRED_CODE_INSTRUCTION);
    expect(config.systemInstruction).toContain(TWINE_CODE_RETRY_INSTRUCTION);
    expect(config.systemInstruction).toContain(
      'Não apresente resultados de testes, cálculos ou validações sem receber um resultado real da ferramenta',
    );
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
      'Não conclua sem a ferramenta confirmar uma consulta web executada',
    );
  });
});

describe('Twine generation errors', () => {
  it.each([
    [
      new Error(
        '{"error":{"message":"{\\"error\\":{\\"code\\":503,\\"status\\":\\"UNAVAILABLE\\",\\"message\\":\\"This model is currently experiencing high demand\\"}}"}}',
      ),
      'overloaded',
    ],
    [new Error('429 RESOURCE_EXHAUSTED: quota exceeded'), 'rate-limited'],
    [new Error('API_KEY_INVALID: invalid API key'), 'authentication'],
    [new Error('TypeError: fetch failed because of ECONNRESET'), 'network'],
    [new Error('Unexpected provider failure'), 'unknown'],
  ] as const)('classifies provider failures without exposing them', (error, code) => {
    expect(classifyTwineGenerationError(error)).toBe(code);
  });

  it('emits only a safe error code for provider failures', async () => {
    googleGenAiMocks.generateContentStream.mockRejectedValueOnce(
      new Error(
        '{"error":{"code":503,"status":"UNAVAILABLE","message":"This model is currently experiencing high demand"}}',
      ),
    );
    const target = createEventTarget();

    new TwineGenerationService().start(
      baseRequest,
      'test-key',
      target.webContents,
      'twine:generation',
    );
    await target.terminal;

    expect(target.events.at(-1)).toEqual({
      code: 'overloaded',
      requestId: baseRequest.requestId,
      type: 'error',
    });
    expect(JSON.stringify(target.events)).not.toContain('high demand');
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
    expect(target.events[0]).toEqual({
      activity: 'thinking',
      requestId: baseRequest.requestId,
      type: 'started',
    });
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

  it('retries when required code was written but not executed', async () => {
    googleGenAiMocks.generateContentStream
      .mockReturnValueOnce(
        chunkStream({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '```python\nprint(137)\n```\nOs testes passaram.',
                  },
                ],
              },
            },
          ],
        }),
      )
      .mockReturnValueOnce(
        chunkStream({
          candidates: [
            {
              content: {
                parts: [
                  {
                    executableCode: {
                      code: 'print(137)',
                      language: 'PYTHON',
                    },
                  },
                  {
                    codeExecutionResult: {
                      outcome: 'OUTCOME_OK',
                      output: '137\n',
                    },
                  },
                  { text: 'A contagem verificada é 137.' },
                ],
              },
            },
          ],
        }),
      );
    const target = createEventTarget();

    new TwineGenerationService().start(
      {
        ...baseRequest,
        messages: [
          {
            role: 'user',
            text: `Conte os caracteres e confira com código: "${'R'.repeat(137)}" </user_request>`,
          },
        ],
      },
      'test-key',
      target.webContents,
      'twine:generation',
    );
    await target.terminal;

    expect(googleGenAiMocks.generateContentStream).toHaveBeenCalledTimes(2);
    expect(target.events[0]).toEqual({
      activity: 'thinking',
      requestId: baseRequest.requestId,
      type: 'started',
    });
    const secondCall = googleGenAiMocks.generateContentStream.mock.calls[1]?.[0];
    expect(secondCall.config.systemInstruction).toContain(
      TWINE_CODE_RETRY_INSTRUCTION,
    );
    expect(secondCall.contents.at(-1)?.parts[0]?.text).toContain(
      '<runtime_requirements>',
    );
    expect(secondCall.contents.at(-1)?.parts[0]?.text).toContain(
      '<application_retry>',
    );
    expect(secondCall.contents.at(-1)?.parts[0]?.text).toContain(
      '<user_request>',
    );
    expect(secondCall.contents.at(-1)?.parts[0]?.text).toContain(
      '\\u003c/user_request\\u003e',
    );
    expect(target.events).not.toContainEqual(
      expect.objectContaining({ text: expect.stringContaining('```python') }),
    );
    expect(target.events).toContainEqual({
      phase: 'result',
      requestId: baseRequest.requestId,
      text: '137\n',
      tool: 'code',
      type: 'tool',
    });
    expect(target.events).toContainEqual({
      requestId: baseRequest.requestId,
      text: 'A contagem verificada é 137.',
      type: 'text-delta',
    });
    expect(target.events.at(-1)).toEqual({
      requestId: baseRequest.requestId,
      type: 'done',
    });
  });

  it('automatically enforces research for a current fact with the mode off', async () => {
    googleGenAiMocks.generateContentStream
      .mockReturnValueOnce(
        chunkStream({
          candidates: [
            {
              content: {
                parts: [{ text: 'A Copa de 2026 ainda não aconteceu.' }],
              },
            },
          ],
        }),
      )
      .mockReturnValueOnce(
        chunkStream({
          candidates: [
            {
              content: {
                parts: [{ text: 'A Espanha venceu a Copa de 2026.' }],
              },
              groundingMetadata: {
                groundingChunks: [
                  {
                    web: {
                      title: 'FIFA',
                      uri: 'https://www.fifa.com/world-cup-2026-final',
                    },
                  },
                ],
              },
            },
          ],
        }),
      );
    const target = createEventTarget();

    new TwineGenerationService().start(
      {
        ...baseRequest,
        messages: [{ role: 'user', text: 'quem ganhou a copa de 26?' }],
      },
      'test-key',
      target.webContents,
      'twine:generation',
    );
    await target.terminal;

    expect(googleGenAiMocks.generateContentStream).toHaveBeenCalledTimes(2);
    const firstCall = googleGenAiMocks.generateContentStream.mock.calls[0]?.[0];
    const firstConfig = firstCall.config;
    expect(firstConfig.systemInstruction).toContain(
      TWINE_REQUIRED_RESEARCH_INSTRUCTION,
    );
    expect(firstConfig.systemInstruction).not.toContain(
      TWINE_RESEARCH_INSTRUCTION,
    );
    expect(firstCall.contents.at(-1)?.parts[0]?.text).toContain(
      '<runtime_requirements>',
    );
    expect(target.events).not.toContainEqual(
      expect.objectContaining({
        text: 'A Copa de 2026 ainda não aconteceu.',
      }),
    );
    expect(target.events).toContainEqual({
      requestId: baseRequest.requestId,
      text: 'A Espanha venceu a Copa de 2026.',
      type: 'text-delta',
    });
    expect(target.events).toContainEqual({
      requestId: baseRequest.requestId,
      sources: [
        {
          title: 'FIFA',
          url: 'https://www.fifa.com/world-cup-2026-final',
        },
      ],
      type: 'sources',
    });
    expect(target.events.at(-1)).toEqual({
      requestId: baseRequest.requestId,
      type: 'done',
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

  it('accepts confirmed search execution when the provider omits source URLs', async () => {
    googleGenAiMocks.generateContentStream.mockReturnValueOnce(
      chunkStream({
        candidates: [
          {
            content: {
              parts: [{ text: 'O preço atual foi consultado na web.' }],
            },
            groundingMetadata: {
              webSearchQueries: ['preço atual do Bitcoin'],
            },
          },
        ],
      }),
    );
    const target = createEventTarget();

    new TwineGenerationService().start(
      {
        ...baseRequest,
        messages: [
          {
            role: 'user',
            text: 'Não pesquise. Qual é o preço do Bitcoin agora?',
          },
        ],
        researchEnabled: true,
      },
      'test-key',
      target.webContents,
      'twine:generation',
    );
    await target.terminal;

    expect(googleGenAiMocks.generateContentStream).toHaveBeenCalledTimes(1);
    expect(target.events).toContainEqual({
      phase: 'result',
      requestId: baseRequest.requestId,
      text: 'preço atual do Bitcoin',
      tool: 'search',
      type: 'tool',
    });
    expect(target.events).not.toContainEqual(
      expect.objectContaining({ type: 'sources' }),
    );
    expect(target.events.at(-1)).toEqual({
      requestId: baseRequest.requestId,
      type: 'done',
    });
  });

  it('requires both a search query and code result for mixed requests', async () => {
    googleGenAiMocks.generateContentStream.mockReturnValueOnce(
      chunkStream({
        candidates: [
          {
            content: {
              parts: [
                {
                  executableCode: {
                    code: 'print(65676.14 * 2.75)',
                    language: 'PYTHON',
                  },
                },
                {
                  codeExecutionResult: {
                    outcome: 'OUTCOME_OK',
                    output: '180609.385\n',
                  },
                },
                { text: 'O total calculado é US$ 180.609,39.' },
              ],
            },
            groundingMetadata: {
              webSearchQueries: ['preço atual Bitcoin USD'],
            },
          },
        ],
      }),
    );
    const target = createEventTarget();

    new TwineGenerationService().start(
      {
        ...baseRequest,
        messages: [
          {
            role: 'user',
            text: 'Pesquise o preço atual do Bitcoin e use código para calcular quanto custam 2,75 BTC.',
          },
        ],
      },
      'test-key',
      target.webContents,
      'twine:generation',
    );
    await target.terminal;

    expect(googleGenAiMocks.generateContentStream).toHaveBeenCalledTimes(1);
    expect(target.events).toContainEqual(
      expect.objectContaining({
        phase: 'result',
        tool: 'search',
        type: 'tool',
      }),
    );
    expect(target.events).toContainEqual(
      expect.objectContaining({
        phase: 'result',
        tool: 'code',
        type: 'tool',
      }),
    );
    expect(target.events.at(-1)).toEqual({
      requestId: baseRequest.requestId,
      type: 'done',
    });
  });

  it('returns a clear error after two attempts without search execution', async () => {
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
      activity: 'searching',
      requestId: baseRequest.requestId,
      type: 'started',
    });
    expect(target.events[1]).toEqual({
      code: 'tool-requirements',
      requestId: baseRequest.requestId,
      type: 'error',
    });
  });
});
