import type { Session, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { configureSessionSecurity } from '../../src/main/security/session-security';
import { secureWebContents } from '../../src/main/security/web-contents';

type EventHandler = (...arguments_: unknown[]) => void;

describe('web contents security', () => {
  it('blocks untrusted navigation, redirects, subframes, and new windows', () => {
    const handlers = new Map<string, EventHandler>();
    const setWindowOpenHandler = vi.fn();
    const fakeWebContents = {
      on: vi.fn((event: string, handler: EventHandler) => {
        handlers.set(event, handler);
        return fakeWebContents;
      }),
      setWindowOpenHandler,
    };
    const isAllowedUrl = (url: string) => url.startsWith('flyoff://app/');

    secureWebContents(
      fakeWebContents as unknown as WebContents,
      isAllowedUrl,
    );

    const navigationEvent = { preventDefault: vi.fn() };
    handlers.get('will-navigate')?.(
      navigationEvent,
      'https://attacker.example',
    );
    expect(navigationEvent.preventDefault).toHaveBeenCalledOnce();

    const frameEvent = {
      isMainFrame: false,
      preventDefault: vi.fn(),
      url: 'flyoff://app/frame.html',
    };
    handlers.get('will-frame-navigate')?.(frameEvent);
    expect(frameEvent.preventDefault).toHaveBeenCalledOnce();

    const redirectEvent = {
      isMainFrame: true,
      preventDefault: vi.fn(),
      url: 'https://attacker.example',
    };
    handlers.get('will-redirect')?.(redirectEvent);
    expect(redirectEvent.preventDefault).toHaveBeenCalledOnce();

    const openHandler = setWindowOpenHandler.mock.calls[0]?.[0] as
      | (() => { action: string })
      | undefined;
    expect(openHandler?.()).toEqual({ action: 'deny' });
  });
});

describe('session security', () => {
  it('adds a restrictive production CSP and denies permissions', () => {
    let headersListener:
      | ((
          details: { responseHeaders?: Record<string, string[]> },
          callback: (response: {
            responseHeaders?: Record<string, string[]>;
          }) => void,
        ) => void)
      | undefined;
    const setPermissionCheckHandler = vi.fn();
    const setPermissionRequestHandler = vi.fn();
    const fakeSession = {
      setPermissionCheckHandler,
      setPermissionRequestHandler,
      webRequest: {
        onHeadersReceived: vi.fn((listener: typeof headersListener) => {
          headersListener = listener;
        }),
      },
    };

    configureSessionSecurity(fakeSession as unknown as Session, true);

    let responseHeaders: Record<string, string[]> | undefined;
    headersListener?.(
      { responseHeaders: { Existing: ['value'] } },
      (response) => {
        responseHeaders = response.responseHeaders;
      },
    );

    const csp = responseHeaders?.['Content-Security-Policy']?.[0];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("worker-src 'none'");
    expect(csp).toContain("img-src 'self' data: flyoff-asset:");
    expect(responseHeaders?.['X-Content-Type-Options']).toEqual(['nosniff']);

    const checkHandler = setPermissionCheckHandler.mock.calls[0]?.[0] as
      | (() => boolean)
      | undefined;
    expect(checkHandler?.()).toBe(false);

    const requestHandler = setPermissionRequestHandler.mock.calls[0]?.[0] as
      | ((
          webContents: undefined,
          permission: string,
          callback: (allowed: boolean) => void,
        ) => void)
      | undefined;
    const permissionCallback = vi.fn();
    requestHandler?.(undefined, 'notifications', permissionCallback);
    expect(permissionCallback).toHaveBeenCalledWith(false);
  });
});
