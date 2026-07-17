import type { Translate } from '../../pages/page-types';
import { MaskedIcon } from '../MaskedIcon';
import { getTooltipTargetProps } from '../tooltip';
import type { RailView } from './rail-views';

export interface IconRailProps {
  views: readonly RailView[];
  activeViewId: string;
  translate: Translate;
  onSelect: (railViewId: string) => void;
}

export function IconRail({
  activeViewId,
  onSelect,
  translate,
  views,
}: IconRailProps) {
  return (
    <nav className="icon-rail" aria-label={translate('rail.navigation')}>
      {views.map((view) => {
        const label = translate(view.labelKey);

        return (
          <button
            aria-current={view.id === activeViewId ? 'page' : undefined}
            aria-label={label}
            className="icon-rail__button"
            key={view.id}
            onClick={() => onSelect(view.id)}
            type="button"
            {...getTooltipTargetProps(label, 'right')}
          >
            <MaskedIcon className="icon-rail__icon" icon={view.icon} />
          </button>
        );
      })}
    </nav>
  );
}
