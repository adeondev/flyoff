import type { WebContents } from 'electron';

import type {
  TwineGenerationEvent,
  TwineGenerationRequest,
  TwineGenerationUsage,
  TwineIpcModelId,
} from '../../shared/contracts';
import { shouldRequireTwineCodeExecution } from './twine-code-policy';
import { compactTwineContext } from './twine-context-compactor';
import {
  countTwineGenerationInputTokens,
  mergeTwineGenerationUsage,
  runTwineGenerationAttempt,
  type TwineGenAIClient,
  type TwineGenerateContentConfig,
} from './twine-generation-attempt';
import { classifyTwineGenerationError } from './twine-generation-error';
import {
  TWINE_CONTEXT_COMPACTION_THRESHOLD_TOKENS,
  TwineInputRateLimiter,
} from './twine-generation-limits';
import { shouldRequireTwineResearch } from './twine-research-policy';
import {
  createTwineRuntimeToolInstruction,
  createTwineSystemInstruction,
} from './twine-system-instruction';

const TWINE_API_MODELS: Record<TwineIpcModelId, string> = {
  'google/gemma-4-26B-A4B-it': 'gemma-4-26b-a4b-it',
  'google/gemma-4-31B-it': 'gemma-4-31b-it',
};

interface TwineGenerationConfigOptions {
  codeRequired?: boolean;
  codeRetry?: boolean;
  currentDate?: Date;
  researchRequired?: boolean;
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
      codeRequired: options.codeRequired,
      codeRetry: options.codeRetry,
      currentDate: options.currentDate,
      researchEnabled: request.researchEnabled,
      researchRequired: options.researchRequired,
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

  constructor(
    private readonly inputRateLimiter = new TwineInputRateLimiter(),
  ) {}

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

  private reserveInputTokens(apiKey: string, tokens: number): void {
    if (!this.inputRateLimiter.consume(apiKey, tokens)) {
      throw new Error('Twine input token rate limit exceeded.');
    }
  }

  private async run(
    request: TwineGenerationRequest,
    apiKey: string,
    webContents: WebContents,
    channel: string,
    controller: AbortController,
  ): Promise<void> {
    const currentDate = new Date();
    const codeRequired = shouldRequireTwineCodeExecution(request);
    const researchRequired =
      request.researchEnabled ||
      shouldRequireTwineResearch(request, currentDate);
    this.emit(webContents, channel, {
      activity: researchRequired ? 'searching' : 'thinking',
      requestId: request.requestId,
      type: 'started',
    });

    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey }) as TwineGenAIClient;
      const model = TWINE_API_MODELS[request.modelId];
      const firstConfig = createTwineGenerateContentConfig(request, {
        codeRequired,
        currentDate,
        researchRequired,
      });
      const firstRuntimeInstruction =
        codeRequired || researchRequired
          ? createTwineRuntimeToolInstruction({
              codeRequired,
              researchRequired,
              retry: false,
            })
          : undefined;
      let effectiveRequest = request;
      let firstInputTokens = await countTwineGenerationInputTokens(
        ai,
        firstConfig,
        model,
        effectiveRequest,
        firstRuntimeInstruction,
        false,
        controller.signal,
      );
      if (controller.signal.aborted) {
        return;
      }
      if (
        firstInputTokens >= TWINE_CONTEXT_COMPACTION_THRESHOLD_TOKENS
      ) {
        const compaction = await compactTwineContext(
          ai,
          model,
          effectiveRequest,
          controller.signal,
          (tokens) => this.reserveInputTokens(apiKey, tokens),
        );
        if (controller.signal.aborted) {
          return;
        }
        if (compaction) {
          effectiveRequest = compaction.request;
          this.emit(webContents, channel, {
            memory: compaction.memory,
            requestId: request.requestId,
            type: 'memory',
          });
          firstInputTokens = await countTwineGenerationInputTokens(
            ai,
            firstConfig,
            model,
            effectiveRequest,
            firstRuntimeInstruction,
            false,
            controller.signal,
          );
          if (controller.signal.aborted) {
            return;
          }
        }
      }
      this.reserveInputTokens(apiKey, firstInputTokens);

      if (!codeRequired && !researchRequired) {
        const result = await runTwineGenerationAttempt({
          ai,
          config: firstConfig,
          emit: (event) => this.emit(webContents, channel, event),
          model,
          request: effectiveRequest,
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
        const retry = attemptIndex > 0;
        const config = retry
          ? createTwineGenerateContentConfig(effectiveRequest, {
              codeRequired,
              codeRetry: codeRequired,
              currentDate,
              researchRequired,
              researchRetry: researchRequired,
            })
          : firstConfig;
        const runtimeInstruction = createTwineRuntimeToolInstruction({
          codeRequired,
          researchRequired,
          retry,
        });
        if (retry) {
          const inputTokens = await countTwineGenerationInputTokens(
            ai,
            config,
            model,
            effectiveRequest,
            runtimeInstruction,
            true,
            controller.signal,
          );
          if (controller.signal.aborted) {
            return;
          }
          this.reserveInputTokens(apiKey, inputTokens);
        }
        const result = await runTwineGenerationAttempt({
          ai,
          config,
          emit: (event) => events.push(event),
          model,
          protectRuntimeRequirements: retry,
          request: effectiveRequest,
          runtimeInstruction,
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          return;
        }

        totalUsage = mergeTwineGenerationUsage(totalUsage, result.usage);
        if (
          (!codeRequired || result.hasCodeExecution) &&
          (!researchRequired || result.hasSearchExecution)
        ) {
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
        code: 'tool-requirements',
        requestId: request.requestId,
        type: 'error',
      });
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      this.emit(webContents, channel, {
        code: classifyTwineGenerationError(error),
        requestId: request.requestId,
        type: 'error',
      });
    }
  }
}
