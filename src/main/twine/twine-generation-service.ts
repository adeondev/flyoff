import type { WebContents } from 'electron';

import type {
  TwineGenerationEvent,
  TwineGenerationRequest,
  TwineGenerationUsage,
  TwineIpcModelId,
} from '../../shared/contracts';
import {
  mergeTwineGenerationUsage,
  runTwineGenerationAttempt,
  type TwineGenAIClient,
  type TwineGenerateContentConfig,
} from './twine-generation-attempt';
import { createTwineSystemInstruction } from './twine-system-instruction';

const TWINE_API_MODELS: Record<TwineIpcModelId, string> = {
  'google/gemma-4-26B-A4B-it': 'gemma-4-26b-a4b-it',
  'google/gemma-4-31B-it': 'gemma-4-31b-it',
};

interface TwineGenerationConfigOptions {
  currentDate?: Date;
  researchRetry?: boolean;
}

export function createTwineGenerateContentConfig(
  request: TwineGenerationRequest,
  options: TwineGenerationConfigOptions = {},
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
    systemInstruction: createTwineSystemInstruction({
      currentDate: options.currentDate,
      researchEnabled: request.researchEnabled,
      researchRetry: options.researchRetry,
    }),
    thinkingConfig: {
      includeThoughts: highThinking,
      thinkingLevel: highThinking ? 'HIGH' : 'MINIMAL',
    },
    tools: [{ googleSearch: {} }, { codeExecution: {} }],
  };
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
      const currentDate = new Date();

      if (!request.researchEnabled) {
        const result = await runTwineGenerationAttempt({
          ai,
          config: createTwineGenerateContentConfig(request, { currentDate }),
          emit: (event) => this.emit(webContents, channel, event),
          model: TWINE_API_MODELS[request.modelId],
          request,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          this.emit(webContents, channel, {
            requestId: request.requestId,
            type: 'done',
            ...(result.usage ? { usage: result.usage } : {}),
          });
        }
        return;
      }

      let totalUsage: TwineGenerationUsage | undefined;
      for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
        const events: TwineGenerationEvent[] = [];
        const result = await runTwineGenerationAttempt({
          ai,
          config: createTwineGenerateContentConfig(request, {
            currentDate,
            researchRetry: attemptIndex > 0,
          }),
          emit: (event) => events.push(event),
          model: TWINE_API_MODELS[request.modelId],
          request,
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          return;
        }

        totalUsage = mergeTwineGenerationUsage(totalUsage, result.usage);
        if (result.hasSources) {
          for (const event of events) {
            this.emit(webContents, channel, event);
          }
          this.emit(webContents, channel, {
            requestId: request.requestId,
            type: 'done',
            ...(totalUsage ? { usage: totalUsage } : {}),
          });
          return;
        }
      }

      this.emit(webContents, channel, {
        message:
          'O Modo Pesquisa não conseguiu obter fontes verificáveis. Tente novamente ou revise a conexão com o Google Search.',
        requestId: request.requestId,
        type: 'error',
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
