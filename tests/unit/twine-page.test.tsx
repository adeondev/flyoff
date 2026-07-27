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
  vi.unstubAllGlobals();
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
      activityAt: 2,
      archivedAt: null,
      createdAt: 1,
      id: 'twine-conversation-1',
      nextId: 4,
      pinnedAt: null,
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
              {
                attachments: [],
                id: 'message-2',
                kind: 'assistant',
                status: 'complete',
                text: 'Persisted answer',
              },
            ],
          },
        },
      },
      title: 'Persisted prompt',
      titleMode: 'automatic',
      version: 2,
    });
    mockFlyoffApi({
      createTwineConversation: vi.fn(),
      listTwineConversations: vi.fn().mockResolvedValue({
        activeConversationId: 'twine-conversation-1',
        conversations: [
          {
            activityAt: 2,
            archivedAt: null,
            createdAt: 1,
            id: 'twine-conversation-1',
            pinnedAt: null,
            title: 'Persisted prompt',
            titleMode: 'automatic',
          },
        ],
        version: 2,
      }),
      loadTwineConversation,
      saveTwineConversation: vi.fn().mockResolvedValue({
        activeConversationId: 'twine-conversation-1',
        conversations: [],
        version: 2,
      }),
      queryTwineConversations: vi.fn().mockResolvedValue({
        conversations: [
          {
            activityAt: 2,
            archivedAt: null,
            createdAt: 1,
            id: 'twine-conversation-1',
            pinnedAt: null,
            title: 'Persisted prompt',
            titleMode: 'automatic',
          },
        ],
        version: 2,
      }),
    });

    const { onStateChange } = renderTwine();

    expect(await screen.findByText('Persisted prompt')).toBeTruthy();
    expect(screen.getByText('Persisted answer')).toBeTruthy();
    expect(screen.getByText('Twine')).toBeTruthy();
    expect(screen.queryByText('Thinking…')).toBeNull();
    expect(loadTwineConversation).toHaveBeenCalledWith('twine-conversation-1');
    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          activeConversationId: 'twine-conversation-1',
        }),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    const history = await screen.findByRole('dialog', { name: 'History' });
    expect(
      history
        .querySelector('.twine-history__open')
        ?.getAttribute('aria-current'),
    ).toBe('page');
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
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(
      screen.getByRole('button', {
        name: 'Select model: Gemma 4 31B IT',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Thinking level: High' }),
    ).toBeTruthy();
  });

  it('opens history as a modal without changing the chat layout', async () => {
    const queryTwineConversations = vi.fn().mockResolvedValue({
      conversations: [],
      version: 2,
    });
    mockFlyoffApi({ queryTwineConversations });
    const { container } = renderTwine();
    const trigger = screen.getByRole('button', { name: 'History' });

    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'History' });
    const search = within(dialog).getByRole('searchbox', {
      name: 'Search conversations',
    });
    expect(search).toBeTruthy();
    expect(dialog.querySelector('.sr-only')).toBeNull();
    expect(container.querySelector('.twine-page__workspace')).toBeTruthy();
    expect(container.querySelector('.twine-page__layout')).toBeNull();
    await waitFor(() => expect(queryTwineConversations).toHaveBeenCalled());

    fireEvent.click(dialog.querySelectorAll('.twine-history__select')[0]!);
    const activeFilter = await screen.findByRole('menuitemcheckbox', {
      name: 'Active',
    });
    fireEvent.keyDown(activeFilter, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(screen.getByRole('dialog', { name: 'History' })).toBeTruthy();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const composer = screen.getByRole('textbox', { name: 'Message Twine' });
    await waitFor(() => expect(document.activeElement).toBe(composer));
    expect(document.activeElement).not.toBe(trigger);

    fireEvent.click(trigger);
    const reopenedDialog = await screen.findByRole('dialog', {
      name: 'History',
    });
    const backdrop = reopenedDialog.closest('.flyoff-dialog__backdrop');
    expect(backdrop).toBeTruthy();
    fireEvent.pointerDown(backdrop!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(composer));
  });

  it('searches and manages conversations from the history window', async () => {
    const entry = {
      activityAt: Date.now(),
      archivedAt: null,
      createdAt: Date.now() - 1_000,
      id: 'twine-conversation-history',
      matchSnippet: 'Conteúdo encontrado na conversa',
      pinnedAt: null,
      title: 'Planejamento',
      titleMode: 'automatic' as const,
    };
    const queryTwineConversations = vi.fn().mockResolvedValue({
      conversations: [entry],
      version: 2,
    });
    const updateTwineConversation = vi.fn().mockResolvedValue({
      activeConversationId: entry.id,
      conversations: [{ ...entry, matchSnippet: undefined }],
      version: 2,
    });
    mockFlyoffApi({ queryTwineConversations, updateTwineConversation });
    renderTwine();
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    const dialog = await screen.findByRole('dialog', { name: 'History' });
    const search = within(dialog).getByRole('searchbox');

    fireEvent.change(search, { target: { value: 'conteudo' } });
    await waitFor(() =>
      expect(queryTwineConversations).toHaveBeenLastCalledWith({
        filter: 'all',
        query: 'conteudo',
        sort: 'recent',
      }),
    );
    expect(within(dialog).getByText(entry.matchSnippet)).toBeTruthy();

    fireEvent.click(
      within(dialog).getByRole('button', {
        name: 'Conversation actions: Planejamento',
      }),
    );
    expect(screen.getByRole('menu').classList.contains('flyoff-menu--modal')).toBe(
      true,
    );
    expect(screen.getAllByRole('menuitem').every((item) =>
      Boolean(item.querySelector('.flyoff-menu__leading-icon')),
    )).toBe(true);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename conversation' }));
    let rename = within(dialog).getByDisplayValue('Planejamento');
    fireEvent.keyDown(rename, { key: 'Escape' });
    expect(within(dialog).queryByDisplayValue('Planejamento')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'History' })).toBeTruthy();

    fireEvent.click(
      within(dialog).getByRole('button', {
        name: 'Conversation actions: Planejamento',
      }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename conversation' }));
    expect(within(dialog).getByDisplayValue('Planejamento')).toBeTruthy();
    fireEvent.pointerDown(search);
    expect(within(dialog).queryByDisplayValue('Planejamento')).toBeNull();

    fireEvent.click(
      within(dialog).getByRole('button', {
        name: 'Conversation actions: Planejamento',
      }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename conversation' }));
    rename = within(dialog).getByDisplayValue('Planejamento');
    fireEvent.change(rename, { target: { value: 'Projeto principal' } });
    fireEvent.submit(rename.closest('form')!);
    await waitFor(() =>
      expect(updateTwineConversation).toHaveBeenCalledWith({
        id: entry.id,
        title: 'Projeto principal',
        type: 'rename',
      }),
    );
  });

  it('uses the Flyoff tools menu for thinking, research, files, and audio status', () => {
    const { container, onStateChange } = renderTwine();
    const tools = screen.getByRole('button', { name: 'Add and configure' });
    const composer = container.querySelector('.twine-composer')!;
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const clickFileInput = vi.spyOn(fileInput!, 'click');

    expect(
      screen.getByRole('button', { name: /Audio/ }).getAttribute('aria-disabled'),
    ).toBe('true');
    expect(composer.getAttribute('data-thinking-level')).toBe('low');
    fireEvent.click(tools);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Attach file' }));
    expect(clickFileInput).toHaveBeenCalledOnce();

    fireEvent.click(
      screen.getByRole('button', { name: 'Thinking level: Low' }),
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
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'High' }));
    expect(
      screen.getByRole('button', { name: 'Thinking level: High' }),
    ).toBeTruthy();
    expect(composer.getAttribute('data-thinking-level')).toBe('high');

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
    const firstView = renderTwine();
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
        messages: [
          { id: expect.any(String), role: 'user', text: 'Oi Twine' },
        ],
        modelId: 'google/gemma-4-26B-A4B-it',
        researchEnabled: false,
        thinkingLevel: 'low',
      }),
    );
    const assistantMessage = document.querySelector<HTMLElement>(
      '.twine-message--assistant',
    )!;
    expect(within(assistantMessage).getByText('Twine')).toBeTruthy();
    expect(within(assistantMessage).getByText('Thinking…')).toBeTruthy();
    expect(
      assistantMessage.querySelector('.twine-message__identity img'),
    ).toBeTruthy();
    expect(
      assistantMessage.querySelector('.twine-message__stream-caret'),
    ).toBeNull();
    expect(
      assistantMessage.querySelector(
        ".twine-thinking-indicator[data-activity='thinking']",
      ),
    ).toBeTruthy();
    expect(
      firstView.container
        .querySelector('.twine-composer')
        ?.getAttribute('data-generating'),
    ).toBe('true');

    act(() => {
      listener?.({
        phase: 'start',
        requestId: request.requestId,
        text: 'print("hello")',
        tool: 'code',
        type: 'tool',
      });
    });
    expect(within(assistantMessage).getByText('Thinking…')).toBeTruthy();

    act(() => {
      listener?.({
        activity: 'searching',
        requestId: request.requestId,
        type: 'started',
      });
    });
    expect(within(assistantMessage).getByText('Searching…')).toBeTruthy();
    expect(
      assistantMessage.querySelector(
        ".twine-thinking-indicator[data-activity='searching']",
      ),
    ).toBeTruthy();

    act(() => {
      listener?.({
        requestId: request.requestId,
        sources: [{ title: 'Gemini source', url: 'https://example.com/source' }],
        type: 'sources',
      });
    });
    expect(screen.queryByRole('button', { name: 'Gemini source' })).toBeNull();

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
    expect(within(assistantMessage).queryByText('Searching…')).toBeNull();
    expect(
      assistantMessage.querySelector('.twine-thinking-indicator'),
    ).toBeNull();
    expect(within(assistantMessage).getByText('Twine')).toBeTruthy();
    const source = await screen.findByRole('button', { name: 'Gemini source' });
    expect(
      source
        .closest('.twine-message__sources')
        ?.getAttribute('data-animate'),
    ).toBe('true');
    expect(
      firstView.container
        .querySelector('.twine-composer')
        ?.hasAttribute('data-generating'),
    ).toBe(false);

    firstView.unmount();
    const restoredView = renderTwine();
    await screen.findByRole('button', { name: 'Gemini source' });
    expect(
      restoredView.container
        .querySelector('.twine-message__sources')
        ?.hasAttribute('data-animate'),
    ).toBe(false);
  });

  it('caps user messages at 4,000 Unicode characters', async () => {
    mockFlyoffApi({
      getTwineCredentialStatus: vi.fn().mockResolvedValue({
        encryptionAvailable: true,
        hasApiKey: true,
      }),
    });
    renderTwine();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Connect Gemini' })).toBeNull(),
    );

    const textbox = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Message Twine',
    });
    fireEvent.change(textbox, { target: { value: '😀'.repeat(4_001) } });

    expect(Array.from(textbox.value)).toHaveLength(4_000);
    expect(
      screen.getByText(
        'Each message can contain no more than 4,000 characters.',
      ),
    ).toBeTruthy();
  });

  it('shows a localized message instead of a raw provider error', async () => {
    let listener: ((event: TwineGenerationEvent) => void) | undefined;
    const startTwineGeneration = vi.fn().mockResolvedValue(undefined);
    mockFlyoffApi({
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
    fireEvent.change(textbox, { target: { value: 'Tell me about space.' } });
    fireEvent.keyDown(textbox, { key: 'Enter' });
    await waitFor(() => expect(startTwineGeneration).toHaveBeenCalledOnce());
    const request = startTwineGeneration.mock.calls[0]?.[0];

    act(() => {
      listener?.({
        code: 'overloaded',
        requestId: request.requestId,
        type: 'error',
      });
    });

    expect(
      await screen.findByText(
        'Gemini is temporarily overloaded. Try again in a moment.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/UNAVAILABLE|503|high demand/)).toBeNull();
  });

  it('switches approval mode from the composer dropdown', () => {
    const { onStateChange } = renderTwine();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Approval mode: Request approval',
      }),
    );
    const fullAccessItem = screen.getByRole('menuitemcheckbox', {
      name: 'Total Freedom',
    });
    expect(fullAccessItem.classList.contains('flyoff-menu__item--warning')).toBe(
      true,
    );
    expect(fullAccessItem.querySelector('.flyoff-menu__item-icon')).toBeTruthy();
    const fullAccessIcon = fullAccessItem
      .querySelector<HTMLElement>('.home__icon')
      ?.style.getPropertyValue('--home-icon');
    fireEvent.click(fullAccessItem);

    const confirmation = screen.getByRole('dialog', {
      name: 'Grant Total Freedom to Twine?',
    });
    expect(
      within(confirmation).getByText(/view your notes, access your dens/),
    ).toBeTruthy();
    expect(
      confirmation
        .querySelector<HTMLElement>('.twine-full-access-dialog__icon')
        ?.style.getPropertyValue('--home-icon'),
    ).toBe(fullAccessIcon);
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    expect(
      screen.getByRole('button', { name: 'Approval mode: Request approval' }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Approval mode: Request approval',
      }),
    );
    fireEvent.click(
      screen.getByRole('menuitemcheckbox', { name: 'Total Freedom' }),
    );
    fireEvent.click(
      within(
        screen.getByRole('dialog', {
          name: 'Grant Total Freedom to Twine?',
        }),
      ).getByRole('button', { name: 'Grant Total Freedom' }),
    );

    expect(
      screen.getByRole('button', { name: 'Approval mode: Total Freedom' }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Approval mode: Total Freedom' })
        .querySelector<HTMLElement>('.home__icon')?.style.getPropertyValue(
          '--home-icon',
        ),
    ).toBe(fullAccessIcon);
    fireEvent.click(
      screen.getByRole('button', { name: 'Approval mode: Total Freedom' }),
    );
    const selectedFullAccessItem = screen.getByRole('menuitemcheckbox', {
      name: 'Total Freedom',
    });
    expect(
      selectedFullAccessItem.querySelector('.flyoff-menu__item-icon'),
    ).toBeTruthy();
    expect(
      selectedFullAccessItem.querySelector('.flyoff-menu__check'),
    ).toBeTruthy();
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
    expect(screen.queryByText('What will we do today?')).toBeNull();
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

  it('settles an active response before editing and ignores its late events', async () => {
    let listener: ((event: TwineGenerationEvent) => void) | undefined;
    const cancelTwineGeneration = vi.fn().mockResolvedValue(undefined);
    const startTwineGeneration = vi.fn().mockResolvedValue(undefined);
    mockFlyoffApi({
      cancelTwineGeneration,
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
    const requestId = startTwineGeneration.mock.calls[0]?.[0].requestId;

    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    expect(cancelTwineGeneration).toHaveBeenCalledWith(requestId);
    expect(
      (screen.getByRole('textbox', {
        name: 'Edit message',
      }) as HTMLTextAreaElement).value,
    ).toBe('Original prompt');

    act(() => {
      listener?.({
        requestId,
        text: 'This must be ignored',
        type: 'text-delta',
      });
    });
    expect(screen.queryByText('This must be ignored')).toBeNull();

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit message' }), {
      key: 'Escape',
    });
    expect(cancelTwineGeneration).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox', { name: 'Message Twine' })).toBeTruthy();
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

    fireEvent.change(textbox, { target: { value: 'Preserved draft' } });

    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    const editor = screen.getByRole('textbox', { name: 'Edit message' });
    fireEvent.change(editor, { target: { value: 'Edited prompt' } });
    expect(
      fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true }),
    ).toBe(true);
    expect(startTwineGeneration).toHaveBeenCalledOnce();
    fireEvent.change(editor, {
      target: { value: 'Edited prompt\nSecond line' },
    });
    fireEvent.keyDown(editor, { key: 'Enter' });

    await waitFor(() => expect(startTwineGeneration).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/Edited prompt/)).toBeTruthy();
    expect(startTwineGeneration.mock.calls[1]?.[0].messages.at(-1)?.text).toBe(
      'Edited prompt\nSecond line',
    );
    expect(
      (screen.getByRole('textbox', {
        name: 'Message Twine',
      }) as HTMLTextAreaElement).value,
    ).toBe('Preserved draft');
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
    const thirdMount = renderTwine();

    await screen.findByText('Continued while moving');
    expect(screen.getByText('Draft across panes')).toBeTruthy();
    expect(api.cancelTwineGeneration).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit message' }), {
      target: { value: 'Edit across panes' },
    });
    thirdMount.unmount();
    renderTwine();
    expect(
      (screen.getByRole('textbox', {
        name: 'Edit message',
      }) as HTMLTextAreaElement).value,
    ).toBe('Edit across panes');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit message' }), {
      key: 'Escape',
    });
    expect(screen.getByRole('textbox', { name: 'Message Twine' })).toBeTruthy();
  });
});
