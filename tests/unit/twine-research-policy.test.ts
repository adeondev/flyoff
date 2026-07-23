import { describe, expect, it } from 'vitest';

import type { TwineGenerationRequest } from '../../src/shared/contracts';
import { shouldRequireTwineResearch } from '../../src/main/twine';

const currentDate = new Date('2026-07-23T00:00:00.000Z');

function requestFor(text: string): TwineGenerationRequest {
  return {
    approvalMode: 'request',
    messages: [{ role: 'user', text }],
    modelId: 'google/gemma-4-31B-it',
    requestId: 'twine-research-policy',
    researchEnabled: false,
    thinkingLevel: 'low',
  };
}

describe('Twine automatic research policy', () => {
  it.each([
    'quem ganhou a copa de 26?',
    'qual modelo do chatgpt mais recente?',
    'pesquisa pqp',
    'busque isso na internet',
    'quem é o presidente do Brasil?',
    'qual o preço do bitcoin agora?',
    'what is the latest OpenAI model?',
    '¿cuál es el modelo actual de Gemini?',
  ])('requires research for %s', (text) => {
    expect(shouldRequireTwineResearch(requestFor(text), currentDate)).toBe(true);
  });

  it.each([
    'vlw',
    'oi, tudo bem?',
    'escreva uma história que se passa em 2026',
    'quem ganhou a copa de 2018?',
    'quanto é 2 + 2?',
    'explique fotossíntese',
    'revise este texto para mim',
  ])('does not require research for %s', (text) => {
    expect(shouldRequireTwineResearch(requestFor(text), currentDate)).toBe(
      false,
    );
  });

  it('uses the most recent user message in a conversation', () => {
    const request = requestFor('qual o modelo atual do ChatGPT?');
    request.messages = [
      { role: 'user', text: 'qual o modelo atual do ChatGPT?' },
      { role: 'assistant', text: 'Vou verificar.' },
      { role: 'user', text: 'vlw' },
    ];

    expect(shouldRequireTwineResearch(request, currentDate)).toBe(false);
  });
});
