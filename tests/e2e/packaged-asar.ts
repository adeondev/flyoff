import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

function entryWithName(directory: string, expectedName: string): string {
  const entry = readdirSync(directory, { withFileTypes: true }).find(
    ({ name }) => name.toLowerCase() === expectedName.toLowerCase(),
  );

  if (!entry) {
    throw new Error(`${expectedName} was not found in ${directory}.`);
  }

  return path.join(directory, entry.name);
}

function packagedBuild(repositoryRoot: string): string {
  const outDirectory = process.env.FLYOFF_E2E_OUT_DIR
    ? path.resolve(repositoryRoot, process.env.FLYOFF_E2E_OUT_DIR)
    : path.join(repositoryRoot, 'out');
  const expectedSuffix = `-${process.platform}-${process.arch}`;

  if (!existsSync(outDirectory)) {
    throw new Error(
      'The packaged app is missing. Run `npm run package` before `npm run test:e2e`.',
    );
  }

  const candidates = readdirSync(outDirectory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name.endsWith(expectedSuffix),
    )
    .map(({ name }) => path.join(outDirectory, name));

  if (candidates.length !== 1 || !candidates[0]) {
    throw new Error(
      `Expected one package for ${process.platform}/${process.arch}, found ${candidates.length}.`,
    );
  }

  return candidates[0];
}

export function locatePackagedAsar(repositoryRoot: string): string {
  const buildDirectory = packagedBuild(repositoryRoot);
  const resourcesDirectory =
    process.platform === 'darwin'
      ? path.join(
          entryWithName(buildDirectory, 'Flyoff.app'),
          'Contents',
          'Resources',
        )
      : path.join(buildDirectory, 'resources');
  const appPath = path.join(resourcesDirectory, 'app.asar');

  if (!existsSync(appPath)) {
    throw new Error(`The packaged ASAR was not found at ${appPath}.`);
  }

  return appPath;
}
