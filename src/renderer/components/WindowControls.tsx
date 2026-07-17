import type { WindowControlAction } from '../../shared/contracts';
import { getTooltipTargetProps } from './tooltip';

export interface WindowControlLabels {
  minimize: string;
  maximize: string;
  restore: string;
  close: string;
}

interface WindowControlsProps {
  labels: WindowControlLabels;
  maximized: boolean;
  onAction: (action: WindowControlAction) => void;
}

function MinimizeIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M4.5 9.25h11v1.5h-11z" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        fillRule="evenodd"
        d="M4 4h12v12H4V4Zm1.5 1.5v9h9v-9h-9Z"
      />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M4 4h10v1.5H5.5V14H4V4Z" />
      <path
        fillRule="evenodd"
        d="M6 6h10v10H6V6Zm1.5 1.5v7h7v-7h-7Z"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="m5.2 4.1 4.8 4.8 4.8-4.8 1.1 1.1-4.8 4.8 4.8 4.8-1.1 1.1-4.8-4.8-4.8 4.8-1.1-1.1L8.9 10 4.1 5.2l1.1-1.1Z" />
    </svg>
  );
}

export function WindowControls({
  labels,
  maximized,
  onAction,
}: WindowControlsProps) {
  const maximizeLabel = maximized ? labels.restore : labels.maximize;

  return (
    <div className="window-controls" aria-label="Flyoff">
      <button
        className="window-controls__button"
        type="button"
        aria-label={labels.minimize}
        data-testid="window-minimize"
        onClick={() => onAction('minimize')}
        {...getTooltipTargetProps(labels.minimize, 'bottom')}
      >
        <MinimizeIcon />
      </button>
      <button
        className="window-controls__button"
        type="button"
        aria-label={maximizeLabel}
        data-testid="window-toggle-maximize"
        onClick={() => onAction('toggle-maximize')}
        {...getTooltipTargetProps(maximizeLabel, 'bottom')}
      >
        {maximized ? <RestoreIcon /> : <MaximizeIcon />}
      </button>
      <button
        className="window-controls__button window-controls__button--close"
        type="button"
        aria-label={labels.close}
        data-testid="window-close"
        onClick={() => onAction('close')}
        {...getTooltipTargetProps(labels.close, 'bottom')}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
