import folderIcon from '../../../public/images/icons/instances/folder-solid.svg';
import noteIcon from '../../../public/images/icons/instances/note-solid.svg';
import type { ProjectSummary } from '../../shared/contracts';
import { MaskedIcon } from '../components/MaskedIcon';
import type { Translate } from '../pages/page-types';

export interface ProjectOverviewProps {
  project: ProjectSummary;
  translate: Translate;
  onNewFolder: () => void;
  onNewMarkdown: () => void;
}

export function ProjectOverview({
  onNewFolder,
  onNewMarkdown,
  project,
  translate,
}: ProjectOverviewProps) {
  return (
    <main className="project-overview">
      <section className="project-overview__content">
        <div>
          <p className="project-overview__eyebrow">
            {translate('projects.overview')}
          </p>
          <h1>{project.name}</h1>
          <p>{translate('projects.overviewDescription')}</p>
        </div>
        <div className="project-overview__actions">
          <button onClick={onNewMarkdown} type="button">
            <MaskedIcon icon={noteIcon} />
            {translate('projects.newNote')}
          </button>
          <button onClick={onNewFolder} type="button">
            <MaskedIcon icon={folderIcon} />
            {translate('projects.newFolder')}
          </button>
        </div>
      </section>
    </main>
  );
}
