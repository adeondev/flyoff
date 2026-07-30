const { app, BrowserWindow } = require('electron');
const { build } = require('esbuild');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('ozone-platform', 'headless');
app.commandLine.appendSwitch('disable-gpu');

/** Aggregate a CDP CPU profile into self time per function. */
function selfTimeByFunction(profile) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const selfTime = new Map();
  const total = { ms: 0 };

  for (let index = 0; index < profile.samples.length; index += 1) {
    const delta = (profile.timeDeltas[index] ?? 0) / 1000;
    if (delta <= 0) {
      continue;
    }
    total.ms += delta;
    const node = byId.get(profile.samples[index]);
    if (!node) {
      continue;
    }
    const frame = node.callFrame;
    const name = frame.functionName || '(anonymous)';
    const file = (frame.url || '').split('/').pop() || '(native)';
    const key = `${name} @ ${file}:${frame.lineNumber + 1}`;
    selfTime.set(key, (selfTime.get(key) ?? 0) + delta);
  }

  return { rows: [...selfTime.entries()].sort((a, b) => b[1] - a[1]), total };
}

async function profilePass(window, label, call) {
  const debug = window.webContents.debugger;
  await debug.sendCommand('Profiler.start');
  await window.webContents.executeJavaScript(call, true);
  const { profile } = await debug.sendCommand('Profiler.stop');
  const { rows, total } = selfTimeByFunction(profile);

  process.stdout.write(`\n=== ${label} (${total.ms.toFixed(0)} ms sampled) ===\n`);
  for (const [name, ms] of rows.slice(0, 18)) {
    const share = total.ms > 0 ? (ms / total.ms) * 100 : 0;
    process.stdout.write(
      `${ms.toFixed(1).padStart(8)} ms  ${share.toFixed(1).padStart(5)}%  ${name}\n`,
    );
  }
}

async function run() {
  const requested = Number.parseInt(process.env.FLYOFF_BENCHMARK_LINES ?? '', 10);
  const lineCount = Number.isSafeInteger(requested) && requested > 0 ? requested : 20_000;
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'flyoff-source-profile-'));

  try {
    process.stderr.write('Bundling profile...\n');
    const bundlePath = path.join(temporaryDirectory, 'profile.js');
    const htmlPath = path.join(temporaryDirectory, 'profile.html');
    await build({
      bundle: true,
      entryPoints: [path.join(root, 'scripts', 'profile-source-entry.ts')],
      format: 'iife',
      outfile: bundlePath,
      platform: 'browser',
      sourcemap: 'inline',
      target: 'chrome142',
    });
    await writeFile(
      htmlPath,
      '<!doctype html><html><body><script src="./profile.js"></script></body></html>',
    );

    await app.whenReady();
    const window = new BrowserWindow({
      height: 900,
      show: false,
      width: 1280,
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        offscreen: true,
        sandbox: true,
      },
    });
    await window.loadFile(htmlPath);
    await window.webContents.insertCSS(
      await readFile(path.join(root, 'src', 'renderer', 'projects', 'projects.css'), 'utf8'),
    );

    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Profiler.enable');
    await window.webContents.debugger.sendCommand(
      'Profiler.setSamplingInterval',
      { interval: 100 },
    );

    process.stderr.write('Setting up view...\n');
    await window.webContents.executeJavaScript(
      `window.setUpSourceProfile(${lineCount})`,
      true,
    );

    await profilePass(window, 'scroll pass', 'window.runSourceScrollPass()');
    await profilePass(window, 'edit pass', 'window.runSourceEditPass()');

    const caret = await window.webContents.executeJavaScript(
      'window.inspectCaretWhileTyping()',
      true,
    );
    process.stdout.write(`\n=== caret geometry ===\n${JSON.stringify(caret, null, 2)}\n`);

    window.destroy();
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
    app.quit();
  }
}

void run();
