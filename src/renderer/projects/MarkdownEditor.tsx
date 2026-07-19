import {
  useCallback,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import editModeIcon from '../../../public/images/icons/editor/code-block.svg';
import readingModeIcon from '../../../public/images/icons/editor/preview.svg';
import splitModeIcon from '../../../public/images/icons/actions/sidebar-toggle.svg';
import closeToolbarIcon from '../../../public/images/icons/actions/close-toolbar.svg';
import openToolbarIcon from '../../../public/images/icons/actions/open-toolbar.svg';
import type { MarkdownDocument } from '../../shared/contracts';
import { extractInternalLinks } from '../../shared/markdown';
import { MaskedIcon } from '../components/MaskedIcon';
import type { MenuItem } from '../components/menu';
import { getTooltipTargetProps } from '../components/tooltip';
import type { Translate } from '../pages/page-types';
import { useFlyoffPreferences } from '../preferences';
import type { EditorMode } from './editor-mode';
import {
  applyMarkdownAction,
  type MarkdownAction,
} from './markdown-actions';
import { MarkdownReadingView } from './MarkdownReadingView';
import { MarkdownFocusShelf } from './MarkdownFocusShelf';
import { MarkdownSourceContextMenu } from './MarkdownSourceContextMenu';
import { MarkdownToolbar } from './MarkdownToolbar';
import { RichSourceEditor } from './RichSourceEditor';
import {
  readSelection,
  writeSelection,
  type SourceSelection,
} from './source-caret';
import { sourcePositionStatus } from './source-status';
import type { SourceEditTransaction } from './markdown-history';
import type { SourceContextEdit } from './source-context-actions';
import { sourceLineCapabilities } from './source-context-actions';
import { useMarkdownSourceMenu } from './use-markdown-source-menu';
import { useSplitScrollSync } from './use-split-scroll-sync';
import { useMarkdownInternalLinks } from './use-markdown-internal-links';
import type {
  MarkdownLinkNavigation,
  MarkdownLinkRuntime,
} from './project-page-type-registry';
import type {
  MarkdownDocumentController,
  MarkdownBufferSnapshot,
} from './markdown-document-controller';

const MODE_OPTIONS: readonly {
  id: EditorMode;
  labelKey: Parameters<Translate>[0];
  icon: string;
}[] = [
  { id: 'edit', labelKey: 'projects.modeEdit', icon: editModeIcon },
  { id: 'reading', labelKey: 'projects.modeReading', icon: readingModeIcon },
  { id: 'split', labelKey: 'projects.modeSplit', icon: splitModeIcon },
];

export interface MarkdownEditorHandle {
  flush: () => Promise<boolean>;
  isDirty: () => boolean;
  focus: () => void;
}

export interface MarkdownEditorProps {
  controller: MarkdownDocumentController;
  document: MarkdownDocument;
  mode?: EditorMode;
  title?: string;
  translate: Translate;
  autoFocus?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onError?: (message: string) => void;
  onModeChange?: (mode: EditorMode) => void;
  onScrollChange?: (scrollTop: number) => void;
  scrollTop?: number;
  linkRuntime?: MarkdownLinkRuntime;
  navigation?: MarkdownLinkNavigation;
  viewId?: string;
}

function statusLabel(
  snapshot: MarkdownBufferSnapshot,
  translate: Translate,
): string {
  if (snapshot.readOnly) {
    return translate('projects.readOnly');
  }
  switch (snapshot.status) {
    case 'saving':
    case 'loading':
      return translate('projects.saving');
    case 'dirty':
      return translate('projects.unsaved');
    case 'error':
      return translate('projects.saveFailed');
    case 'conflict':
      return translate('projects.conflictTitle');
    case 'saved':
      return translate('projects.saved');
  }
}

export const MarkdownEditor = forwardRef<
  MarkdownEditorHandle,
  MarkdownEditorProps
>(function MarkdownEditor(
  {
    autoFocus = false,
    controller,
    document,
    mode = 'edit',
    onDirtyChange,
    onError,
    onModeChange,
    onScrollChange,
    scrollTop = 0,
    linkRuntime,
    navigation,
    viewId = document.nodeId,
    title,
    translate,
  },
  forwardedRef,
) {
  const { preferences, update: updatePreferences } =
    useFlyoffPreferences();
  const editorPreferences = preferences.editor;
  const toolbarCollapsed = editorPreferences.toolbarCollapsed;
  const [snapshot, setSnapshot] = useState(() =>
    controller.open(document, viewId),
  );
  const [liveSelection, setLiveSelection] = useState(snapshot.selection);
  const editorRef = useRef<HTMLDivElement>(null);
  const readingRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef(snapshot.selection);
  const selectionFrameRef = useRef<number | undefined>(undefined);
  const pendingLiveSelectionRef = useRef(snapshot.selection);
  const nodeId = document.nodeId;
  const publishLiveSelection = useCallback(
    (selection: SourceSelection): void => {
      pendingLiveSelectionRef.current = selection;
      if (selectionFrameRef.current !== undefined) {
        return;
      }
      selectionFrameRef.current = requestAnimationFrame(() => {
        selectionFrameRef.current = undefined;
        setLiveSelection(pendingLiveSelectionRef.current);
      });
    },
    [],
  );
  const handleSourceSelection = useCallback(
    (selection: SourceSelection): void => {
      selectionRef.current = selection;
      publishLiveSelection(selection);
      controller.setEditorSelection(nodeId, selection, viewId);
    },
    [controller, nodeId, publishLiveSelection, viewId],
  );
  const editingDisabled =
    snapshot.readOnly || controller.isMutationLocked(nodeId);
  const internalLinks = useMarkdownInternalLinks({
    content: snapshot.content,
    nodeId,
    onCommit: commitContextEdit,
    onError,
    runtime: linkRuntime,
    translate,
  });
  const splitScroll = useSplitScrollSync({
    content: snapshot.content,
    enabled: editorPreferences.syncSplitScroll,
    mode,
    readingRef,
    sourceRef: editorRef,
  });
  const sourceMenu = useMarkdownSourceMenu({
    content: snapshot.content,
    controller,
    editingDisabled,
    editorRef,
    nodeId,
    onCommit: commitContextEdit,
    onError,
    onFormat: handleMarkdownAction,
    onInternalLinkAction: (action, context) =>
      void internalLinks.execute(action, context),
    onSelectionChange: handleSourceSelection,
    resetKey: `${nodeId}:${mode}`,
    translate,
    viewId,
  });

  useEffect(() => {
    setSnapshot(controller.open(document, viewId));
    return controller.subscribe(nodeId, () => {
      const next = controller.getSnapshot(nodeId, viewId);
      if (next) {
        setSnapshot(next);
      }
    });
  }, [controller, document, nodeId, viewId]);

  useEffect(() => {
    onDirtyChange?.(snapshot.dirty);
  }, [onDirtyChange, snapshot.dirty]);

  useEffect(() => {
    selectionRef.current = snapshot.selection;
    publishLiveSelection(snapshot.selection);
  }, [publishLiveSelection, snapshot.selection]);

  useEffect(
    () => () => {
      if (selectionFrameRef.current !== undefined) {
        cancelAnimationFrame(selectionFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.scrollTop !== scrollTop) {
      editor.scrollTop = scrollTop;
    }
  }, [scrollTop]);

  useEffect(() => {
    if (!navigation || navigation.nodeId !== nodeId) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (mode === 'reading') {
        const heading = [...(readingRef.current?.querySelectorAll<HTMLElement>(
          '[data-markdown-heading-path]',
        ) ?? [])].find((element) => {
          try {
            return (
              JSON.stringify(
                JSON.parse(element.dataset.markdownHeadingPath ?? '[]'),
              ) === JSON.stringify(navigation.headingPath)
            );
          } catch {
            return false;
          }
        });
        if (heading) {
          heading.scrollIntoView({ block: 'start' });
        } else if (readingRef.current) {
          readingRef.current.scrollTop = 0;
        }
        return;
      }

      const editor = editorRef.current;
      if (!editor) {
        return;
      }
      const offset = Math.min(
        snapshot.content.length,
        Math.max(0, navigation.offset ?? 0),
      );
      const nextSelection: SourceSelection = {
        direction: 'none',
        end: offset,
        start: offset,
      };
      writeSelection(editor, nextSelection);
      handleSourceSelection(nextSelection);
      const line =
        snapshot.content.slice(0, offset).split('\n').length;
      editor
        .querySelector<HTMLElement>(`.md-line[data-line="${line}"]`)
        ?.scrollIntoView({ block: 'center' });
      editor.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    mode,
    navigation,
    navigation?.requestId,
    nodeId,
    snapshot.content,
    handleSourceSelection,
  ]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      flush: () => controller.flush(nodeId),
      isDirty: () => controller.isDirty(nodeId),
      focus: () => editorRef.current?.focus(),
    }),
    [controller, nodeId],
  );

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const platform =
      editorRef.current?.ownerDocument.documentElement.dataset.platform;
    const primary = platform === 'darwin' ? event.metaKey : event.ctrlKey;
    const key = event.key.toLocaleLowerCase();

    const internalAction =
      event.key === 'F12'
        ? event.altKey
          ? 'source.internal.peek'
          : event.shiftKey
            ? 'source.internal.find-references'
            : 'source.internal.go-to-definition'
        : event.key === 'F2' && !event.altKey && !event.shiftKey
          ? primary
            ? 'source.internal.change-all'
            : 'source.internal.rename'
          : undefined;
    if (internalAction) {
      const selection = selectionRef.current;
      const occurrence = extractInternalLinks(snapshot.content).find(
        (candidate) =>
          selection.start >= candidate.start &&
          selection.start <= candidate.end,
      );
      if (occurrence) {
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        void internalLinks.execute(internalAction, {
          content: snapshot.content,
          link: {
            end: occurrence.destinationEnd,
            headingPath: occurrence.headingPath,
            internal: true,
            path: occurrence.path,
            start: occurrence.destinationStart,
            syntax: occurrence.syntax,
            url: occurrence.destination,
          },
          lines: sourceLineCapabilities(snapshot.content, selection),
          position: { x: bounds.left + 32, y: bounds.top + 32 },
          selection,
        });
        return;
      }
    }

    if (primary && !event.altKey && key === 'z') {
      event.preventDefault();
      if (editingDisabled) {
        return;
      }
      if (event.shiftKey) {
        controller.redo(nodeId, viewId);
      } else {
        controller.undo(nodeId, viewId);
      }
      return;
    }

    if (
      platform !== 'darwin' &&
      event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      key === 'y'
    ) {
      event.preventDefault();
      if (editingDisabled) {
        return;
      }
      controller.redo(nodeId, viewId);
      return;
    }

    if (
      !event.altKey &&
      (event.ctrlKey || event.metaKey) &&
      key === 's'
    ) {
      event.preventDefault();
      if (!editingDisabled && snapshot.status !== 'conflict') {
        void controller.save(nodeId);
      }
    }
  }

  function commitContextEdit(
    edit: SourceContextEdit,
    beforeSelection: SourceSelection,
    inputType: string,
  ): void {
    if (editingDisabled || edit.content === snapshot.content) {
      return;
    }

    controller.commitEditorTransaction(nodeId, {
      before: { content: snapshot.content, selection: beforeSelection },
      after: edit,
      inputType,
      timestamp: performance.now(),
    }, viewId);
    requestAnimationFrame(() => {
      const editor = editorRef.current;
      editor?.focus();
      if (editor) {
        writeSelection(editor, edit.selection);
      }
    });
  }

  function handleMarkdownAction(
    action: MarkdownAction,
    requestedSelection?: SourceSelection,
  ): void {
    if (editingDisabled) {
      return;
    }
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const currentSelection =
      requestedSelection ??
      (editor.contains(editor.ownerDocument.getSelection()?.anchorNode ?? null)
        ? readSelection(editor)
        : selectionRef.current);
    const edit = applyMarkdownAction(
      action,
      snapshot.content,
      currentSelection.start,
      currentSelection.end,
    );
    commitContextEdit(
      {
        content: edit.value,
        selection: {
          start: edit.selectionStart,
          end: edit.selectionEnd,
          direction:
            edit.selectionStart === edit.selectionEnd ? 'none' : 'forward',
        },
      },
      currentSelection,
      `toolbar:${action}`,
    );
  }

  function handleTransaction(transaction: SourceEditTransaction): void {
    if (editingDisabled) {
      return;
    }
    selectionRef.current = transaction.after.selection;
    publishLiveSelection(transaction.after.selection);
    controller.commitEditorTransaction(nodeId, transaction, viewId);
  }

  const status = statusLabel(snapshot, translate);
  const busy = snapshot.status === 'saving' || snapshot.status === 'loading';
  const position = sourcePositionStatus(snapshot.content, liveSelection);
  const focusLayout = editorPreferences.chromeLayout === 'focus';
  const importantStatus = snapshot.readOnly || snapshot.status !== 'saved';
  const modeMenuItems: readonly MenuItem[] = [
    ...(title
      ? [{ kind: 'label' as const, id: 'note-title', label: title }]
      : []),
    ...(title
      ? [{ kind: 'separator' as const, id: 'note-title-separator' }]
      : []),
    ...MODE_OPTIONS.map((option) => ({
      kind: 'action' as const,
      id: `mode:${option.id}`,
      label: translate(option.labelKey),
      icon: option.icon,
      checked: mode === option.id,
    })),
  ];

  return (
    <main
      aria-label={translate('projects.editorLabel')}
      className="markdown-editor"
      data-content-padding={editorPreferences.contentPadding}
      data-content-width={editorPreferences.contentWidth}
      data-line-numbers={String(editorPreferences.showLineNumbers)}
      data-note-font={editorPreferences.noteFont}
      data-source-style={editorPreferences.sourceStyle}
      data-wrap={String(editorPreferences.wrapLongLines)}
      data-chrome-layout={editorPreferences.chromeLayout}
    >
      {focusLayout ? null : (
        <header className="markdown-editor__header">
          {title ? (
            <h1 {...getTooltipTargetProps(title, 'bottom')}>{title}</h1>
          ) : (
            <span />
          )}
          <div className="markdown-editor__meta">
            <div
              aria-label={translate('projects.editorLabel')}
              className="markdown-editor__modes"
              role="group"
            >
              {MODE_OPTIONS.map((option) => (
                <button
                  aria-pressed={mode === option.id}
                  className="markdown-editor__mode"
                  key={option.id}
                  onClick={() => onModeChange?.(option.id)}
                  type="button"
                >
                  <MaskedIcon
                    className="markdown-editor__mode-icon"
                    icon={option.icon}
                  />
                  {translate(option.labelKey)}
                </button>
              ))}
            </div>
            <span
              aria-live="polite"
              className={`markdown-editor__status markdown-editor__status--${snapshot.status}`}
            >
              {status}
            </span>
          </div>
        </header>
      )}
      {snapshot.status === 'conflict' ? (
        <section
          aria-labelledby="markdown-conflict-title"
          className="markdown-editor__conflict"
        >
          <div>
            <strong id="markdown-conflict-title">
              {translate('projects.conflictTitle')}
            </strong>
            <p>{translate('projects.conflictDescription')}</p>
          </div>
          <div className="markdown-editor__conflict-actions">
            <button
              disabled={busy}
              onClick={() => void controller.reload(nodeId)}
              type="button"
            >
              {translate('projects.reloadFromDisk')}
            </button>
            <button
              className="markdown-editor__overwrite"
              disabled={busy || editingDisabled}
              onClick={() => void controller.overwrite(nodeId)}
              type="button"
            >
              {translate('projects.overwrite')}
            </button>
          </div>
        </section>
      ) : null}
      {!focusLayout &&
      mode !== 'reading' &&
      editorPreferences.showToolbar ? (
        <MarkdownToolbar
          disabled={editingDisabled}
          onAction={handleMarkdownAction}
          translate={translate}
        />
      ) : null}
      {focusLayout &&
      mode !== 'reading' &&
      editorPreferences.showToolbar ? (
        <div
          className="markdown-editor__toolbar-region"
          data-collapsed={toolbarCollapsed || undefined}
        >
          <div className="markdown-editor__toolbar-drawer">
            <MarkdownToolbar
              disabled={editingDisabled}
              onAction={handleMarkdownAction}
              translate={translate}
            />
          </div>
          <button
            aria-label={translate(
              toolbarCollapsed
                ? 'projects.expandToolbar'
                : 'projects.collapseToolbar',
            )}
            className="markdown-editor__toolbar-toggle"
            onClick={() =>
              updatePreferences((current) => ({
                ...current,
                editor: {
                  ...current.editor,
                  toolbarCollapsed: !current.editor.toolbarCollapsed,
                },
              }))
            }
            type="button"
            {...getTooltipTargetProps(
              translate(
                toolbarCollapsed
                  ? 'projects.expandToolbar'
                  : 'projects.collapseToolbar',
              ),
              'bottom',
            )}
          >
            <MaskedIcon
              icon={toolbarCollapsed ? openToolbarIcon : closeToolbarIcon}
            />
          </button>
        </div>
      ) : null}
      <div className={`markdown-editor__body markdown-editor__body--${mode}`}>
        {mode === 'reading' ? null : (
          <RichSourceEditor
            ariaLabel={translate('projects.editorLabel')}
            autoFocus={autoFocus}
            checkCodeBlocks={preferences.spellcheck.checkCodeBlocks}
            editorRef={editorRef}
            nodeId={nodeId}
            viewId={viewId}
            readOnly={editingDisabled}
            onContextMenuRequest={sourceMenu.open}
            onKeyDown={handleKeyDown}
            onRedo={() => controller.redo(nodeId, viewId)}
            onScroll={(scrollPosition) => {
              onScrollChange?.(scrollPosition);
              splitScroll.handleSourceScroll();
            }}
            onSelectionChange={(next) => {
              handleSourceSelection(next);
            }}
            onTransaction={handleTransaction}
            onUndo={() => controller.undo(nodeId, viewId)}
            selection={snapshot.selection}
            spellCheck={preferences.spellcheck.enabled}
            spellcheckScope={preferences.spellcheck.languages.join('\u0000')}
            value={snapshot.content}
          />
        )}
        {mode === 'edit' ? null : (
          <MarkdownReadingView
            ariaLabel={translate('projects.readingView')}
            content={snapshot.content}
            onError={onError}
            onInternalLink={(link, position, action) =>
              void internalLinks.executeRequest(
                action === 'open'
                  ? 'source.internal.go-to-definition'
                  : 'source.internal.peek',
                {
                  ...link,
                  sourceNodeId: nodeId,
                },
                position,
              )
            }
            onScrollIntent={splitScroll.handleReadingIntent}
            translate={translate}
            updatePolicy={mode === 'split' ? 'split' : 'immediate'}
            viewRef={readingRef}
          />
        )}
      </div>
      {!focusLayout &&
      mode !== 'reading' &&
      editorPreferences.showStatusBar ? (
        <footer
          aria-label={translate('projects.editorPosition')}
          className="markdown-editor__position"
        >
          <span>
            {translate('projects.line')} {position.line},{' '}
            {translate('projects.column')} {position.column}
          </span>
          {position.selected > 0 ? (
            <span>
              {position.selected}{' '}
              {translate(
                position.selected === 1
                  ? 'projects.selectedOne'
                  : 'projects.selectedMany',
              )}
            </span>
          ) : null}
        </footer>
      ) : null}
      {focusLayout ? (
        <MarkdownFocusShelf
          menuItems={modeMenuItems}
          mode={mode}
          onModeChange={onModeChange}
          position={position}
          showPosition={editorPreferences.showStatusBar}
          status={
            importantStatus
              ? { label: status, state: snapshot.status }
              : undefined
          }
          translate={translate}
        />
      ) : null}
      {sourceMenu.context ? (
        <MarkdownSourceContextMenu
          canRedo={controller.canRedo(nodeId)}
          canUndo={controller.canUndo(nodeId)}
          context={sourceMenu.context}
          editingDisabled={editingDisabled}
          isMac={
            editorRef.current?.ownerDocument.documentElement.dataset.platform ===
            'darwin'
          }
          onAction={sourceMenu.onAction}
          onClose={sourceMenu.onClose}
          translate={translate}
        />
      ) : null}
      {internalLinks.overlays}
    </main>
  );
});
