import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import type { MarkdownDocument } from '../../shared/contracts';
import type { Translate } from '../pages/page-types';
import { MarkdownReadingView } from './MarkdownReadingView';
import { SourceEditor } from './SourceEditor';
import type {
  MarkdownDocumentController,
  MarkdownBufferSnapshot,
} from './markdown-document-controller';

type EditorMode = 'edit' | 'reading' | 'split';

const EDITOR_MODES: readonly {
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
  title?: string;
  translate: Translate;
  autoFocus?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
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
    onDirtyChange,
    onScrollChange,
    scrollTop = 0,
    title,
    translate,
  },
  forwardedRef,
) {
  const [snapshot, setSnapshot] = useState(() => controller.open(document));
  const [mode, setMode] = useState<EditorMode>('edit');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
    const textarea = textareaRef.current;
    if (textarea && textarea.scrollTop !== scrollTop) {
      textarea.scrollTop = scrollTop;
    }
  }, [scrollTop]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      flush: () => controller.flush(nodeId),
      isDirty: () => controller.isDirty(nodeId),
      focus: () => textareaRef.current?.focus(),
    }),
    [controller, nodeId],
  );

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (
      !event.altKey &&
      (event.ctrlKey || event.metaKey) &&
      event.key.toLocaleLowerCase() === 's'
    ) {
      event.preventDefault();
      if (snapshot.status !== 'conflict') {
        void controller.save(nodeId);
      }
    }
  }

  const status = statusLabel(snapshot, translate);
  const busy = snapshot.status === 'saving' || snapshot.status === 'loading';

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
            {EDITOR_MODES.map((option) => (
              <button
                aria-pressed={mode === option.id}
                className="markdown-editor__mode"
                key={option.id}
                onClick={() => setMode(option.id)}
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
      {snapshot.status === 'error' ? (
        <p className="markdown-editor__error" role="alert">
          {translate('projects.saveFailed')}
        </p>
      ) : null}
      <div className={`markdown-editor__body markdown-editor__body--${mode}`}>
        {mode === 'reading' ? null : (
          <SourceEditor
            ariaLabel={translate('projects.editorLabel')}
            autoFocus={autoFocus}
            onChange={(next) => controller.update(nodeId, next)}
            onKeyDown={handleKeyDown}
            onScroll={(scrollPosition) => onScrollChange?.(scrollPosition)}
            textareaRef={textareaRef}
            value={snapshot.content}
          />
        )}
        {mode === 'edit' ? null : (
          <MarkdownReadingView
            ariaLabel={translate('projects.readingView')}
            content={snapshot.content}
          />
        )}
      </div>
    </main>
  );
});
