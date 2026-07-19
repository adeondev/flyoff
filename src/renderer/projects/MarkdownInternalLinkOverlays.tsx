import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { createPortal } from 'react-dom';

import type {
  ProjectBacklinksOutcome,
  ProjectInternalLinkTarget,
  ProjectLinkTarget,
} from '../../shared/contracts';
import { Dialog } from '../components/dialog';
import type { Translate } from '../pages/page-types';
import { renderMarkdownInto } from './markdown-render';

export interface InternalLinkPreviewState {
  content?: string;
  error?: string;
  loading: boolean;
  locked: boolean;
  position: { x: number; y: number };
  target: ProjectInternalLinkTarget;
}

export interface InternalLinkReferencesState {
  loading: boolean;
  outcome?: ProjectBacklinksOutcome;
  target: ProjectInternalLinkTarget;
}

export interface InternalLinkChooserState {
  candidates: readonly ProjectLinkTarget[];
}

export interface InternalLinkRenameState {
  busy: boolean;
  error?: string;
  name: string;
  target: ProjectInternalLinkTarget;
}

export interface InternalLinkReplaceState {
  busy: boolean;
  count: number;
  currentTarget: ProjectInternalLinkTarget;
  error?: string;
  query: string;
  targets: readonly ProjectLinkTarget[];
}

interface MarkdownInternalLinkOverlaysProps {
  chooser?: InternalLinkChooserState;
  preview?: InternalLinkPreviewState;
  references?: InternalLinkReferencesState;
  rename?: InternalLinkRenameState;
  replace?: InternalLinkReplaceState;
  translate: Translate;
  onChooseCandidate: (target: ProjectLinkTarget) => void;
  onCloseChooser: () => void;
  onClosePreview: () => void;
  onCloseReferences: () => void;
  onCloseRename: () => void;
  onCloseReplace: () => void;
  onOpenPreview: () => void;
  onOpenReference: (
    target: ProjectLinkTarget,
    offset: number,
  ) => void;
  onRenameNameChange: (name: string) => void;
  onRenameSubmit: () => void;
  onReplaceQueryChange: (query: string) => void;
  onReplaceTarget: (target: ProjectLinkTarget) => void;
}

function PreviewContent({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) {
      renderMarkdownInto(ref.current, content);
    }
  }, [content]);
  return <div className="internal-link-preview__content markdown-view" ref={ref} />;
}

function InternalLinkPreview({
  preview,
  translate,
  onClose,
  onOpen,
}: {
  preview: InternalLinkPreviewState;
  translate: Translate;
  onClose: () => void;
  onOpen: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({
    left: 8,
    top: 8,
    visibility: 'hidden',
  });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const bounds = element.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, preview.position.x),
      Math.max(8, window.innerWidth - bounds.width - 8),
    );
    const preferredTop = preview.position.y + 6;
    const top =
      preferredTop + bounds.height <= window.innerHeight - 8
        ? preferredTop
        : Math.max(8, preview.position.y - bounds.height - 6);
    setStyle({ left, top, visibility: 'visible' });
  }, [preview.position.x, preview.position.y]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    const handlePointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [onClose]);

  return createPortal(
    <section
      aria-busy={preview.loading}
      aria-label={translate('projects.linkPreview')}
      className="internal-link-preview"
      ref={ref}
      role="dialog"
      style={style}
    >
      <header>
        <strong>{preview.target.name}</strong>
        <span>/{preview.target.path}</span>
      </header>
      <div className="internal-link-preview__body">
        {preview.locked ? (
          <p>{translate('projects.previewLocked')}</p>
        ) : preview.error ? (
          <p role="alert">{preview.error}</p>
        ) : preview.content !== undefined ? (
          <PreviewContent content={preview.content} />
        ) : null}
      </div>
      <footer>
        <button onClick={onClose} type="button">
          {translate('windowControls.close')}
        </button>
        <button onClick={onOpen} type="button">
          {translate('projects.openLink')}
        </button>
      </footer>
    </section>,
    document.body,
  );
}

