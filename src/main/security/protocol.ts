import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { net, protocol } from 'electron';

export const FLYOFF_SCHEME = 'flyoff';
export const FLYOFF_ASSET_SCHEME = 'flyoff-asset';
export const FLYOFF_RENDERER_URL = `${FLYOFF_SCHEME}://app/main_window/index.html`;
export const FLYOFF_TWEMOJI_URL = `${FLYOFF_ASSET_SCHEME}://app/twemoji/`;

const TWEMOJI_FILE_PATTERN =
  /^[0-9a-f]{1,6}(?:-[0-9a-f]{1,6})*\.svg$/;

export interface RendererLocation {
  isAllowedUrl(url: string): boolean;
  rendererUrl: string;
}

export function createRendererLocation(
  rendererUrl: string,
  isPackaged: boolean,
): RendererLocation {
  const expected = new URL(rendererUrl);

  if (isPackaged && (expected.protocol !== 'flyoff:' || expected.host !== 'app')) {
    throw new Error('The packaged renderer must use the Flyoff app origin.');
  }

  if (
    !isPackaged &&
    expected.protocol !== 'http:' &&
    expected.protocol !== 'https:'
  ) {
    throw new Error('The development renderer must use HTTP or HTTPS.');
  }

  return {
    rendererUrl,
    isAllowedUrl(candidate: string): boolean {
      try {
        const url = new URL(candidate);

        if (url.username || url.password) {
          return false;
        }

        return isPackaged
          ? url.protocol === 'flyoff:' && url.host === 'app'
          : url.protocol === expected.protocol && url.host === expected.host;
      } catch {
        return false;
      }
    },
  };
}

export function registerFlyoffScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: FLYOFF_SCHEME,
      privileges: {
        codeCache: true,
        secure: true,
        standard: true,
        supportFetchAPI: true,
      },
    },
    {
      scheme: FLYOFF_ASSET_SCHEME,
      privileges: {
        secure: true,
        standard: true,
        supportFetchAPI: true,
      },
    },
  ]);
}

export function resolveTwemojiAssetPath(
  requestUrl: string,
  assetRoot: string,
): string | null {
  let url: URL;

  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }

  if (
    url.protocol !== `${FLYOFF_ASSET_SCHEME}:` ||
    url.host !== 'app' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return null;
  }

  let pathname: string;

  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }

  const prefix = '/twemoji/';

  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const filename = pathname.slice(prefix.length);

  if (!TWEMOJI_FILE_PATTERN.test(filename)) {
    return null;
  }

  const requestedFile = path.resolve(assetRoot, filename);
  const relativePath = path.relative(assetRoot, requestedFile);

  return relativePath === filename ? requestedFile : null;
}

export function registerFlyoffAssetProtocol(assetRoot: string): void {
  const resolvedAssetRoot = path.resolve(assetRoot);

  protocol.handle(FLYOFF_ASSET_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405 });
    }

    const requestedFile = resolveTwemojiAssetPath(
      request.url,
      resolvedAssetRoot,
    );

    if (!requestedFile) {
      return new Response(null, { status: 404 });
    }

    try {
      return await net.fetch(pathToFileURL(requestedFile).toString(), {
        method: request.method,
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

export function registerFlyoffProtocol(rendererEntry: string): void {
  const entryUrl = new URL(rendererEntry);

  if (entryUrl.protocol !== 'file:') {
    throw new Error('The packaged renderer entry must be a file URL.');
  }

  const rendererRoot = path.resolve(
    path.dirname(fileURLToPath(entryUrl)),
    '..',
  );

  protocol.handle(FLYOFF_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405 });
    }

    const requestUrl = new URL(request.url);

    if (
      requestUrl.host !== 'app' ||
      requestUrl.username ||
      requestUrl.password
    ) {
      return new Response(null, { status: 404 });
    }

    let pathname: string;

    try {
      pathname =
        requestUrl.pathname === '/'
          ? '/main_window/index.html'
          : decodeURIComponent(requestUrl.pathname);
    } catch {
      return new Response(null, { status: 400 });
    }

    if (pathname.includes('\0')) {
      return new Response(null, { status: 400 });
    }

    const requestedFile = path.resolve(rendererRoot, `.${pathname}`);
    const relativePath = path.relative(rendererRoot, requestedFile);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return new Response(null, { status: 403 });
    }

    try {
      return await net.fetch(pathToFileURL(requestedFile).toString());
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}
