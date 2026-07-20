import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ProjectLinkMaintenanceStore } from '../../src/main/projects/project-link-maintenance';

const temporaryDirectories: string[] = [];
const projectId = 'cdb39a1a-0339-4c75-91ea-78fbbcb2f97a';
const targetId = 'ffbf978c-43d7-4135-a3ea-f6e4e3ec76fb';
const firstSourceId = '2b4aa17c-9c6e-4f99-99af-b729c77c7603';
const secondSourceId = 'f44fd7c7-e84d-4b31-8d23-c268c1be446d';

function createStore(): {
  filePath: string;
  store: ProjectLinkMaintenanceStore;
} {
  const rootPath = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), 'flyoff-link-maintenance-')),
  );
  temporaryDirectories.push(rootPath);
  mkdirSync(path.join(rootPath, '.flyoff'));
  return {
    filePath: path.join(rootPath, '.flyoff', 'link-maintenance.json'),
    store: new ProjectLinkMaintenanceStore(rootPath, projectId),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('ProjectLinkMaintenanceStore', () => {
  it('repairs each locked note from the path generation it last observed', async () => {
    const { filePath, store } = createStore();
    const firstPaths = new Map([
      [targetId, 'Target.md'],
      [firstSourceId, 'First.md'],
      [secondSourceId, 'Second.md'],
    ]);
    const secondPaths = new Map(firstPaths);
    secondPaths.set(targetId, 'Renamed.md');
    await store.stage(firstPaths, secondPaths, [firstSourceId]);

    const finalPaths = new Map(secondPaths);
    finalPaths.set(targetId, 'Final.md');
    await store.stage(secondPaths, finalPaths, [
      firstSourceId,
      secondSourceId,
    ]);

    await expect(
      store.rewrite(
        firstSourceId,
        '[target](Target.md)\n[[Target]]',
        finalPaths,
      ),
    ).resolves.toEqual({
      content: '[target](Final.md)\n[[Final]]',
      pending: true,
    });
    await expect(
      store.rewrite(
        secondSourceId,
        '[target](Renamed.md)\n[[Renamed]]',
        finalPaths,
      ),
    ).resolves.toEqual({
      content: '[target](Final.md)\n[[Final]]',
      pending: true,
    });

    await store.complete(firstSourceId);
    expect(existsSync(filePath)).toBe(true);
    await store.complete(secondSourceId);
    expect(existsSync(filePath)).toBe(false);
  });
});
