import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

interface BuildCommand {
  args: string[];
  command: string;
  label: string;
}

interface BuildFailure extends Error {
  exitCode: number;
  restoreError?: BuildFailure;
}

const requireFromTest = createRequire(__filename);
const {
  buildCommands,
  makeWindowsZip,
}: {
  buildCommands: () => Record<
    'forge' | 'restore' | 'typecheck' | 'windowsNative',
    BuildCommand
  >;
  makeWindowsZip: (
    execute?: (command: BuildCommand) => void,
  ) => void;
} = requireFromTest('../../scripts/make-windows-zip.cjs');

function failure(message: string, exitCode: number): BuildFailure {
  return Object.assign(new Error(message), { exitCode });
}

describe('Windows ZIP build orchestration', () => {
  it('targets a Windows x64 ZIP while keeping host restoration explicit', () => {
    const commands = buildCommands();

    expect(commands.forge.command).toBe(process.execPath);
    expect(commands.forge.args).toEqual(
      expect.arrayContaining([
        '--platform=win32',
        '--arch=x64',
        '--targets=@electron-forge/maker-zip',
      ]),
    );
    expect(commands.windowsNative.args).toEqual(
      expect.arrayContaining(['run', 'native:build:windows']),
    );
    expect(commands.restore.args).toEqual(
      expect.arrayContaining(['run', 'native:build']),
    );
  });

  it('runs the build in order and restores the host native core', () => {
    const calls: string[] = [];

    makeWindowsZip((command) => {
      calls.push(command.label);
    });

    expect(calls).toEqual([
      'Type-check',
      'Build Windows native core',
      'Package Windows ZIP',
      'Restore host native core',
    ]);
  });

  it('restores the host binary and preserves the Forge exit code', () => {
    const calls: string[] = [];
    const forgeFailure = failure('Forge failed.', 23);
    let thrown: BuildFailure | undefined;

    try {
      makeWindowsZip((command) => {
        calls.push(command.label);
        if (command.label === 'Package Windows ZIP') {
          throw forgeFailure;
        }
      });
    } catch (error) {
      thrown = error as BuildFailure;
    }

    expect(calls).toEqual([
      'Type-check',
      'Build Windows native core',
      'Package Windows ZIP',
      'Restore host native core',
    ]);
    expect(thrown).toBe(forgeFailure);
    expect(thrown?.exitCode).toBe(23);
  });

  it('restores after a partial Windows native build failure', () => {
    const calls: string[] = [];
    const nativeFailure = failure('Native build failed.', 19);
    let thrown: BuildFailure | undefined;

    try {
      makeWindowsZip((command) => {
        calls.push(command.label);
        if (command.label === 'Build Windows native core') {
          throw nativeFailure;
        }
      });
    } catch (error) {
      thrown = error as BuildFailure;
    }

    expect(calls).toEqual([
      'Type-check',
      'Build Windows native core',
      'Restore host native core',
    ]);
    expect(thrown).toBe(nativeFailure);
    expect(thrown?.exitCode).toBe(19);
  });

  it('keeps the primary failure when restoring the host also fails', () => {
    const forgeFailure = failure('Forge failed.', 17);
    const restoreFailure = failure('Restore failed.', 31);
    let thrown: BuildFailure | undefined;

    try {
      makeWindowsZip((command) => {
        if (command.label === 'Package Windows ZIP') {
          throw forgeFailure;
        }
        if (command.label === 'Restore host native core') {
          throw restoreFailure;
        }
      });
    } catch (error) {
      thrown = error as BuildFailure;
    }

    expect(thrown).toBe(forgeFailure);
    expect(thrown?.exitCode).toBe(17);
    expect(thrown?.restoreError).toBe(restoreFailure);
  });

  it('fails the command when only host restoration fails', () => {
    const restoreFailure = failure('Restore failed.', 31);
    let thrown: BuildFailure | undefined;

    try {
      makeWindowsZip((command) => {
        if (command.label === 'Restore host native core') {
          throw restoreFailure;
        }
      });
    } catch (error) {
      thrown = error as BuildFailure;
    }

    expect(thrown).toBe(restoreFailure);
    expect(thrown?.exitCode).toBe(31);
  });
});
