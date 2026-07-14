import { describe, expect, it, vi } from 'vitest';

import {
  hardenCommandLine,
  hasRemoteDebuggingSwitch,
  REMOTE_DEBUGGING_SWITCHES,
} from '../../src/main/security/command-line';

describe('production command line hardening', () => {
  it('removes every Chromium remote debugging switch from packages', () => {
    const removeSwitch = vi.fn();

    hardenCommandLine(
      { hasSwitch: vi.fn(() => false), removeSwitch },
      true,
    );

    expect(removeSwitch.mock.calls.map(([name]) => name)).toEqual(
      REMOTE_DEBUGGING_SWITCHES,
    );
  });

  it('keeps the development command line available to test tooling', () => {
    const removeSwitch = vi.fn();

    hardenCommandLine(
      { hasSwitch: vi.fn(() => false), removeSwitch },
      false,
    );

    expect(removeSwitch).not.toHaveBeenCalled();
  });

  it('detects any remaining remote debugging capability', () => {
    const hasSwitch = vi.fn(
      (name: string) => name === 'remote-debugging-pipe',
    );

    expect(hasRemoteDebuggingSwitch({ hasSwitch, removeSwitch: vi.fn() })).toBe(
      true,
    );
  });
});
