import type {
  TwineGenerationEvent,
  TwineGenerationRequest,
  TwineGenerationUsage,
  TwineSource,
} from '../../shared/contracts';
import { TwineStreamParser } from './twine-stream-parser';

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

export interface TwineGenAIClient {
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

interface TwineGenerationAttempt {
  hasSources: boolean;
  usage?: TwineGenerationUsage;
}

interface TwineGenerationAttemptOptions {
  ai: TwineGenAIClient;
  config: TwineGenerateContentConfig;
  emit: (event: TwineGenerationEvent) => void;
  model: string;
  request: TwineGenerationRequest;
  signal: AbortSignal;
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
      if (uri?.trim()) {
        sources.push({ title: title?.trim() || uri, url: uri });
      }
    }
  }
  return sources;
}

export function mergeTwineGenerationUsage(
  current: TwineGenerationUsage | undefined,
  next: TwineGenerationUsage | undefined,
): TwineGenerationUsage | undefined {
  if (!current) {
    return next;
  }
  if (!next) {
    return current;
  }

  const result: TwineGenerationUsage = {};
  for (const key of [
    'inputTokens',
    'outputTokens',
    'thoughtTokens',
    'totalTokens',
  ] as const) {
    if (current[key] !== undefined || next[key] !== undefined) {
      result[key] = (current[key] ?? 0) + (next[key] ?? 0);
    }
  }
  return result;
}

export async function runTwineGenerationAttempt({
  ai,
  config,
  emit,
  model,
  request,
  signal,
}: TwineGenerationAttemptOptions): Promise<TwineGenerationAttempt> {
  const stream = await ai.models.generateContentStream({
    config: { ...config, abortSignal: signal },
    contents: request.messages.map((message) => ({
      parts: [{ text: message.text }],
      role: message.role === 'assistant' ? 'model' : 'user',
    })),
    model,
  });
  const parser = new TwineStreamParser(request.thinkingLevel === 'high');
  const sourceUrls = new Set<string>();
  let lastUsage: TwineGenerationUsage | undefined;

  for await (const chunk of stream) {
    if (signal.aborted) {
      return { hasSources: false, usage: lastUsage };
    }

    lastUsage = usageFromChunk(chunk) ?? lastUsage;
    for (const candidate of chunk.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if (part.text) {
          if (part.thought) {
            if (request.thinkingLevel === 'high') {
              emit({
                requestId: request.requestId,
                text: part.text,
                type: 'thought-delta',
              });
            }
          } else {
            for (const delta of parser.push(part.text)) {
              emit({
                requestId: request.requestId,
                ...delta,
              });
            }
          }
        }
        if (part.executableCode?.code) {
          emit({
            phase: 'start',
            requestId: request.requestId,
            text: `${part.executableCode.language ?? ''}\n${part.executableCode.code}`.trim(),
            tool: 'code',
            type: 'tool',
          });
        }
        if (part.codeExecutionResult?.output) {
          emit({
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
      emit({
        phase: 'result',
        requestId: request.requestId,
        text: '',
        tool: 'search',
        type: 'tool',
      });
      emit({
        requestId: request.requestId,
        sources,
        type: 'sources',
      });
    }
  }

  for (const delta of parser.flush()) {
    emit({
      requestId: request.requestId,
      ...delta,
    });
  }

  return {
    hasSources: sourceUrls.size > 0,
    usage: lastUsage,
  };
}
