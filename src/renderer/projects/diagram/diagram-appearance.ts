import type { DiagramElementColor } from '../../../shared/diagram';
import type { Translate } from '../../pages/page-types';

export const DEFAULT_CUSTOM_DIAGRAM_COLOR: DiagramElementColor = '#8f4fc4';

export const DIAGRAM_COLOR_PRESETS: readonly {
  color: DiagramElementColor;
  labelKey: Parameters<Translate>[0];
}[] = [
  { color: '#8f4fc4', labelKey: 'diagram.colorPurple' },
  { color: '#567fc4', labelKey: 'diagram.colorBlue' },
  { color: '#3f8f9b', labelKey: 'diagram.colorCyan' },
  { color: '#528b62', labelKey: 'diagram.colorGreen' },
  { color: '#b17b38', labelKey: 'diagram.colorAmber' },
  { color: '#aa575b', labelKey: 'diagram.colorRed' },
];
