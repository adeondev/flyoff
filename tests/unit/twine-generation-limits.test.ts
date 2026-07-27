import { describe, expect, it } from 'vitest';

import {
  TWINE_INPUT_TOKENS_PER_MINUTE,
  TwineInputRateLimiter,
} from '../../src/main/twine';

describe('Twine input rate limiter', () => {
  it('enforces a rolling token window independently per credential', () => {
    let now = 0;
    const limiter = new TwineInputRateLimiter(() => now);

    expect(limiter.consume('first-key', 200_000)).toBe(true);
    expect(limiter.consume('first-key', 40_000)).toBe(true);
    expect(limiter.consume('first-key', 1)).toBe(false);
    expect(
      limiter.consume('second-key', TWINE_INPUT_TOKENS_PER_MINUTE),
    ).toBe(true);

    now = 59_999;
    expect(limiter.consume('first-key', 1)).toBe(false);
    now = 60_000;
    expect(
      limiter.consume('first-key', TWINE_INPUT_TOKENS_PER_MINUTE),
    ).toBe(true);
  });

  it('rejects invalid reservations and requests larger than the limit', () => {
    const limiter = new TwineInputRateLimiter(() => 0);

    expect(limiter.consume('key', -1)).toBe(false);
    expect(limiter.consume('key', 1.5)).toBe(false);
    expect(
      limiter.consume('key', TWINE_INPUT_TOKENS_PER_MINUTE + 1),
    ).toBe(false);
  });
});
