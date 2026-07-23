import { spawnSync } from 'node:child_process';

import { app } from 'electron';

const FILE_CLASS = 'Flyoff.Diagram';
const MIME_TYPE = 'application/vnd.flyoff.diagram';

function registry(args: readonly string[]): void {
  spawnSync('reg.exe', args, {
    encoding: 'utf8',
    windowsHide: true,
  });
}

function registerFlyd(executablePath: string): void {
  const root = `HKCU\\Software\\Classes\\${FILE_CLASS}`;
  registry(['add', root, '/ve', '/d', 'Flyoff Diagram File', '/f']);
  registry(['add', `${root}\\DefaultIcon`, '/ve', '/d', `"${executablePath}",0`, '/f']);
  registry([
    'add',
    `${root}\\shell\\open\\command`,
    '/ve',
    '/d',
    `"${executablePath}" "%1"`,
    '/f',
  ]);
  registry(['add', 'HKCU\\Software\\Classes\\.flyd', '/ve', '/d', FILE_CLASS, '/f']);
  registry([
    'add',
    'HKCU\\Software\\Classes\\.flyd',
    '/v',
    'Content Type',
    '/d',
    MIME_TYPE,
    '/f',
  ]);
}

function unregisterFlyd(): void {
  registry(['delete', `HKCU\\Software\\Classes\\${FILE_CLASS}`, '/f']);
  registry(['delete', 'HKCU\\Software\\Classes\\.flyd', '/f']);
}

export function handleSquirrelFileAssociationEvent(): boolean {
  if (process.platform !== 'win32') {
    return false;
  }
  const event = process.argv[1];
  if (event === '--squirrel-install' || event === '--squirrel-updated') {
    registerFlyd(process.execPath);
    app.quit();
    return true;
  }
  if (event === '--squirrel-uninstall') {
    unregisterFlyd();
    app.quit();
    return true;
  }
  if (event === '--squirrel-obsolete') {
    app.quit();
    return true;
  }
  return false;
}
