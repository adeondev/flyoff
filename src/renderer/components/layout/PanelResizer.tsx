import type { RefObject } from 'react';

import { usePanelResize } from './usePanelResize';

export interface PanelResizerProps {
  ariaLabel: string;
  target: RefObject<HTMLElement | null>;
  cssVar: string;
  min: number;
  max: number;
  value: number;
  direction?: 1 | -1;
  className?: string;
  onCommit: (size: number) => void;
  onReset?: () => void;
}

export function PanelResizer({
  ariaLabel,
  className,
  cssVar,
  direction,
  max,
  min,
  onCommit,
  onReset,
  target,
  value,
}: PanelResizerProps) {
  const { onDoubleClick, onKeyDown, onPointerDown } = usePanelResize({
    cssVar,
    direction,
    getSize: () => value,
    max,
    min,
    onCommit,
    onReset,
    target,
  });

  return (
    <div
      aria-label={ariaLabel}
      aria-orientation="vertical"
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={value}
      className={`flyoff-panel-resizer${className ? ` ${className}` : ''}`}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      role="separator"
      tabIndex={0}
    />
  );
}
