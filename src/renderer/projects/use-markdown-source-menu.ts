import { useRef, useState, type RefObject } from 'react';

import {
  APPLICATION_MENU_COMMANDS,
  type FlyoffApi,
} from '../../shared/contracts';
import type { Translate } from '../pages/page-types';
import type { MarkdownAction } from './markdown-actions';
import type { MarkdownDocumentController } from './markdown-document-controller';
import { safeExternalUrl } from './markdown-render';
import {
  SOURCE_FORMAT_ACTION_PREFIX,
  SOURCE_LINE_ACTION_PREFIX,
  SOURCE_MENU_ACTION,
  SOURCE_SPELLING_ACTION_PREFIX,
} from './MarkdownSourceContextMenu';
import { useFlyoffPreferences } from '../preferences';
import {
  applySourceLineAction,
  toggleSourceTask,
  type SourceContextEdit,
  type SourceLineAction,
  type SourceMenuRequest,
} from './source-context-actions';
import { writeSelection, type SourceSelection } from './source-caret';
import { PERSONAL_DICTIONARY_CHANGED_EVENT } from './source-spellcheck';

interface UseMarkdownSourceMenuOptions {
  content: string;
  controller: MarkdownDocumentController;
  editingDisabled: boolean;
  editorRef: RefObject<HTMLDivElement | null>;
  nodeId: string;
  resetKey: string;
  translate: Translate;
  viewId?: string;
  onCommit: (
    edit: SourceContextEdit,
    beforeSelection: SourceSelection,
    inputType: string,
  ) => void;
  onError?: (message: string) => void;
  onFormat: (action: MarkdownAction, selection: SourceSelection) => void;
  onInternalLinkAction?: (
    action:
      | typeof SOURCE_MENU_ACTION.changeAllOccurrences
      | typeof SOURCE_MENU_ACTION.findReferences
      | typeof SOURCE_MENU_ACTION.goToDefinition
      | typeof SOURCE_MENU_ACTION.peekDefinition
      | typeof SOURCE_MENU_ACTION.renameSymbol,
    context: SourceMenuRequest,
  ) => void;
  onSelectionChange: (selection: SourceSelection) => void;
}

