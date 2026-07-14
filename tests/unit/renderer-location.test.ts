import { describe, expect, it, vi } from 'vitest';

import {
  createRendererLocation,
  FLYOFF_RENDERER_URL,
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
