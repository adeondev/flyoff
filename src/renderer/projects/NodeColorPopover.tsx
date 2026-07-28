import { useCallback, useEffect, useId, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import { ACCENT_COLOR_PRESETS } from '../../shared/contracts';
import { ColorSwatchPicker, isColorPicking } from '../components/color';
import type { Translate } from '../pages/page-types';

export interface NodeColorPopoverProps {
  nodeId?: string;
  position: { x: number; y: number };
  resetLabel?: string;
  restoreFocus?: HTMLElement | null;
  seed: string | null;
  title?: string;
  translate: Translate;
  onClose: () => void;
  onSelect: (seed: string | null) => void;
}

function positionStyle(position: { x: number; y: number }): CSSProperties {
  const width = 326;
  const height = 354;
  const gap = 8;
  return {
    left: Math.max(gap, Math.min(position.x, window.innerWidth - width - gap)),
    top: Math.max(gap, Math.min(position.y, window.innerHeight - height - gap)),
  };
}

export function NodeColorPopover({
  nodeId,
  onClose,
  onSelect,
  position,
  resetLabel,
  restoreFocus,
  seed,
  title,
  translate,
}: NodeColorPopoverProps) {
  const titleId = `node-color-title-${useId()}`;
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(
    (restore: boolean): void => {
      onClose();
      if (!restore) {
        return;
      }
      requestAnimationFrame(() => {
        if (restoreFocus?.isConnected) {
          restoreFocus.focus({ preventScroll: true });
        }
      });
    },
    [onClose, restoreFocus],
  );

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      if (!isColorPicking() && !rootRef.current?.contains(event.target as Node)) {
        close(false);
      }
    };
    const handleEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || isColorPicking()) {
        return;
      }
      event.preventDefault();
      close(true);
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [close]);

  return createPortal(
    <div
      aria-labelledby={titleId}
      className="node-color-popover"
      data-node-id={nodeId}
      ref={rootRef}
      role="dialog"
      style={positionStyle(position)}
    >
      <strong id={titleId}>
        {title ?? translate('projects.nodeColor')}
      </strong>
      <ColorSwatchPicker
        customLabel={translate('projects.nodeColorCustom')}
        label={translate('projects.nodeColorPresets')}
        labels={{
          alpha: translate('color.alpha'),
          eyedropper: translate('color.eyedropper'),
          format: translate('color.format'),
          hue: translate('color.hue'),
          loupeCancel: translate('color.loupeCancel'),
          loupeHint: translate('color.loupeHint'),
          loupeLocked: translate('color.loupeLocked'),
          loupeScreen: translate('color.loupeScreen'),
          recent: translate('color.recent'),
        }}
        onChange={onSelect}
        optionLabel={(preset) =>
          `${translate('projects.nodeColor')}: ${preset}`
        }
        presets={ACCENT_COLOR_PRESETS}
        value={seed}
      />
      <button
        className="node-color-popover__reset"
        disabled={seed === null}
        onClick={() => onSelect(null)}
        type="button"
      >
        {resetLabel ?? translate('projects.nodeColorInherit')}
      </button>
    </div>,
    document.body,
  );
}
