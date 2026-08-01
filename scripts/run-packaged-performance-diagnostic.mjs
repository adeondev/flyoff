import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const tempDirectoryPrefix = 'flyoff-performance-diagnostic-';
const keepTempDirectory =
  process.env.FLYOFF_KEEP_PERFORMANCE_DIAGNOSTIC_TEMP === '1';

function diagnosticSetting(name, allowed, fallback) {
  const value = process.env[name]?.trim() || fallback;
  if (!allowed.includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(', ')}.`);
  }
  return value;
}

function chromiumSwitches() {
  const serialized = process.env.FLYOFF_PERFORMANCE_CHROMIUM_SWITCHES?.trim();
  if (!serialized) {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('FLYOFF_PERFORMANCE_CHROMIUM_SWITCHES must be JSON.');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (value) =>
        typeof value !== 'string' || !/^--[a-z0-9][a-z0-9-]*(?:=.*)?$/i.test(value),
    )
  ) {
    throw new Error(
      'FLYOFF_PERFORMANCE_CHROMIUM_SWITCHES must be a JSON array of Chromium switches.',
    );
  }
  return parsed;
}

function findCaseInsensitive(entries, expectedName) {
  return entries.find(
    ({ name }) => name.toLowerCase() === expectedName.toLowerCase(),
  );
}

async function locatePackagedExecutable() {
  const outDirectory = path.join(repositoryRoot, 'out');
  let entries;

  try {
    entries = await readdir(outDirectory, { withFileTypes: true });
  } catch {
    throw new Error('Package output is missing. Run `npm run package` first.');
  }

  const suffix = `-${process.platform}-${process.arch}`;
  const candidates = entries.filter(
    (entry) => entry.isDirectory() && entry.name.endsWith(suffix),
  );

  if (candidates.length !== 1) {
    throw new Error(
      `Expected one packaged build for ${process.platform}/${process.arch} under ${outDirectory}, found ${candidates.length}. Run \`npm run package\` first.`,
    );
  }

  const buildDirectory = path.join(outDirectory, candidates[0].name);
  let executable;

  if (process.platform === 'darwin') {
    const buildEntries = await readdir(buildDirectory, { withFileTypes: true });
    const appBundle = findCaseInsensitive(buildEntries, 'Flyoff.app');

    if (!appBundle?.isDirectory()) {
      throw new Error('Flyoff.app was not found in the packaged build.');
    }

    executable = path.join(
      buildDirectory,
      appBundle.name,
      'Contents',
      'MacOS',
      'Flyoff',
    );
  } else {
    const executableName = process.platform === 'win32' ? 'Flyoff.exe' : 'Flyoff';
    const buildEntries = await readdir(buildDirectory, { withFileTypes: true });
    const executableEntry = findCaseInsensitive(buildEntries, executableName);
    executable = executableEntry
      ? path.join(buildDirectory, executableEntry.name)
      : undefined;
  }

  const executableInfo = executable
    ? await stat(executable).catch(() => undefined)
    : undefined;

  if (!executableInfo?.isFile()) {
    throw new Error('The Flyoff executable was not found in the packaged build.');
  }

  return { buildDirectory, executable };
}

function resolveOutputPaths(argument) {
  const reportPath = argument
    ? path.resolve(process.cwd(), argument)
    : path.join(
        repositoryRoot,
        'test-results',
        'performance-diagnostics',
        `performance-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}-${randomUUID().slice(0, 8)}.json`,
      );
  const extension = path.extname(reportPath);

  if (extension !== '.json') {
    throw new Error('The diagnostic output path must end in .json.');
  }

  return {
    reportPath,
    tracePath: `${reportPath.slice(0, -extension.length)}.trace.json`,
  };
}

async function assertOutputDoesNotExist(filePath) {
  try {
    await access(filePath);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  throw new Error(`Diagnostic output already exists: ${filePath}`);
}

function waitForExit(executable, args, options, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, options);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`Packaged Flyoff exceeded ${timeoutMs} ms.`));
        return;
      }
      resolve({ code, signal });
    });
  });
}

