import type { IpcMainInvokeEvent, WebFrameMain } from 'electron';

export function validateTrustedMainFrame(
  event: IpcMainInvokeEvent,
  isAllowedUrl: (url: string) => boolean,
  capability: string,
): WebFrameMain {
  const senderFrame = event.senderFrame;

  if (!senderFrame || senderFrame !== event.sender.mainFrame) {
    throw new Error(`${capability} is only available to the main frame.`);
  }

  if (!isAllowedUrl(senderFrame.url)) {
    throw new Error(`${capability} request came from an untrusted origin.`);
  }

  return senderFrame;
}
