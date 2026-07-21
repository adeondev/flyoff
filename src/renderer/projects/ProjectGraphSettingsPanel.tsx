import closeIcon from '../../../public/images/icons/actions/close-pane.svg';
import { MaskedIcon } from '../components/MaskedIcon';
import { getTooltipTargetProps } from '../components/tooltip';
import type { Translate } from '../pages/page-types';
import {
  PROJECT_GRAPH_SETTING_LIMITS,
  type ProjectGraphSettings,
} from './project-graph-settings';
import type { ProjectGraphLayoutMode } from './project-graph-state';

interface ProjectGraphSettingsPanelProps {
  layoutMode: ProjectGraphLayoutMode;
  onChange: (key: keyof ProjectGraphSettings, value: number) => void;
  onChangeMode: (mode: ProjectGraphLayoutMode) => void;
  onClose: () => void;
  onFit: () => void;
  onReset: () => void;
  settings: ProjectGraphSettings;
  translate: Translate;
}

interface GraphSettingDefinition {
  format: (value: number) => string;
  key: keyof ProjectGraphSettings;
  label:
    | 'graph.centerStrength'
    | 'graph.damping'
    | 'graph.edgeScale'
    | 'graph.labelZoom'
    | 'graph.linkParticles'
    | 'graph.nodeDistance'
    | 'graph.nodeScale'
    | 'graph.repulsion'
    | 'graph.simulationSpeed'
    | 'graph.springStrength'
    | 'graph.zoomSensitivity';
}

const percentage = (value: number) => `${Math.round(value * 100)}%`;
const multiplier = (value: number) => `${value.toFixed(2).replace(/0$/, '')}×`;
const particleDensity = (value: number) =>
  value <= 0 ? '—' : multiplier(value);

const SIMULATION_SETTINGS: readonly GraphSettingDefinition[] = [
  {
    format: (value) => `${Math.round(value)} px`,
    key: 'nodeDistance',
    label: 'graph.nodeDistance',
  },
  {
    format: percentage,
    key: 'springStrength',
    label: 'graph.springStrength',
  },
  {
    format: (value) => Math.round(value).toLocaleString(),
    key: 'repulsion',
    label: 'graph.repulsion',
  },
  {
    format: percentage,
    key: 'centerStrength',
    label: 'graph.centerStrength',
  },
  {
    format: (value) => value.toFixed(1),
    key: 'damping',
    label: 'graph.damping',
  },
  {
    format: multiplier,
    key: 'simulationSpeed',
    label: 'graph.simulationSpeed',
  },
];

const APPEARANCE_SETTINGS: readonly GraphSettingDefinition[] = [
  {
    format: multiplier,
    key: 'nodeScale',
    label: 'graph.nodeScale',
  },
  {
    format: multiplier,
    key: 'edgeScale',
    label: 'graph.edgeScale',
  },
  {
    format: (value) => `≥ ${multiplier(value)}`,
    key: 'labelZoom',
    label: 'graph.labelZoom',
  },
  {
    format: particleDensity,
    key: 'linkParticles',
    label: 'graph.linkParticles',
  },
];

const CAMERA_SETTINGS: readonly GraphSettingDefinition[] = [
  {
    format: multiplier,
    key: 'zoomSensitivity',
    label: 'graph.zoomSensitivity',
  },
];

function GraphSettingsGroup({
  definitions,
  onChange,
  settings,
  title,
  translate,
}: {
  definitions: readonly GraphSettingDefinition[];
  onChange: ProjectGraphSettingsPanelProps['onChange'];
  settings: ProjectGraphSettings;
  title: 'graph.appearance' | 'graph.simulation' | 'graph.zoom';
  translate: Translate;
}) {
  return (
    <fieldset className="project-graph-settings__group">
      <legend>{translate(title)}</legend>
      {definitions.map((definition) => {
        const limits = PROJECT_GRAPH_SETTING_LIMITS[definition.key];
        const value = settings[definition.key];
        const output = definition.format(value);
        return (
          <label className="project-graph-settings__field" key={definition.key}>
            <span>
              <span>{translate(definition.label)}</span>
              <output>{output}</output>
            </span>
            <input
              aria-label={translate(definition.label)}
              aria-valuetext={output}
              max={limits.maximum}
              min={limits.minimum}
              onChange={(event) =>
                onChange(definition.key, event.currentTarget.valueAsNumber)
              }
              step={limits.step}
              type="range"
              value={value}
            />
          </label>
        );
      })}
    </fieldset>
  );
}

const LAYOUT_MODES: readonly {
  labelKey: 'graph.modeOrbit' | 'graph.modeGraph';
  value: ProjectGraphLayoutMode;
}[] = [
  { labelKey: 'graph.modeOrbit', value: 'orbit' },
  { labelKey: 'graph.modeGraph', value: 'force' },
];

export function ProjectGraphSettingsPanel({
  layoutMode,
  onChange,
  onChangeMode,
  onClose,
  onFit,
  onReset,
  settings,
  translate,
}: ProjectGraphSettingsPanelProps) {
  return (
    <aside
      aria-label={translate('graph.settings')}
      className="project-graph-settings"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="project-graph-settings__header">
        <h3>{translate('graph.settings')}</h3>
        <button
          aria-label={translate('graph.closeSettings')}
          className="project-graph__action"
          onClick={onClose}
          type="button"
          {...getTooltipTargetProps(translate('graph.closeSettings'), 'bottom')}
        >
          <MaskedIcon icon={closeIcon} />
        </button>
      </header>
      <div className="project-graph-settings__content">
        <fieldset className="project-graph-settings__group">
          <legend>{translate('graph.layoutMode')}</legend>
          <div
            aria-label={translate('graph.layoutMode')}
            className="project-graph-settings__modes"
            role="radiogroup"
          >
            {LAYOUT_MODES.map((mode) => (
              <button
                aria-checked={layoutMode === mode.value}
                className="project-graph-settings__mode"
                data-active={layoutMode === mode.value}
                key={mode.value}
                onClick={() => onChangeMode(mode.value)}
                role="radio"
                type="button"
              >
                {translate(mode.labelKey)}
              </button>
            ))}
          </div>
        </fieldset>
        <GraphSettingsGroup
          definitions={SIMULATION_SETTINGS}
          onChange={onChange}
          settings={settings}
          title="graph.simulation"
          translate={translate}
        />
        <GraphSettingsGroup
          definitions={APPEARANCE_SETTINGS}
          onChange={onChange}
          settings={settings}
          title="graph.appearance"
          translate={translate}
        />
        <GraphSettingsGroup
          definitions={CAMERA_SETTINGS}
          onChange={onChange}
          settings={settings}
          title="graph.zoom"
          translate={translate}
        />
      </div>
      <footer className="project-graph-settings__footer">
        <button onClick={onFit} type="button">
          {translate('graph.fit')}
        </button>
        <button onClick={onReset} type="button">
          {translate('graph.resetSettings')}
        </button>
      </footer>
    </aside>
  );
}
