import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import {
  ACCENT_COLOR_PRESETS,
  COLOR_RECENT_LIMIT,
} from '../../shared/contracts';
import { ColorSwatchPicker, isColorPicking } from '../components/color';
import type { Translate } from '../pages/page-types';
import { useFlyoffPreferences } from '../preferences';
import type { MarkdownInlineColorKind } from './markdown-actions';

export interface MarkdownColorPopoverProps {
  anchorRef?: RefObject<HTMLElement | null>;
  hasSelection?: boolean;
  initialColor?: string;
  initialKind?: MarkdownInlineColorKind;
  kindLocked?: boolean;
  onApply: (kind: MarkdownInlineColorKind, color: string) => void;
  onClose: () => void;
  position?: { x: number; y: number };
  snapTo?: readonly string[];
  translate: Translate;
}

function popoverStyle(
  position?: { x: number; y: number },
): CSSProperties {
  const width = 326;
  const height = 400;
  const gap = 8;
  const x = position?.x ?? gap;
  const preferredY = position?.y ?? gap;
  return {
    left: Math.max(gap, Math.min(x, window.innerWidth - width - gap)),
    top: Math.max(
      gap,
      Math.min(preferredY, window.innerHeight - height - gap),
    ),
  };
}

export function MarkdownColorPopover({
  anchorRef,
  hasSelection = true,
  initialColor = ACCENT_COLOR_PRESETS[0] ?? '#8F4FC4',
  initialKind = 'text',
  kindLocked = false,
  onApply,
  onClose,
  position,
  snapTo,
  translate,
}: MarkdownColorPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { preferences, update } = useFlyoffPreferences();
  const [color, setColor] = useState(initialColor);
  const [kind, setKind] = useState<MarkdownInlineColorKind>(initialKind);
  const close = useCallback(() => onClose(), [onClose]);

  function rememberColor(applied: string): void {
    update((current) => ({
      ...current,
      editor: {
        ...current.editor,
        colorRecent: [
          applied,
          ...current.editor.colorRecent.filter((item) => item !== applied),
        ].slice(0, COLOR_RECENT_LIMIT),
      },
    }));
  }

  useEffect(() => {
    const pointerDown = (event: PointerEvent): void => {
      if (
        !isColorPicking() &&
        !rootRef.current?.contains(event.target as Node) &&
        !anchorRef?.current?.contains(event.target as Node)
      ) {
        close();
      }
    };
    const keyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !isColorPicking()) {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener('pointerdown', pointerDown, true);
    window.addEventListener('keydown', keyDown);
    return () => {
      window.removeEventListener('pointerdown', pointerDown, true);
      window.removeEventListener('keydown', keyDown);
    };
  }, [anchorRef, close]);

  return createPortal(
    <div
      aria-label={translate('toolbar.color')}
      className="markdown-color-popover"
      ref={rootRef}
      role="dialog"
      style={popoverStyle(position)}
    >
      {hasSelection ? (
        <>
          {kindLocked ? null : (
            <div className="markdown-color-popover__modes">
              {(['text', 'highlight'] as const).map((mode) => (
                <button
                  aria-pressed={kind === mode}
                  key={mode}
                  onClick={() => setKind(mode)}
                  type="button"
                >
                  {translate(
                    mode === 'text'
                      ? 'toolbar.textColor'
                      : 'toolbar.highlightColor',
                  )}
                </button>
              ))}
            </div>
          )}
          <ColorSwatchPicker
            allowAlpha
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
            onChange={setColor}
            optionLabel={(preset) =>
              `${translate('toolbar.color')}: ${preset}`
            }
            presets={ACCENT_COLOR_PRESETS}
            recent={preferences.editor.colorRecent}
            snapTo={snapTo}
            value={color}
          />
          <button
            className="markdown-color-popover__apply"
            onClick={() => {
              onApply(kind, color);
              rememberColor(color);
              close();
            }}
            type="button"
          >
            {translate('toolbar.applyColor')}
          </button>
        </>
      ) : (
        <p className="markdown-color-popover__hint">
          {translate('toolbar.colorNoSelection')}
        </p>
      )}
    </div>,
    document.body,
  );
}
