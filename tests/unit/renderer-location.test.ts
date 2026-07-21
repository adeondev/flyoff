import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createRendererLocation,
  FLYOFF_RENDERER_URL,
  FLYOFF_TWEMOJI_URL,
  resolveTwemojiAssetPath,
} from '../../src/main/security/protocol';

vi.mock('electron/main', () => ({
  net: {},
  protocol: {},
}));

describe('renderer URL policy', () => {
  it('allows only the packaged flyoff://app authority', () => {
    const location = createRendererLocation(FLYOFF_RENDERER_URL, true);

    expect(location.isAllowedUrl('flyoff://app/index.html')).toBe(true);
    expect(location.isAllowedUrl('flyoff://app/assets/logo.svg?version=1')).toBe(
      true,
    );
    expect(location.isAllowedUrl('flyoff://other/index.html')).toBe(false);
    expect(location.isAllowedUrl('https://app/index.html')).toBe(false);
    expect(location.isAllowedUrl('flyoff://user@app/index.html')).toBe(false);
    expect(location.isAllowedUrl('not a URL')).toBe(false);
  });

  it('pins development navigation to the configured server', () => {
    const location = createRendererLocation('http://localhost:3000/index.html', false);

    expect(location.isAllowedUrl('http://localhost:3000/assets/app.js')).toBe(
      true,
    );
    expect(location.isAllowedUrl('http://localhost:3001/index.html')).toBe(false);
    expect(location.isAllowedUrl('https://localhost:3000/index.html')).toBe(
      false,
    );
  });

  it('rejects renderer entry protocols that do not match the environment', () => {
    expect(() => createRendererLocation('file:///tmp/index.html', true)).toThrow(
      'must use the Flyoff app origin',
    );
    expect(() => createRendererLocation(FLYOFF_RENDERER_URL, false)).toThrow(
      'must use HTTP or HTTPS',
    );
  });
});

describe('Twemoji asset location', () => {
  const root = path.resolve('twemoji-assets');

  it('resolves only canonical SVG filenames inside the asset root', () => {
    expect(
      resolveTwemojiAssetPath(`${FLYOFF_TWEMOJI_URL}1f44b-1f3fd.svg`, root),
    ).toBe(path.join(root, '1f44b-1f3fd.svg'));
    expect(
      resolveTwemojiAssetPath(`${FLYOFF_TWEMOJI_URL}00a9.svg`, root),
    ).toBe(path.join(root, '00a9.svg'));
  });

  it('rejects traversal, alternate hosts, queries, and malformed names', () => {
    expect(
      resolveTwemojiAssetPath(
        `${FLYOFF_TWEMOJI_URL}..%2fsecret.svg`,
        root,
      ),
    ).toBeNull();
    expect(
      resolveTwemojiAssetPath(
        'flyoff-asset://attacker/twemoji/1f600.svg',
        root,
      ),
    ).toBeNull();
    expect(
      resolveTwemojiAssetPath(`${FLYOFF_TWEMOJI_URL}1F600.svg`, root),
    ).toBeNull();
    expect(
      resolveTwemojiAssetPath(`${FLYOFF_TWEMOJI_URL}1f600.svg?other=1`, root),
    ).toBeNull();
  });
});
