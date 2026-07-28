import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

import { ColorLoupe } from './ColorLoupe';
import { captureWindowPixels, type PixelSampler } from './pixel-sampler';
import {
  colorContrastInk,
  contrastRatio,
  hslToRgb,
  hsvToRgb,
  nearestColor,
  parseColor,
  parseHexRgba,
  rgbaToHex,
  rgbToHsl,
  rgbToHsv,
  type HslColor,
  type HsvColor,
  type RgbColor,
} from './color-model';

/** Channel triplet the numeric fields edit; hexadecimal is always shown. */
type ChannelFormat = 'rgb' | 'hsl';

export interface ColorPickerLabels {
  alpha?: string;
  eyedropper?: string;
  format?: string;
  hue?: string;
  loupeCancel?: string;
  loupeHint?: string;
  loupeLocked?: string;
  loupeScreen?: string;
  recent?: string;
}

interface ColorSwatchPickerProps {
  allowAlpha?: boolean;
  customLabel?: string;
  label: string;
  labels?: ColorPickerLabels;
  onChange: (value: string) => void;
  optionLabel: (preset: string) => string;
  presets: readonly string[];
  recent?: readonly string[];
  /** Colours a screen sample should land back on exactly when it lands near. */
  snapTo?: readonly string[];
  value: string | null;
}

interface EyeDropperInstance {
  open: () => Promise<{ sRGBHex: string }>;
}

type EyeDropperConstructor = new () => EyeDropperInstance;

function eyeDropperConstructor(): EyeDropperConstructor | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const candidate = (window as unknown as { EyeDropper?: unknown }).EyeDropper;
  return typeof candidate === 'function'
    ? (candidate as EyeDropperConstructor)
    : null;
}

function initialColor(value: string | null, presets: readonly string[]): string {
  const parsed = parseHexRgba(value ?? '');
  return parsed ? rgbaToHex(parsed) : presets[0] ?? '#8F4FC4';
}

