import { describe, expect, it } from 'vitest';

import {
  createTwineGenerateContentConfig,
  TWINE_SYSTEM_INSTRUCTION,
} from '../../src/main/twine';

const baseRequest = {
  approvalMode: 'request',
  messages: [{ role: 'user', text: 'Oi' }],
  modelId: 'google/gemma-4-31B-it',
  requestId: 'twine-request-1',
  researchEnabled: false,
  thinkingLevel: 'low',
} as const;

describe('Twine generation config', () => {
  it('builds the professional Twine system prompt and low thinking config', () => {
    const config = createTwineGenerateContentConfig(baseRequest);

    expect(config.systemInstruction).toBe(TWINE_SYSTEM_INSTRUCTION);
    expect(config.thinkingConfig.thinkingLevel).toBe('MINIMAL');
    expect(config.thinkingConfig.includeThoughts).toBe(false);
    expect(config.tools).toEqual([{ codeExecution: {} }]);
    expect(config.safetySettings).toContainEqual({
      category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
      threshold: 'BLOCK_MEDIUM_AND_ABOVE',
    });
  });

  it('enables high thinking and Google Search when research is active', () => {
    const config = createTwineGenerateContentConfig({
      ...baseRequest,
      researchEnabled: true,
      thinkingLevel: 'high',
    });

    expect(config.thinkingConfig.thinkingLevel).toBe('HIGH');
    expect(config.thinkingConfig.includeThoughts).toBe(true);
    expect(config.tools).toEqual([
      { googleSearch: {} },
      { codeExecution: {} },
    ]);
  });
});
