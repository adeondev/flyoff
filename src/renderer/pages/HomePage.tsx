import folderOpenIcon from '../../../public/images/icons/instances/folder-open.svg';
import projectIcon from '../../../public/images/icons/instances/project.svg';
import tableIcon from '../../../public/images/icons/instances/table.svg';
import flyoffLogo from '../../../public/images/flyoff/flyoff-logo.svg';
import flyoffWordmark from '../../../public/images/flyoff/text_black_mode.svg';
import twineIcon from '../../../public/images/twine/icon.svg';
import { MaskedIcon } from '../components/MaskedIcon';
import type { InternalPageProps } from './page-types';

export interface HomePageProps extends InternalPageProps {
  onNewProject?: () => void;
  onOpenProject?: () => void;
  onOpenTwine?: () => void;
}

export function HomePage({
  onNewProject,
  onOpenProject,
  onOpenTwine,
  translate,
}: HomePageProps) {
  return (
    <main className="home__main" aria-label="Flyoff">
      <section className="home__actions" aria-label="Flyoff">
        <div className="home__actions-brand">
          <img
            className="home__actions-mark"
            src={flyoffLogo}
            alt=""
            aria-hidden="true"
          />
          <img
            className="home__actions-wordmark"
            src={flyoffWordmark}
            alt="Flyoff"
          />
        </div>
        <div className="home__action-list">
          <button
            aria-disabled={!onNewProject}
            disabled={!onNewProject}
            onClick={onNewProject}
            type="button"
          >
            <MaskedIcon icon={projectIcon} />
            {translate('home.newProject')}
          </button>
          <button
            aria-disabled={!onOpenProject}
            disabled={!onOpenProject}
            onClick={onOpenProject}
            type="button"
          >
            <MaskedIcon icon={folderOpenIcon} />
            {translate('home.openProject')}
          </button>
          <button aria-disabled="true" disabled type="button">
            <MaskedIcon icon={tableIcon} />
            {translate('home.templates')}
          </button>
          <button
            aria-label={`${translate('pages.twine')}, ${translate('twine.beta')}`}
            aria-disabled={!onOpenTwine}
            disabled={!onOpenTwine}
            onClick={onOpenTwine}
            type="button"
          >
            <img
              aria-hidden="true"
              className="home__action-image"
              src={twineIcon}
              alt=""
            />
            <span>{translate('pages.twine')}</span>
            <span className="beta-badge">
              {translate('twine.beta')}
            </span>
          </button>
        </div>
        <div className="home__drop-zone" aria-disabled="true">
          {translate('home.dragFiles')}
        </div>
      </section>
    </main>
  );
}
