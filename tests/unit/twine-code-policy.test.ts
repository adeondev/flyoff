import { describe, expect, it } from 'vitest';

import type { TwineGenerationRequest } from '../../src/shared/contracts';
import { shouldRequireTwineCodeExecution } from '../../src/main/twine';

function requestFor(text: string): TwineGenerationRequest {
  return {
    approvalMode: 'request',
    messages: [{ role: 'user', text }],
    modelId: 'google/gemma-4-31B-it',
    requestId: 'twine-code-policy',
    researchEnabled: false,
    thinkingLevel: 'low',
  };
}

describe('Twine automatic code execution policy', () => {
  it.each([
    'Calcule 12345 * 67890 e confira com código.',
    'Execute testes nesse código Python.',
    'Use code to count the characters in this text.',
    `quantos R existem aqui? "${'R'.repeat(120)}"`,
    'Implemente uma função Python para detectar ciclos e execute três testes.',
    'Calcule a soma dos inteiros de 1 a 100000 divisíveis por 7.',
  ])('requires code execution for %s', (text) => {
    expect(shouldRequireTwineCodeExecution(requestFor(text))).toBe(true);
  });

  it.each([
    'quanto é 2 + 2?',
    'escreva um exemplo curto em Python',
    'explique o que é DFS',
    'revise este código sem executá-lo',
    'vlw',
  ])('does not require code execution for %s', (text) => {
    expect(shouldRequireTwineCodeExecution(requestFor(text))).toBe(false);
  });
});
