import type { Translate } from '../pages/page-types';

export interface ProjectEmptyStateProps {
  translate: Translate;
  onCloseProject: () => void;
}

export function ProjectEmptyState({
  onCloseProject,
  translate,
}: ProjectEmptyStateProps) {
  return (
    <div className="project-empty">
      <p className="project-empty__message">
        {translate('projects.emptyWorkspace')}
      </p>
      <button
        className="project-empty__close"
        onClick={onCloseProject}
        type="button"
      >
        {translate('projects.closeProject')}
      </button>
    </div>
  );
}
