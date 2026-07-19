import flickSleeping from '../../../public/images/flick/flick_sleeping.png';
import plusIcon from '../../../public/images/icons/actions/plus.svg';
import searchIcon from '../../../public/images/icons/actions/search.svg';
import { MaskedIcon } from '../components/MaskedIcon';
import type { Translate } from '../pages/page-types';

export interface ProjectEmptyStateProps {
  translate: Translate;
  onCreateNote: () => void;
  onSearch: () => void;
}

export function ProjectEmptyState({
  onCreateNote,
  onSearch,
  translate,
}: ProjectEmptyStateProps) {
  return (
    <div className="project-empty">
      <img
        alt=""
        aria-hidden="true"
        className="project-empty__illustration"
        src={flickSleeping}
      />
      <h1>{translate('pages.nothingOpenYet')}</h1>
      <div className="project-empty__actions">
        <button onClick={onCreateNote} type="button">
          <MaskedIcon icon={plusIcon} />
          {translate('projects.newNote')}
        </button>
        <button onClick={onSearch} type="button">
          <MaskedIcon icon={searchIcon} />
          {translate('pages.search')}
        </button>
      </div>
    </div>
  );
}
