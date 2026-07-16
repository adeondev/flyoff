import { ipcMain, shell } from 'electron';

import {
  isOpenExternalLinkRequest,
  OPEN_EXTERNAL_LINK_CHANNEL,
  type OpenExternalLinkResult,
} from '../../shared/contracts';
import { validateTrustedMainFrame } from './trusted-sender';

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function validateExternalUrl(url: string): OpenExternalLinkResult {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { ok: false, error: 'invalid-url' };
  }

  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol.toLowerCase())) {
    return { ok: false, error: 'unsupported-scheme' };
  }
  return { ok: true };
}

export function registerExternalLinkHandler(
  isAllowedUrl: (url: string) => boolean,
): () => void {
  ipcMain.handle(OPEN_EXTERNAL_LINK_CHANNEL, async (event, request: unknown) => {
    validateTrustedMainFrame(event, isAllowedUrl, 'External links');
    if (!isOpenExternalLinkRequest(request)) {
      return { ok: false, error: 'invalid-url' } satisfies OpenExternalLinkResult;
    }

    const validation = validateExternalUrl(request.url);
    if (!validation.ok) {
      return validation;
    }

    try {
      await shell.openExternal(request.url.trim());
      return { ok: true } satisfies OpenExternalLinkResult;
    } catch {
      return { ok: false, error: 'open-failed' } satisfies OpenExternalLinkResult;
    }
  });

  return () => ipcMain.removeHandler(OPEN_EXTERNAL_LINK_CHANNEL);
}
