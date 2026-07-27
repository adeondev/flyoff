import { createHash } from 'node:crypto';

export const TWINE_INPUT_TOKENS_PER_MINUTE = 240_000;
export const TWINE_CONTEXT_COMPACTION_THRESHOLD_TOKENS = 180_000;
export const TWINE_CONTEXT_MEMORY_TARGET_TOKENS = 25_000;
export const TWINE_CONTEXT_MEMORY_MAX_OUTPUT_TOKENS = 30_000;
export const TWINE_TOKEN_COUNT_RESERVE_TOKENS = 2_048;

const TWINE_RATE_LIMIT_WINDOW_MS = 60_000;

interface TokenUsage {
  timestamp: number;
  tokens: number;
}

export class TwineInputRateLimiter {
  private readonly usageByCredential = new Map<string, TokenUsage[]>();

  constructor(private readonly now: () => number = Date.now) {}

  consume(apiKey: string, tokens: number): boolean {
    if (!Number.isInteger(tokens) || tokens < 0) {
      return false;
    }
    const credential = createHash('sha256').update(apiKey).digest('hex');
    const timestamp = this.now();
    const active = (this.usageByCredential.get(credential) ?? []).filter(
      (usage) => timestamp - usage.timestamp < TWINE_RATE_LIMIT_WINDOW_MS,
    );
    const used = active.reduce((total, usage) => total + usage.tokens, 0);
    if (tokens > TWINE_INPUT_TOKENS_PER_MINUTE - used) {
      this.usageByCredential.set(credential, active);
      return false;
    }
    active.push({ timestamp, tokens });
    this.usageByCredential.set(credential, active);
    return true;
  }
}
