// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../src/renderer/App';
import {
  WORKSPACE_SESSION_VERSION,
  type BootstrapState,
  type CloseRequest,
  type FlyoffApi,
  type RendererMenuCommand,
  type WorkspaceSessionSnapshot,
} from '../../src/shared/contracts';

const bootstrap: BootstrapState = {
  platform: 'win32',
  uiLocale: 'en-US',
  nativeCore: { coreVersion: '0.1.0', protocolVersion: 1 },
  spellcheck: {
    provider: 'chromium-hunspell',
    canSelectLanguages: true,
    downloadsDictionaries: true,
  },
};

function createSession(
  pages: readonly ('home' | 'help' | 'settings')[],
  activeTabId = `page:${pages[0] ?? 'home'}`,
): WorkspaceSessionSnapshot {
  return {
    version: WORKSPACE_SESSION_VERSION,
    home: {
      root: {
        kind: 'pane',
        paneId: 'home-pane-1',
        tabs: pages.map((pageId) => ({
          tabId: `page:${pageId}`,
          target: { type: 'internal', pageId },
          scrollTop: 0,
          pageState: { version: 1, data: {} },
        })),
        activeTabId,
      },
      activePaneId: 'home-pane-1',
    },
    project: null,
  };
}

function installApi(restorable: WorkspaceSessionSnapshot | null = null) {
  let closeListener: ((request: CloseRequest) => void) | undefined;
  let menuListener: ((command: RendererMenuCommand) => void) | undefined;
  const api: FlyoffApi = {
    controlWindow: vi.fn(() => Promise.resolve({ maximized: false })),
    executeMenuCommand: vi.fn(() => Promise.resolve()),
    getBootstrapState: vi.fn(() => Promise.resolve(bootstrap)),
    getRestorableTabSession: vi.fn(() => Promise.resolve(restorable)),
    getWindowState: vi.fn(() => Promise.resolve({ maximized: false })),
    onCloseRequested: vi.fn((listener) => {
      closeListener = listener;
      return () => {
        closeListener = undefined;
      };
    }),
    onRendererMenuCommand: vi.fn((listener) => {
      menuListener = listener;
      return () => {
        menuListener = undefined;
      };
    }),
    onWindowStateChanged: vi.fn(() => () => undefined),
    resolveRestorableTabSession: vi.fn(() => Promise.resolve()),
    respondToCloseRequest: vi.fn(() => Promise.resolve()),
    saveTabSession: vi.fn(() => Promise.resolve()),
  };

  Object.defineProperty(window, 'flyoff', {
    configurable: true,
    value: api,
  });

  return {
    api,
    emitClose(request: CloseRequest) {
      closeListener?.(request);
    },
    emitMenu(command: RendererMenuCommand) {
      menuListener?.(command);
    },
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('tab workspace', () => {
  it('opens singleton pages and restores Home after closing the last one', async () => {
    installApi();
    render(<App />);

    const settingsNavigation = await screen.findByRole('button', {
      name: 'Settings',
    });
    fireEvent.click(settingsNavigation);
    fireEvent.click(settingsNavigation);

    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /Close tab:/ })).toHaveLength(
      2,
    );
    expect(
      screen
        .getByRole('tab', { name: 'Settings' })
        .getAttribute('aria-selected'),
    ).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Close tab: Home' }));
    await waitFor(() =>
      expect(screen.queryByRole('tab', { name: 'Home' })).toBeNull(),
    );
    expect(
      screen.getByRole('button', { name: 'Close tab: Settings' }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('tab', { name: 'Settings' }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close tab: Settings' }));
    await waitFor(() =>
      expect(
        screen.getByRole('tab', { name: 'Home' }).getAttribute('aria-selected'),
      ).toBe('true'),
    );
    expect(screen.queryByRole('button', { name: 'Close tab: Home' })).toBeNull();
  });

  it('supports cycling and numeric browser shortcuts', async () => {
    installApi();
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));

    fireEvent.keyDown(document, { ctrlKey: true, key: '1' });
    expect(
      screen.getByRole('tab', { name: 'Home' }).getAttribute('aria-selected'),
    ).toBe('true');
    fireEvent.keyDown(document, { ctrlKey: true, key: '9' });
    expect(
      screen.getByRole('tab', { name: 'Help' }).getAttribute('aria-selected'),
    ).toBe('true');
    fireEvent.keyDown(document, { ctrlKey: true, key: 'Tab' });
    expect(
      screen.getByRole('tab', { name: 'Home' }).getAttribute('aria-selected'),
    ).toBe('true');

  });

  it('traps close confirmation focus and returns a validated snapshot', async () => {
    const bridge = installApi();
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    act(() =>
      bridge.emitClose({
        requestId: 'close:1',
        intent: 'close-window',
      }),
    );

    const dialog = screen.getByRole('dialog', { name: 'Close this window?' });
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Cancel' }),
    );
    fireEvent.keyDown(document, { ctrlKey: true, key: '1' });
    act(() => bridge.emitMenu('file.closeTab'));
    expect(
      screen
        .getByRole('tab', { hidden: true, name: 'Settings' })
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(screen.getAllByRole('tab', { hidden: true })).toHaveLength(2);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() =>
      expect(bridge.api.respondToCloseRequest).toHaveBeenCalledWith({
        requestId: 'close:1',
        decision: 'cancel',
      }),
    );

    act(() =>
      bridge.emitClose({
        requestId: 'close:2',
        intent: 'quit-application',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Quit' }));
    await waitFor(() =>
      expect(bridge.api.respondToCloseRequest).toHaveBeenLastCalledWith(
        expect.objectContaining({
          requestId: 'close:2',
          decision: 'confirm',
          session: expect.objectContaining({
            home: expect.objectContaining({
              root: expect.objectContaining({
                activeTabId: 'page:settings',
              }),
            }),
          }),
        }),
      ),
    );
  });

  it('keeps the close dialog available when the response bridge fails', async () => {
    const bridge = installApi();
    const respond = vi.mocked(bridge.api.respondToCloseRequest);
    respond.mockRejectedValueOnce(new Error('temporary IPC failure'));
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    act(() =>
      bridge.emitClose({
        requestId: 'close:retry',
        intent: 'close-window',
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog').getAttribute('aria-busy')).toBe(
        'false',
      ),
    );
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).toBeNull(),
    );
    expect(respond).toHaveBeenCalledTimes(2);
  });

  it('restores the previous order and active page', async () => {
    const previous = createSession(['help', 'home'], 'page:help');
    const bridge = installApi(previous);
    render(<App />);

    expect(
      await screen.findByText('Restore tabs from your last session?'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => {
      expect(screen.getAllByRole('tab').map(({ textContent }) => textContent)).toEqual([
        'Help',
        'Home',
      ]);
      expect(
        screen.getByRole('tab', { name: 'Help' }).getAttribute('aria-selected'),
      ).toBe('true');
    });
    expect(bridge.api.resolveRestorableTabSession).toHaveBeenCalledWith(
      'restore',
      previous,
    );
  });

  it('dismisses the pending session popup with Escape', async () => {
    const previous = createSession(['home', 'settings'], 'page:settings');
    const bridge = installApi(previous);
    render(<App />);

    expect(
      await screen.findByText('Restore tabs from your last session?'),
    ).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() =>
      expect(
        screen.queryByText('Restore tabs from your last session?'),
      ).toBeNull(),
    );
    expect(bridge.api.resolveRestorableTabSession).toHaveBeenCalledWith(
      'ignore',
      expect.objectContaining({
        home: expect.objectContaining({
          root: expect.objectContaining({ activeTabId: 'page:home' }),
        }),
      }),
    );
  });

  it('ignores the pending session after eight seconds', async () => {
    vi.useFakeTimers();
    const previous = createSession(['home', 'settings'], 'page:settings');
    const bridge = installApi(previous);
    render(<App />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText('Restore tabs from your last session?')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });

    expect(screen.queryByText('Restore tabs from your last session?')).toBeNull();
    expect(bridge.api.resolveRestorableTabSession).toHaveBeenCalledWith(
      'ignore',
      expect.objectContaining({
        home: expect.objectContaining({
          root: expect.objectContaining({ activeTabId: 'page:home' }),
        }),
      }),
    );
  });
});
