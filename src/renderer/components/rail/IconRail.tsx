import type { Translate } from '../../pages/page-types';
import sidebarCloseIcon from '../../../../public/images/icons/actions/sidebar-close.svg';
import sidebarOpenIcon from '../../../../public/images/icons/actions/sidebar-open.svg';
import { MaskedIcon } from '../MaskedIcon';
import { getTooltipTargetProps } from '../tooltip';
import type { RailView } from './rail-views';

export interface IconRailAction {
  id: string;
  label: string;
  icon: string;
  active?: boolean;
  onSelect: () => void;
}

export interface IconRailProps {
  views: readonly RailView[];
  actions?: readonly IconRailAction[];
  activeViewId: string;
  translate: Translate;
  onSelect: (railViewId: string) => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

export function IconRail({
  actions = [],
  activeViewId,
  onSelect,
  onToggleSidebar,
  sidebarCollapsed,
  translate,
  views,
}: IconRailProps) {
  return (
    <nav className="icon-rail" aria-label={translate('rail.navigation')}>
      {onToggleSidebar ? (
        <button
          aria-label={translate(
            sidebarCollapsed
              ? 'layout.expandSidebar'
              : 'layout.collapseSidebar',
          )}
          className="icon-rail__button icon-rail__button--sidebar"
          onClick={onToggleSidebar}
          type="button"
          {...getTooltipTargetProps(
            translate(
              sidebarCollapsed
                ? 'layout.expandSidebar'
                : 'layout.collapseSidebar',
            ),
            'right',
          )}
        >
          <MaskedIcon
            className="icon-rail__icon"
            icon={sidebarCollapsed ? sidebarOpenIcon : sidebarCloseIcon}
          />
        </button>
      ) : null}
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
      {actions.length > 0 ? (
        <div className="icon-rail__actions">
          {actions.map((action) => (
            <button
              aria-label={action.label}
              aria-pressed={action.active}
              className="icon-rail__button"
              key={action.id}
              onClick={action.onSelect}
              type="button"
              {...getTooltipTargetProps(action.label, 'right')}
            >
              <MaskedIcon className="icon-rail__icon" icon={action.icon} />
            </button>
          ))}
        </div>
      ) : null}
    </nav>
  );
}
