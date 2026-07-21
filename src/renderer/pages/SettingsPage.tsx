import { useMemo, useState } from 'react';

import type { InternalPageProps } from './page-types';
import { useFlyoffPreferences } from '../preferences';
import { AppearanceSettings, GeneralSettings } from './settings/GeneralAppearanceSettings';
import { EditorSettings } from './settings/EditorSettings';
import {
  DocumentSettings,
  WorkspaceSettings,
} from './settings/WorkspaceDocumentSettings';
import { SpellcheckSettings } from './settings/SpellcheckSettings';
import {
  AccessibilitySettings,
  AboutSettings,
} from './settings/AccessibilityAboutSettings';
import { SecuritySettings } from './settings/SecuritySettings';

type SettingsSectionId =
  | 'general'
  | 'appearance'
  | 'editor'
  | 'workspace'
  | 'documents'
  | 'spellcheck'
  | 'security'
  | 'accessibility'
  | 'about';

export function SettingsPage({ translate }: InternalPageProps) {
  const [query, setQuery] = useState('');
  const [activeSection, setActiveSection] =
    useState<SettingsSectionId>('general');
  const { ready, resetAll, saveStatus } = useFlyoffPreferences();
  const sections = useMemo(
    () => [
      {
        id: 'general' as const,
        label: translate('settings.sectionGeneral'),
      },
      {
        id: 'appearance' as const,
        label: translate('settings.sectionAppearance'),
      },
      {
        id: 'editor' as const,
        label: translate('settings.sectionEditor'),
      },
      {
        id: 'workspace' as const,
        label: translate('settings.sectionWorkspace'),
      },
      {
        id: 'documents' as const,
        label: translate('settings.sectionDocuments'),
      },
      {
        id: 'spellcheck' as const,
        label: translate('settings.sectionSpellcheck'),
      },
      {
        id: 'security' as const,
        label: translate('settings.sectionSecurity'),
      },
      {
        id: 'accessibility' as const,
        label: translate('settings.sectionAccessibility'),
      },
      {
        id: 'about' as const,
        label: translate('settings.sectionAbout'),
      },
    ],
    [translate],
  );

  function selectSection(section: SettingsSectionId): void {
    setActiveSection(section);
    setQuery('');
  }

  function renderSection(section: SettingsSectionId) {
    const props = { query, translate };
    switch (section) {
      case 'general':
        return <GeneralSettings {...props} />;
      case 'appearance':
        return <AppearanceSettings {...props} />;
      case 'editor':
        return <EditorSettings {...props} />;
      case 'workspace':
        return <WorkspaceSettings {...props} />;
      case 'documents':
        return <DocumentSettings {...props} />;
      case 'spellcheck':
        return <SpellcheckSettings {...props} />;
      case 'security':
        return <SecuritySettings {...props} />;
      case 'accessibility':
        return <AccessibilitySettings {...props} />;
      case 'about':
        return <AboutSettings {...props} />;
    }
  }

  const status =
    saveStatus === 'saving'
      ? translate('settings.saving')
      : saveStatus === 'saved'
        ? translate('settings.saved')
        : saveStatus === 'error'
          ? translate('settings.saveError')
          : '';

  return (
    <main
      aria-busy={!ready || saveStatus === 'saving'}
      className="settings-page-container"
    >
      <div className="settings-page">
        <aside className="settings-page__sidebar">
          <div className="settings-page__heading">
            <h1>{translate('settings.title')}</h1>
          </div>
          <input
            aria-label={translate('settings.search')}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={translate('settings.search')}
            type="search"
            value={query}
          />
          <nav aria-label={translate('settings.title')}>
            {sections.map((section) => (
              <button
                aria-current={
                  activeSection === section.id ? 'page' : undefined
                }
                key={section.id}
                onClick={() => selectSection(section.id)}
                type="button"
              >
                {section.label}
              </button>
            ))}
          </nav>
          <div className="settings-page__sidebar-footer">
            <span aria-live="polite">{status}</span>
            <button disabled={!ready} onClick={resetAll} type="button">
              {translate('settings.resetAll')}
            </button>
          </div>
        </aside>
        <div className="settings-page__content">
          {query
            ? sections.map((section) => (
                <div
                  className="settings-page__search-section"
                  key={section.id}
                >
                  {renderSection(section.id)}
                </div>
              ))
            : renderSection(activeSection)}
          <p className="settings-page__no-results">
            {translate('settings.noResults')}
          </p>
        </div>
      </div>
    </main>
  );
}
