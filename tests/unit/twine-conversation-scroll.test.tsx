// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TwineConversation } from '../../src/renderer/twine/TwineConversation';
import type { TwineMessage } from '../../src/renderer/twine/twine-types';
import type { TranslationKey } from '../../src/shared/i18n';

const messages: readonly TwineMessage[] = [
  {
    attachments: [],
    id: 'message-1',
    kind: 'user',
    status: 'complete',
    text: 'Question',
  },
  {
    attachments: [],
    id: 'message-2',
    kind: 'assistant',
    status: 'complete',
    text: 'Answer',
  },
];

describe('Twine conversation scrolling', () => {
  it('pauses follow mode on manual upward scrolling and resumes on demand', () => {
    const onScrollStateChange = vi.fn();
    const { container } = render(
      <TwineConversation
        active
        conversationId="twine-conversation-1"
        messages={messages}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onRegenerate={vi.fn()}
        onRewind={vi.fn()}
        onScrollStateChange={onScrollStateChange}
        onVariantChange={vi.fn()}
        translate={(key: TranslationKey) => key}
      />,
    );
    const scroller = container.querySelector<HTMLElement>('.twine-messages')!;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1000 },
    });
    scroller.scrollTop = 800;

    fireEvent.wheel(scroller, { deltaY: -120 });
    scroller.scrollTop = 420;
    fireEvent.scroll(scroller);

    const jump = screen.getByRole('button', { name: 'twine.jumpToLatest' });
    expect(onScrollStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ follow: false, scrollTop: 420 }),
    );
    fireEvent.click(jump);

    expect(scroller.scrollTop).toBe(1000);
    expect(
      screen.queryByRole('button', { name: 'twine.jumpToLatest' }),
    ).toBeNull();
  });
});