export function useMarkdownSourceMenu({
  content,
  controller,
  editingDisabled,
  editorRef,
  nodeId,
  onCommit,
  onError,
  onFormat,
  onInternalLinkAction,
  onSelectionChange,
  resetKey,
  translate,
  viewId = nodeId,
}: UseMarkdownSourceMenuOptions) {
  const { preferences } = useFlyoffPreferences();
  const [openState, setOpenState] = useState<{
    context: SourceMenuRequest;
    key: string;
  }>();
  const context = openState?.key === resetKey ? openState.context : undefined;
  const actionRef = useRef(false);
  const openRequestRef = useRef(0);

  function restoreSelection(selection: SourceSelection): HTMLDivElement | undefined {
    const editor = editorRef.current ?? undefined;
    editor?.focus({ preventScroll: true });
    if (editor) {
      writeSelection(editor, selection);
    }
    return editor;
  }

  function executeNativeEdit(
    command:
      | typeof APPLICATION_MENU_COMMANDS.cut
      | typeof APPLICATION_MENU_COMMANDS.copy
      | typeof APPLICATION_MENU_COMMANDS.paste,
    selection: SourceSelection,
  ): void {
    restoreSelection(selection);
    void window.flyoff.executeMenuCommand(command).catch(() => {
      onError?.(translate('projects.operationFailed'));
    });
  }

  function onAction(action: string): void {
    if (!context || context.content !== content) {
      return;
    }

    actionRef.current = true;

    if (action.startsWith(SOURCE_SPELLING_ACTION_PREFIX)) {
      const index = Number(
        action.slice(SOURCE_SPELLING_ACTION_PREFIX.length),
      );
      const suggestion = context.spelling?.suggestions?.[index];
      if (suggestion && context.spelling && !editingDisabled) {
        const edit = {
          content:
            content.slice(0, context.spelling.start) +
            suggestion +
            content.slice(context.spelling.end),
          selection: {
            direction: 'none' as const,
            start: context.spelling.start + suggestion.length,
            end: context.spelling.start + suggestion.length,
          },
        };
        onCommit(edit, context.selection, 'context:spelling');
      }
      return;
    }

    if (action.startsWith(SOURCE_FORMAT_ACTION_PREFIX)) {
      onFormat(
        action.slice(SOURCE_FORMAT_ACTION_PREFIX.length) as MarkdownAction,
        context.selection,
      );
      return;
    }

    if (action.startsWith(SOURCE_LINE_ACTION_PREFIX)) {
      const lineAction = action.slice(
        SOURCE_LINE_ACTION_PREFIX.length,
      ) as SourceLineAction;
      const edit = applySourceLineAction(
        lineAction,
        content,
        context.selection,
      );
      if (edit) {
        onCommit(edit, context.selection, `context:${lineAction}`);
      }
      return;
    }

    switch (action) {
      case SOURCE_MENU_ACTION.goToDefinition:
      case SOURCE_MENU_ACTION.peekDefinition:
      case SOURCE_MENU_ACTION.findReferences:
      case SOURCE_MENU_ACTION.renameSymbol:
      case SOURCE_MENU_ACTION.changeAllOccurrences:
        if (context.link?.internal) {
          onInternalLinkAction?.(action, context);
        }
        return;
      case SOURCE_MENU_ACTION.undo:
        controller.undo(nodeId, viewId);
        requestAnimationFrame(() => editorRef.current?.focus());
        return;
      case SOURCE_MENU_ACTION.redo:
        controller.redo(nodeId, viewId);
        requestAnimationFrame(() => editorRef.current?.focus());
        return;
      case SOURCE_MENU_ACTION.cut:
        executeNativeEdit(APPLICATION_MENU_COMMANDS.cut, context.selection);
        return;
      case SOURCE_MENU_ACTION.copy:
        executeNativeEdit(APPLICATION_MENU_COMMANDS.copy, context.selection);
        return;
      case SOURCE_MENU_ACTION.paste:
        executeNativeEdit(APPLICATION_MENU_COMMANDS.paste, context.selection);
        return;
      case SOURCE_MENU_ACTION.selectAll: {
        const selection = {
          direction: 'forward' as const,
          start: 0,
          end: content.length,
        };
        restoreSelection(selection);
        onSelectionChange(selection);
        return;
      }
      case SOURCE_MENU_ACTION.toggleTask: {
        if (!context.task || editingDisabled) {
          return;
        }
        const edit = toggleSourceTask(content, context.selection, context.task);
        if (edit) {
          onCommit(edit, context.selection, 'context:toggle-task');
        }
        return;
      }
      case SOURCE_MENU_ACTION.openLink: {
        const url = context.link
          ? safeExternalUrl(context.link.url)
          : null;
        restoreSelection(context.selection);
        if (!url) {
          return;
        }
        void window.flyoff
          .openExternalLink({ url })
          .then((result) => {
            if (!result.ok) {
              onError?.(translate('projects.linkOpenFailed'));
            }
          })
          .catch(() => onError?.(translate('projects.linkOpenFailed')));
        return;
      }
      case SOURCE_MENU_ACTION.copyLink:
        if (!context.link) {
          return;
        }
        restoreSelection({
          direction: 'forward',
          start: context.link.start,
          end: context.link.end,
        });
        void window.flyoff
          .executeMenuCommand(APPLICATION_MENU_COMMANDS.copy)
          .catch(() => onError?.(translate('projects.operationFailed')))
          .finally(() => {
            requestAnimationFrame(() => restoreSelection(context.selection));
          });
        return;
      case SOURCE_MENU_ACTION.addToDictionary:
        if (!context.spelling?.allowPersonalDictionary) {
          return;
        }
        {
          const addWord = (window.flyoff as Partial<FlyoffApi>)
            .addSpellcheckWord;
          if (addWord) {
            void addWord({ word: context.spelling.word })
              .then((added) => {
                if (added) {
                  window.dispatchEvent(
                    new Event(PERSONAL_DICTIONARY_CHANGED_EVENT),
                  );
                }
              })
              .catch(() =>
                onError?.(translate('projects.operationFailed')),
              );
          }
        }
        restoreSelection(context.selection);
        return;
      default:
        restoreSelection(context.selection);
    }
  }

  function onClose(restoreFocus: boolean): void {
    openRequestRef.current += 1;
    const current = context;
    setOpenState(undefined);
    if (current && restoreFocus && !actionRef.current) {
      requestAnimationFrame(() => restoreSelection(current.selection));
    }
    actionRef.current = false;
  }

  async function open(request: SourceMenuRequest): Promise<void> {
    const requestId = openRequestRef.current + 1;
    openRequestRef.current = requestId;
    actionRef.current = false;
    const spelling =
      preferences.spellcheck.enabled && request.spelling
        ? request.spelling
        : undefined;
    const getSuggestions = (window.flyoff as Partial<FlyoffApi>)
      .getSpellcheckSuggestions;
    const checkWords = (window.flyoff as Partial<FlyoffApi>)
      .checkSpellcheckWords;
    const spellingResults: readonly [
      readonly string[],
      readonly string[],
    ] =
      spelling && getSuggestions && checkWords
        ? await Promise.all([
            getSuggestions({ word: spelling.word }),
            checkWords({ words: [spelling.word] }),
          ]).catch(() => [[], []] as const)
        : [[], []];
    const [suggestions, misspelled] = spellingResults;
    if (requestId !== openRequestRef.current) {
      return;
    }
    const isMisspelled =
      spelling !== undefined && misspelled.includes(spelling.word);
    setOpenState({
      context:
        spelling && isMisspelled
          ? {
              ...request,
              spelling: {
                ...spelling,
                suggestions: suggestions.slice(
                  0,
                  preferences.spellcheck.suggestionLimit,
                ),
                allowPersonalDictionary:
                  preferences.spellcheck.allowPersonalDictionary,
              },
            }
          : { ...request, spelling: undefined },
      key: resetKey,
    });
  }

  return { context, onAction, onClose, open };
}
