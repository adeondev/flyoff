import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  FuseState,
  FuseV1Options,
  FuseVersion,
  getCurrentFuseWire,
} from '@electron/fuses';

import {
  findFiles,
  locatePackagedApplication,
} from './package-layout.mjs';

const { fuseTarget, resourcesDirectory } = locatePackagedApplication();
const appAsar = path.join(resourcesDirectory, 'app.asar');
const unpackedDirectory = path.join(resourcesDirectory, 'app.asar.unpacked');

assert.ok(existsSync(appAsar), `ASAR archive was not found at ${appAsar}.`);
assert.ok(
  existsSync(unpackedDirectory),
  `Unpacked native directory was not found at ${unpackedDirectory}.`,
);

const nativeModules = findFiles(
  unpackedDirectory,
  (filePath) => path.extname(filePath) === '.node',
);
assert.ok(
  nativeModules.length > 0,
  'No native Node-API module was found in app.asar.unpacked.',
);

const fuseWire = await getCurrentFuseWire(fuseTarget);
assert.equal(fuseWire.version, FuseVersion.V1);

const expectedFuses = new Map([
  [FuseV1Options.RunAsNode, FuseState.DISABLE],
  [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
  [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
  [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, FuseState.DISABLE],
  [FuseV1Options.GrantFileProtocolExtraPrivileges, FuseState.DISABLE],
  [FuseV1Options.WasmTrapHandlers, FuseState.ENABLE],
]);
const knownFuseCount = Object.values(FuseV1Options).filter(
  (value) => typeof value === 'number',
).length;
assert.equal(expectedFuses.size, knownFuseCount, 'A known fuse is not asserted.');

for (const [option, expectedState] of expectedFuses) {
  assert.equal(
    fuseWire[option],
    expectedState,
    `${FuseV1Options[option]} has an unexpected state.`,
  );
}

process.stdout.write(
  `Package verification passed with ${nativeModules.length} unpacked native module(s).\n`,
);
