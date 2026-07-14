import { randomUUID } from 'node:crypto';

import {
  app,
  BrowserWindow,
  ipcMain,
  type Event,
  type IpcMainInvokeEvent,
} from 'electron';

import {
  CLOSE_REQUESTED_CHANNEL,
  CLOSE_RESPONSE_CHANNEL,
  isCloseResponse,
  type CloseIntent,
  type CloseRequest,
  type CloseResponse,
} from '../../shared/contracts';
import { validateTrustedMainFrame } from '../ipc/trusted-sender';
import type { TabSessionStore } from '../session';

export interface CloseCoordinatorOptions {
  isAllowedUrl: (url: string) => boolean;
  onShutdownApproved?: () => void;
  smokeTest: boolean;
  tabSessionStore: TabSessionStore;
}

interface PendingClose {
  request: CloseRequest;
  window: BrowserWindow;
}

export class CloseCoordinator {
  private readonly bypassWindows = new WeakSet<BrowserWindow>();
  private pendingClose: PendingClose | undefined;
  private quitApproved = false;
  private systemShutdown = false;

  constructor(private readonly options: CloseCoordinatorOptions) {
    app.on('before-quit', this.handleBeforeQuit);
    ipcMain.handle(CLOSE_RESPONSE_CHANNEL, this.handleCloseResponse);
  }

  attachWindow(window: BrowserWindow): () => void {
    const webContents = window.webContents;
    const handleClose = (event: Event) => {
      if (
        this.options.smokeTest ||
        this.systemShutdown ||
        this.bypassWindows.has(window) ||
        !this.canRequestRenderer(window)
      ) {
        return;
      }

      event.preventDefault();
      this.requestClose(window, 'close-window');
    };
    const handleSessionEnd = () => {
      this.systemShutdown = true;
      this.quitApproved = true;
      this.options.onShutdownApproved?.();
      this.bypassWindows.add(window);
      this.flushSafely();
    };
    const handleRendererGone = () => this.completeWithoutRenderer(window);

    window.on('close', handleClose);
    window.on('query-session-end', handleSessionEnd);
    webContents.on('render-process-gone', handleRendererGone);
    webContents.on('destroyed', handleRendererGone);

    const detach = () => {
      window.off('close', handleClose);
      window.off('query-session-end', handleSessionEnd);
      webContents.off('render-process-gone', handleRendererGone);
      webContents.off('destroyed', handleRendererGone);
    };

    window.once('closed', detach);
    return detach;
  }

  dispose(): void {
    app.off('before-quit', this.handleBeforeQuit);
    ipcMain.removeHandler(CLOSE_RESPONSE_CHANNEL);
    this.pendingClose = undefined;
  }

  private readonly handleBeforeQuit = (event: Event): void => {
    if (this.options.smokeTest || this.quitApproved || this.systemShutdown) {
      return;
    }

    const window =
      BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

    if (!window || !this.canRequestRenderer(window)) {
      this.quitApproved = true;
      this.options.onShutdownApproved?.();
      this.flushSafely();
      return;
    }

    event.preventDefault();
    this.requestClose(window, 'quit-application');
  };

  private readonly handleCloseResponse = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): void => {
    validateTrustedMainFrame(
      event,
      this.options.isAllowedUrl,
      'Close confirmation',
    );

    if (!isCloseResponse(value)) {
      throw new TypeError('Invalid close response.');
    }

    const pending = this.pendingClose;
    const response: CloseResponse = value;

    if (!pending || pending.request.requestId !== response.requestId) {
      throw new Error('The close request is no longer active.');
    }

    if (BrowserWindow.fromWebContents(event.sender) !== pending.window) {
      throw new Error('The close response belongs to a different window.');
    }

    if (response.decision === 'cancel') {
      this.pendingClose = undefined;
      return;
    }

    this.pendingClose = undefined;

    try {
      this.options.tabSessionStore.saveFinal(response.session);
    } catch {
      // Persistence must not override the user's confirmed close decision.
    }

    this.complete(pending.window, pending.request.intent);
  };

  private requestClose(window: BrowserWindow, intent: CloseIntent): void {
    if (!this.canRequestRenderer(window)) {
      this.complete(window, intent);
      return;
    }

    if (
      this.pendingClose?.window === window &&
      this.pendingClose.request.intent === intent
    ) {
      return;
    }

    const request: CloseRequest = {
      requestId: randomUUID(),
      intent,
    };
    this.pendingClose = { request, window };
    window.webContents.send(CLOSE_REQUESTED_CHANNEL, request);
  }

  private complete(window: BrowserWindow, intent: CloseIntent): void {
    if (intent === 'quit-application') {
      this.quitApproved = true;
      this.options.onShutdownApproved?.();

      for (const candidate of BrowserWindow.getAllWindows()) {
        this.bypassWindows.add(candidate);
      }

      app.quit();
      return;
    }

    if (!window.isDestroyed()) {
      this.bypassWindows.add(window);
      window.close();
    }
  }

  private completeWithoutRenderer(window: BrowserWindow): void {
    const pending = this.pendingClose;

    if (!pending || pending.window !== window) {
      return;
    }

    this.pendingClose = undefined;
    this.flushSafely();
    this.complete(window, pending.request.intent);
  }

  private flushSafely(): void {
    try {
      this.options.tabSessionStore.flush();
    } catch {
      return;
    }
  }

  private canRequestRenderer(window: BrowserWindow): boolean {
    return (
      !window.isDestroyed() &&
      !window.webContents.isDestroyed() &&
      !window.webContents.isLoadingMainFrame()
    );
  }
}
