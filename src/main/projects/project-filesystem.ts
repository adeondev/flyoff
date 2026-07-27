import {
  copyFile,
  cp,
  link,
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

import { ProjectOperationError, normalizeProjectError } from './errors';
import { isPortableProjectName } from './portable-name';
import type { ContentIndexEntry } from './project-format';
import { projectPageStorageMatch } from './project-storage-adapters';
import {
  PROJECT_MEDIA_DIRECTORY,
  PROJECT_METADATA_DIRECTORY,
} from './project-paths';

export interface DiscoveredProjectNode {
  name: string;
  kind: 'folder' | 'page';
  locator: string;
  pageType?: string;
}

export interface ProjectFileIdentity {
  device: number;
  inode: number;
  modifiedAt: number;
  size: number;
}

function isInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

export class ProjectFileSystem {
  readonly rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  static async validateCreationParent(parentPath: string): Promise<void> {
    try {
      const stats = await lstat(parentPath);

      if (stats.isSymbolicLink()) {
        throw new ProjectOperationError(
          'unsafe-path',
          'Projects cannot be created through a symbolic link.',
        );
      }

      if (!stats.isDirectory()) {
        throw new ProjectOperationError(
          'not-found',
          'The selected project location is not a directory.',
        );
      }
    } catch (error) {
      throw normalizeProjectError(error);
    }
  }

  static async canonicalProjectRoot(rootPath: string): Promise<string> {
    if (!path.isAbsolute(rootPath)) {
      throw new ProjectOperationError(
        'unsafe-path',
        'Project paths must be absolute.',
      );
    }

    try {
      const stats = await lstat(rootPath);

      if (stats.isSymbolicLink()) {
        throw new ProjectOperationError(
          'unsafe-path',
          'Flyoff projects cannot be opened through a symbolic link.',
        );
      }

      if (!stats.isDirectory()) {
        throw new ProjectOperationError(
          'invalid-format',
          'The selected project location is not a directory.',
        );
      }

      return await realpath(rootPath);
    } catch (error) {
      throw normalizeProjectError(error);
    }
  }

  static async validateMetadataDirectory(rootPath: string): Promise<void> {
    const metadataPath = path.join(rootPath, PROJECT_METADATA_DIRECTORY);

    try {
      const stats = await lstat(metadataPath);

      if (stats.isSymbolicLink()) {
        throw new ProjectOperationError(
          'unsafe-path',
          'Project metadata cannot be stored through a symbolic link.',
        );
      }

      if (!stats.isDirectory()) {
        throw new ProjectOperationError(
          'invalid-format',
          'The selected folder does not contain Flyoff project metadata.',
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ProjectOperationError(
          'invalid-format',
          'The selected folder is not a Flyoff project.',
          { cause: error },
        );
      }

      throw normalizeProjectError(error);
    }
  }

  async resolveParentDirectory(
    parent: ContentIndexEntry | undefined,
  ): Promise<string> {
    return parent ? this.resolveExistingEntry(parent) : this.validateRoot();
  }

  async resolveExistingEntry(entry: ContentIndexEntry): Promise<string> {
    await this.validateRoot();
    const segments = entry.locator.split('/');
    let cursor = this.rootPath;

    for (const [index, segment] of segments.entries()) {
      cursor = path.join(cursor, segment);

      try {
        const stats = await lstat(cursor);

        if (stats.isSymbolicLink()) {
          throw new ProjectOperationError(
            'unsafe-path',
            'Symbolic links and junctions are not supported inside Flyoff projects.',
          );
        }

        const isFinalSegment = index === segments.length - 1;

        if (
          (!isFinalSegment && !stats.isDirectory()) ||
          (isFinalSegment && entry.kind === 'folder' && !stats.isDirectory()) ||
          (isFinalSegment && entry.kind === 'page' && !stats.isFile())
        ) {
          throw new ProjectOperationError(
            'not-found',
            'The requested project content no longer matches its index entry.',
          );
        }
      } catch (error) {
        throw normalizeProjectError(error);
      }
    }

    const canonicalPath = await realpath(cursor).catch((error: unknown) => {
      throw normalizeProjectError(error);
    });

    if (!isInside(this.rootPath, canonicalPath)) {
      throw new ProjectOperationError(
        'unsafe-path',
        'The requested content resolves outside the project.',
      );
    }

    return canonicalPath;
  }

  async scanChildren(
    parent: ContentIndexEntry | undefined,
  ): Promise<DiscoveredProjectNode[]> {
    const directoryPath = await this.resolveParentDirectory(parent);
    let directoryEntries;

    try {
      directoryEntries = await readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
      throw normalizeProjectError(error);
    }

    const discovered: DiscoveredProjectNode[] = [];

    for (const directoryEntry of directoryEntries) {
      if (
        directoryEntry.isSymbolicLink() ||
        directoryEntry.name.toLowerCase() === PROJECT_METADATA_DIRECTORY ||
        (!parent &&
          directoryEntry.name.toLocaleLowerCase() ===
            PROJECT_MEDIA_DIRECTORY.toLocaleLowerCase())
      ) {
        continue;
      }

      const absolutePath = path.join(directoryPath, directoryEntry.name);
      const stats = await lstat(absolutePath).catch(() => undefined);

      if (!stats || stats.isSymbolicLink()) {
        continue;
      }

      if (stats.isDirectory() && isPortableProjectName(directoryEntry.name)) {
        discovered.push({
          name: directoryEntry.name,
          kind: 'folder',
          locator: this.joinLocator(parent?.locator, directoryEntry.name),
        });
        continue;
      }

      if (!stats.isFile()) {
        continue;
      }

      const storage = projectPageStorageMatch(directoryEntry.name);
      if (!storage) {
        continue;
      }
      const name = directoryEntry.name.slice(0, -storage.extension.length);

      if (isPortableProjectName(name)) {
        discovered.push({
          name,
          kind: 'page',
          locator: this.joinLocator(parent?.locator, directoryEntry.name),
          pageType: storage.pageType,
        });
      }
    }

    discovered.sort((left, right) => left.locator.localeCompare(right.locator));

    for (let index = 1; index < discovered.length; index += 1) {
      const previous = discovered[index - 1];
      const current = discovered[index];

      if (
        previous &&
        current &&
        previous.locator.toLowerCase() === current.locator.toLowerCase()
      ) {
        throw new ProjectOperationError(
          'collision',
          'The project contains names that collide on case-insensitive filesystems.',
        );
      }
    }

    return discovered;
  }

  joinLocator(parentLocator: string | undefined, diskName: string): string {
    return parentLocator ? path.posix.join(parentLocator, diskName) : diskName;
  }

  async ensureNameAvailable(
    directoryPath: string,
    diskName: string,
    ignoredName?: string,
  ): Promise<void> {
    const names = await readdir(directoryPath);
    const foldedName = diskName.toLowerCase();

    if (
      names.some(
        (name) => name !== ignoredName && name.toLowerCase() === foldedName,
      )
    ) {
      throw new ProjectOperationError(
        'collision',
        'Content with that name already exists in this location.',
      );
    }
  }

  async pathExists(candidatePath: string): Promise<boolean> {
    try {
      await lstat(candidatePath);
      return true;
    } catch {
      return false;
    }
  }

  async captureIdentity(candidatePath: string): Promise<ProjectFileIdentity> {
    const stats = await lstat(candidatePath).catch((error: unknown) => {
      throw normalizeProjectError(error);
    });
    return {
      device: stats.dev,
      inode: stats.ino,
      modifiedAt: stats.mtimeMs,
      size: stats.size,
    };
  }

  async removeIfUnchanged(
    candidatePath: string,
    identity: ProjectFileIdentity,
    kind: ContentIndexEntry['kind'],
  ): Promise<void> {
    await this.validateRoot();
    const relative = path.relative(this.rootPath, candidatePath);

    if (
      relative === '' ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      return;
    }

    const stats = await lstat(candidatePath).catch(() => undefined);

    if (
      !stats ||
      stats.isSymbolicLink() ||
      stats.dev !== identity.device ||
      stats.ino !== identity.inode ||
      stats.mtimeMs !== identity.modifiedAt ||
      stats.size !== identity.size
    ) {
      return;
    }

    if (kind === 'folder' && (await readdir(candidatePath)).length > 0) {
      return;
    }

    await rm(candidatePath, { recursive: kind === 'folder' });
  }

  async moveWithoutOverwrite(
    sourcePath: string,
    destinationPath: string,
    kind: ContentIndexEntry['kind'],
  ): Promise<void> {
    if (sourcePath === destinationPath) {
      return;
    }

    if (
      sourcePath.toLowerCase() === destinationPath.toLowerCase() &&
      (await this.isCaseOnlyAlias(sourcePath, destinationPath))
    ) {
      if (!(await this.isCaseOnlyAlias(sourcePath, destinationPath))) {
        throw new ProjectOperationError(
          'collision',
          'Content with that name already exists in this location.',
        );
      }

      await rename(sourcePath, destinationPath).catch((error: unknown) => {
        throw normalizeProjectError(error);
      });
      return;
    }

    if (kind === 'folder') {
      await this.moveFolderWithoutOverwrite(sourcePath, destinationPath);
      return;
    }

    let linked = false;

    try {
      await link(sourcePath, destinationPath);
      linked = true;
      await unlink(sourcePath);
    } catch (error) {
      if (linked && (await this.pathExists(sourcePath))) {
        await unlink(destinationPath).catch(() => undefined);
      }

      if (!linked && this.canFallbackFromHardLink(error)) {
        await this.copyFileWithoutOverwrite(sourcePath, destinationPath);
        return;
      }

      throw normalizeProjectError(error);
    }
  }

  async validateMetadataFileForWrite(fileName: string): Promise<void> {
    await this.validateRoot();
    await ProjectFileSystem.validateMetadataDirectory(this.rootPath);
    const metadataPath = path.join(this.rootPath, PROJECT_METADATA_DIRECTORY);
    const canonicalMetadataPath = await realpath(metadataPath).catch(
      (error: unknown) => {
        throw normalizeProjectError(error);
      },
    );

    if (!isInside(this.rootPath, canonicalMetadataPath)) {
      throw new ProjectOperationError(
        'unsafe-path',
        'Project metadata resolves outside the project.',
      );
    }

    const filePath = path.join(canonicalMetadataPath, fileName);

    try {
      const stats = await lstat(filePath);

      if (stats.isSymbolicLink()) {
        throw new ProjectOperationError(
          'unsafe-path',
          'Project metadata cannot be stored through a symbolic link.',
        );
      }

      if (!stats.isFile()) {
        throw new ProjectOperationError(
          'invalid-format',
          'Project metadata is not a regular file.',
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw normalizeProjectError(error);
      }
    }
  }

  private async validateRoot(): Promise<string> {
    const canonicalRoot = await ProjectFileSystem.canonicalProjectRoot(
      this.rootPath,
    );

    if (path.relative(this.rootPath, canonicalRoot) !== '') {
      throw new ProjectOperationError(
        'unsafe-path',
        'The project root changed after it was opened.',
      );
    }

    return canonicalRoot;
  }

  private canFallbackFromHardLink(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return (
      code === 'EXDEV' ||
      code === 'ENOSYS' ||
      code === 'ENOTSUP' ||
      code === 'EOPNOTSUPP' ||
      code === 'EINVAL' ||
      code === 'EPERM'
    );
  }

  private async isCaseOnlyAlias(
    sourcePath: string,
    destinationPath: string,
  ): Promise<boolean> {
    const sourceStats = await lstat(sourcePath, { bigint: true }).catch(
      (error: unknown) => {
        throw normalizeProjectError(error);
      },
    );
    let destinationStats;

    try {
      destinationStats = await lstat(destinationPath, { bigint: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }

      throw normalizeProjectError(error);
    }

    if (
      sourceStats.isSymbolicLink() ||
      destinationStats.isSymbolicLink()
    ) {
      throw new ProjectOperationError(
        'unsafe-path',
        'Symbolic links and junctions are not supported inside Flyoff projects.',
      );
    }

    if (
      sourceStats.dev !== destinationStats.dev ||
      sourceStats.ino !== destinationStats.ino
    ) {
      throw new ProjectOperationError(
        'collision',
        'Content with that name already exists in this location.',
      );
    }

    const [canonicalSource, canonicalDestination] = await Promise.all([
      realpath(sourcePath),
      realpath(destinationPath),
    ]).catch((error: unknown) => {
      throw normalizeProjectError(error);
    });

    if (path.relative(canonicalSource, canonicalDestination) !== '') {
      throw new ProjectOperationError(
        'collision',
        'Content with that name already exists in this location.',
      );
    }

    return true;
  }

  private async copyFileWithoutOverwrite(
    sourcePath: string,
    destinationPath: string,
  ): Promise<void> {
    let copied = false;

    try {
      await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
      copied = true;
      await unlink(sourcePath);
    } catch (error) {
      if (copied && (await this.pathExists(sourcePath))) {
        await unlink(destinationPath).catch(() => undefined);
      }

      throw normalizeProjectError(error);
    }
  }

  private async moveFolderWithoutOverwrite(
    sourcePath: string,
    destinationPath: string,
  ): Promise<void> {
    let destinationCreated = false;
    let removingSource = false;

    try {
      await mkdir(destinationPath);
      destinationCreated = true;
      const children = await readdir(sourcePath);

      for (const child of children) {
        await cp(
          path.join(sourcePath, child),
          path.join(destinationPath, child),
          {
            recursive: true,
            errorOnExist: true,
            force: false,
            preserveTimestamps: true,
            mode: constants.COPYFILE_FICLONE,
            filter: async (candidatePath) => {
              const stats = await lstat(candidatePath);

              if (stats.isSymbolicLink()) {
                throw new ProjectOperationError(
                  'unsafe-path',
                  'Symbolic links and junctions are not supported inside Flyoff projects.',
                );
              }

              return true;
            },
          },
        );
      }

      removingSource = true;
      await rm(sourcePath, { recursive: true });
    } catch (error) {
      if (destinationCreated && !removingSource) {
        await rm(destinationPath, { recursive: true, force: true }).catch(
          () => undefined,
        );
      }

      throw normalizeProjectError(error);
    }
  }
}
