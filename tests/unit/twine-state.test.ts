import { describe, expect, it } from 'vitest';

import {
  createTwinePageState,
  migrateTwinePageState,
} from '../../src/renderer/twine';

describe('Twine page state', () => {
  it('creates the documented defaults', () => {
    expect(createTwinePageState()).toEqual({
      version: 1,
      data: {
        activeConversationId: null,
        modelId: 'google/gemma-4-31B-it',
        approvalMode: 'request',
        researchEnabled: false,
        thinkingLevel: 'high',
      },
    });
  });

  it('keeps valid settings and repairs invalid fields independently', () => {
    expect(
      migrateTwinePageState({
        version: 1,
        data: {
          activeConversationId: 'twine-conversation-1',
          modelId: 'google/gemma-4-26B-A4B-it',
          approvalMode: 'full',
          researchEnabled: true,
          thinkingLevel: 'high',
        },
      }),
    ).toEqual({
      version: 1,
      data: {
        activeConversationId: 'twine-conversation-1',
        modelId: 'google/gemma-4-26B-A4B-it',
        approvalMode: 'full',
        researchEnabled: true,
        thinkingLevel: 'high',
      },
    });

    expect(
      migrateTwinePageState({
        version: 1,
        data: {
          modelId: 'unknown',
          researchEnabled: 'yes',
          thinkingLevel: 'medium',
        },
      }),
    ).toEqual(createTwinePageState());
  });

  it('migrates the previous empty placeholder state', () => {
    expect(migrateTwinePageState({ version: 1, data: {} })).toEqual(
      createTwinePageState(),
    );
  });
});
