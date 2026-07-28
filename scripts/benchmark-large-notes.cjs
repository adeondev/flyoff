const { app, BrowserWindow } = require('electron');
const { build } = require('esbuild');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('ozone-platform', 'headless');
app.commandLine.appendSwitch('disable-gpu');

async function run() {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), 'flyoff-large-notes-'),
  );

  try {
    process.stderr.write('Bundling benchmark...\n');
    const bundlePath = path.join(temporaryDirectory, 'benchmark.js');
    const htmlPath = path.join(temporaryDirectory, 'benchmark.html');
    await build({
      bundle: true,
      entryPoints: [
        path.join(root, 'scripts', 'benchmark-large-notes-entry.ts'),
      ],
      format: 'iife',
      outfile: bundlePath,
      platform: 'browser',
      target: 'chrome142',
    });
    await writeFile(
      htmlPath,
      '<!doctype html><html><body><script src="./benchmark.js"></script></body></html>',
    );

    await app.whenReady();
    process.stderr.write('Opening offscreen Chromium window...\n');
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
      await readFile(
        path.join(root, 'src', 'renderer', 'projects', 'projects.css'),
        'utf8',
      ),
    );
    process.stderr.write('Running benchmark cases...\n');
    const result = await window.webContents.executeJavaScript(
      'window.runLargeNotesBenchmark()',
      true,
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    window.destroy();
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
    app.quit();
  }
}

void run();
