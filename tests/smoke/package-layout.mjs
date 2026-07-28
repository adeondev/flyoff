import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

function findCaseInsensitive(directory, expectedName) {
  const entry = readdirSync(directory, { withFileTypes: true }).find(
    ({ name }) => name.toLowerCase() === expectedName.toLowerCase(),
  );

  return entry ? path.join(directory, entry.name) : undefined;
}

function selectBuildDirectory(outDirectory, platform, arch) {
  const suffix = `-${platform}-${arch}`;
  const candidates = readdirSync(outDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(suffix))
    .map(({ name }) => path.join(outDirectory, name));

  if (candidates.length !== 1) {
    throw new Error(
      `Expected one packaged build for ${platform}/${arch}, found ${candidates.length}.`,
    );
  }

  return candidates[0];
}

export function locatePackagedApplication() {
  const platform = process.env.FLYOFF_PACKAGE_PLATFORM ?? process.platform;
  const arch = process.env.FLYOFF_PACKAGE_ARCH ?? process.arch;
  const configuredOutDirectory =
    process.env.FLYOFF_PACKAGE_OUT_DIR ?? process.env.FLYOFF_E2E_OUT_DIR;
  const outDirectory = configuredOutDirectory
    ? path.resolve(repositoryRoot, configuredOutDirectory)
    : path.join(repositoryRoot, 'out');

  if (!existsSync(outDirectory)) {
    throw new Error('Package output is missing. Run `npm run package` first.');
  }

  const buildDirectory = selectBuildDirectory(outDirectory, platform, arch);

  if (platform === 'darwin') {
    const appPath = findCaseInsensitive(buildDirectory, 'Flyoff.app');
    if (!appPath || !statSync(appPath).isDirectory()) {
      throw new Error('Flyoff.app was not found in the packaged build.');
    }

    const executable = path.join(appPath, 'Contents', 'MacOS', 'Flyoff');
    return {
      appPath,
      buildDirectory,
      executable,
      fuseTarget: appPath,
      resourcesDirectory: path.join(appPath, 'Contents', 'Resources'),
    };
  }

  const executableName = platform === 'win32' ? 'Flyoff.exe' : 'Flyoff';
  const executable = findCaseInsensitive(buildDirectory, executableName);
  if (!executable || !statSync(executable).isFile()) {
    throw new Error(`${executableName} was not found in the packaged build.`);
  }

  return {
    appPath: buildDirectory,
    buildDirectory,
    executable,
    fuseTarget: executable,
    resourcesDirectory: path.join(buildDirectory, 'resources'),
  };
}

export function findFiles(directory, predicate) {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return findFiles(entryPath, predicate);
    }

    return predicate(entryPath) ? [entryPath] : [];
  });
}
