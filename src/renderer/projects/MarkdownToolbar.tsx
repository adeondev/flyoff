import { useRef, useState, type CSSProperties } from 'react';

import boldIcon from '../../../public/images/icons/editor/bold.svg';
import codeIcon from '../../../public/images/icons/editor/code.svg';
import dividerIcon from '../../../public/images/icons/editor/divider.svg';
import headingIcon from '../../../public/images/icons/editor/heading.svg';
import highlightIcon from '../../../public/images/icons/editor/highlight.svg';
import linkIcon from '../../../public/images/icons/editor/ink.svg';
import italicIcon from '../../../public/images/icons/editor/italic.svg';
import listIcon from '../../../public/images/icons/editor/list-bullet.svg';
import quoteIcon from '../../../public/images/icons/editor/quote.svg';
import strikeIcon from '../../../public/images/icons/editor/strikethrough.svg';
import taskIcon from '../../../public/images/icons/instances/checklist.svg';
import emojiIcon from '../../../newicons/emoji.svg';
import paletteIcon from '../../../newicons/color-pallete.svg';
import { EMOJI_RECENT_LIMIT, type EmojiSkinTone } from '../../shared/contracts';
import { MaskedIcon } from '../components/MaskedIcon';
import { getTooltipTargetProps } from '../components/tooltip';
import type { Translate } from '../pages/page-types';
import { useFlyoffPreferences } from '../preferences';
import { EmojiPicker } from './EmojiPicker';
import { MARKDOWN_ACTIONS, type MarkdownAction } from './markdown-actions';
import type { MarkdownInlineColorKind } from './markdown-actions';
import { MarkdownColorPopover } from './MarkdownColorPopover';
import type { MarkdownTypingColor } from './source-typing-color';

export const MARKDOWN_ACTION_LABEL_KEYS: Record<
  MarkdownAction,
  Parameters<Translate>[0]
> = {
  bold: 'toolbar.bold',
  italic: 'toolbar.italic',
  strike: 'toolbar.strike',
  highlight: 'toolbar.highlight',
  code: 'toolbar.code',
  heading: 'toolbar.heading',
  list: 'toolbar.list',
  task: 'toolbar.task',
  quote: 'toolbar.quote',
  link: 'toolbar.link',
  divider: 'toolbar.divider',
};

export const MARKDOWN_ACTION_ICONS: Record<MarkdownAction, string> = {
  bold: boldIcon,
  italic: italicIcon,
  strike: strikeIcon,
  highlight: highlightIcon,
  code: codeIcon,
  heading: headingIcon,
  list: listIcon,
  task: taskIcon,
  quote: quoteIcon,
  link: linkIcon,
  divider: dividerIcon,
};

export interface MarkdownToolbarProps {
  activeTypingColor?: MarkdownTypingColor | null;
  disabled?: boolean;
  hasSelection?: boolean;
  translate: Translate;
  /** Read once per opening, so long notes are not rescanned per keystroke. */
  readColorContext?: () => {
    color: string | null;
    hasSelection?: boolean;
    kind: MarkdownInlineColorKind | null;
    snapTo: readonly string[];
  };
  onAction: (action: MarkdownAction) => void;
  onColor: (kind: MarkdownInlineColorKind, color: string | null) => void;
  onEmoji: (emoji: string) => void;
  onEmojiPickerClose: () => void;
}

