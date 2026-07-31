/**
 * Where a keystroke's bytes come from, attributed to the code that allocates
 * them.
 *
 * `profile:keystroke` reports how much the heap grew per key but not who grew
 * it, and a heap delta stops being meaningful once a collection lands inside
 * the measured window. This attaches V8's sampling heap profiler instead, which
 * counts allocations rather than survivors.
 *
 * Setup allocates far more than the keystrokes do, so the run is done twice
 * with different sample counts and the two profiles are subtracted: everything
 * that does not scale with the number of keys cancels, and what remains is
 * divided by the difference to give bytes per keystroke.
 *
 * Env: FLYOFF_PROFILE_LINES, FLYOFF_ALLOC_BASE_SAMPLES, FLYOFF_ALLOC_SAMPLES,
 * FLYOFF_PROFILE_ABLATION.
 */
const { app, BrowserWindow } = require('electron');
const { build } = require('esbuild');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('enable-precise-memory-info');
app.commandLine.appendSwitch('js-flags', '--expose-gc');
// Each run gets its own window and destroys it; without this the first destroy
// closes the last window and Electron quits before the second run starts.
app.on('window-all-closed', () => undefined);

/** Sum self bytes per `function (file:line)` over the sampling profile tree. */
function foldProfile(node, totals) {
  const frame = node.callFrame ?? {};
  const name = frame.functionName || '(anonymous)';
  const url = (frame.url || '').split('/').pop() || '?';
  const key = `${name} (${url}:${frame.lineNumber ?? -1})`;
  const self = node.selfSize ?? 0;
  if (self > 0) {
    totals.set(key, (totals.get(key) ?? 0) + self);
  }
  for (const child of node.children ?? []) {
    foldProfile(child, totals);
  }
  return totals;
}

async function profileRun(makeWindow, lineCount, samples, ablation) {
  // A fresh window per run: the harness builds its document once, and reusing
  // it made the second run measure almost nothing.
  const window = await makeWindow();
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('HeapProfiler.enable');
  await window.webContents.debugger.sendCommand(
    'HeapProfiler.startSampling',
    // Small interval: a keystroke allocates little enough that the default
    // 32 KB interval puts only a handful of samples on the interesting frames.
    { samplingInterval: 2_048 },
  );
  await window.webContents.executeJavaScript(
    `window.runKeystrokeLatencyProfile(${lineCount}, ${JSON.stringify({
      ablation,
      samples,
    })})`,
    true,
  );
  const { profile } = await window.webContents.debugger.sendCommand(
    'HeapProfiler.stopSampling',
  );
  await window.webContents.debugger.sendCommand('HeapProfiler.disable');
  const totals = foldProfile(profile.head, new Map());
  window.destroy();
  return totals;
}

async function run() {
  const lineCount =
    Number.parseInt(process.env.FLYOFF_PROFILE_LINES ?? '', 10) || 20_000;
  const baseSamples =
    Number.parseInt(process.env.FLYOFF_ALLOC_BASE_SAMPLES ?? '', 10) || 50;
  const samples =
    Number.parseInt(process.env.FLYOFF_ALLOC_SAMPLES ?? '', 10) || 450;
  const ablation = process.env.FLYOFF_PROFILE_ABLATION ?? 'none';
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), 'flyoff-keystroke-alloc-'),
  );

  try {
    const bundlePath = path.join(temporaryDirectory, 'profile.js');
    const htmlPath = path.join(temporaryDirectory, 'profile.html');
    await build({
      bundle: true,
      entryPoints: [path.join(root, 'scripts', 'keystroke-latency-entry.ts')],
      format: 'iife',
      // Names survive minification-free bundling, which is what makes the
      // attribution readable.
      outfile: bundlePath,
      platform: 'browser',
      target: 'chrome142',
    });
    await writeFile(
      htmlPath,
      '<!doctype html><html><body><script src="./profile.js"></script></body></html>',
    );

    await app.whenReady();
    const css = await readFile(
      path.join(root, 'src', 'renderer', 'projects', 'projects.css'),
      'utf8',
    );
    const makeWindow = async () => {
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
      await window.webContents.insertCSS(css);
      return window;
    };

    const low = await profileRun(makeWindow, lineCount, baseSamples, ablation);
    const high = await profileRun(makeWindow, lineCount, samples, ablation);
    const sum = (map) => [...map.values()].reduce((a, b) => a + b, 0);
    process.stdout.write(
      `[diag] sites low=${low.size} high=${high.size} bytes low=${sum(low)} high=${sum(high)}\n`,
    );

    const delta = samples - baseSamples;
    const rows = [];
    let total = 0;
    for (const [key, bytes] of high) {
      const perKey = (bytes - (low.get(key) ?? 0)) / delta;
      if (perKey > 512) {
        rows.push({ bytesPerKeystroke: Math.round(perKey), site: key });
        total += perKey;
      }
    }
    rows.sort((left, right) => right.bytesPerKeystroke - left.bytesPerKeystroke);

    process.stdout.write(
      `\nlines=${lineCount} ablation=${ablation} keys=${baseSamples}->${samples}\n` +
        `attributed total: ${(total / 1024).toFixed(1)} KB per keystroke\n\n`,
    );
    for (const row of rows.slice(0, 30)) {
      process.stdout.write(
        `${(row.bytesPerKeystroke / 1024).toFixed(1).padStart(9)} KB  ${row.site}\n`,
      );
    }
    process.stdout.write('\n');

  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
    app.quit();
  }
}

void run();
