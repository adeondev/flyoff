import type { CSSProperties } from 'react';

import closeIcon from '../../../public/images/icons/actions/close-pane.svg';
import { MaskedIcon } from '../components/MaskedIcon';
import { getTooltipTargetProps } from '../components/tooltip';
import type { Translate } from '../pages/page-types';
import {
  PROJECT_GRAPH_FORCE_SETTING_LIMITS,
  PROJECT_GRAPH_ORBIT_SETTING_LIMITS,
  type ProjectGraphForceSettings,
  type ProjectGraphOrbitSettings,
  type ProjectGraphSettings,
} from './project-graph-settings';
import type { ProjectGraphLayoutMode } from './project-graph-state';

interface ProjectGraphSettingsPanelProps {
  onChange: (settings: ProjectGraphSettings) => void;
  onChangeMode: (mode: ProjectGraphLayoutMode) => void;
  onClose: () => void;
  onFit: () => void;
  onReset: () => void;
  settings: ProjectGraphSettings;
  translate: Translate;
}

type SettingLabel =
  | 'graph.centerStrength'
  | 'graph.damping'
  | 'graph.edgeScale'
  | 'graph.elasticity'
  | 'graph.floatSpeed'
  | 'graph.floatStrength'
  | 'graph.labelZoom'
  | 'graph.linkParticles'
  | 'graph.nodeDistance'
  | 'graph.nodeScale'
  | 'graph.orbitBodyScale'
  | 'graph.orbitSpacing'
  | 'graph.repulsion'
  | 'graph.simulationSpeed'
  | 'graph.springStrength'
  | 'graph.zoomSensitivity';

type SettingGroupTitle =
  | 'graph.appearance'
  | 'graph.layout'
  | 'graph.motion'
  | 'graph.simulation'
  | 'graph.zoom';

interface SettingDefinition<K extends PropertyKey> {
  format: (value: number) => string;
  key: K;
  label: SettingLabel;
}

interface SettingGroup<K extends PropertyKey> {
  definitions: readonly SettingDefinition<K>[];
  title: SettingGroupTitle;
}

const percentage = (value: number) => `${Math.round(value * 100)}%`;
const multiplier = (value: number) => `${value.toFixed(2).replace(/0$/, '')}×`;
const particleDensity = (value: number) =>
  value <= 0 ? '—' : multiplier(value);

const FORCE_GROUPS: readonly SettingGroup<keyof ProjectGraphForceSettings>[] = [
  {
    definitions: [
      {
        format: (value) => `${Math.round(value)} px`,
        key: 'nodeDistance',
        label: 'graph.nodeDistance',
      },
      { format: percentage, key: 'springStrength', label: 'graph.springStrength' },
      {
        format: (value) => Math.round(value).toLocaleString(),
        key: 'repulsion',
        label: 'graph.repulsion',
      },
      { format: percentage, key: 'centerStrength', label: 'graph.centerStrength' },
      { format: (value) => value.toFixed(1), key: 'damping', label: 'graph.damping' },
      { format: multiplier, key: 'simulationSpeed', label: 'graph.simulationSpeed' },
    ],
    title: 'graph.simulation',
  },
  {
    definitions: [
      { format: multiplier, key: 'nodeScale', label: 'graph.nodeScale' },
      { format: multiplier, key: 'edgeScale', label: 'graph.edgeScale' },
      {
        format: (value) => `≥ ${multiplier(value)}`,
        key: 'labelZoom',
        label: 'graph.labelZoom',
      },
      { format: particleDensity, key: 'linkParticles', label: 'graph.linkParticles' },
    ],
    title: 'graph.appearance',
  },
  {
    definitions: [
      { format: multiplier, key: 'zoomSensitivity', label: 'graph.zoomSensitivity' },
    ],
    title: 'graph.zoom',
  },
];

