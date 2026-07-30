const { app, BrowserWindow } = require('electron');
const { build } = require('esbuild');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('ozone-platform', 'headless');
app.commandLine.appendSwitch('disable-gpu');
// Precise heap readings, so a keystroke that triggered a collection can be told
// apart from one that merely allocated.
app.commandLine.appendSwitch('enable-precise-memory-info');
app.commandLine.appendSwitch('js-flags', '--expose-gc');

async function run() {
  const lineCount =
    Number.parseInt(process.env.FLYOFF_PROFILE_LINES ?? '', 10) || 20_000;
  const samples =
    Number.parseInt(process.env.FLYOFF_PROFILE_SAMPLES ?? '', 10) || 200;
  const throttleRate = Number.parseFloat(
    process.env.FLYOFF_PROFILE_CPU_THROTTLE ?? '1',
  );
  const ablation = process.env.FLYOFF_PROFILE_ABLATION ?? 'none';
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), 'flyoff-keystroke-'),
  );

  try {
    const bundlePath = path.join(temporaryDirectory, 'profile.js');
    const htmlPath = path.join(temporaryDirectory, 'profile.html');
    await build({
      bundle: true,
      entryPoints: [path.join(root, 'scripts', 'keystroke-latency-entry.ts')],
      format: 'iife',
      outfile: bundlePath,
      platform: 'browser',
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
      await readFile(
        path.join(root, 'src', 'renderer', 'projects', 'projects.css'),
        'utf8',
      ),
    );
    if (Number.isFinite(throttleRate) && throttleRate > 1) {
      window.webContents.debugger.attach('1.3');
      await window.webContents.debugger.sendCommand(
        'Emulation.setCPUThrottlingRate',
        { rate: throttleRate },
      );
    }
    const result = await window.webContents.executeJavaScript(
      `window.runKeystrokeLatencyProfile(${lineCount}, ${JSON.stringify({
        ablation,
        samples,
      })})`,
      true,
    );
    result.cpuThrottlingRate =
      Number.isFinite(throttleRate) && throttleRate > 1 ? throttleRate : 1;
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    window.destroy();
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
    app.quit();
  }
}

void run();
