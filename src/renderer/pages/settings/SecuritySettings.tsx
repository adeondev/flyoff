import type { Translate } from '../page-types';
import { useFlyoffPreferences } from '../../preferences';
import {
  SettingRow,
  SettingsSection,
  SettingsToggle,
  usePreferenceSection,
} from './SettingsControls';

export function SecuritySettings({
  query,
  translate,
}: {
  query: string;
  translate: Translate;
}) {
  const [security, update] = usePreferenceSection('security');
  const { resetSection } = useFlyoffPreferences();

  return (
    <SettingsSection
      description={translate('settings.sectionSecurityDescription')}
      id="settings-security"
      onReset={() => resetSection('security')}
      title={translate('settings.sectionSecurity')}
      translate={translate}
    >
      <SettingRow
        description={translate(
          'settings.lockProtectedOnWindowBlurDescription',
        )}
        query={query}
        title={translate('settings.lockProtectedOnWindowBlur')}
      >
        <SettingsToggle
          checked={security.lockProtectedOnWindowBlur}
          label={translate('settings.lockProtectedOnWindowBlur')}
          onChange={(lockProtectedOnWindowBlur) =>
            update({ lockProtectedOnWindowBlur })
          }
        />
      </SettingRow>
    </SettingsSection>
  );
}
