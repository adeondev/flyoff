// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDescriptor } from '../../src/renderer/components/tabs/tab-state';
import { TwinePage } from '../../src/renderer/pages/TwinePage';
import { resetTwineRuntimeForTests } from '../../src/renderer/twine/twine-runtime';
import {
  INTERNAL_PAGE_IDS,
  type FlyoffApi,
  type PageSessionState,
  type TwineGenerationEvent,
} from '../../src/shared/contracts';
import { enUS, type TranslationKey } from '../../src/shared/i18n';

function translate(key: TranslationKey): string {
  const [section, entry] = key.split('.') as [keyof typeof enUS, string];
  return (enUS[section] as unknown as Record<string, string>)[entry] ?? key;
}

function renderTwine(initialPageState?: PageSessionState) {
  const onStateChange = vi.fn();
  const descriptor = createDescriptor(
    { type: 'internal', pageId: INTERNAL_PAGE_IDS.twine },
    initialPageState,
  );
  const view = render(
    <TwinePage
      active
      descriptor={descriptor}
      onScrollChange={vi.fn()}
      onStateChange={onStateChange}
      title="Twine"
      translate={translate}
    />,
  );
  return { ...view, onStateChange };
}

afterEach(() => {
  resetTwineRuntimeForTests();
  Object.defineProperty(window, 'flyoff', {
    configurable: true,
    value: undefined,
  });
  cleanup();
});

function mockFlyoffApi(api: Partial<FlyoffApi>): void {
  Object.defineProperty(window, 'flyoff', {
    configurable: true,
    value: api,
  });
}

