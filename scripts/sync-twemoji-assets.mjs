import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const version = '17.0.3';
const catalogVersion = 2;
const require = createRequire(import.meta.url);
const { parse: parseTwemoji } = require('@twemoji/parser');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'public', 'images', 'twemoji');
const catalogOutput = path.join(
  root,
  'src',
  'renderer',
  'projects',
  'emoji-catalog.generated.json',
);
const temporary = mkdtempSync(path.join(os.tmpdir(), 'flyoff-twemoji-'));
const repository = path.join(temporary, 'twemoji');

function normalized(value) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .trim();
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function hasCurrentAssets() {
  const versionFile = path.join(output, 'version.json');
  const assets = path.join(output, 'svg');

  if (!existsSync(versionFile) || !existsSync(assets)) {
    return false;
  }

  try {
    const metadata = readJson(versionFile);
    return (
      metadata.version === version &&
      readdirSync(assets).filter((name) => name.endsWith('.svg')).length >= 4_000
    );
  } catch {
    return false;
  }
}

function hasCurrentCatalog() {
  if (!existsSync(catalogOutput) || statSync(catalogOutput).size === 0) {
    return false;
  }

  try {
    return readJson(catalogOutput).version === catalogVersion;
  } catch {
    return false;
  }
}

function twemojiCodepoint(unicode) {
  return parseTwemoji(unicode, {
    assetType: 'svg',
    buildUrl: (codepoint) => codepoint,
  })[0]?.url;
}

function createCatalog() {
  const dataRoot = path.join(root, 'node_modules', 'emojibase-data');
  const en = readJson(path.join(dataRoot, 'en', 'compact.json'));
  const pt = readJson(path.join(dataRoot, 'pt', 'compact.json'));
  const enMessages = readJson(path.join(dataRoot, 'en', 'messages.json'));
  const ptMessages = readJson(path.join(dataRoot, 'pt', 'messages.json'));
  const englishByHexcode = new Map(en.map((emoji) => [emoji.hexcode, emoji]));

  const entries = pt.flatMap((emoji) => {
    const english = englishByHexcode.get(emoji.hexcode);

    if (
      !english ||
      emoji.group === undefined ||
      emoji.group === 2 ||
      !emoji.order
    ) {
      return [];
    }

    const search = normalized(
      [
        emoji.label,
        ...(emoji.tags ?? []),
        english.label,
        ...(english.tags ?? []),
      ].join(' '),
    );

    return [{
      codepoint: twemojiCodepoint(emoji.unicode),
      group: emoji.group,
      hexcode: emoji.hexcode,
      label: {
        en: english.label,
        pt: emoji.label,
      },
      order: emoji.order,
      search,
      skinCodepoints: emoji.skins?.map(({ unicode }) =>
        twemojiCodepoint(unicode),
      ),
      skins: emoji.skins?.map(({ unicode }) => unicode),
      unicode: emoji.unicode,
    }];
  });

  const groups = Object.fromEntries(
    [
      ['en', enMessages.groups],
      ['pt', ptMessages.groups],
    ].map(([locale, groups]) => [
      locale,
      groups
        .filter(({ order }) => order !== 2)
        .sort((left, right) => left.order - right.order),
    ]),
  );

  writeFileSync(
    catalogOutput,
    `${JSON.stringify({ entries, groups, version: catalogVersion })}\n`,
    'utf8',
  );
}

try {
  if (hasCurrentAssets()) {
    if (!hasCurrentCatalog()) {
      createCatalog();
    }
    console.log(`Twemoji ${version} assets are already current.`);
  } else {
    execFileSync(
      'git',
      [
        'clone',
        '--branch',
        `v${version}`,
        '--depth',
        '1',
        'https://github.com/jdecked/twemoji.git',
        repository,
      ],
      { stdio: 'inherit' },
    );
    const assets = path.join(repository, 'assets', 'svg');
    rmSync(output, { force: true, recursive: true });
    cpSync(assets, path.join(temporary, 'svg'), { recursive: true });
    writeFileSync(
      path.join(temporary, 'version.json'),
      `${JSON.stringify({ version }, null, 2)}\n`,
      'utf8',
    );
    cpSync(temporary, output, {
      filter: (source) => source !== repository,
      recursive: true,
    });
    cpSync(
      path.join(repository, 'LICENSE-GRAPHICS'),
      path.join(output, 'LICENSE-GRAPHICS'),
    );
    createCatalog();
    console.log(
      `Prepared ${readdirSync(path.join(output, 'svg')).length} Twemoji ${version} SVG assets.`,
    );
  }
} finally {
  rmSync(temporary, { force: true, recursive: true });
}