export function ColorSwatchPicker({
  allowAlpha = false,
  customLabel,
  label,
  labels,
  onChange,
  optionLabel,
  presets,
  recent,
  snapTo,
  value,
}: ColorSwatchPickerProps) {
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const planeRef = useRef<HTMLDivElement>(null);
  const externalColor = initialColor(value, presets);
  const [syncedColor, setSyncedColor] = useState(externalColor);
  const [hex, setHex] = useState(externalColor);
  const [format, setFormat] = useState<ChannelFormat>('rgb');
  const [picking, setPicking] = useState<{
    sampler: PixelSampler | null;
  } | null>(null);
  const [alpha, setAlpha] = useState(
    () => parseHexRgba(externalColor)?.alpha ?? 1,
  );
  const [hsv, setHsv] = useState<HsvColor>(() =>
    rgbToHsv(parseHexRgba(externalColor)!),
  );
  const rgb = hsvToRgb(hsv);
  const hsl = rgbToHsl(rgb);
  const selectedIndex = value ? presets.indexOf(value) : -1;
  const fieldGroupLabel = customLabel ?? label;
  const eyeDropper = eyeDropperConstructor();
  const ink = colorContrastInk(rgbaToHex({ ...rgb, alpha: 1 }));
  const ratio = contrastRatio(rgb, parseHexRgba(ink)!);

  if (externalColor !== syncedColor) {
    const parsed = parseHexRgba(externalColor)!;
    setSyncedColor(externalColor);
    setHex(externalColor);
    setHsv(rgbToHsv(parsed));
    setAlpha(parsed.alpha);
  }

  const preview = (next: HsvColor): void => {
    setHsv(next);
    setHex(rgbaToHex({ ...hsvToRgb(next), alpha }));
  };

  const commit = (next: HsvColor = hsv, nextAlpha: number = alpha): void => {
    const nextHex = rgbaToHex({ ...hsvToRgb(next), alpha: nextAlpha });
    setHex(nextHex);
    onChange(nextHex);
  };

  const applyRgb = (next: RgbColor, nextAlpha: number = alpha): void => {
    const nextHsv = rgbToHsv(next);
    preview(nextHsv);
    commit(nextHsv, nextAlpha);
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
    applyRgb({ ...rgb, [channel]: Math.min(255, Number(raw)) });
  };

  const updateHsl = (channel: keyof HslColor, raw: string): void => {
    if (!/^\d{1,3}$/.test(raw)) {
      return;
    }
    const amount = Number(raw);
    applyRgb(
      hslToRgb({
        ...hsl,
        [channel]:
          channel === 'hue' ? Math.min(359, amount) : Math.min(100, amount) / 100,
      }),
    );
  };

  const updateAlpha = (next: number, shouldCommit: boolean): void => {
    setAlpha(next);
    setHex(rgbaToHex({ ...rgb, alpha: next }));
    if (shouldCommit) {
      commit(hsv, next);
    }
  };

  const refreshSampler = useCallback(async (): Promise<void> => {
    const sampler = await captureWindowPixels();
    setPicking((current) => (current ? { sampler } : current));
  }, []);

  const applyPicked = (picked: string): void => {
    const parsed = parseColor(picked);
    if (parsed) {
      applyRgb(parsed, allowAlpha ? parsed.alpha : 1);
    }
  };

  const pickFromScreen = (): void => {
    if (!eyeDropper) {
      return;
    }
    void new eyeDropper()
      .open()
      .then(({ sRGBHex }) => {
        const sampled = parseColor(sRGBHex);
        if (!sampled) {
          return;
        }
        const snapped = snapTo?.length
          ? parseColor(nearestColor(sampled, snapTo) ?? '')
          : null;
        const picked = snapped ?? sampled;
        applyRgb(picked, allowAlpha ? picked.alpha : 1);
      })
      .catch(() => undefined);
  };

  const moveFocus = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    total: number,
  ): void => {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + total) % total;
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % total;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = total - 1;
    }
    if (nextIndex === undefined) {
      return;
    }
    event.preventDefault();
    buttonsRef.current[nextIndex]?.focus();
  };

  const channels: readonly {
    amount: number;
    key: string;
    maximum: number;
    shortLabel: string;
  }[] =
    format === 'rgb'
      ? [
          { key: 'red', shortLabel: 'R', amount: rgb.red, maximum: 255 },
          { key: 'green', shortLabel: 'G', amount: rgb.green, maximum: 255 },
          { key: 'blue', shortLabel: 'B', amount: rgb.blue, maximum: 255 },
        ]
      : [
          {
            key: 'hue',
            shortLabel: 'H',
            amount: Math.round(hsl.hue),
            maximum: 359,
          },
          {
            key: 'saturation',
            shortLabel: 'S',
            amount: Math.round(hsl.saturation * 100),
            maximum: 100,
          },
          {
            key: 'lightness',
            shortLabel: 'L',
            amount: Math.round(hsl.lightness * 100),
            maximum: 100,
          },
        ];

  return (
    <div className="flyoff-color-picker">
      {picking ? (
        <ColorLoupe
          onRefresh={refreshSampler}
          sampler={picking.sampler}
          labels={{
            cancel: labels?.loupeCancel ?? 'Esc to cancel',
            hint: labels?.loupeHint ?? 'Click to confirm the colour',
            locked: labels?.loupeLocked ?? 'Note colour',
            screen: labels?.loupeScreen ?? 'Whole screen',
          }}
          onCancel={() => setPicking(null)}
          onPick={(picked) => {
            setPicking(null);
            applyPicked(picked);
          }}
          onScreenPick={
            eyeDropper
              ? () => {
                  setPicking(null);
                  pickFromScreen();
                }
              : undefined
          }
        />
      ) : null}
      <div aria-label={label} className="flyoff-swatches" role="radiogroup">
        {presets.map((preset, index) => (
          <button
            aria-checked={value === preset}
            aria-label={optionLabel(preset)}
            key={preset}
            onClick={() => onChange(preset)}
            onKeyDown={(event) => moveFocus(event, index, presets.length)}
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
      {recent?.length ? (
        <div
          aria-label={labels?.recent ?? 'Recent colours'}
          className="flyoff-swatches flyoff-swatches--recent"
          role="group"
        >
          {recent.map((preset) => (
            <button
              aria-label={optionLabel(preset)}
              key={preset}
              onClick={() => onChange(preset)}
              style={{ '--swatch-color': preset } as CSSProperties}
              type="button"
            >
              <span aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}
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
      <div className="flyoff-color-picker__sliders">
        <span
          aria-label={`${fieldGroupLabel}: ${rgbaToHex({ ...rgb, alpha })}, ${
            Math.round(ratio * 10) / 10
          }:1`}
          className="flyoff-color-picker__preview"
          role="img"
          style={
            {
              '--preview-color': rgbaToHex({ ...rgb, alpha }),
              '--preview-ink': ink,
            } as CSSProperties
          }
        >
          <span aria-hidden="true">Aa</span>
        </span>
        <div className="flyoff-color-picker__ranges">
          <label className="flyoff-color-picker__hue">
            <span>{customLabel ?? label}</span>
            <input
              aria-label={`${fieldGroupLabel}: ${labels?.hue ?? 'Hue'}`}
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
          {allowAlpha ? (
            <label className="flyoff-color-picker__alpha">
              <span>{labels?.alpha ?? 'Alpha'}</span>
              <input
                aria-label={`${fieldGroupLabel}: ${labels?.alpha ?? 'Alpha'}`}
                max="100"
                min="0"
                onChange={(event) =>
                  updateAlpha(Number(event.target.value) / 100, false)
                }
                onKeyUp={(event) =>
                  updateAlpha(Number(event.currentTarget.value) / 100, true)
                }
                onPointerUp={(event) =>
                  updateAlpha(Number(event.currentTarget.value) / 100, true)
                }
                style={
                  {
                    '--alpha-color': rgbaToHex({ ...rgb, alpha: 1 }),
                  } as CSSProperties
                }
                type="range"
                value={Math.round(alpha * 100)}
              />
            </label>
          ) : null}
        </div>
        <button
          aria-label={labels?.eyedropper ?? 'Pick a colour'}
          className="flyoff-color-picker__eyedropper"
          onClick={() => {
            // Captured before the loupe mounts, so it stays out of the still.
            void captureWindowPixels().then((sampler) =>
              setPicking({ sampler }),
            );
          }}
          type="button"
        >
          <span aria-hidden="true" />
        </button>
      </div>
      <div className="flyoff-color-picker__fields">
        <button
          aria-label={`${labels?.format ?? 'Format'}: ${format.toUpperCase()}`}
          className="flyoff-color-picker__format"
          onClick={() => setFormat(format === 'rgb' ? 'hsl' : 'rgb')}
          type="button"
        >
          {format.toUpperCase()}
        </button>
        {channels.map(({ amount, key, maximum, shortLabel }) => (
          <label key={key}>
            <span>{shortLabel}</span>
            <input
              aria-label={`${fieldGroupLabel}: ${shortLabel}`}
              inputMode="numeric"
              max={maximum}
              min="0"
              onChange={(event) =>
                format === 'rgb'
                  ? updateRgb(key as keyof RgbColor, event.target.value)
                  : updateHsl(key as keyof HslColor, event.target.value)
              }
              type="number"
              value={amount}
            />
          </label>
        ))}
        <label className="flyoff-color-picker__hex">
          <span>Hex</span>
          <input
            aria-invalid={!parseColor(hex)}
            aria-label={`${fieldGroupLabel}: hexadecimal`}
            maxLength={9}
            onBlur={() => {
              const parsed = parseColor(hex);
              if (parsed) {
                applyRgb(parsed, allowAlpha ? parsed.alpha : 1);
              } else {
                setHex(rgbaToHex({ ...rgb, alpha }));
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
