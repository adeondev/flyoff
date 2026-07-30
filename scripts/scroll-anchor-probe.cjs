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
  const requestedLines = Number.parseInt(
    process.env.FLYOFF_PROBE_LINES ?? '',
    10,
  );
  const lineCount =
    Number.isSafeInteger(requestedLines) && requestedLines > 0
      ? requestedLines
      : 11_000;
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), 'flyoff-scroll-anchor-'),
  );

  try {
    const bundlePath = path.join(temporaryDirectory, 'probe.js');
    const htmlPath = path.join(temporaryDirectory, 'probe.html');
    await build({
      bundle: true,
      entryPoints: [path.join(root, 'scripts', 'scroll-anchor-probe-entry.ts')],
      format: 'iife',
      outfile: bundlePath,
      platform: 'browser',
      target: 'chrome142',
    });
    await writeFile(
      htmlPath,
      '<!doctype html><html><body><script src="./probe.js"></script></body></html>',
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
      await readFile(
        path.join(root, 'src', 'renderer', 'projects', 'projects.css'),
        'utf8',
      ),
    );
    const result = await window.webContents.executeJavaScript(
      `window.runScrollAnchorProbe(${lineCount})`,
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
