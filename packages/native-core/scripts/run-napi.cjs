'use strict';

const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const cliPackagePath = require.resolve('@napi-rs/cli/package.json');
const cliPackage = require(cliPackagePath);
const cliPath = path.resolve(
  path.dirname(cliPackagePath),
  cliPackage.bin.napi,
);
const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
const env = {
  ...process.env,
  PATH: `${cargoBin}${path.delimiter}${process.env.PATH ?? ''}`,
};
const result = spawnSync(
  process.execPath,
  [cliPath, ...process.argv.slice(2)],
  {
    cwd: path.resolve(__dirname, '..'),
    env,
    stdio: 'inherit',
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