const ORBIT_GROUPS: readonly SettingGroup<keyof ProjectGraphOrbitSettings>[] = [
  {
    definitions: [
      { format: multiplier, key: 'spacing', label: 'graph.orbitSpacing' },
      { format: multiplier, key: 'bodyScale', label: 'graph.orbitBodyScale' },
    ],
    title: 'graph.layout',
  },
  {
    definitions: [
      { format: percentage, key: 'floatStrength', label: 'graph.floatStrength' },
      { format: multiplier, key: 'floatSpeed', label: 'graph.floatSpeed' },
      { format: percentage, key: 'elasticity', label: 'graph.elasticity' },
      { format: percentage, key: 'damping', label: 'graph.damping' },
    ],
    title: 'graph.motion',
  },
  {
    definitions: [
      { format: multiplier, key: 'edgeScale', label: 'graph.edgeScale' },
      {
        format: (value) => `≥ ${multiplier(value)}`,
        key: 'labelZoom',
        label: 'graph.labelZoom',
      },
    ],
    title: 'graph.appearance',
  },
  {
    definitions: [
      { format: multiplier, key: 'zoomSensitivity', label: 'graph.zoomSensitivity' },
    ],
    title: 'graph.zoom',
  },
];

function SettingsGroup<T extends Record<keyof T, number>>({
  definitions,
  limits,
  onChange,
  settings,
  title,
  translate,
}: {
  definitions: readonly SettingDefinition<keyof T>[];
  limits: Record<keyof T, { maximum: number; minimum: number; step: number }>;
  onChange: (key: keyof T, value: number) => void;
  settings: T;
  title: SettingGroupTitle;
  translate: Translate;
}) {
  return (
    <fieldset className="project-graph-settings__group">
      <legend>{translate(title)}</legend>
      {definitions.map((definition) => {
        const settingLimits = limits[definition.key];
        const value = settings[definition.key];
        const output = definition.format(value);
        return (
          <label className="project-graph-settings__field" key={String(definition.key)}>
            <span>
              <span>{translate(definition.label)}</span>
              <output>{output}</output>
            </span>
            <input
              aria-label={translate(definition.label)}
              aria-valuetext={output}
              max={settingLimits.maximum}
              min={settingLimits.minimum}
              onChange={(event) =>
                onChange(definition.key, event.currentTarget.valueAsNumber)
              }
              step={settingLimits.step}
              style={
                {
                  '--graph-setting-progress': `${
                    ((value - settingLimits.minimum) /
                      (settingLimits.maximum - settingLimits.minimum)) *
                    100
                  }%`,
                } as CSSProperties
              }
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
  onChange,
  onChangeMode,
  onClose,
  onFit,
  onReset,
  settings,
  translate,
}: ProjectGraphSettingsPanelProps) {
  const layoutMode = settings.layoutMode;
  const title = translate(
    layoutMode === 'orbit' ? 'graph.orbitSettings' : 'graph.graphSettings',
  );
  const closeLabel = translate(
    layoutMode === 'orbit'
      ? 'graph.closeOrbitSettings'
      : 'graph.closeGraphSettings',
  );
  const changeForceSetting = (
    key: keyof ProjectGraphForceSettings,
    value: number,
  ) => onChange({ ...settings, force: { ...settings.force, [key]: value } });
  const changeOrbitSetting = (
    key: keyof ProjectGraphOrbitSettings,
    value: number,
  ) => onChange({ ...settings, orbit: { ...settings.orbit, [key]: value } });

  return (
    <aside
      aria-label={title}
      className="project-graph-settings"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="project-graph-settings__header">
        <h3>{title}</h3>
        <button
          aria-label={closeLabel}
          className="project-graph-settings__close"
          onClick={onClose}
          type="button"
          {...getTooltipTargetProps(closeLabel, 'bottom')}
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
        {layoutMode === 'orbit'
          ? ORBIT_GROUPS.map((group) => (
              <SettingsGroup
                definitions={group.definitions}
                key={group.title}
                limits={PROJECT_GRAPH_ORBIT_SETTING_LIMITS}
                onChange={changeOrbitSetting}
                settings={settings.orbit}
                title={group.title}
                translate={translate}
              />
            ))
          : FORCE_GROUPS.map((group) => (
              <SettingsGroup
                definitions={group.definitions}
                key={group.title}
                limits={PROJECT_GRAPH_FORCE_SETTING_LIMITS}
                onChange={changeForceSetting}
                settings={settings.force}
                title={group.title}
                translate={translate}
              />
            ))}
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
