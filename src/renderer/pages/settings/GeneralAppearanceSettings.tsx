import { useState } from 'react';

import type { Translate } from '../page-types';
import {
  SettingRow,
  SettingsSection,
  SettingsSelect,
  SettingsToggle,
  usePreferenceSection,
} from './SettingsControls';
import { useFlyoffPreferences } from '../../preferences';

interface SettingsSectionProps {
  query: string;
  translate: Translate;
}

export function GeneralSettings({
  query,
  translate,
}: SettingsSectionProps) {
  const [general, update] = usePreferenceSection('general');
  const {
    resetSection,
    restartApplication,
    runtime,
  } = useFlyoffPreferences();
  const [restarting, setRestarting] = useState(false);
  const startupOptions = [
    { value: 'ask', label: translate('settings.optionAsk') },
    { value: 'restore', label: translate('settings.optionRestore') },
    { value: 'fresh', label: translate('settings.optionFresh') },
  ];
  const autosaveOptions = [
    { value: '0', label: `0 ${translate('settings.milliseconds')}` },
    { value: '300', label: `300 ${translate('settings.milliseconds')}` },
    { value: '500', label: `500 ${translate('settings.milliseconds')}` },
    { value: '1000', label: `1 ${translate('settings.seconds')}` },
    { value: '2000', label: `2 ${translate('settings.seconds')}` },
  ];

  return (
    <SettingsSection
      description={translate('settings.sectionGeneralDescription')}
      id="settings-general"
      onReset={() => resetSection('general')}
      title={translate('settings.sectionGeneral')}
      translate={translate}
    >
      <SettingRow
        description={translate('settings.startupBehaviorDescription')}
        query={query}
        title={translate('settings.startupBehavior')}
      >
        <SettingsSelect
          label={translate('settings.startupBehavior')}
          onChange={(event) =>
            update({
              startupBehavior: event.currentTarget.value as
                | 'ask'
                | 'restore'
                | 'fresh',
            })
          }
          options={startupOptions}
          value={general.startupBehavior}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.hardwareAccelerationDescription')}
        query={query}
        title={translate('settings.hardwareAcceleration')}
      >
        <div className="settings-runtime-control">
          <SettingsToggle
            checked={general.hardwareAcceleration}
            label={translate('settings.hardwareAcceleration')}
            onChange={(hardwareAcceleration) =>
              update({ hardwareAcceleration })
            }
          />
          {general.hardwareAcceleration !==
          runtime.hardwareAccelerationEnabled ? (
            <div className="settings-runtime-restart">
              <span>{translate('settings.restartRequired')}</span>
              <button
                disabled={restarting}
                onClick={() => {
                  setRestarting(true);
                  void restartApplication().catch(() => {
                    setRestarting(false);
                  });
                }}
                type="button"
              >
                {translate('settings.restartNow')}
              </button>
            </div>
          ) : null}
        </div>
      </SettingRow>
      <SettingRow
        description={translate('settings.focusEditorOnOpenDescription')}
        query={query}
        title={translate('settings.focusEditorOnOpen')}
      >
        <SettingsToggle
          checked={general.focusEditorOnOpen}
          label={translate('settings.focusEditorOnOpen')}
          onChange={(focusEditorOnOpen) => update({ focusEditorOnOpen })}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.saveOnWindowBlurDescription')}
        query={query}
        title={translate('settings.saveOnWindowBlur')}
      >
        <SettingsToggle
          checked={general.saveOnWindowBlur}
          label={translate('settings.saveOnWindowBlur')}
          onChange={(saveOnWindowBlur) => update({ saveOnWindowBlur })}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.autosaveDelayDescription')}
        query={query}
        title={translate('settings.autosaveDelay')}
      >
        <SettingsSelect
          label={translate('settings.autosaveDelay')}
          onChange={(event) =>
            update({
              autosaveDelayMs: Number(event.currentTarget.value) as
                | 0
                | 300
                | 500
                | 1000
                | 2000,
            })
          }
          options={autosaveOptions}
          value={String(general.autosaveDelayMs)}
        />
      </SettingRow>
    </SettingsSection>
  );
}

