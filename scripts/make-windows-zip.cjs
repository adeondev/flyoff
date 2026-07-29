'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');

class BuildCommandError extends Error {
  constructor(label, result) {
    const detail =
      result.signal === null || result.signal === undefined
        ? `exit code ${result.status ?? 1}`
        : `signal ${result.signal}`;
    super(`${label} failed with ${detail}.`, { cause: result.error });
    this.exitCode = result.status ?? 1;
    this.restoreError = undefined;
  }
}

function npmCommand(label, args) {
  const npmExecPath = process.env.npm_execpath;
  return npmExecPath
    ? {
        args: [npmExecPath, ...args],
        command: process.execPath,
        label,
      }
    : {
        args,
        command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
        label,
      };
}

function buildCommands() {
  return {
    forge: {
      args: [
        '--max-old-space-size=3072',
        path.join(
          repositoryRoot,
          'node_modules',
          '@electron-forge',
          'cli',
          'dist',
          'electron-forge-make.js',
        ),
        '--platform=win32',
        '--arch=x64',
        '--targets=@electron-forge/maker-zip',
      ],
      command: process.execPath,
      label: 'Package Windows ZIP',
    },
    restore: npmCommand('Restore host native core', [
      'run',
      'native:build',
    ]),
    typecheck: npmCommand('Type-check', ['run', 'typecheck']),
    windowsNative: npmCommand('Build Windows native core', [
      'run',
      'native:build:windows',
    ]),
  };
}

function executeCommand(command) {
  const result = spawnSync(command.command, command.args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    throw new BuildCommandError(command.label, result);
  }
}

function makeWindowsZip(execute = executeCommand) {
  const commands = buildCommands();
  execute(commands.typecheck);

  let failure;
  try {
    execute(commands.windowsNative);
    execute(commands.forge);
  } catch (error) {
    failure = error;
  } finally {
    try {
      execute(commands.restore);
    } catch (restoreError) {
      if (failure) {
        failure.restoreError = restoreError;
      } else {
        failure = restoreError;
      }
    }
  }

  if (failure) {
    throw failure;
  }
}

function reportFailure(error) {
  const failure =
    error instanceof Error ? error : new Error(String(error));
  process.stderr.write(`${failure.message}\n`);
  if (failure.restoreError) {
    process.stderr.write(`${failure.restoreError.message}\n`);
  }
  process.exitCode =
    typeof failure.exitCode === 'number' ? failure.exitCode : 1;
}

if (require.main === module) {
  try {
    makeWindowsZip();
  } catch (error) {
    reportFailure(error);
  }
}

module.exports = {
  BuildCommandError,
  buildCommands,
  makeWindowsZip,
};
