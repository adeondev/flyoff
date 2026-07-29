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
      loader: { '.svg': 'dataurl' },
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
    const styles = await Promise.all([
      path.join(root, 'src', 'renderer', 'styles.css'),
      path.join(root, 'src', 'renderer', 'projects', 'projects.css'),
      path.join(
        root,
        'src',
        'renderer',
        'projects',
        'virtual-source-editor.css',
      ),
    ].map((file) => readFile(file, 'utf8')));
    await window.webContents.insertCSS(styles.join('\n'));
    process.stderr.write('Running benchmark cases...\n');
    const benchmarkExpression =
      process.env.FLYOFF_BENCHMARK_VIRTUAL_ONLY === '1'
        ? 'window.runVirtualSourceBenchmark()'
        : 'window.runLargeNotesBenchmark()';
    const result = await window.webContents.executeJavaScript(
      benchmarkExpression,
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
