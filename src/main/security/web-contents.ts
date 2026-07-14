import type { WebContents } from 'electron';

export function secureWebContents(
  webContents: WebContents,
  isAllowedUrl: (url: string) => boolean,
): void {
  webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isAllowedUrl(navigationUrl)) {
      event.preventDefault();
    }
  });

  webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame || !isAllowedUrl(event.url)) {
      event.preventDefault();
    }
  });

  webContents.on('will-redirect', (event) => {
    if (!event.isMainFrame || !isAllowedUrl(event.url)) {
      event.preventDefault();
    }
  });

  webContents.on('will-attach-webview', (event) => event.preventDefault());
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}
