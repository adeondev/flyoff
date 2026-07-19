import { useMemo } from 'react';

import type { Translate } from '../page-types';
import { useFlyoffPreferences } from '../../preferences';
import {
  SettingRow,
  SettingsSection,
  SettingsSelect,
  SettingsToggle,
  usePreferenceSection,
} from './SettingsControls';

function languageName(code: string): string {
  try {
    const names = new Intl.DisplayNames(
      [document.documentElement.lang || 'en-US'],
      { type: 'language' },
    );
    const display = names.of(code);
    return display && display !== code ? `${display} (${code})` : code;
  } catch {
    return code;
  }
}

export function SpellcheckSettings({
  query,
  translate,
}: {
  query: string;
  translate: Translate;
}) {
  const [preferences, update] = usePreferenceSection('spellcheck');
  const { resetSection, spellcheck } = useFlyoffPreferences();
  const languages = useMemo(
    () =>
      spellcheck.availableLanguages.map((code) => ({
        code,
        name: languageName(code),
      })),
    [spellcheck.availableLanguages],
  );
  const explicitLanguages = new Set(preferences.languages);

  function toggleLanguage(code: string, checked: boolean): void {
    const next = new Set(preferences.languages);
    if (checked) {
      next.add(code);
    } else {
      next.delete(code);
    }
    update({ languages: [...next].sort() });
  }

  return (
    <SettingsSection
      description={translate('settings.sectionSpellcheckDescription')}
      id="settings-spellcheck"
      onReset={() => resetSection('spellcheck')}
      title={translate('settings.sectionSpellcheck')}
      translate={translate}
    >
      <SettingRow
        description={translate('settings.spellcheckEnabledDescription')}
        query={query}
        title={translate('settings.spellcheckEnabled')}
      >
        <SettingsToggle
          checked={preferences.enabled}
          label={translate('settings.spellcheckEnabled')}
          onChange={(enabled) => update({ enabled })}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.spellcheckLanguagesDescription')}
        keywords={languages.map(({ name }) => name)}
        query={query}
        title={translate('settings.spellcheckLanguages')}
      >
        {spellcheck.canSelectLanguages ? (
          <div className="settings-languages">
            <button
              aria-pressed={preferences.languages.length === 0}
              className="settings-languages__automatic"
              disabled={!preferences.enabled}
              onClick={() => update({ languages: [] })}
              type="button"
            >
              {translate('settings.automatic')}
              {preferences.languages.length === 0 &&
              spellcheck.activeLanguages.length > 0
                ? ` \u00b7 ${spellcheck.activeLanguages.join(', ')}`
                : ''}
            </button>
            <div className="settings-languages__list">
              {languages.map(({ code, name }) => (
                <label key={code}>
                  <input
                    checked={explicitLanguages.has(code)}
                    className="flyoff-checkbox"
                    disabled={!preferences.enabled}
                    onChange={(event) =>
                      toggleLanguage(code, event.currentTarget.checked)
                    }
                    type="checkbox"
                  />
                  <span>{name}</span>
                </label>
              ))}
            </div>
          </div>
        ) : (
          <p className="settings-row__platform-note">
            {translate('settings.spellcheckManagedByMacOS')}
          </p>
        )}
      </SettingRow>
      <SettingRow
        description={translate('settings.checkCodeBlocksDescription')}
        query={query}
        title={translate('settings.checkCodeBlocks')}
      >
        <SettingsToggle
          checked={preferences.checkCodeBlocks}
          disabled={!preferences.enabled}
          label={translate('settings.checkCodeBlocks')}
          onChange={(checkCodeBlocks) => update({ checkCodeBlocks })}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.spellcheckSuggestionLimitDescription')}
        query={query}
        title={translate('settings.spellcheckSuggestionLimit')}
      >
        <SettingsSelect
          label={translate('settings.spellcheckSuggestionLimit')}
          onChange={(event) =>
            update({
              suggestionLimit: Number(event.currentTarget.value) as 3 | 5 | 8,
            })
          }
          options={[3, 5, 8].map((value) => ({
            value: String(value),
            label: String(value),
          }))}
          value={String(preferences.suggestionLimit)}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.allowPersonalDictionaryDescription')}
        query={query}
        title={translate('settings.allowPersonalDictionary')}
      >
        <SettingsToggle
          checked={preferences.allowPersonalDictionary}
          label={translate('settings.allowPersonalDictionary')}
          onChange={(allowPersonalDictionary) =>
            update({ allowPersonalDictionary })
          }
        />
      </SettingRow>
    </SettingsSection>
  );
}
