import { ipcMain } from 'electron';

import {
  CAPTURE_WINDOW_PIXELS_CHANNEL,
  type WindowPixelSnapshot,
} from '../../shared/contracts';
import { validateTrustedMainFrame } from './trusted-sender';

/**
 * Hands the renderer a still of its own viewport so the eyedropper can read
 * real pixels — images, emoji and gradients included — rather than guessing
 * from the DOM, which only knows about colours someone declared.
 */
export function registerColorSampleHandler(
  isAllowedUrl: (url: string) => boolean,
): () => void {
  ipcMain.handle(CAPTURE_WINDOW_PIXELS_CHANNEL, async (event) => {
    validateTrustedMainFrame(event, isAllowedUrl, 'Colour sampling');

    const image = await event.sender.capturePage();
    const { height, width } = image.getSize();
    if (width === 0 || height === 0) {
      return null;
    }

    return {
      dataUrl: image.toDataURL(),
      height,
      width,
    } satisfies WindowPixelSnapshot;
  });

  return () => ipcMain.removeHandler(CAPTURE_WINDOW_PIXELS_CHANNEL);
}
