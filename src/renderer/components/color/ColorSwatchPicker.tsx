import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

import {
  hsvToRgb,
  parseHexColor,
  rgbToHex,
  rgbToHsv,
  type HsvColor,
  type RgbColor,
} from './color-model';

interface ColorSwatchPickerProps {
  customLabel?: string;
  label: string;
  onChange: (value: string) => void;
  optionLabel: (preset: string) => string;
  presets: readonly string[];
  value: string | null;
}

function initialColor(value: string | null, presets: readonly string[]): string {
  const parsed = parseHexColor(value ?? '');
  return parsed ? rgbToHex(parsed) : presets[0] ?? '#8F4FC4';
}

export function ColorSwatchPicker({
  customLabel,
  label,
  onChange,
  optionLabel,
  presets,
  value,
}: ColorSwatchPickerProps) {
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const planeRef = useRef<HTMLDivElement>(null);
  const externalColor = initialColor(value, presets);
  const [syncedColor, setSyncedColor] = useState(externalColor);
  const [hex, setHex] = useState(externalColor);
  const [hsv, setHsv] = useState<HsvColor>(() =>
    rgbToHsv(parseHexColor(externalColor)!),
  );
  const rgb = hsvToRgb(hsv);
  const selectedIndex = value ? presets.indexOf(value) : -1;

  if (externalColor !== syncedColor) {
    setSyncedColor(externalColor);
    setHex(externalColor);
    setHsv(rgbToHsv(parseHexColor(externalColor)!));
  }

  const preview = (next: HsvColor): void => {
    setHsv(next);
    setHex(rgbToHex(hsvToRgb(next)));
  };

  const commit = (next: HsvColor = hsv): void => {
    const nextHex = rgbToHex(hsvToRgb(next));
    setHex(nextHex);
    onChange(nextHex);
  };

  const updatePlane = (
    event: PointerEvent<HTMLDivElement>,
    shouldCommit: boolean,
  ): void => {
    const bounds = planeRef.current?.getBoundingClientRect();
    if (!bounds) {
      return;
    }
    const next = {
      ...hsv,
      saturation: Math.min(
        1,
        Math.max(0, (event.clientX - bounds.left) / bounds.width),
      ),
      value:
        1 -
        Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
    preview(next);
    if (shouldCommit) {
      commit(next);
    }
  };

  const updateRgb = (channel: keyof RgbColor, raw: string): void => {
    if (!/^\d{1,3}$/.test(raw)) {
      return;
    }
    const nextRgb = { ...rgb, [channel]: Math.min(255, Number(raw)) };
    const next = rgbToHsv(nextRgb);
    preview(next);
    commit(next);
  };

  const moveFocus = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + presets.length) % presets.length;
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % presets.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = presets.length - 1;
    }
    if (nextIndex === undefined) {
      return;
    }
    event.preventDefault();
    buttonsRef.current[nextIndex]?.focus();
  };

  return (
    <div className="flyoff-color-picker">
      <div aria-label={label} className="flyoff-swatches" role="radiogroup">
        {presets.map((preset, index) => (
          <button
            aria-checked={value === preset}
            aria-label={optionLabel(preset)}
            key={preset}
            onClick={() => onChange(preset)}
            onKeyDown={(event) => moveFocus(event, index)}
            ref={(button) => {
              buttonsRef.current[index] = button;
            }}
            role="radio"
            style={{ '--swatch-color': preset } as CSSProperties}
            tabIndex={
              selectedIndex === index || (selectedIndex === -1 && index === 0)
                ? 0
                : -1
            }
            type="button"
          >
            <span aria-hidden="true" />
          </button>
        ))}
      </div>
      <div
        aria-label={customLabel ?? label}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuetext={`${Math.round(hsv.saturation * 100)}%, ${Math.round(hsv.value * 100)}%`}
        className="flyoff-color-picker__plane"
        onKeyDown={(event) => {
          const step = event.shiftKey ? 0.1 : 0.01;
          const next = { ...hsv };
          if (event.key === 'ArrowLeft') {
            next.saturation = Math.max(0, next.saturation - step);
          } else if (event.key === 'ArrowRight') {
            next.saturation = Math.min(1, next.saturation + step);
          } else if (event.key === 'ArrowUp') {
            next.value = Math.min(1, next.value + step);
          } else if (event.key === 'ArrowDown') {
            next.value = Math.max(0, next.value - step);
          } else {
            return;
          }
          event.preventDefault();
          preview(next);
          commit(next);
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          updatePlane(event, false);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            updatePlane(event, false);
          }
        }}
        onPointerUp={(event) => {
          updatePlane(event, true);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        ref={planeRef}
        role="slider"
        style={
          {
            '--picker-hue': `hsl(${hsv.hue} 100% 50%)`,
            '--picker-saturation': `${hsv.saturation * 100}%`,
            '--picker-value': `${(1 - hsv.value) * 100}%`,
          } as CSSProperties
        }
        tabIndex={0}
      >
        <span aria-hidden="true" />
      </div>
      <label className="flyoff-color-picker__hue">
        <span>{customLabel ?? label}</span>
        <input
          aria-label={`${customLabel ?? label}: H`}
          max="359"
          min="0"
          onChange={(event) =>
            preview({ ...hsv, hue: Number(event.target.value) })
          }
          onKeyUp={(event) =>
            commit({ ...hsv, hue: Number(event.currentTarget.value) })
          }
          onPointerUp={(event) =>
            commit({ ...hsv, hue: Number(event.currentTarget.value) })
          }
          type="range"
          value={Math.round(hsv.hue)}
        />
      </label>
      <div className="flyoff-color-picker__fields">
        {([
          ['red', 'R'],
          ['green', 'G'],
          ['blue', 'B'],
        ] as const).map(([channel, shortLabel]) => (
          <label key={channel}>
            <span>{shortLabel}</span>
            <input
              aria-label={`${customLabel ?? label}: ${shortLabel}`}
              inputMode="numeric"
              max="255"
              min="0"
              onChange={(event) => updateRgb(channel, event.target.value)}
              type="number"
              value={rgb[channel]}
            />
          </label>
        ))}
        <label className="flyoff-color-picker__hex">
          <span>Hex</span>
          <input
            aria-invalid={!parseHexColor(hex)}
            aria-label={`${customLabel ?? label}: hexadecimal`}
            maxLength={7}
            onBlur={() => {
              const parsed = parseHexColor(hex);
              if (parsed) {
                const next = rgbToHsv(parsed);
                preview(next);
                commit(next);
              }
            }}
            onChange={(event) => setHex(event.target.value.toUpperCase())}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            spellCheck={false}
            type="text"
            value={hex}
          />
        </label>
      </div>
    </div>
  );
}
