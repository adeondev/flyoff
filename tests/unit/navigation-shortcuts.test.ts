import type { BrowserWindow, Event, Input } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { registerNavigationShortcuts } from '../../src/main/window';
import {
  RENDERER_MENU_COMMAND_CHANNEL,
  RENDERER_MENU_COMMANDS,
} from '../../src/shared/contracts';

type InputListener = (event: Event, input: Input) => void;

function createWindow() {
  let listener: InputListener | undefined;
  const webContents = {
    off: vi.fn((_event: string, callback: InputListener) => {
      if (listener === callback) {
        listener = undefined;
      }
    }),
    on: vi.fn((_event: string, callback: InputListener) => {
      listener = callback;
    }),
    send: vi.fn(),
  };
  const window = {
    close: vi.fn(),
    webContents,
  };

  return {
    emit(input: Partial<Input>) {
      const event = { preventDefault: vi.fn() } as unknown as Event;
      listener?.(event, {
        alt: false,
        control: false,
        key: '',
        meta: false,
        shift: false,
        type: 'keyDown',
        ...input,
      } as Input);
      return event;
    },
    webContents,
    window,
  };
}

describe('navigation shortcuts', () => {
  it('routes Ctrl+W to exactly one renderer tab command on Windows', () => {
    const created = createWindow();
    registerNavigationShortcuts(
      created.window as unknown as BrowserWindow,
      'win32',
    );

    const event = created.emit({ control: true, key: 'w' });

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(created.webContents.send).toHaveBeenCalledOnce();
    expect(created.webContents.send).toHaveBeenCalledWith(
      RENDERER_MENU_COMMAND_CHANNEL,
      RENDERER_MENU_COMMANDS.closeTab,
    );
    expect(created.window.close).not.toHaveBeenCalled();
  });

  it('routes the shifted shortcut to the guarded window close', () => {
    const created = createWindow();
    registerNavigationShortcuts(
      created.window as unknown as BrowserWindow,
      'linux',
    );

    const event = created.emit({ control: true, key: 'W', shift: true });

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(created.window.close).toHaveBeenCalledOnce();
    expect(created.webContents.send).not.toHaveBeenCalled();
  });

  it('uses Command on macOS and ignores unrelated input', () => {
    const created = createWindow();
    const dispose = registerNavigationShortcuts(
      created.window as unknown as BrowserWindow,
      'darwin',
    );

    expect(created.emit({ control: true, key: 'w' }).preventDefault).not
      .toHaveBeenCalled();
    expect(
      created.emit({ key: 'w', meta: true, type: 'keyUp' }).preventDefault,
    ).not.toHaveBeenCalled();
    expect(
      created.emit({ alt: true, key: 'w', meta: true }).preventDefault,
    ).not.toHaveBeenCalled();
    expect(created.emit({ key: 'w', meta: true }).preventDefault)
      .toHaveBeenCalledOnce();

    dispose();
    created.emit({ key: 'w', meta: true });
    expect(created.webContents.send).toHaveBeenCalledOnce();
  });
});