async function cleanupTempDirectory(tempDirectory) {
  const resolvedDirectory = path.resolve(tempDirectory);
  const tempParent = path.resolve(os.tmpdir());

  if (
    path.dirname(resolvedDirectory) !== tempParent ||
    !path.basename(resolvedDirectory).startsWith(tempDirectoryPrefix)
  ) {
    throw new Error(`Refusing to remove unexpected path: ${resolvedDirectory}`);
  }

  await rm(resolvedDirectory, { force: true, recursive: true });
}

async function main() {
  const outputArguments = process.argv.slice(2);
  if (outputArguments.length > 1) {
    throw new Error(
      'Usage: npm run diagnose:performance -- [absolute-or-relative-report.json]',
    );
  }

  const { buildDirectory, executable } = await locatePackagedExecutable();
  const { reportPath, tracePath } = resolveOutputPaths(outputArguments[0]);
  const suite = diagnosticSetting(
    'FLYOFF_PERFORMANCE_DIAGNOSTIC_SUITE',
    ['controls', 'full'],
    'full',
  );
  const traceMode = diagnosticSetting(
    'FLYOFF_PERFORMANCE_DIAGNOSTIC_TRACE',
    ['full', 'off'],
    'full',
  );
  const graphicsBackend = diagnosticSetting(
    'FLYOFF_PERFORMANCE_GRAPHICS_BACKEND',
    ['automatic', 'opengl'],
    'automatic',
  );
  await mkdir(path.dirname(reportPath), { recursive: true });
  await Promise.all([
    assertOutputDoesNotExist(reportPath),
    assertOutputDoesNotExist(tracePath),
  ]);

  const tempDirectory = await mkdtemp(
    path.join(path.resolve(os.tmpdir()), tempDirectoryPrefix),
  );
  const userDataPath = path.join(tempDirectory, 'user-data');
  const projectParent = path.join(tempDirectory, 'projects');
  const projectRoot = path.join(projectParent, 'Performance Diagnostic');
  await Promise.all([
    mkdir(userDataPath, { recursive: true }),
    mkdir(projectParent, { recursive: true }),
  ]);
  await writeFile(
    path.join(userDataPath, 'preferences.json'),
    `${JSON.stringify({ general: { graphicsBackend } }, null, 2)}\n`,
    'utf8',
  );

  process.stdout.write(`Performance report: ${reportPath}\n`);
  process.stdout.write(`Chromium trace: ${tracePath}\n`);
  process.stdout.write(`Graphics backend preference: ${graphicsBackend}\n`);

  try {
    const args = [
      `--user-data-dir=${userDataPath}`,
      `--flyoff-performance-diagnostic=${reportPath}`,
      `--flyoff-performance-diagnostic-suite=${suite}`,
      `--flyoff-performance-diagnostic-trace=${traceMode}`,
      ...chromiumSwitches(),
    ];
    if (process.platform === 'linux' && process.env.CI) {
      args.push('--no-sandbox');
    }

    const { code, signal } = await waitForExit(
      executable,
      args,
      {
        cwd: buildDirectory,
        env: {
          ...process.env,
          FLYOFF_E2E: '1',
          FLYOFF_E2E_PROJECT_CREATE_PARENT: projectParent,
          FLYOFF_E2E_PROJECT_OPEN_ROOT: projectRoot,
          FLYOFF_E2E_USER_DATA: userDataPath,
        },
        stdio: 'inherit',
      },
      suite === 'controls' ? 90_000 : 300_000,
    );

    if (signal) {
      throw new Error(`Packaged Flyoff exited after receiving signal ${signal}.`);
    }
    if (code !== 0) {
      throw new Error(`Packaged Flyoff exited with code ${code}.`);
    }

    await access(reportPath);
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    if (report.trace?.path) {
      await access(report.trace.path);
    }
    process.stdout.write(`Diagnostic completed.\nReport: ${reportPath}\n`);
    process.stdout.write(
      report.trace?.path ? `Trace: ${report.trace.path}\n` : 'Trace: disabled\n',
    );
  } finally {
    if (keepTempDirectory) {
      process.stdout.write(`Temporary data kept at: ${tempDirectory}\n`);
    } else {
      await cleanupTempDirectory(tempDirectory);
    }
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
