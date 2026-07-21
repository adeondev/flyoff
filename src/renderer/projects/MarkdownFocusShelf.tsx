import chevronIcon from '../../../public/images/icons/actions/chevron-right.svg';
import { MaskedIcon } from '../components/MaskedIcon';
import { DropdownMenu, type MenuItem } from '../components/menu';
import { getTooltipTargetProps } from '../components/tooltip';
import type { Translate } from '../pages/page-types';
import type { EditorMode } from './editor-mode';
import type { SourcePositionStatus } from './source-status';

interface MarkdownFocusShelfProps {
  menuItems: readonly MenuItem[];
  mode: EditorMode;
  onModeChange?: (mode: EditorMode) => void;
  position: SourcePositionStatus;
  showPosition: boolean;
  status?: {
    label: string;
    state: string;
  };
  translate: Translate;
}

export function MarkdownFocusShelf({
  menuItems,
  mode,
  onModeChange,
  position,
  showPosition,
  status,
  translate,
}: MarkdownFocusShelfProps) {
  return (
    <div
      aria-label={translate('projects.editorPosition')}
      className="markdown-editor__shelf"
    >
      <svg
        aria-hidden="true"
        className="markdown-editor__shelf-frame"
        focusable="false"
      >
        <path
          className="markdown-editor__shelf-fill"
          d="M24 0C17.37 0 12 5.37 12 12C12 19.73 6.63 26 0 26H24Z"
        />
        <path
          className="markdown-editor__shelf-outline"
          d="M24 .5C17.65 .5 12.5 5.65 12.5 12C12.5 19.45 7.15 25.5 .5 25.5"
        />
        <line
          className="markdown-editor__shelf-outline"
          x1="24"
          x2="100%"
          y1=".5"
          y2=".5"
        />
        <line
          className="markdown-editor__shelf-outline"
          x1=".5"
          x2="100%"
          y1="25.5"
          y2="25.5"
        />
      </svg>
      {status ? (
        <span
          aria-live="polite"
          className={`markdown-editor__status markdown-editor__status--${status.state}`}
        >
          {status.label}
        </span>
      ) : null}
      {mode !== 'reading' && showPosition ? (
        <>
          <span className="markdown-editor__shelf-position">
            {translate('projects.line')} {position.line},{' '}
            {translate('projects.column')} {position.column}
          </span>
          {position.selected > 0 ? (
            <span className="markdown-editor__shelf-position">
              {position.selected}{' '}
              {translate(
                position.selected === 1
                  ? 'projects.selectedOne'
                  : 'projects.selectedMany',
              )}
            </span>
          ) : null}
        </>
      ) : null}
      <DropdownMenu
        items={menuItems}
        onAction={(id) => {
          if (id.startsWith('mode:')) {
            onModeChange?.(id.slice(5) as EditorMode);
          }
        }}
        placement="top-end"
        trigger={(triggerProps) => (
          <button
            {...triggerProps}
            aria-label={translate('projects.editorModeMenu')}
            className="markdown-editor__shelf-trigger"
            type="button"
            {...getTooltipTargetProps(
              translate('projects.editorModeMenu'),
              'top',
            )}
          >
            <MaskedIcon icon={chevronIcon} />
          </button>
        )}
      />
    </div>
  );
}
