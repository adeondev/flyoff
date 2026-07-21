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

export function WorkspaceSettings({
  query,
  translate,
}: SettingsSectionProps) {
  const [workspace, update] = usePreferenceSection('workspace');
  const { resetSection } = useFlyoffPreferences();

  return (
    <SettingsSection
      description={translate('settings.sectionWorkspaceDescription')}
      id="settings-workspace"
      onReset={() => resetSection('workspace')}
      title={translate('settings.sectionWorkspace')}
      translate={translate}
    >
      <SettingRow
        description={translate('settings.showTabIconsDescription')}
        query={query}
        title={translate('settings.showTabIcons')}
      >
        <SettingsToggle
          checked={workspace.showTabIcons}
          label={translate('settings.showTabIcons')}
          onChange={(showTabIcons) => update({ showTabIcons })}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.tabCloseVisibilityDescription')}
        query={query}
        title={translate('settings.tabCloseVisibility')}
      >
        <SettingsSelect
          label={translate('settings.tabCloseVisibility')}
          onChange={(event) =>
            update({
              tabCloseVisibility: event.currentTarget.value as
                | 'hover'
                | 'always',
            })
          }
          options={[
            {
              value: 'hover',
              label: translate('settings.optionCloseHover'),
            },
            {
              value: 'always',
              label: translate('settings.optionCloseAlways'),
            },
          ]}
          value={workspace.tabCloseVisibility}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.treeDensityDescription')}
        query={query}
        title={translate('settings.treeDensity')}
      >
        <SettingsSelect
          label={translate('settings.treeDensity')}
          onChange={(event) =>
            update({
              treeDensity: event.currentTarget.value as
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
          value={workspace.treeDensity}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.showSearchTipsDescription')}
        query={query}
        title={translate('settings.showSearchTips')}
      >
        <SettingsToggle
          checked={workspace.showSearchTips}
          label={translate('settings.showSearchTips')}
          onChange={(showSearchTips) => update({ showSearchTips })}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.showPaneDropLabelsDescription')}
        query={query}
        title={translate('settings.showPaneDropLabels')}
      >
        <SettingsToggle
          checked={workspace.showPaneDropLabels}
          label={translate('settings.showPaneDropLabels')}
          onChange={(showPaneDropLabels) => update({ showPaneDropLabels })}
        />
      </SettingRow>
    </SettingsSection>
  );
}

export function DocumentSettings({
  query,
  translate,
}: SettingsSectionProps) {
  const [documents, update] = usePreferenceSection('documents');
  const { resetSection } = useFlyoffPreferences();

  return (
    <SettingsSection
      description={translate('settings.sectionDocumentsDescription')}
      id="settings-documents"
      onReset={() => resetSection('documents')}
      title={translate('settings.sectionDocuments')}
      translate={translate}
    >
      <SettingRow
        description={translate('settings.showPathDescription')}
        query={query}
        title={translate('settings.showPath')}
      >
        <SettingsToggle
          checked={documents.showPath}
          label={translate('settings.showPath')}
          onChange={(showPath) => update({ showPath })}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.propertiesDensityDescription')}
        query={query}
        title={translate('settings.propertiesDensity')}
      >
        <SettingsSelect
          label={translate('settings.propertiesDensity')}
          onChange={(event) =>
            update({
              propertiesDensity: event.currentTarget.value as
                | 'compact'
                | 'full',
            })
          }
          options={[
            {
              value: 'compact',
              label: translate('settings.optionPropertiesCompact'),
            },
            {
              value: 'full',
              label: translate('settings.optionPropertiesFull'),
            },
          ]}
          value={documents.propertiesDensity}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.showFileExtensionsDescription')}
        query={query}
        title={translate('settings.showFileExtensions')}
      >
        <SettingsToggle
          checked={documents.showFileExtensions}
          label={translate('settings.showFileExtensions')}
          onChange={(showFileExtensions) => update({ showFileExtensions })}
        />
      </SettingRow>
    </SettingsSection>
  );
}