export function AppearanceSettings({
  query,
  translate,
}: SettingsSectionProps) {
  const [appearance, update] = usePreferenceSection('appearance');
  const { resetSection } = useFlyoffPreferences();

  return (
    <SettingsSection
      description={translate('settings.sectionAppearanceDescription')}
      id="settings-appearance"
      onReset={() => resetSection('appearance')}
      title={translate('settings.sectionAppearance')}
      translate={translate}
    >
      <SettingRow
        description={translate('settings.themeDescription')}
        keywords={[
          translate('settings.themeFlyoffDescription'),
          translate('settings.themeBasaltDescription'),
        ]}
        query={query}
        title={translate('settings.theme')}
      >
        <div
          aria-label={translate('settings.theme')}
          className="settings-theme-options"
          role="radiogroup"
        >
          {(['flyoff', 'basalt'] as const).map((theme) => (
            <button
              aria-checked={appearance.theme === theme}
              className={`settings-theme-card settings-theme-card--${theme}`}
              key={theme}
              onClick={() => update({ theme })}
              role="radio"
              type="button"
            >
              <span className="settings-theme-card__preview" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <strong>
                {translate(
                  theme === 'flyoff'
                    ? 'settings.optionFlyoff'
                    : 'settings.optionBasalt',
                )}
              </strong>
              <small>
                {translate(
                  theme === 'flyoff'
                    ? 'settings.themeFlyoffDescription'
                    : 'settings.themeBasaltDescription',
                )}
              </small>
            </button>
          ))}
        </div>
      </SettingRow>
      <SettingRow
        description={translate('settings.accentStrengthDescription')}
        query={query}
        title={translate('settings.accentStrength')}
      >
        <SettingsSelect
          label={translate('settings.accentStrength')}
          onChange={(event) =>
            update({
              accentStrength: event.currentTarget.value as
                | 'subtle'
                | 'standard'
                | 'strong',
            })
          }
          options={[
            { value: 'subtle', label: translate('settings.optionSubtle') },
            { value: 'standard', label: translate('settings.optionStandard') },
            { value: 'strong', label: translate('settings.optionStrong') },
          ]}
          value={appearance.accentStrength}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.interfaceFontDescription')}
        query={query}
        title={translate('settings.interfaceFont')}
      >
        <SettingsSelect
          label={translate('settings.interfaceFont')}
          onChange={(event) =>
            update({
              interfaceFont: event.currentTarget.value as 'inter' | 'system',
            })
          }
          options={[
            { value: 'inter', label: translate('settings.optionInter') },
            {
              value: 'system',
              label: translate('settings.optionSystemFont'),
            },
          ]}
          value={appearance.interfaceFont}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.interfaceDensityDescription')}
        query={query}
        title={translate('settings.interfaceDensity')}
      >
        <SettingsSelect
          label={translate('settings.interfaceDensity')}
          onChange={(event) =>
            update({
              density: event.currentTarget.value as
                | 'compact'
                | 'comfortable',
            })
          }
          options={[
            { value: 'compact', label: translate('settings.optionCompact') },
            {
              value: 'comfortable',
              label: translate('settings.optionComfortable'),
            },
          ]}
          value={appearance.density}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.borderContrastDescription')}
        query={query}
        title={translate('settings.borderContrast')}
      >
        <SettingsSelect
          label={translate('settings.borderContrast')}
          onChange={(event) =>
            update({
              borderContrast: event.currentTarget.value as 'soft' | 'strong',
            })
          }
          options={[
            { value: 'soft', label: translate('settings.optionSoft') },
            { value: 'strong', label: translate('settings.optionStrong') },
          ]}
          value={appearance.borderContrast}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.scrollbarWidthDescription')}
        query={query}
        title={translate('settings.scrollbarWidth')}
      >
        <SettingsSelect
          label={translate('settings.scrollbarWidth')}
          onChange={(event) =>
            update({
              scrollbarWidth: event.currentTarget.value as
                | 'thin'
                | 'standard',
            })
          }
          options={[
            { value: 'thin', label: translate('settings.optionThin') },
            { value: 'standard', label: translate('settings.optionStandard') },
          ]}
          value={appearance.scrollbarWidth}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.motionDescription')}
        query={query}
        title={translate('settings.motion')}
      >
        <SettingsSelect
          label={translate('settings.motion')}
          onChange={(event) =>
            update({
              motion: event.currentTarget.value as
                | 'system'
                | 'full'
                | 'reduced',
            })
          }
          options={[
            { value: 'system', label: translate('settings.optionMotionSystem') },
            { value: 'full', label: translate('settings.optionMotionFull') },
            {
              value: 'reduced',
              label: translate('settings.optionMotionReduced'),
            },
          ]}
          value={appearance.motion}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.tabWidthDescription')}
        query={query}
        title={translate('settings.tabWidth')}
      >
        <SettingsSelect
          label={translate('settings.tabWidth')}
          onChange={(event) =>
            update({
              tabWidth: event.currentTarget.value as
                | 'compact'
                | 'balanced'
                | 'wide',
            })
          }
          options={[
            {
              value: 'compact',
              label: translate('settings.optionTabCompact'),
            },
            {
              value: 'balanced',
              label: translate('settings.optionTabBalanced'),
            },
            { value: 'wide', label: translate('settings.optionTabWide') },
          ]}
          value={appearance.tabWidth}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.activePaneIndicatorDescription')}
        query={query}
        title={translate('settings.activePaneIndicator')}
      >
        <SettingsSelect
          label={translate('settings.activePaneIndicator')}
          onChange={(event) =>
            update({
              activePaneIndicator: event.currentTarget.value as
                | 'off'
                | 'subtle'
                | 'strong',
            })
          }
          options={[
            { value: 'off', label: translate('settings.optionOff') },
            { value: 'subtle', label: translate('settings.optionSubtle') },
            { value: 'strong', label: translate('settings.optionStrong') },
          ]}
          value={appearance.activePaneIndicator}
        />
      </SettingRow>
    </SettingsSection>
  );
}
