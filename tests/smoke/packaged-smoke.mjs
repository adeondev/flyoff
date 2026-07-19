import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

import { locatePackagedApplication } from './package-layout.mjs';

const { executable } = locatePackagedApplication();
const child = spawn(
  executable,
  [
    '--smoke-test',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    ...(process.platform === 'linux' && process.env.CI
      ? ['--no-sandbox']
      : []),
  ],
  {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  },
);

let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  stdout += chunk;
});
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

const timeout = setTimeout(() => {
  child.kill();
}, 45_000);

const { code, signal } = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('close', (exitCode, exitSignal) => {
    resolve({ code: exitCode, signal: exitSignal });
  });
});
clearTimeout(timeout);

assert.equal(
  signal,
  null,
  `Packaged smoke test was terminated by ${signal}.\n${stderr}`,
);
assert.equal(code, 0, `Packaged smoke test failed.\n${stdout}\n${stderr}`);

const smokeLine = stdout
  .split(/\r?\n/u)
  .find((line) => line.startsWith('FLYOFF_SMOKE '));
assert.ok(smokeLine, `Smoke result was not emitted.\n${stdout}\n${stderr}`);

const result = JSON.parse(smokeLine.slice('FLYOFF_SMOKE '.length));
assert.equal(result.ok, true, result.error ?? 'Flyoff reported a smoke failure.');
assert.equal(result.commandLineHardened, true);
assert.doesNotMatch(
  `${stdout}\n${stderr}`,
  /DevTools listening/iu,
  'The hardened package opened a remote debugging endpoint.',
);
assert.equal(result.state.platform, process.platform);
assert.equal(result.state.nativeCore.coreVersion, '0.1.0');
assert.equal(result.state.nativeCore.protocolVersion, 1);
assert.equal(
  result.state.spellcheck.provider,
  process.platform === 'darwin' ? 'macos-native' : 'bundled-hunspell',
);

process.stdout.write(
  `Packaged Flyoff smoke test passed on ${process.platform}/${process.arch}.\n`,
);
