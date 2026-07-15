import { isPortableProjectName } from '../../shared/contracts/projects';
import { ProjectOperationError } from './errors';

export { isPortableProjectName } from '../../shared/contracts/projects';

export function assertPortableProjectName(name: unknown): asserts name is string {
  if (!isPortableProjectName(name)) {
    throw new ProjectOperationError(
      'invalid-name',
      'Names must be portable, contain 1 to 100 characters, and avoid reserved characters or device names.',
    );
  }
}
