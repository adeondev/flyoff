export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

export interface RgbaColor extends RgbColor {
  /** Opacity between 0 and 1. */
  alpha: number;
}

export interface HsvColor {
  hue: number;
  saturation: number;
  value: number;
}

export interface HslColor {
  hue: number;
  saturation: number;
  lightness: number;
}

export type ColorFormat = 'hex' | 'rgb' | 'hsl';

export const COLOR_FORMATS: readonly ColorFormat[] = ['hex', 'rgb', 'hsl'];

const HEX_COLOR = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_COLOR =
  /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:\s*[/,]\s*(\d*\.?\d+)(%?))?\s*\)$/i;
const HSL_COLOR =
  /^hsla?\(\s*(-?\d*\.?\d+)(?:deg)?[\s,]+(\d*\.?\d+)%[\s,]+(\d*\.?\d+)%(?:\s*[/,]\s*(\d*\.?\d+)(%?))?\s*\)$/i;
const LUMINANCE_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;

function byte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function unit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function readAlpha(raw: string | undefined, percent: string | undefined): number {
  if (raw === undefined) {
    return 1;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? unit(percent ? parsed / 100 : parsed) : 1;
}

/** `#abc` and `#abcd` expand to their six and eight digit forms. */
function expandHex(digits: string): string {
  return digits.length <= 4
    ? digits
        .split('')
        .map((digit) => digit + digit)
        .join('')
    : digits;
}

export function parseHexRgba(value: string): RgbaColor | null {
  const match = HEX_COLOR.exec(value.trim());
  if (!match) {
    return null;
  }
  const digits = expandHex(match[1]!);
  const packed = Number.parseInt(digits.slice(0, 6), 16);
  return {
    red: (packed >> 16) & 255,
    green: (packed >> 8) & 255,
    blue: packed & 255,
    alpha:
      digits.length === 8 ? Number.parseInt(digits.slice(6), 16) / 255 : 1,
  };
}

/** Accepts hexadecimal, `rgb()` and `hsl()` notation; rejects anything else. */
export function parseColor(value: string): RgbaColor | null {
  const text = value.trim();
  const hex = parseHexRgba(text);
  if (hex) {
    return hex;
  }

  const rgb = RGB_COLOR.exec(text);
  if (rgb) {
    return {
      red: byte(Number(rgb[1])),
      green: byte(Number(rgb[2])),
      blue: byte(Number(rgb[3])),
      alpha: readAlpha(rgb[4], rgb[5]),
    };
  }

  const hsl = HSL_COLOR.exec(text);
  if (hsl) {
    return {
      ...hslToRgb({
        hue: Number(hsl[1]),
        saturation: unit(Number(hsl[2]) / 100),
        lightness: unit(Number(hsl[3]) / 100),
      }),
      alpha: readAlpha(hsl[4], hsl[5]),
    };
  }

  return null;
}

export function parseHexColor(value: string): RgbColor | null {
  const parsed = parseHexRgba(value);
  return parsed
    ? { red: parsed.red, green: parsed.green, blue: parsed.blue }
    : null;
}

export function rgbToHex({ blue, green, red }: RgbColor): string {
  return `#${[red, green, blue]
    .map((channel) => byte(channel).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

/** Appends the alpha pair only when the colour is translucent. */
export function rgbaToHex(color: RgbaColor): string {
  const base = rgbToHex(color);
  return color.alpha >= 1
    ? base
    : `${base}${byte(color.alpha * 255)
        .toString(16)
        .padStart(2, '0')
        .toUpperCase()}`;
}

export function rgbToHsv({ blue, green, red }: RgbColor): HsvColor {
  const r = byte(red) / 255;
  const g = byte(green) / 255;
  const b = byte(blue) / 255;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta > 0) {
    hue =
      maximum === r
        ? 60 * (((g - b) / delta) % 6)
        : maximum === g
          ? 60 * ((b - r) / delta + 2)
          : 60 * ((r - g) / delta + 4);
  }
  return {
    hue: hue < 0 ? hue + 360 : hue,
    saturation: maximum === 0 ? 0 : delta / maximum,
    value: maximum,
  };
}

export function hsvToRgb({ hue, saturation, value }: HsvColor): RgbColor {
  const section = (((hue % 360) + 360) % 360) / 60;
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  const [r, g, b] =
    section < 1
      ? [chroma, x, 0]
      : section < 2
        ? [x, chroma, 0]
        : section < 3
          ? [0, chroma, x]
          : section < 4
            ? [0, x, chroma]
            : section < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const offset = value - chroma;
  return {
    red: byte((r + offset) * 255),
    green: byte((g + offset) * 255),
    blue: byte((b + offset) * 255),
  };
}

export function rgbToHsl({ blue, green, red }: RgbColor): HslColor {
  const r = byte(red) / 255;
  const g = byte(green) / 255;
  const b = byte(blue) / 255;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  let hue = 0;
  if (delta > 0) {
    hue =
      maximum === r
        ? 60 * (((g - b) / delta) % 6)
        : maximum === g
          ? 60 * ((b - r) / delta + 2)
          : 60 * ((r - g) / delta + 4);
  }
  return {
    hue: hue < 0 ? hue + 360 : hue,
    saturation:
      delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1)),
    lightness,
  };
}

export function hslToRgb({ hue, lightness, saturation }: HslColor): RgbColor {
  const section = (((hue % 360) + 360) % 360) / 60;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * unit(saturation);
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  const [r, g, b] =
    section < 1
      ? [chroma, x, 0]
      : section < 2
        ? [x, chroma, 0]
        : section < 3
          ? [0, chroma, x]
          : section < 4
            ? [0, x, chroma]
            : section < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const offset = lightness - chroma / 2;
  return {
    red: byte((r + offset) * 255),
    green: byte((g + offset) * 255),
    blue: byte((b + offset) * 255),
  };
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance({ blue, green, red }: RgbColor): number {
  return [red, green, blue]
    .map((channel) => {
      const normalized = byte(channel) / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    })
    .reduce(
      (total, channel, index) => total + channel * LUMINANCE_WEIGHTS[index]!,
      0,
    );
}

/** WCAG 2.1 contrast ratio, between 1 and 21. */
export function contrastRatio(first: RgbColor, second: RgbColor): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const BLACK: RgbColor = { red: 0, green: 0, blue: 0 };
const WHITE: RgbColor = { red: 255, green: 255, blue: 255 };

export function colorContrastInk(value: string): '#000000' | '#FFFFFF' {
  const rgb = parseHexColor(value);
  if (!rgb) {
    return '#FFFFFF';
  }
  return contrastRatio(rgb, BLACK) >= contrastRatio(rgb, WHITE)
    ? '#000000'
    : '#FFFFFF';
}

/**
 * Redmean approximation of perceptual difference, roughly 0 to 765. Cheaper
 * than Lab and far closer to the eye than a plain RGB distance.
 */
export function colorDistance(first: RgbColor, second: RgbColor): number {
  const deltaRed = byte(first.red) - byte(second.red);
  const deltaGreen = byte(first.green) - byte(second.green);
  const deltaBlue = byte(first.blue) - byte(second.blue);
  const meanRed = (byte(first.red) + byte(second.red)) / 2;
  return Math.sqrt(
    (2 + meanRed / 256) * deltaRed ** 2 +
      4 * deltaGreen ** 2 +
      (2 + (255 - meanRed) / 256) * deltaBlue ** 2,
  );
}

/**
 * Screen samples of coloured text are blended with the page by anti-aliasing,
 * so a sample lands near — never on — the colour that was authored. Anything
 * past this drifted far enough that snapping would be a guess.
 */
export const COLOR_SNAP_THRESHOLD = 64;

/**
 * Returns the candidate the sample most likely came from, unchanged so any
 * authored alpha survives, or null when nothing is close enough.
 */
export function nearestColor(
  sample: RgbColor,
  candidates: readonly string[],
  maxDistance = COLOR_SNAP_THRESHOLD,
): string | null {
  let best: string | null = null;
  let bestDistance = maxDistance;

  for (const candidate of candidates) {
    const parsed = parseColor(candidate);
    if (!parsed) {
      continue;
    }
    const distance = colorDistance(sample, parsed);
    if (distance <= bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}

export function formatColor(color: RgbaColor, format: ColorFormat): string {
  if (format === 'hex') {
    return rgbaToHex(color);
  }

  const alpha = Math.round(unit(color.alpha) * 100) / 100;

  if (format === 'rgb') {
    const channels = `${byte(color.red)} ${byte(color.green)} ${byte(color.blue)}`;
    return alpha >= 1
      ? `rgb(${channels})`
      : `rgb(${channels} / ${alpha})`;
  }

  const { hue, lightness, saturation } = rgbToHsl(color);
  const channels = `${Math.round(hue)} ${Math.round(saturation * 100)}% ${Math.round(
    lightness * 100,
  )}%`;
  return alpha >= 1 ? `hsl(${channels})` : `hsl(${channels} / ${alpha})`;
}
