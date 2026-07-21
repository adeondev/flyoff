import { ContextMenu, type MenuItem } from '../components/menu';
import type { Translate } from '../pages/page-types';
import { MARKDOWN_ACTIONS } from './markdown-actions';
import { safeExternalUrl } from './markdown-render';
import {
  MARKDOWN_ACTION_ICONS,
  MARKDOWN_ACTION_LABEL_KEYS,
} from './MarkdownToolbar';
import type { SourceMenuRequest } from './source-context-actions';

export const SOURCE_MENU_ACTION = {
  undo: 'source.undo',
  redo: 'source.redo',
  cut: 'source.cut',
  copy: 'source.copy',
  paste: 'source.paste',
  selectAll: 'source.select-all',
  copyLink: 'source.copy-link',
  openLink: 'source.open-link',
  toggleTask: 'source.toggle-task',
  goToDefinition: 'source.internal.go-to-definition',
  peekDefinition: 'source.internal.peek',
  findReferences: 'source.internal.find-references',
  renameSymbol: 'source.internal.rename',
  changeAllOccurrences: 'source.internal.change-all',
  addToDictionary: 'source.spelling.add-to-dictionary',
} as const;

export const SOURCE_FORMAT_ACTION_PREFIX = 'source.format.';
export const SOURCE_LINE_ACTION_PREFIX = 'source.line.';
export const SOURCE_SPELLING_ACTION_PREFIX = 'source.spelling.replace.';

interface MarkdownSourceContextMenuProps {
  canRedo: boolean;
  canUndo: boolean;
  context: SourceMenuRequest;
  editingDisabled: boolean;
  isMac: boolean;
  translate: Translate;
  onAction: (action: string) => void;
  onClose: (restoreFocus: boolean) => void;
}

function shortcut(
  key: string,
  shift: boolean,
  isMac: boolean,
): Pick<Extract<MenuItem, { kind: 'action' }>, 'keyShortcut' | 'shortcut'> {
  return isMac
    ? {
        keyShortcut: `Meta+${shift ? 'Shift+' : ''}${key}`,
        shortcut: `${shift ? '⇧' : ''}⌘${key}`,
      }
    : {
        keyShortcut: `Control+${shift ? 'Shift+' : ''}${key}`,
        shortcut: `Ctrl+${shift ? 'Shift+' : ''}${key}`,
      };
}