export function MarkdownToolbar({
  activeTypingColor = null,
  disabled = false,
  hasSelection = true,
  onAction,
  onColor,
  onEmoji,
  onEmojiPickerClose,
  readColorContext,
  translate,
}: MarkdownToolbarProps) {
  const { preferences, update } = useFlyoffPreferences();
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const colorButtonRef = useRef<HTMLButtonElement>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [colorPicker, setColorPicker] = useState<{
    color: string | null;
    hasSelection: boolean;
    kind: MarkdownInlineColorKind | null;
    position: { x: number; y: number };
    snapTo: readonly string[];
  } | null>(null);

  function updateSkinTone(emojiSkinTone: EmojiSkinTone): void {
    update((current) => ({
      ...current,
      editor: { ...current.editor, emojiSkinTone },
    }));
  }

  function insertEmoji(emoji: string): void {
    onEmoji(emoji);
    update((current) => ({
      ...current,
      editor: {
        ...current.editor,
        emojiRecent: [
          emoji,
          ...current.editor.emojiRecent.filter((item) => item !== emoji),
        ].slice(0, EMOJI_RECENT_LIMIT),
      },
    }));
  }

  function closePicker(): void {
    setEmojiPickerOpen(false);
    onEmojiPickerClose();
  }

  function togglePicker(): void {
    if (emojiPickerOpen) {
      closePicker();
    } else {
      setEmojiPickerOpen(true);
    }
  }

  return (
    <div
      aria-label={translate('toolbar.label')}
      className="markdown-toolbar"
      role="toolbar"
    >
      {MARKDOWN_ACTIONS.map((action) => {
        const label = translate(MARKDOWN_ACTION_LABEL_KEYS[action]);

        return (
          <button
            aria-label={label}
            className="markdown-toolbar__button"
            disabled={disabled}
            key={action}
            onClick={() => onAction(action)}
            type="button"
            {...getTooltipTargetProps(label, 'bottom')}
          >
            <MaskedIcon
              className="markdown-toolbar__icon"
              icon={MARKDOWN_ACTION_ICONS[action]}
            />
          </button>
        );
      })}
      <button
        aria-expanded={Boolean(colorPicker)}
        aria-haspopup="dialog"
        aria-label={translate('toolbar.color')}
        aria-pressed={Boolean(activeTypingColor)}
        className="markdown-toolbar__button markdown-toolbar__button--color"
        data-color-default={
          activeTypingColor?.color === null ? true : undefined
        }
        disabled={disabled}
        onClick={(event) => {
          if (colorPicker) {
            setColorPicker(null);
            return;
          }
          const bounds = event.currentTarget.getBoundingClientRect();
          const context = readColorContext?.();
          setColorPicker({
            color: context?.color ?? null,
            hasSelection: context?.hasSelection ?? hasSelection,
            kind: context?.kind ?? null,
            position: { x: bounds.left, y: bounds.bottom + 5 },
            snapTo: context?.snapTo ?? [],
          });
        }}
        ref={colorButtonRef}
        style={
          activeTypingColor?.color
            ? ({
                '--markdown-toolbar-color': activeTypingColor.color,
              } as CSSProperties)
            : undefined
        }
        type="button"
        {...getTooltipTargetProps(translate('toolbar.color'), 'bottom')}
      >
        <MaskedIcon className="markdown-toolbar__icon" icon={paletteIcon} />
      </button>
      {colorPicker ? (
        <MarkdownColorPopover
          anchorRef={colorButtonRef}
          hasSelection={colorPicker.hasSelection}
          initialColor={colorPicker.color ?? undefined}
          initialDefault={colorPicker.color === null}
          initialKind={colorPicker.kind ?? 'text'}
          onApply={onColor}
          onClose={() => {
            setColorPicker(null);
            onEmojiPickerClose();
          }}
          position={colorPicker.position}
          snapTo={colorPicker.snapTo}
          translate={translate}
        />
      ) : null}
      <button
        aria-expanded={emojiPickerOpen}
        aria-haspopup="dialog"
        aria-label={translate('toolbar.emoji')}
        className="markdown-toolbar__button"
        disabled={disabled}
        onClick={togglePicker}
        ref={emojiButtonRef}
        type="button"
        {...getTooltipTargetProps(translate('toolbar.emoji'), 'bottom')}
      >
        <MaskedIcon className="markdown-toolbar__icon" icon={emojiIcon} />
      </button>
      {emojiPickerOpen ? (
        <EmojiPicker
          anchorRef={emojiButtonRef}
          onClose={closePicker}
          onPick={insertEmoji}
          onSkinToneChange={updateSkinTone}
          open
          recent={preferences.editor.emojiRecent}
          skinTone={preferences.editor.emojiSkinTone}
          translate={translate}
        />
      ) : null}
    </div>
  );
}
