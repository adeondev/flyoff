import {
  projectFailure,
  type ProjectErrorCode,
  type ProjectResult,
} from '../../shared/contracts/projects';

export class ProjectOperationError extends Error {
  readonly code: ProjectErrorCode;
  readonly currentRevision?: string;

  constructor(
    code: ProjectErrorCode,
    message: string,
    options: { cause?: unknown; currentRevision?: string } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ProjectOperationError';
    this.code = code;
    this.currentRevision = options.currentRevision;
  }
}

function filesystemErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return undefined;
  }

  return typeof error.code === 'string' ? error.code : undefined;
}

export function normalizeProjectError(
  error: unknown,
  fallbackMessage = 'The project operation could not be completed.',
): ProjectOperationError {
  if (error instanceof ProjectOperationError) {
    return error;
  }

  const code = filesystemErrorCode(error);

  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return new ProjectOperationError(
      'permission-denied',
      'Flyoff does not have permission to access this project.',
      { cause: error },
    );
  }

  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return new ProjectOperationError(
      'not-found',
      'The requested project or content no longer exists.',
      { cause: error },
    );
  }

  if (code === 'EEXIST' || code === 'ENOTEMPTY') {
    return new ProjectOperationError(
      'collision',
      'Content with that name already exists in this location.',
      { cause: error },
    );
  }

  if (code === 'EFBIG' || code === 'ENOSPC') {
    return new ProjectOperationError(
      'size-exceeded',
      'The project content exceeds the supported storage limit.',
      { cause: error },
    );
  }

  return new ProjectOperationError('io-error', fallbackMessage, {
    cause: error,
  });
}

export function projectErrorResult<T>(error: unknown): ProjectResult<T> {
  const normalized = normalizeProjectError(error);
  return projectFailure(
    normalized.code,
    normalized.message,
    normalized.currentRevision,
  );
}
