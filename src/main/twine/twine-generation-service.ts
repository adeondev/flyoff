import type { WebContents } from 'electron';

import type {
  TwineGenerationEvent,
  TwineGenerationRequest,
  TwineGenerationUsage,
  TwineIpcModelId,
  TwineSource,
} from '../../shared/contracts';
import { TwineStreamParser } from './twine-stream-parser';

export const TWINE_SYSTEM_INSTRUCTION = `IDENTIDADE
Você é o Twine, o assistente local do Flyoff. Nunca se apresente como Gemini ou Gemma. Responda no idioma usado pelo usuário.

RESPOSTAS
Seja direto, natural e útil. Comece pelo conteúdo que resolve o pedido, sem saudações ou introduções genéricas desnecessárias. Entregue uma única resposta final coerente. Não apresente rascunhos, respostas candidatas ou alternativas de formulação, exceto quando o usuário pedir opções ou comparações. Pense com profundidade proporcional à complexidade da tarefa e não narre alternativas internas na resposta final. Quando houver ambiguidade relevante, peça somente a informação indispensável. Declare incertezas e diferencie fatos de inferências.

FERRAMENTAS E FONTES
Use pesquisa e execução de código apenas quando estiverem disponíveis e forem úteis ao pedido. Nunca afirme ter usado uma ferramenta sem um resultado correspondente. Ao pesquisar, baseie afirmações nas fontes retornadas, preserve os links verificáveis e não invente referências. Ao executar código, explique de forma objetiva o resultado observado.

CONTEÚDO ADULTO
Você pode usar palavrões e tratar de temas sexuais entre adultos, consensuais e legais quando o usuário pedir. Não moralize nem simule desconforto.

LIMITES
Recuse conteúdo sexual envolvendo menores, coerção ou exploração; gore gráfico; e instruções que facilitem crimes, fraude, malware, violência real, armas, evasão de segurança ou autoagressão. Faça recusas breves e, quando possível, ofereça uma alternativa segura.`;

const TWINE_API_MODELS: Record<TwineIpcModelId, string> = {
  'google/gemma-4-26B-A4B-it': 'gemma-4-26b-a4b-it',
  'google/gemma-4-31B-it': 'gemma-4-31b-it',
};

interface TwineGenerateContentConfig {
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
    googleSearch?: Record<string, never>;
  }>;
}

interface TwinePart {
  codeExecutionResult?: {
    outcome?: string;
    output?: string;
  };
  executableCode?: {
    code?: string;
    language?: string;
  };
  text?: string;
  thought?: boolean;
}

interface TwineGenerateContentChunk {
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

interface TwineGenAIClient {
  models: {
    generateContentStream(params: {
      config: TwineGenerateContentConfig;
      contents: Array<{
        parts: Array<{ text: string }>;
        role: 'model' | 'user';
      }>;
      model: string;
    }): Promise<AsyncGenerator<TwineGenerateContentChunk>>;
  };
}

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
    systemInstruction: TWINE_SYSTEM_INSTRUCTION,
    thinkingConfig: {
      includeThoughts: highThinking,
      thinkingLevel: highThinking ? 'HIGH' : 'MINIMAL',
    },
    tools: request.researchEnabled
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

export class TwineGenerationService {
  private readonly active = new Map<string, AbortController>();

  cancel(requestId: string): void {
    this.active.get(requestId)?.abort();
    this.active.delete(requestId);
  }

  cancelAll(): void {
    for (const controller of this.active.values()) {
      controller.abort();
    }
    this.active.clear();
  }

  start(
    request: TwineGenerationRequest,
    apiKey: string,
    webContents: WebContents,
    channel: string,
  ): void {
    this.cancel(request.requestId);

    const controller = new AbortController();
    this.active.set(request.requestId, controller);

    void this.run(request, apiKey, webContents, channel, controller).finally(() => {
      if (this.active.get(request.requestId) === controller) {
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
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey }) as TwineGenAIClient;
      const config = createTwineGenerateContentConfig(request);
      const stream = await ai.models.generateContentStream({
        config: { ...config, abortSignal: controller.signal },
        contents: request.messages.map((message) => ({
          parts: [{ text: message.text }],
          role: message.role === 'assistant' ? 'model' : 'user',
        })),
        model: TWINE_API_MODELS[request.modelId],
      });
      const parser = new TwineStreamParser(request.thinkingLevel === 'high');
      const sourceUrls = new Set<string>();
      let lastUsage: TwineGenerationUsage | undefined;

      for await (const chunk of stream) {
        if (controller.signal.aborted) {
          return;
        }

        lastUsage = usageFromChunk(chunk) ?? lastUsage;
        for (const candidate of chunk.candidates ?? []) {
          for (const part of candidate.content?.parts ?? []) {
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
