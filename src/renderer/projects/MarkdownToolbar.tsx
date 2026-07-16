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
            {label}
          </button>
        );
      })}
    </div>
  );
}
