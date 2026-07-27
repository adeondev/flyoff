export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

export interface HsvColor {
  hue: number;
  saturation: number;
  value: number;
}

const HEX_COLOR = /^#?([0-9a-f]{6})$/i;

function byte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

export function parseHexColor(value: string): RgbColor | null {
  const match = HEX_COLOR.exec(value.trim());
  if (!match) {
    return null;
  }
  const packed = Number.parseInt(match[1]!, 16);
  return {
    red: (packed >> 16) & 255,
    green: (packed >> 8) & 255,
    blue: packed & 255,
  };
}

export function rgbToHex({ blue, green, red }: RgbColor): string {
  return `#${[red, green, blue]
    .map((channel) => byte(channel).toString(16).padStart(2, '0'))
    .join('')
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

export function hsvToRgb({
  hue,
  saturation,
  value,
}: HsvColor): RgbColor {
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

export function colorContrastInk(value: string): '#000000' | '#FFFFFF' {
  const rgb = parseHexColor(value);
  if (!rgb) {
    return '#FFFFFF';
  }
  const luminance = [rgb.red, rgb.green, rgb.blue]
    .map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    })
    .reduce(
      (total, channel, index) =>
        total + channel * [0.2126, 0.7152, 0.0722][index]!,
      0,
    );
  return luminance > 0.42 ? '#000000' : '#FFFFFF';
}
