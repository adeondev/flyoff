import importProjectIcon from '../../../public/images/icons/homepage/import-project.svg';
import modelsIcon from '../../../public/images/icons/homepage/models.svg';
import newProjectIcon from '../../../public/images/icons/homepage/new-project.svg';
import flyoffLogo from '../../../public/images/flyoff/flyoff-logo.svg';
import flyoffWordmark from '../../../public/images/flyoff/text_black_mode.svg';
import { MaskedIcon } from '../components/MaskedIcon';
import type { InternalPageProps } from './page-types';

export function HomePage({ translate }: InternalPageProps) {
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
          <button aria-disabled="true" type="button">
            <MaskedIcon icon={newProjectIcon} />
            {translate('home.newProject')}
          </button>
          <button aria-disabled="true" type="button">
            <MaskedIcon icon={importProjectIcon} />
            {translate('home.importProject')}
          </button>
          <button aria-disabled="true" type="button">
            <MaskedIcon icon={modelsIcon} />
            {translate('home.templates')}
          </button>
        </div>
        <div className="home__drop-zone" aria-disabled="true">
          {translate('home.dragFiles')}
        </div>
      </section>
    </main>
  );
}
