const { spawnSync } = require('node:child_process');

const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js');
const result = spawnSync(process.execPath, [nodeGyp, ...process.argv.slice(2)], {
  cwd: require('node:path').resolve(__dirname, '..'),
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
