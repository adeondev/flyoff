import { useRef, type CSSProperties, type KeyboardEvent } from 'react';

import {
  ACCENT_COLOR_PRESETS,
  type FlyoffTheme,
} from '../../../shared/contracts';
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
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = value
    ? ACCENT_COLOR_PRESETS.indexOf(
        value as (typeof ACCENT_COLOR_PRESETS)[number],
      )
    : -1;

  const selectByKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex =
        (index - 1 + ACCENT_COLOR_PRESETS.length) %
        ACCENT_COLOR_PRESETS.length;
    } else if (
      event.key === 'ArrowRight' ||
      event.key === 'ArrowDown'
    ) {
      nextIndex = (index + 1) % ACCENT_COLOR_PRESETS.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = ACCENT_COLOR_PRESETS.length - 1;
    }
    if (nextIndex === undefined) {
      return;
    }
    event.preventDefault();
    const nextColor = ACCENT_COLOR_PRESETS[nextIndex]!;
    onChange(nextColor);
    buttonsRef.current[nextIndex]?.focus();
  };

  return (
    <div className="settings-accent-picker">
      <div
        aria-label={translate('settings.accentPresets')}
        className="settings-accent-picker__presets"
        role="radiogroup"
      >
        {ACCENT_COLOR_PRESETS.map((preset, index) => (
          <button
            aria-checked={value === preset}
            aria-label={`${translate('settings.accentColor')}: ${preset}`}
            key={preset}
            onClick={() => onChange(preset)}
            onKeyDown={(event) => selectByKeyboard(event, index)}
            ref={(button) => {
              buttonsRef.current[index] = button;
            }}
            role="radio"
            style={
              { '--accent-option': preset } as CSSProperties
            }
            tabIndex={
              selectedIndex === index ||
              (selectedIndex === -1 && index === 0)
                ? 0
                : -1
            }
            type="button"
          >
            <span aria-hidden="true" />
          </button>
        ))}
      </div>
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
