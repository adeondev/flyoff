import {
  ACCENT_COLOR_PRESETS,
  type FlyoffTheme,
} from '../../../shared/contracts';
import { ColorSwatchPicker } from '../../components/color';
import type { Translate } from '../page-types';
import { themeAccentColor } from './accent-color';

interface AccentColorPickerProps {
  onChange: (value: string | null) => void;
  theme: FlyoffTheme;
  translate: Translate;
  value: string | null;
}

export function AccentColorPicker({
  onChange,
  theme,
  translate,
  value,
}: AccentColorPickerProps) {
  return (
    <div className="settings-accent-picker">
      <ColorSwatchPicker
        label={translate('settings.accentPresets')}
        labels={{
          alpha: translate('color.alpha'),
          eyedropper: translate('color.eyedropper'),
          format: translate('color.format'),
          hue: translate('color.hue'),
          loupeCancel: translate('color.loupeCancel'),
          loupeHint: translate('color.loupeHint'),
          loupeLocked: translate('color.loupeLocked'),
          loupeScreen: translate('color.loupeScreen'),
          recent: translate('color.recent'),
        }}
        onChange={onChange}
        optionLabel={(preset) =>
          `${translate('settings.accentColor')}: ${preset}`
        }
        presets={ACCENT_COLOR_PRESETS}
        value={value}
      />
      <button
        className="settings-accent-picker__reset"
        disabled={value === null}
        onClick={() => onChange(null)}
        type="button"
      >
        <span
          aria-hidden="true"
          style={{ background: themeAccentColor(theme) }}
        />
        {translate('settings.accentUseTheme')}
      </button>
    </div>
  );
}
