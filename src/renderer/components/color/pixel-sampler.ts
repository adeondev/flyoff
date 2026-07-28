import { rgbToHex } from './color-model';

export interface PixelSampler {
  /** Device pixels per CSS pixel in the snapshot. */
  readonly scale: number;
  readonly source: CanvasImageSource;
  at: (x: number, y: number) => string | null;
}

/**
 * A frozen still of the window that any point can be read back from. Reading
 * pixels is what lets the eyedropper accept images, emoji and gradients —
 * things no amount of DOM inspection can report a colour for.
 */
export async function createPixelSampler(
  dataUrl: string,
  cssWidth: number,
): Promise<PixelSampler | null> {
  const image = new Image();
  image.src = dataUrl;
  try {
    await image.decode();
  } catch {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context || cssWidth <= 0) {
    return null;
  }
  context.drawImage(image, 0, 0);

  const scale = image.naturalWidth / cssWidth;

  return {
    scale,
    source: canvas,
    at(x, y) {
      const deviceX = Math.floor(x * scale);
      const deviceY = Math.floor(y * scale);
      if (
        deviceX < 0 ||
        deviceY < 0 ||
        deviceX >= canvas.width ||
        deviceY >= canvas.height
      ) {
        return null;
      }
      const [red, green, blue] = context.getImageData(
        deviceX,
        deviceY,
        1,
        1,
      ).data;
      return rgbToHex({
        red: red ?? 0,
        green: green ?? 0,
        blue: blue ?? 0,
      });
    },
  };
}

/** Two frames: one to apply the hidden state, one to be sure it painted. */
function painted(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * Captures the viewport, or null wherever the bridge is unavailable. The loupe
 * is hidden for the shot: it floats over the page, so leaving it visible would
 * bake it into the still and let it sample its own pixels afterwards.
 */
export async function captureWindowPixels(): Promise<PixelSampler | null> {
  const capture = window.flyoff?.captureWindowPixels;
  if (typeof capture !== 'function') {
    return null;
  }

  const root = document.documentElement;
  root.dataset.colorCapturing = 'true';
  try {
    await painted();
    const snapshot = await capture();
    return snapshot
      ? await createPixelSampler(snapshot.dataUrl, window.innerWidth)
      : null;
  } catch {
    return null;
  } finally {
    delete root.dataset.colorCapturing;
  }
}
