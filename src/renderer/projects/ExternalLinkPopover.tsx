import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';

import type { Translate } from '../pages/page-types';

export interface ExternalLinkPopoverProps {
  anchor: HTMLAnchorElement;
  translate: Translate;
  url: string;
  onClose: () => void;
  onOpen: () => Promise<void>;
}

const POPOVER_WIDTH = 360;
const VIEWPORT_INSET = 8;

export function ExternalLinkPopover({
  anchor,
  onClose,
  onOpen,
  translate,
  url,
}: ExternalLinkPopoverProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = `${useId()}-title`;
  const destinationId = `${useId()}-destination`;
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({
    left: VIEWPORT_INSET,
    top: VIEWPORT_INSET,
    visibility: 'hidden',
  });

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const place = (): void => {
      const anchorRect = anchor.getBoundingClientRect();
      const dialogRect = dialog.getBoundingClientRect();
      const left = Math.min(
        Math.max(VIEWPORT_INSET, anchorRect.left),
        window.innerWidth - Math.min(POPOVER_WIDTH, dialogRect.width) - VIEWPORT_INSET,
      );
      const below = anchorRect.bottom + 6;
      const top =
        below + dialogRect.height <= window.innerHeight - VIEWPORT_INSET
          ? below
          : Math.max(VIEWPORT_INSET, anchorRect.top - dialogRect.height - 6);
      setPosition({ left, top, visibility: 'visible' });
    };

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor]);

  const close = useCallback((): void => {
    onClose();
    requestAnimationFrame(() => {
      if (anchor.isConnected) {
        anchor.focus();
      }
    });
  }, [anchor, onClose]);

  useEffect(() => {
    cancelRef.current?.focus();

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (
        target instanceof Node &&
        !dialogRef.current?.contains(target) &&
        !anchor.contains(target)
      ) {
        close();
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [anchor, close]);

  const open = (): void => {
    if (busy) {
      return;
    }
    setBusy(true);
    void onOpen().catch(() => undefined).finally(close);
  };

  return createPortal(
    <div
      aria-labelledby={titleId}
      className="external-link-popover"
      ref={dialogRef}
      role="dialog"
      style={position}
    >
      <strong id={titleId}>
        {translate('projects.linkRedirectTitle')}
      </strong>
      <p>{translate('projects.linkRedirectDescription')}</p>
      <span className="external-link-popover__label" id={destinationId}>
        {translate('projects.linkDestination')}
      </span>
      <output aria-labelledby={destinationId} title={url}>{url}</output>
      <div className="external-link-popover__actions">
        <button disabled={busy} onClick={close} ref={cancelRef} type="button">
          {translate('projects.cancel')}
        </button>
        <button
          className="external-link-popover__open"
          disabled={busy}
          onClick={open}
          type="button"
        >
          {translate('projects.openLink')}
        </button>
      </div>
    </div>,
    document.body,
  );
}
