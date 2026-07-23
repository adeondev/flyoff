// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  afterEach(() => {
    Object.defineProperty(window, 'flyoff', {
      configurable: true,
      value: undefined,
    });
  });

  it('pauses follow mode on manual upward scrolling and resumes on demand', () => {
    const onScrollStateChange = vi.fn();
    const { container } = render(
      <TwineConversation
        active
        conversationId="twine-conversation-1"
        conversationTitle="Conversation"
        messages={messages}
        onDelete={vi.fn()}
        onEditRequest={vi.fn()}
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

    expect(scroller.scrollTop).toBe(800);
    expect(
      screen.queryByRole('button', { name: 'twine.jumpToLatest' }),
    ).toBeNull();
  });

  it('does not restore stale scroll during rerenders and follows a replacement generation', async () => {
    const sharedProps = {
      active: true,
      conversationId: 'twine-conversation-1',
      conversationTitle: 'Conversation',
      onDelete: vi.fn(),
      onEditRequest: vi.fn(),
      onRegenerate: vi.fn(),
      onRewind: vi.fn(),
      onScrollStateChange: vi.fn(),
      onVariantChange: vi.fn(),
      translate: (key: TranslationKey) => key,
    };
    const view = render(
      <TwineConversation
        {...sharedProps}
        initialScrollState={{ follow: false, scrollTop: 420 }}
        messages={messages}
      />,
    );
    const scroller = view.container.querySelector<HTMLElement>(
      '.twine-messages',
    )!;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1000 },
    });
    scroller.scrollTop = 420;

    view.rerender(
      <TwineConversation
        {...sharedProps}
        initialScrollState={{ follow: false, scrollTop: 120 }}
        messages={messages}
      />,
    );
    expect(scroller.scrollTop).toBe(420);

    view.rerender(
      <TwineConversation
        {...sharedProps}
        initialScrollState={{ follow: false, scrollTop: 120 }}
        messages={[
          messages[0]!,
          {
            ...messages[1]!,
            status: 'streaming',
            streamRequestId: 'request-after-edit',
            text: '',
          },
        ]}
      />,
    );

    await waitFor(() => expect(scroller.scrollTop).toBe(800));
    expect(sharedProps.onScrollStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ follow: true, scrollTop: 800 }),
    );
    expect(
      screen.queryByRole('button', { name: 'twine.jumpToLatest' }),
    ).toBeNull();
  });

  it('restores a paused conversation after visiting an empty conversation', () => {
    const sharedProps = {
      active: true,
      conversationTitle: 'Conversation',
      onDelete: vi.fn(),
      onEditRequest: vi.fn(),
      onRegenerate: vi.fn(),
      onRewind: vi.fn(),
      onScrollStateChange: vi.fn(),
      onVariantChange: vi.fn(),
      translate: (key: TranslationKey) => key,
    };
    const view = render(
      <TwineConversation
        {...sharedProps}
        conversationId="conversation-a"
        initialScrollState={{ follow: false, scrollTop: 420 }}
        messages={messages}
      />,
    );

    view.rerender(
      <TwineConversation
        {...sharedProps}
        conversationId="conversation-b"
        initialScrollState={{ follow: true, scrollTop: 0 }}
        messages={[]}
      />,
    );
    expect(view.container.querySelector('.twine-messages')).toBeNull();

    view.rerender(
      <TwineConversation
        {...sharedProps}
        conversationId="conversation-a"
        initialScrollState={{ follow: false, scrollTop: 420 }}
        messages={messages}
      />,
    );
    expect(
      view.container.querySelector<HTMLElement>('.twine-messages')?.scrollTop,
    ).toBe(420);
  });

  it('orders assistant controls and exposes copy and sharing actions', async () => {
    const copyTwineContent = vi.fn().mockResolvedValue({ status: 'success' });
    const exportTwineMarkdown = vi.fn().mockResolvedValue({ status: 'success' });
    Object.defineProperty(window, 'flyoff', {
      configurable: true,
      value: { copyTwineContent, exportTwineMarkdown },
    });
    const { container } = render(
      <TwineConversation
        active
        conversationId="twine-conversation-1"
        conversationTitle="Conversation"
        messages={messages}
        onDelete={vi.fn()}
        onEditRequest={vi.fn()}
        onRegenerate={vi.fn()}
        onRewind={vi.fn()}
        onScrollStateChange={vi.fn()}
        onVariantChange={vi.fn()}
        translate={(key: TranslationKey) => key}
        variant={{ anchorMessageId: 'message-2', index: 1, total: 2 }}
      />,
    );
    const assistant = container.querySelector('.twine-message--assistant')!;
    expect(
      within(assistant)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'twine.previousVersion',
      'twine.nextVersion',
      'twine.rewindHere',
      'twine.regenerate',
      'twine.copyResponse',
      'twine.shareResponse',
      'twine.deleteMessage',
    ]);

    fireEvent.click(within(assistant).getByRole('button', { name: 'twine.copyResponse' }));
    await waitFor(() =>
      expect(copyTwineContent).toHaveBeenCalledWith({
        content: 'Answer',
        format: 'markdown',
      }),
    );

    fireEvent.click(within(assistant).getByRole('button', { name: 'twine.shareResponse' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'twine.copyText' }));
    await waitFor(() =>
      expect(copyTwineContent).toHaveBeenLastCalledWith({
        content: 'Answer',
        format: 'text',
      }),
    );

    fireEvent.click(within(assistant).getByRole('button', { name: 'twine.shareResponse' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'twine.saveMarkdown' }));
    await waitFor(() =>
      expect(exportTwineMarkdown).toHaveBeenCalledWith({
        content: 'Answer',
        suggestedName: 'Conversation',
      }),
    );
  });
});
