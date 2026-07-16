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
import { MaskedIcon } from '../components/MaskedIcon';
import type { Translate } from '../pages/page-types';
import { MARKDOWN_ACTIONS, type MarkdownAction } from './markdown-actions';

const ACTION_LABEL_KEYS: Record<MarkdownAction, Parameters<Translate>[0]> = {
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

const ACTION_ICONS: Record<MarkdownAction, string> = {
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
  translate: Translate;
  onAction: (action: MarkdownAction) => void;
}

export function MarkdownToolbar({ onAction, translate }: MarkdownToolbarProps) {
  return (
    <div
      aria-label={translate('toolbar.label')}
      className="markdown-toolbar"
      role="toolbar"
    >
      {MARKDOWN_ACTIONS.map((action) => {
        const label = translate(ACTION_LABEL_KEYS[action]);

        return (
          <button
            className="markdown-toolbar__button"
            key={action}
            onClick={() => onAction(action)}
            title={label}
            type="button"
          >
            <MaskedIcon
              className="markdown-toolbar__icon"
              icon={ACTION_ICONS[action]}
            />
            {label}
          </button>
        );
      })}
    </div>
  );
}
