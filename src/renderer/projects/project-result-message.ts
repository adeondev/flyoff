import type { ProjectFailureDetails } from '../../shared/contracts';
import type { Translate } from '../pages/page-types';

export function projectFailureMessage(
  error: ProjectFailureDetails,
  translate: Translate,
): string {
  return error.code === 'authentication-failed'
    ? translate('projects.authenticationFailed')
    : error.message;
}
