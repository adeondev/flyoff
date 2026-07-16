import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { flushSync } from 'react-dom';

import type { MarkdownDocument } from '../../shared/contracts';
import type { Translate } from '../pages/page-types';
import type { EditorMode } from './editor-mode';
import { applyMarkdownAction, type MarkdownAction } from './markdown-actions';
import { MarkdownReadingView } from './MarkdownReadingView';
import { MarkdownToolbar } from './MarkdownToolbar';
import { RichSourceEditor } from './RichSourceEditor';
import { readSelection, writeSelection } from './source-caret';
import { sourcePositionStatus } from './source-status';
import type { SourceEditTransaction } from './markdown-history';
import type {
  MarkdownDocumentController,
  MarkdownBufferSnapshot,
} from './markdown-document-controller';

const MODE_OPTIONS: readonly {
  id: EditorMode;
  labelKey: Parameters<Translate>[0];
}[] = [
  { id: 'edit', labelKey: 'projects.modeEdit' },
  { id: 'reading', labelKey: 'projects.modeReading' },
  { id: 'split', labelKey: 'projects.modeSplit' },
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
}

function statusLabel(
  snapshot: MarkdownBufferSnapshot,
  translate: Translate,
): string {
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
    title,
    translate,
  },
  forwardedRef,
) {
  const [snapshot, setSnapshot] = useState(() => controller.open(document));
  const [liveSelection, setLiveSelection] = useState(snapshot.selection);
  const editorRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef(snapshot.selection);
  const nodeId = document.nodeId;

  useEffect(() => {
    setSnapshot(controller.open(document));
    return controller.subscribe(nodeId, () => {
      const next = controller.getSnapshot(nodeId);
      if (next) {
        setSnapshot(next);
      }
    });
  }, [controller, document, nodeId]);

  useEffect(() => {
    onDirtyChange?.(snapshot.dirty);
  }, [onDirtyChange, snapshot.dirty]);

  useEffect(() => {
    selectionRef.current = snapshot.selection;
    setLiveSelection(snapshot.selection);
  }, [snapshot.selection]);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.scrollTop !== scrollTop) {
      editor.scrollTop = scrollTop;
    }
  }, [scrollTop]);

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

    if (primary && !event.altKey && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) {
        controller.redo(nodeId);
      } else {
        controller.undo(nodeId);
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
      controller.redo(nodeId);
      return;
    }

    if (
      !event.altKey &&
      (event.ctrlKey || event.metaKey) &&
      key === 's'
    ) {
      event.preventDefault();
      if (snapshot.status !== 'conflict') {
        void controller.save(nodeId);
      }
    }
  }

  function handleToolbarAction(action: MarkdownAction): void {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    const currentSelection = editor.contains(
      editor.ownerDocument.getSelection()?.anchorNode ?? null,
    )
      ? readSelection(editor)
      : selectionRef.current;
    const { end, start } = currentSelection;
    const edit = applyMarkdownAction(action, snapshot.content, start, end);
    const nextSelection = {
      start: edit.selectionStart,
      end: edit.selectionEnd,
      direction:
        edit.selectionStart === edit.selectionEnd
          ? ('none' as const)
          : ('forward' as const),
    };
    controller.commitEditorTransaction(nodeId, {
      before: { content: snapshot.content, selection: currentSelection },
      after: { content: edit.value, selection: nextSelection },
      inputType: `toolbar:${action}`,
      timestamp: performance.now(),
    });
    requestAnimationFrame(() => {
      editor.focus();
      writeSelection(editor, nextSelection);
    });
  }

  function handleTransaction(transaction: SourceEditTransaction): void {
    flushSync(() => {
      controller.commitEditorTransaction(nodeId, transaction);
    });
  }

  const status = statusLabel(snapshot, translate);
  const busy = snapshot.status === 'saving' || snapshot.status === 'loading';
  const position = sourcePositionStatus(snapshot.content, liveSelection);

  return (
    <main className="markdown-editor" aria-label={translate('projects.editorLabel')}>
      <header className="markdown-editor__header">
        {title ? <h1>{title}</h1> : <span />}
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
              disabled={busy}
              onClick={() => void controller.overwrite(nodeId)}
              type="button"
            >
              {translate('projects.overwrite')}
            </button>
          </div>
        </section>
      ) : null}
      {mode === 'reading' ? null : (
        <MarkdownToolbar onAction={handleToolbarAction} translate={translate} />
      )}
      <div className={`markdown-editor__body markdown-editor__body--${mode}`}>
        {mode === 'reading' ? null : (
          <RichSourceEditor
            ariaLabel={translate('projects.editorLabel')}
            autoFocus={autoFocus}
            editorRef={editorRef}
            nodeId={nodeId}
            onKeyDown={handleKeyDown}
            onRedo={() => controller.redo(nodeId)}
            onScroll={(scrollPosition) => onScrollChange?.(scrollPosition)}
            onSelectionChange={(next) => {
              selectionRef.current = next;
              setLiveSelection(next);
              controller.setEditorSelection(nodeId, next);
            }}
            onTransaction={handleTransaction}
            onUndo={() => controller.undo(nodeId)}
            selection={liveSelection}
            value={snapshot.content}
          />
        )}
        {mode === 'edit' ? null : (
          <MarkdownReadingView
            ariaLabel={translate('projects.readingView')}
            content={snapshot.content}
            onError={onError}
            translate={translate}
          />
        )}
      </div>
      {mode === 'reading' ? null : (
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
      )}
    </main>
  );
});