export function MarkdownInternalLinkOverlays({
  chooser,
  onChooseCandidate,
  onCloseChooser,
  onClosePreview,
  onCloseReferences,
  onCloseRename,
  onCloseReplace,
  onOpenPreview,
  onOpenReference,
  onRenameNameChange,
  onRenameSubmit,
  onReplaceQueryChange,
  onReplaceTarget,
  preview,
  references,
  rename,
  replace,
  translate,
}: MarkdownInternalLinkOverlaysProps) {
  const filteredTargets = replace
    ? replace.targets.filter((target) => {
        const query = replace.query.trim().toLocaleLowerCase();
        return (
          !query ||
          target.name.toLocaleLowerCase().includes(query) ||
          target.path.toLocaleLowerCase().includes(query)
        );
      })
    : [];

  return (
    <>
      {preview ? (
        <InternalLinkPreview
          onClose={onClosePreview}
          onOpen={onOpenPreview}
          preview={preview}
          translate={translate}
        />
      ) : null}
      {chooser ? (
        <Dialog
          closeLabel={translate('windowControls.close')}
          onCancel={onCloseChooser}
          title={translate('projects.chooseLinkTarget')}
        >
          <div className="internal-link-target-list">
            {chooser.candidates.map((target) => (
              <button
                key={target.nodeId}
                onClick={() => onChooseCandidate(target)}
                type="button"
              >
                <strong>{target.name}</strong>
                <span>/{target.path}</span>
              </button>
            ))}
          </div>
        </Dialog>
      ) : null}
      {references ? (
        <Dialog
          busy={references.loading}
          closeLabel={translate('windowControls.close')}
          onCancel={onCloseReferences}
          size="wide"
          title={`${translate('projects.backlinksTitle')}: ${references.target.name}`}
        >
          <div className="project-reference-results">
            {references.outcome?.references.length === 0 ? (
              <p>{translate('projects.noBacklinks')}</p>
            ) : null}
            {references.outcome?.references.map((reference) => (
              <button
                key={`${reference.sourceNodeId}:${reference.start}`}
                onClick={() =>
                  onOpenReference(
                    {
                      name: reference.sourceName,
                      nodeId: reference.sourceNodeId,
                      path: reference.sourcePath,
                    },
                    reference.start,
                  )
                }
                type="button"
              >
                <span>
                  /{reference.sourcePath}:{reference.line}:{reference.column}
                </span>
                <strong>{reference.excerpt}</strong>
              </button>
            ))}
            {(references.outcome?.skippedLockedNodeIds.length ?? 0) > 0 ? (
              <p className="project-reference-results__notice">
                {translate('projects.backlinksLockedNotice')}
              </p>
            ) : null}
          </div>
        </Dialog>
      ) : null}
      {rename ? (
        <Dialog
          busy={rename.busy}
          closeLabel={translate('windowControls.close')}
          footerEnd={
            <>
              <button
                disabled={rename.busy}
                onClick={onCloseRename}
                type="button"
              >
                {translate('projects.cancel')}
              </button>
              <button
                className="flyoff-dialog__button--primary"
                disabled={rename.busy || !rename.name.trim()}
                form="internal-link-rename-form"
                type="submit"
              >
                {translate('projects.rename')}
              </button>
            </>
          }
          onCancel={onCloseRename}
          title={translate('projects.renameLinkedNote')}
        >
          <form
            id="internal-link-rename-form"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              onRenameSubmit();
            }}
          >
            <label className="flyoff-dialog__field">
              <span>{translate('projects.name')}</span>
              <input
                data-dialog-initial-focus
                disabled={rename.busy}
                maxLength={100}
                onChange={(event) => onRenameNameChange(event.target.value)}
                value={rename.name}
              />
            </label>
            {rename.error ? <p role="alert">{rename.error}</p> : null}
          </form>
        </Dialog>
      ) : null}
      {replace ? (
        <Dialog
          busy={replace.busy}
          closeLabel={translate('windowControls.close')}
          description={`${replace.count} ${translate('projects.occurrencesFound')}`}
          onCancel={onCloseReplace}
          title={translate('projects.replaceLinkOccurrences')}
        >
          <div className="internal-link-target-picker">
            <label className="flyoff-dialog__field">
              <span>{translate('projects.searchNotes')}</span>
              <input
                data-dialog-initial-focus
                onChange={(event) =>
                  onReplaceQueryChange(event.target.value)
                }
                type="search"
                value={replace.query}
              />
            </label>
            <div className="internal-link-target-list">
              {filteredTargets
                .filter(
                  (target) =>
                    target.nodeId !== replace.currentTarget.nodeId,
                )
                .map((target) => (
                  <button
                    disabled={replace.busy}
                    key={target.nodeId}
                    onClick={() => onReplaceTarget(target)}
                    type="button"
                  >
                    <strong>{target.name}</strong>
                    <span>/{target.path}</span>
                  </button>
                ))}
            </div>
            {replace.error ? <p role="alert">{replace.error}</p> : null}
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
