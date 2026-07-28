export const CAPTURE_WINDOW_PIXELS_CHANNEL =
  'flyoff:color:capture-window' as const;

export interface WindowPixelSnapshot {
  /** PNG data URL of the window viewport, at the display's pixel density. */
  dataUrl: string;
  height: number;
  width: number;
}

const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

export function isWindowPixelSnapshot(
  value: unknown,
): value is WindowPixelSnapshot {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const snapshot = value as Partial<WindowPixelSnapshot>;
  return (
    typeof snapshot.dataUrl === 'string' &&
    PNG_DATA_URL.test(snapshot.dataUrl) &&
    typeof snapshot.width === 'number' &&
    typeof snapshot.height === 'number' &&
    Number.isFinite(snapshot.width) &&
    Number.isFinite(snapshot.height) &&
    snapshot.width > 0 &&
    snapshot.height > 0
  );
}
