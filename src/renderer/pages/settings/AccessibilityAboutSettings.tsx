import packageMetadata from '../../../../package.json';

import type { Translate } from '../page-types';
import { useFlyoffPreferences } from '../../preferences';
import {
  SettingRow,
  SettingsSection,
  SettingsSelect,
  SettingsToggle,
  usePreferenceSection,
} from './SettingsControls';

interface SettingsSectionProps {
  query: string;
  translate: Translate;
}

function runtimeLabel(): string {
  const electron = navigator.userAgent.match(/Electron\/([\d.]+)/)?.[1];
  const chromium = navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1];
  return [
    electron ? `Electron ${electron}` : undefined,
    chromium ? `Chromium ${chromium}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

function platformLabel(): string {
  if (/Windows/u.test(navigator.userAgent)) return 'Windows';
  if (/Macintosh|Mac OS/u.test(navigator.userAgent)) return 'macOS';
  if (/Linux/u.test(navigator.userAgent)) return 'Linux';
  return navigator.userAgent;
}

export function AccessibilitySettings({
  query,
  translate,
}: SettingsSectionProps) {
  const [accessibility, update] = usePreferenceSection('accessibility');
  const { resetSection } = useFlyoffPreferences();

  return (
    <SettingsSection
      description={translate('settings.sectionAccessibilityDescription')}
      id="settings-accessibility"
      onReset={() => resetSection('accessibility')}
      title={translate('settings.sectionAccessibility')}
      translate={translate}
    >
      <SettingRow
        description={translate('settings.focusIndicatorDescription')}
        query={query}
        title={translate('settings.focusIndicator')}
      >
        <SettingsSelect
          label={translate('settings.focusIndicator')}
          onChange={(event) =>
            update({
              focusIndicator: event.currentTarget.value as
                | 'standard'
                | 'strong',
            })
          }
          options={[
            { value: 'standard', label: translate('settings.optionStandard') },
            { value: 'strong', label: translate('settings.optionStrong') },
          ]}
          value={accessibility.focusIndicator}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.reduceTransparencyDescription')}
        query={query}
        title={translate('settings.reduceTransparency')}
      >
        <SettingsToggle
          checked={accessibility.reduceTransparency}
          label={translate('settings.reduceTransparency')}
          onChange={(reduceTransparency) => update({ reduceTransparency })}
        />
      </SettingRow>
    </SettingsSection>
  );
}

export function AboutSettings({
  query,
  translate,
}: SettingsSectionProps) {
  return (
    <SettingsSection
      description={translate('settings.sectionAboutDescription')}
      id="settings-about"
      title={translate('settings.sectionAbout')}
      translate={translate}
    >
      <div className="settings-about__summary">
        <strong>Flyoff</strong>
        <p>{translate('settings.aboutSummary')}</p>
      </div>
      <SettingRow
        description=""
        query={query}
        title={translate('settings.aboutVersion')}
      >
        <output>{packageMetadata.version}</output>
      </SettingRow>
      <SettingRow
        description=""
        query={query}
        title={translate('settings.aboutPlatform')}
      >
        <output>{platformLabel()}</output>
      </SettingRow>
      <SettingRow
        description=""
        query={query}
        title={translate('settings.aboutRuntime')}
      >
        <output>{runtimeLabel()}</output>
      </SettingRow>
      <SettingRow
        description=""
        query={query}
        title={translate('settings.aboutLicense')}
      >
        <output>{translate('settings.aboutLicensePrivate')}</output>
      </SettingRow>
      <SettingRow
        description=""
        query={query}
        title={translate('settings.aboutEmojiAssets')}
      >
        <output>
          Twemoji 17.0.3 (CC-BY 4.0) · Emojibase 17
        </output>
      </SettingRow>
    </SettingsSection>
  );
}