describe('Twine chat page', () => {
  it('loads the active persisted Twine conversation', async () => {
    const loadTwineConversation = vi.fn().mockResolvedValue({
      createdAt: 1,
      id: 'twine-conversation-1',
      nextId: 4,
      state: {
        activeBranchId: 'twine-root',
        branches: {
          'twine-root': {
            id: 'twine-root',
            messages: [
              {
                attachments: [],
                id: 'message-1',
                kind: 'user',
                status: 'complete',
                text: 'Persisted prompt',
              },
            ],
          },
        },
      },
      title: 'Persisted prompt',
      updatedAt: 2,
      version: 1,
    });
    mockFlyoffApi({
      createTwineConversation: vi.fn(),
      listTwineConversations: vi.fn().mockResolvedValue({
        activeConversationId: 'twine-conversation-1',
        conversations: [
          {
            createdAt: 1,
            id: 'twine-conversation-1',
            title: 'Persisted prompt',
            updatedAt: 2,
          },
        ],
        version: 1,
      }),
      loadTwineConversation,
      saveTwineConversation: vi.fn().mockResolvedValue({
        activeConversationId: 'twine-conversation-1',
        conversations: [],
        version: 1,
      }),
    });

    const { onStateChange } = renderTwine();

    expect(await screen.findByText('Persisted prompt')).toBeTruthy();
    expect(loadTwineConversation).toHaveBeenCalledWith('twine-conversation-1');
    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          activeConversationId: 'twine-conversation-1',
        }),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Conversation history' }));
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Persisted prompt' }),
    ).toBeTruthy();
  });

  it('selects models and restores the compact page settings', () => {
    const { container, onStateChange } = renderTwine({
      version: 1,
      data: {
        modelId: 'google/gemma-4-26B-A4B-it',
        approvalMode: 'request',
        researchEnabled: true,
        thinkingLevel: 'high',
      },
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Select model: Gemma 4 26B A4B IT',
      }),
    );
    expect(
      document.querySelectorAll('.flyoff-menu__item-image-icon'),
    ).toHaveLength(2);
    fireEvent.click(
      screen.getByRole('menuitemcheckbox', { name: /Gemma 4 31B IT/ }),
    );

    expect(
      screen.getByRole('button', {
        name: 'Select model: Gemma 4 31B IT',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Thinking level: High' }),
    ).toBeTruthy();
    expect(screen.queryByText('Gemma 4 12B IT')).toBeNull();
    expect(container.querySelector('.twine-model-selector img')).toBeTruthy();
    expect(onStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ modelId: 'google/gemma-4-31B-it' }),
      }),
    );
  });

  it('uses the Flyoff tools menu for thinking, research, files, and audio status', () => {
    const { container, onStateChange } = renderTwine();
    const tools = screen.getByRole('button', { name: 'Add and configure' });
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const clickFileInput = vi.spyOn(fileInput!, 'click');

    expect(
      screen.getByRole('button', { name: /Audio/ }).getAttribute('aria-disabled'),
    ).toBe('true');
    fireEvent.click(tools);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Attach file' }));
    expect(clickFileInput).toHaveBeenCalledOnce();

    fireEvent.click(
      screen.getByRole('button', { name: 'Thinking level: High' }),
    );
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'High' }).querySelector(
        '.home__icon',
      ),
    ).toBeNull();
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Low' }).querySelector(
        '.home__icon',
      ),
    ).toBeNull();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Low' }));
    expect(
      screen.getByRole('button', { name: 'Thinking level: Low' }),
    ).toBeTruthy();

    fireEvent.click(tools);
    fireEvent.click(
      screen.getByRole('menuitemcheckbox', { name: 'Research Mode' }),
    );
    fireEvent.click(tools);
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Research Mode' })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(onStateChange).toHaveBeenCalledTimes(2);
  });

  it('asks for the Gemini API key on first Twine open and saves it', async () => {
    const saveTwineApiKey = vi.fn().mockResolvedValue({
      encryptionAvailable: true,
      hasApiKey: true,
    });
    mockFlyoffApi({
      getTwineCredentialStatus: vi.fn().mockResolvedValue({
        encryptionAvailable: true,
        hasApiKey: false,
      }),
      openExternalLink: vi.fn().mockResolvedValue({ ok: true }),
      saveTwineApiKey,
    });

    renderTwine();

    const dialog = await screen.findByRole('dialog', {
      name: 'Connect Gemini',
    });
    fireEvent.change(
      within(dialog).getByLabelText('Gemini API key'),
      { target: { value: 'gemini-key' } },
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save key' }));

    await waitFor(() => expect(saveTwineApiKey).toHaveBeenCalledWith('gemini-key'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Connect Gemini' })).toBeNull(),
    );
  });

  it('sends text through the Twine bridge and streams the assistant response', async () => {
    let listener: ((event: TwineGenerationEvent) => void) | undefined;
    const startTwineGeneration = vi.fn().mockResolvedValue(undefined);
    mockFlyoffApi({
      cancelTwineGeneration: vi.fn().mockResolvedValue(undefined),
      getTwineCredentialStatus: vi.fn().mockResolvedValue({
        encryptionAvailable: true,
        hasApiKey: true,
      }),
      onTwineGenerationEvent: (nextListener) => {
        listener = nextListener;
        return vi.fn();
      },
      startTwineGeneration,
    });
    renderTwine();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Connect Gemini' })).toBeNull(),
    );

    const textbox = screen.getByRole('textbox', { name: 'Message Twine' });
    fireEvent.change(textbox, { target: { value: 'Oi Twine' } });
    fireEvent.keyDown(textbox, { key: 'Enter' });

    await waitFor(() => expect(startTwineGeneration).toHaveBeenCalledOnce());
    const request = startTwineGeneration.mock.calls[0]?.[0];
    expect(request).toEqual(
      expect.objectContaining({
        messages: [{ role: 'user', text: 'Oi Twine' }],
        modelId: 'google/gemma-4-31B-it',
        researchEnabled: false,
        thinkingLevel: 'high',
      }),
    );

    act(() => {
      listener?.({
        requestId: request.requestId,
        text: 'Olá, Gabriel.',
        type: 'text-delta',
      });
      listener?.({
        requestId: request.requestId,
        type: 'done',
      });
    });

    expect(screen.getByText('Oi Twine')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Olá, Gabriel.')).toBeTruthy());
  });

  it('switches approval mode from the composer dropdown', () => {
    const { onStateChange } = renderTwine();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Approval mode: Request approval',
      }),
    );
    const fullAccessItem = screen.getByRole('menuitemcheckbox', {
      name: 'Full access',
    });
    const fullAccessIcon = fullAccessItem
      .querySelector<HTMLElement>('.home__icon')
      ?.style.getPropertyValue('--home-icon');
    fireEvent.click(fullAccessItem);

    expect(
      screen.getByRole('button', { name: 'Approval mode: Full access' }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Approval mode: Full access' })
        .querySelector<HTMLElement>('.home__icon')?.style.getPropertyValue(
          '--home-icon',
        ),
    ).toBe(fullAccessIcon);
    expect(onStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ approvalMode: 'full' }),
      }),
    );
  });

  it('adds, previews, rejects duplicates, and removes attachments', async () => {
    const { container } = renderTwine();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const image = new File(['image'], 'diagram.png', {
      type: 'image/png',
      lastModified: 10,
    });

    fireEvent.change(input, { target: { files: [image] } });
    expect(screen.getByText('diagram.png')).toBeTruthy();
    await waitFor(() =>
      expect(container.querySelector('.twine-attachment__preview')).toBeTruthy(),
    );

    fireEvent.change(input, { target: { files: [image] } });
    expect(screen.getByText('This file has already been added.')).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove attachment: diagram.png' }),
    );
    expect(screen.queryByText('diagram.png')).toBeNull();
  });

  it('accepts drop and paste while enforcing size and count limits', () => {
    const { container } = renderTwine();
    const composer = container.querySelector<HTMLFormElement>('.twine-composer')!;
    const textbox = screen.getByRole('textbox', { name: 'Message Twine' });
    const dropped = new File(['drop'], 'drop.txt', { lastModified: 1 });
    const pasted = new File(['paste'], 'paste.txt', { lastModified: 2 });

    fireEvent.drop(composer, { dataTransfer: { files: [dropped] } });
    fireEvent.paste(textbox, { clipboardData: { files: [pasted] } });
    expect(screen.getByText('drop.txt')).toBeTruthy();
    expect(screen.getByText('paste.txt')).toBeTruthy();

    const oversized = new File([], 'large.bin');
    Object.defineProperty(oversized, 'size', { value: 100 * 1_024 * 1_024 + 1 });
    fireEvent.drop(composer, { dataTransfer: { files: [oversized] } });
    expect(screen.getByText('The file must be no larger than 100 MB.')).toBeTruthy();

    const remaining = Array.from({ length: 9 }, (_, index) =>
      new File([], `file-${index}.txt`, { lastModified: index + 20 }),
    );
    fireEvent.drop(composer, { dataTransfer: { files: remaining } });
    expect(screen.getByText('Add no more than 10 files.')).toBeTruthy();
    expect(container.querySelectorAll('.twine-attachment')).toHaveLength(10);
  });

  it('sends with Enter, preserves Shift+Enter, and never fabricates a response', () => {
    const { container } = renderTwine();
    const textbox = screen.getByRole('textbox', { name: 'Message Twine' });
    const send = screen.getByRole('button', { name: 'Send message' });

    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(textbox, { target: { value: 'First line' } });
    fireEvent.keyDown(textbox, { key: 'Enter', shiftKey: true });
    expect(screen.queryByText('The model is not connected yet.')).toBeNull();

    fireEvent.keyDown(textbox, { key: 'Enter' });
    expect(screen.getByText('First line')).toBeTruthy();
    expect(screen.getByText('The model is not connected yet.')).toBeTruthy();
    expect((textbox as HTMLTextAreaElement).value).toBe('');
    const userMessage = container.querySelector('.twine-message--user')!;
    expect(
      userMessage.querySelector('.twine-message__body')?.textContent,
    ).toContain('First line');
    expect(
      userMessage
        .querySelector('.twine-message__body')
        ?.querySelector('.twine-message__actions'),
    ).toBeNull();
    expect(userMessage.querySelector('.twine-message__footer')).toBeTruthy();
  });

  it('confirms destructive conversation reset and restores the empty state', async () => {
    renderTwine();
    const textbox = screen.getByRole('textbox', { name: 'Message Twine' });
    fireEvent.change(textbox, { target: { value: 'Keep this' } });
    fireEvent.keyDown(textbox, { key: 'Enter' });

    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    const dialog = screen.getByRole('dialog', { name: 'Start a new conversation?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Keep this')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Start new conversation',
      }),
    );
    await waitFor(() => expect(screen.queryByText('Keep this')).toBeNull());
    expect(screen.getByText('Twine')).toBeTruthy();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByText('Beta')).toBeNull();
  });

  it('renders user and assistant Markdown with a separate thought stream', async () => {
    let listener: ((event: TwineGenerationEvent) => void) | undefined;
    const startTwineGeneration = vi.fn().mockResolvedValue(undefined);
    mockFlyoffApi({
      cancelTwineGeneration: vi.fn().mockResolvedValue(undefined),
      getTwineCredentialStatus: vi.fn().mockResolvedValue({
        encryptionAvailable: true,
        hasApiKey: true,
      }),
      onTwineGenerationEvent: (nextListener) => {
        listener = nextListener;
        return vi.fn();
      },
      startTwineGeneration,
    });
    renderTwine();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Connect Gemini' })).toBeNull(),
    );

    const textbox = screen.getByRole('textbox', { name: 'Message Twine' });
    fireEvent.change(textbox, { target: { value: '**Hello** Twine' } });
    fireEvent.keyDown(textbox, { key: 'Enter' });
    await waitFor(() => expect(startTwineGeneration).toHaveBeenCalledOnce());
    const requestId = startTwineGeneration.mock.calls[0]?.[0].requestId;

    act(() => {
      listener?.({ requestId, text: 'Checking **facts**', type: 'thought-delta' });
      listener?.({ requestId, text: 'Final **answer**', type: 'text-delta' });
      listener?.({ requestId, type: 'done' });
    });

    await waitFor(() => expect(screen.getByText('answer').tagName).toBe('STRONG'));
    expect(screen.getByText('Hello').tagName).toBe('STRONG');
    expect(screen.getByText('facts').tagName).toBe('STRONG');
    expect(screen.getByText(/Thought for/)).toBeTruthy();
  });

  it('edits an earlier prompt as a navigable conversation variant', async () => {
    let listener: ((event: TwineGenerationEvent) => void) | undefined;
    const startTwineGeneration = vi.fn().mockResolvedValue(undefined);
    mockFlyoffApi({
      cancelTwineGeneration: vi.fn().mockResolvedValue(undefined),
      getTwineCredentialStatus: vi.fn().mockResolvedValue({
        encryptionAvailable: true,
        hasApiKey: true,
      }),
      onTwineGenerationEvent: (nextListener) => {
        listener = nextListener;
        return vi.fn();
      },
      startTwineGeneration,
    });
    renderTwine();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Connect Gemini' })).toBeNull(),
    );
    const textbox = screen.getByRole('textbox', { name: 'Message Twine' });
    fireEvent.change(textbox, { target: { value: 'Original prompt' } });
    fireEvent.keyDown(textbox, { key: 'Enter' });
    await waitFor(() => expect(startTwineGeneration).toHaveBeenCalledOnce());
    const firstRequestId = startTwineGeneration.mock.calls[0]?.[0].requestId;
    act(() => {
      listener?.({ requestId: firstRequestId, text: 'First answer', type: 'text-delta' });
      listener?.({ requestId: firstRequestId, type: 'done' });
    });
    await screen.findByText('First answer');

    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    const editor = screen.getByRole('textbox', { name: 'Edit message' });
    fireEvent.change(editor, { target: { value: 'Edited prompt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and send' }));

    await waitFor(() => expect(startTwineGeneration).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Edited prompt')).toBeTruthy();
    expect(screen.getByText('2/2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }));
    await waitFor(() => expect(screen.getByText('Original prompt')).toBeTruthy());
  });

  it('survives a pane remount and keeps receiving generation events', async () => {
    let listener: ((event: TwineGenerationEvent) => void) | undefined;
    const startTwineGeneration = vi.fn().mockResolvedValue(undefined);
    const getTwineCredentialStatus = vi.fn().mockResolvedValue({
      encryptionAvailable: true,
      hasApiKey: true,
    });
    const api: Partial<FlyoffApi> = {
      cancelTwineGeneration: vi.fn().mockResolvedValue(undefined),
      getTwineCredentialStatus,
      onTwineGenerationEvent: (nextListener) => {
        listener = nextListener;
        return vi.fn();
      },
      startTwineGeneration,
    };
    mockFlyoffApi(api);
    const firstMount = renderTwine();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Connect Gemini' })).toBeNull(),
    );
    const firstTextbox = screen.getByRole('textbox', { name: 'Message Twine' });
    fireEvent.change(firstTextbox, { target: { value: 'Draft across panes' } });
    firstMount.unmount();

    const secondMount = renderTwine();
    const restoredTextbox = screen.getByRole('textbox', { name: 'Message Twine' });
    expect((restoredTextbox as HTMLTextAreaElement).value).toBe(
      'Draft across panes',
    );
    await waitFor(() =>
      expect(getTwineCredentialStatus).toHaveBeenCalledTimes(2),
    );
    fireEvent.keyDown(restoredTextbox, { key: 'Enter' });
    await waitFor(() => expect(startTwineGeneration).toHaveBeenCalledOnce());
    const requestId = startTwineGeneration.mock.calls[0]?.[0].requestId;
    secondMount.unmount();

    act(() => {
      listener?.({ requestId, text: 'Continued while moving', type: 'text-delta' });
      listener?.({ requestId, type: 'done' });
    });
    renderTwine();

    await screen.findByText('Continued while moving');
    expect(screen.getByText('Draft across panes')).toBeTruthy();
    expect(api.cancelTwineGeneration).not.toHaveBeenCalled();
  });
});
