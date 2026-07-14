import type { InternalPageId } from '../../shared/contracts';
import {
  PAGE_NAVIGATION_ORDER,
  getPageDefinition,
} from '../pages/page-registry';
import type { Translate } from '../pages/page-types';
import { MaskedIcon } from './MaskedIcon';

interface SidebarProps {
  activePageId: InternalPageId;
  translate: Translate;
  onOpenPage: (pageId: InternalPageId) => void;
}

export function Sidebar({
  activePageId,
  translate,
  onOpenPage,
}: SidebarProps) {
  return (
    <aside
      className="home__sidebar"
      aria-label={translate('pages.navigation')}
    >
      <nav className="home__navigation" aria-label="Flyoff">
        {PAGE_NAVIGATION_ORDER.map((pageId) => {
          const definition = getPageDefinition(pageId);

          return (
            <button
              aria-current={activePageId === pageId ? 'page' : undefined}
              key={pageId}
              onClick={() => onOpenPage(pageId)}
              type="button"
            >
              <MaskedIcon icon={definition.icon} />
              {translate(definition.titleKey)}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
