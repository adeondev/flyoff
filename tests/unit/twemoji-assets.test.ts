import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const assetRoot = path.resolve('public', 'images', 'twemoji');
const svgRoot = path.join(assetRoot, 'svg');

describe('packaged Twemoji assets', () => {
  it('keeps individual canonical SVG files instead of a monolithic sprite', () => {
    const assets = readdirSync(svgRoot).filter((name) => name.endsWith('.svg'));

    expect(assets.length).toBeGreaterThanOrEqual(4_000);
    expect(
      assets.every((name) =>
        /^[0-9a-f]{1,6}(?:-[0-9a-f]{1,6})*\.svg$/.test(name),
      ),
    ).toBe(true);
    expect(existsSync(path.join(assetRoot, 'twemoji-sprite.svg'))).toBe(false);
  });

  it('pins the generated assets and compact search catalog', () => {
    const metadata = JSON.parse(
      readFileSync(path.join(assetRoot, 'version.json'), 'utf8'),
    ) as { version?: string };
    const catalog = JSON.parse(
      readFileSync(
        path.resolve(
          'src',
          'renderer',
          'projects',
          'emoji-catalog.generated.json',
        ),
        'utf8',
      ),
    ) as { entries?: unknown[]; version?: number };

    expect(metadata.version).toBe('17.0.3');
    expect(catalog.version).toBe(2);
    expect(catalog.entries?.length).toBeGreaterThan(1_900);
  });
});