function menuItems(
  context: SourceMenuRequest,
  translate: Translate,
  editingDisabled: boolean,
  canUndo: boolean,
  canRedo: boolean,
  isMac: boolean,
): readonly MenuItem[] {
  const hasSelection = context.selection.start !== context.selection.end;
  const items: MenuItem[] = [];
  if (context.spelling?.suggestions?.length) {
    items.push(
      ...context.spelling.suggestions.map((suggestion, index) => ({
        id: `${SOURCE_SPELLING_ACTION_PREFIX}${index}`,
        kind: 'action' as const,
        label: suggestion,
        disabled: editingDisabled,
      })),
    );
    if (context.spelling.allowPersonalDictionary) {
      items.push({
        id: SOURCE_MENU_ACTION.addToDictionary,
        kind: 'action',
        label: translate('projects.addToDictionary'),
      });
    }
    items.push({ id: 'source.spelling-separator', kind: 'separator' });
  }
  items.push(
    {
      id: SOURCE_MENU_ACTION.undo,
      kind: 'action',
      label: translate('menu.undo'),
      ...shortcut('Z', false, isMac),
      disabled: !canUndo,
    },
    {
      id: SOURCE_MENU_ACTION.redo,
      kind: 'action',
      label: translate('menu.redo'),
      ...shortcut('Z', true, isMac),
      disabled: !canRedo,
    },
    { id: 'source.edit-separator', kind: 'separator' },
    {
      id: SOURCE_MENU_ACTION.cut,
      kind: 'action',
      label: translate('menu.cut'),
      ...shortcut('X', false, isMac),
      disabled: editingDisabled || !hasSelection,
    },
    {
      id: SOURCE_MENU_ACTION.copy,
      kind: 'action',
      label: translate('menu.copy'),
      ...shortcut('C', false, isMac),
      disabled: !hasSelection,
    },
    {
      id: SOURCE_MENU_ACTION.paste,
      kind: 'action',
      label: translate('menu.paste'),
      ...shortcut('V', false, isMac),
      disabled: editingDisabled,
    },
    {
      id: SOURCE_MENU_ACTION.selectAll,
      kind: 'action',
      label: translate('menu.selectAll'),
      ...shortcut('A', false, isMac),
      disabled: context.content.length === 0,
    },
    { id: 'source.tools-separator', kind: 'separator' },
    {
      id: 'source.format',
      kind: 'submenu',
      label: translate('projects.format'),
      icon: MARKDOWN_ACTION_ICONS.bold,
      disabled: editingDisabled,
      children: MARKDOWN_ACTIONS.map((action) => ({
        id: `${SOURCE_FORMAT_ACTION_PREFIX}${action}`,
        kind: 'action' as const,
        label: translate(MARKDOWN_ACTION_LABEL_KEYS[action]),
        icon: MARKDOWN_ACTION_ICONS[action],
      })),
    },
    {
      id: 'source.line',
      kind: 'submenu',
      label: translate('projects.lineActions'),
      disabled: editingDisabled,
      children: [
        {
          id: `${SOURCE_LINE_ACTION_PREFIX}duplicate`,
          kind: 'action',
          label: translate('projects.duplicateLine'),
        },
        {
          id: `${SOURCE_LINE_ACTION_PREFIX}delete`,
          kind: 'action',
          label: translate('projects.deleteLine'),
          disabled: !context.lines.canDelete,
        },
        { id: 'source.line-separator', kind: 'separator' },
        {
          id: `${SOURCE_LINE_ACTION_PREFIX}move-up`,
          kind: 'action',
          label: translate('projects.moveLineUp'),
          disabled: !context.lines.canMoveUp,
        },
        {
          id: `${SOURCE_LINE_ACTION_PREFIX}move-down`,
          kind: 'action',
          label: translate('projects.moveLineDown'),
          disabled: !context.lines.canMoveDown,
        },
      ],
    },
  );

  if (context.task) {
    items.push(
      { id: 'source.task-separator', kind: 'separator' },
      {
        id: SOURCE_MENU_ACTION.toggleTask,
        kind: 'action',
        label: translate(
          context.task.checked ? 'projects.unmarkTask' : 'projects.markTask',
        ),
        checked: context.task.checked,
        disabled: editingDisabled,
      },
    );
  }

  if (context.link) {
    items.push({ id: 'source.link-separator', kind: 'separator' });
    if (context.link.internal) {
      items.push(
        {
          id: SOURCE_MENU_ACTION.goToDefinition,
          kind: 'action',
          label: translate('projects.goToDefinition'),
          keyShortcut: 'F12',
          shortcut: 'F12',
        },
        {
          id: SOURCE_MENU_ACTION.peekDefinition,
          kind: 'action',
          label: translate('projects.peekDefinition'),
          keyShortcut: 'Alt+F12',
          shortcut: 'Alt+F12',
        },
        {
          id: SOURCE_MENU_ACTION.findReferences,
          kind: 'action',
          label: translate('projects.findReferences'),
          keyShortcut: 'Shift+F12',
          shortcut: 'Shift+F12',
        },
        { id: 'source.internal-edit-separator', kind: 'separator' },
        {
          id: SOURCE_MENU_ACTION.renameSymbol,
          kind: 'action',
          label: translate('projects.renameSymbol'),
          keyShortcut: 'F2',
          shortcut: 'F2',
        },
        {
          id: SOURCE_MENU_ACTION.changeAllOccurrences,
          kind: 'action',
          label: translate('projects.changeAllOccurrences'),
          keyShortcut: `${isMac ? 'Meta' : 'Control'}+F2`,
          shortcut: `${isMac ? '⌘' : 'Ctrl+'}F2`,
          disabled: editingDisabled,
        },
      );
    }
    if (safeExternalUrl(context.link.url)) {
      items.push({
        id: SOURCE_MENU_ACTION.openLink,
        kind: 'action',
        label: translate('projects.openLinkContext'),
      });
    }
    items.push({
      id: SOURCE_MENU_ACTION.copyLink,
      kind: 'action',
      label: translate('projects.copyLink'),
    });
  }

  return items;
}

export function MarkdownSourceContextMenu({
  canRedo,
  canUndo,
  context,
  editingDisabled,
  isMac,
  onAction,
  onClose,
  translate,
}: MarkdownSourceContextMenuProps) {
  return (
    <ContextMenu
      ariaLabel={translate('projects.editorContextMenu')}
      items={menuItems(
        context,
        translate,
        editingDisabled,
        canUndo,
        canRedo,
        isMac,
      )}
      onAction={onAction}
      onClose={onClose}
      x={context.position.x}
      y={context.position.y}
    />
  );
}
