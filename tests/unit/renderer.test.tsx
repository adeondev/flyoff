// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../src/renderer/App';
import type { BootstrapState } from '../../src/shared/contracts';

function createBootstrapState(
  platform: BootstrapState['platform'] = 'win32',
): BootstrapState {
  return {
    platform,
    uiLocale: 'en-US',
    nativeCore: {
      coreVersion: '0.1.0',
      protocolVersion: 1,
    },
    spellcheck: {
      provider: 'chromium-hunspell',
      canSelectLanguages: true,
      downloadsDictionaries: true,
    },
  };
}

afterEach(() => {
  cleanup();
  document.documentElement.lang = '';
  delete document.documentElement.dataset.platform;
});

describe('initial renderer', () => {
  it('shows the identity and menus inside the Windows titlebar', async () => {
    const getBootstrapState = vi.fn(() =>
      Promise.resolve(createBootstrapState()),
    );
    const executeMenuCommand = vi.fn(() => Promise.resolve());
    const controlWindow = vi.fn(() =>
      Promise.resolve({ maximized: true }),
    );
    Object.defineProperty(window, 'flyoff', {
      configurable: true,
      value: {
        getBootstrapState,
        getWindowState: vi.fn(() => Promise.resolve({ maximized: false })),
        controlWindow,
        onWindowStateChanged: vi.fn(() => () => undefined),
        executeMenuCommand,
      },
    });

    const { container } = render(<App />);

    expect(screen.getByRole('main', { name: 'Flyoff' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Flyoff' })).toBeTruthy();
    expect(
      await screen.findByRole('button', { name: 'New Project' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Project' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Templates' })).toBeTruthy();
    expect(screen.getByText('Or drag files here')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Home' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(screen.getByRole('button', { name: 'This Device' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Help' })).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Update application' }),
    ).toBeTruthy();
    expect(screen.queryByText('Pages')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Home' })).toBeTruthy();
    expect(container.querySelector('.page-tab__icon')).not.toBeNull();
    expect(container.querySelector('.home__actions-brand')).not.toBeNull();
    expect(screen.getByRole('banner', { name: 'Flyoff' })).toBeTruthy();

    await waitFor(() => {
      expect(document.documentElement.lang).toBe('en-US');
      expect(document.documentElement.dataset.platform).toBe('win32');
    });
    expect(await screen.findAllByRole('menuitem')).toHaveLength(4);
    expect(screen.getByTestId('window-minimize')).toBeTruthy();
    expect(screen.getByTestId('window-close')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Maximize' }));
    await waitFor(() => {
      expect(controlWindow).toHaveBeenCalledWith('toggle-maximize');
      expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeTruthy();
    });
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Close TabCtrl+W' }),
    );
    expect(executeMenuCommand).not.toHaveBeenCalledWith('file.closeWindow');
    expect(getBootstrapState).toHaveBeenCalledOnce();
  });

  it('keeps inline menus out of the macOS titlebar', async () => {
    Object.defineProperty(window, 'flyoff', {
      configurable: true,
      value: {
        getBootstrapState: vi.fn(() =>
          Promise.resolve(createBootstrapState('darwin')),
        ),
        getWindowState: vi.fn(() => Promise.resolve({ maximized: false })),
        controlWindow: vi.fn(() => Promise.resolve({ maximized: false })),
        onWindowStateChanged: vi.fn(() => () => undefined),
        executeMenuCommand: vi.fn(() => Promise.resolve()),
      },
    });

    render(<App />);

    expect(
      await screen.findByRole('banner', { name: 'Flyoff' }),
    ).toBeTruthy();
    await waitFor(() => {
      expect(document.documentElement.dataset.platform).toBe('darwin');
    });
    expect(screen.queryByRole('menubar')).toBeNull();
    expect(screen.getByTestId('window-minimize')).toBeTruthy();
    expect(screen.getByTestId('window-toggle-maximize')).toBeTruthy();
    expect(screen.getByTestId('window-close')).toBeTruthy();
  });

  it('keeps the shell usable when bootstrap retrieval fails', async () => {
    const getBootstrapState = vi.fn(() =>
      Promise.reject(new Error('Unavailable')),
    );
    Object.defineProperty(window, 'flyoff', {
      configurable: true,
      value: {
        getBootstrapState,
        getWindowState: vi.fn(() => Promise.resolve({ maximized: false })),
        controlWindow: vi.fn(() => Promise.resolve({ maximized: false })),
        onWindowStateChanged: vi.fn(() => () => undefined),
        executeMenuCommand: vi.fn(() => Promise.resolve()),
      },
    });

    render(<App />);

    expect(screen.getByRole('img', { name: 'Flyoff' })).toBeTruthy();
    await waitFor(() => expect(getBootstrapState).toHaveBeenCalledOnce());
  });
});
