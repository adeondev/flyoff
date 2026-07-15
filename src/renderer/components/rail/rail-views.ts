import graphIcon from '../../../../public/images/icons/homepage/models.svg';
import mediaIcon from '../../../../public/images/icons/homepage/this-device.svg';
import projectIcon from '../../../../public/images/icons/homepage/new-project.svg';
import settingsIcon from '../../../../public/images/icons/homepage/configuration.svg';
import type { Translate } from '../../pages/page-types';

export const RAIL_VIEW_IDS = {
  project: 'projeto',
  graph: 'grafo',
  media: 'midia',
  settings: 'configuracoes',
} as const;

export type RailViewId = (typeof RAIL_VIEW_IDS)[keyof typeof RAIL_VIEW_IDS];

export interface RailView {
  id: RailViewId;
  labelKey: Parameters<Translate>[0];
  icon: string;
}

export const RAIL_VIEWS: readonly RailView[] = [
  { id: RAIL_VIEW_IDS.project, labelKey: 'rail.project', icon: projectIcon },
  { id: RAIL_VIEW_IDS.graph, labelKey: 'rail.graph', icon: graphIcon },
  { id: RAIL_VIEW_IDS.media, labelKey: 'rail.media', icon: mediaIcon },
  {
    id: RAIL_VIEW_IDS.settings,
    labelKey: 'rail.settings',
    icon: settingsIcon,
  },
];

export function resolveRailView(railViewId: string): RailView {
  return (
    RAIL_VIEWS.find((view) => view.id === railViewId) ?? RAIL_VIEWS[0]!
  );
}
