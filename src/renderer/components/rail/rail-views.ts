import calendarIcon from '../../../../newicons/calendario.svg';
import canvasIcon from '../../../../newicons/canvas.svg';
import denIcon from '../../../../newicons/toca.svg';
import graphIcon from '../../../../newicons/grafo.svg';
import mediaIcon from '../../../../newicons/midia.svg';
import modelsIcon from '../../../../newicons/modelos.svg';
import orbitIcon from '../../../../newicons/orbita.svg';
import propertiesIcon from '../../../../newicons/propriedades.svg';
import spreadsheetIcon from '../../../../newicons/planilha.svg';
import type { Translate } from '../../pages/page-types';
import type { ProjectGraphLayoutMode } from '../../projects/project-graph-state';

export const RAIL_VIEW_IDS = {
  project: 'projeto',
  graph: 'grafo',
  canvas: 'canvas',
  media: 'midia',
  calendar: 'calendario',
  models: 'modelos',
  spreadsheet: 'planilha',
  properties: 'propriedades',
} as const;

export type RailViewId = (typeof RAIL_VIEW_IDS)[keyof typeof RAIL_VIEW_IDS];

export interface RailView {
  id: RailViewId;
  labelKey: Parameters<Translate>[0];
  icon: string;
}

export function createRailViews(
  graphMode: ProjectGraphLayoutMode,
): readonly RailView[] {
  return [
    { id: RAIL_VIEW_IDS.project, labelKey: 'rail.project', icon: denIcon },
    {
      id: RAIL_VIEW_IDS.graph,
      labelKey: graphMode === 'orbit' ? 'rail.orbit' : 'rail.graph',
      icon: graphMode === 'orbit' ? orbitIcon : graphIcon,
    },
    { id: RAIL_VIEW_IDS.canvas, labelKey: 'rail.canvas', icon: canvasIcon },
    { id: RAIL_VIEW_IDS.media, labelKey: 'rail.media', icon: mediaIcon },
    {
      id: RAIL_VIEW_IDS.calendar,
      labelKey: 'rail.calendar',
      icon: calendarIcon,
    },
    { id: RAIL_VIEW_IDS.models, labelKey: 'rail.models', icon: modelsIcon },
    {
      id: RAIL_VIEW_IDS.spreadsheet,
      labelKey: 'rail.spreadsheet',
      icon: spreadsheetIcon,
    },
    {
      id: RAIL_VIEW_IDS.properties,
      labelKey: 'rail.properties',
      icon: propertiesIcon,
    },
  ];
}

export function resolveRailView(
  railViewId: string,
  graphMode: ProjectGraphLayoutMode,
): RailView {
  const views = createRailViews(graphMode);
  return (
    views.find((view) => view.id === railViewId) ?? views[0]!
  );
}
