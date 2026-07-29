import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react';

import type { ProjectInternalLinkSyntax } from '../../shared/contracts';
import type { Translate } from '../pages/page-types';
import { ExternalLinkPopover } from './ExternalLinkPopover';
import {
  isLargeMarkdownDocument,
  SPLIT_PREVIEW_IDLE_MS,
  SPLIT_PREVIEW_MAX_LAG_MS,
  VIRTUAL_SPLIT_PREVIEW_IDLE_MS,
} from './editor-performance';
import { shouldVirtualizeSource } from './source-viewport';
import {
  renderMarkdownInto,
  renderMarkdownIntoCooperatively,
} from './markdown-render';
import {
  MEDIA_LIBRARY_CHANGED_EVENT,
  removedMediaAssetIds,
} from './media-transfer';

export type MarkdownReadingUpdatePolicy = 'immediate' | 'split';

function cancelScheduledRender(
  frameRef: RefObject<number | undefined>,
  idleTimerRef: RefObject<number | undefined>,
  maxTimerRef: RefObject<number | undefined>,
): void {
  if (frameRef.current !== undefined) {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = undefined;
  }
  if (idleTimerRef.current !== undefined) {
    window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = undefined;
  }
  if (maxTimerRef.current !== undefined) {
    window.clearTimeout(maxTimerRef.current);
    maxTimerRef.current = undefined;
  }
}

export interface MarkdownReadingViewProps {
  ariaLabel: string;
  content: string;
  projectId?: string;
  translate: Translate;
  updatePolicy?: MarkdownReadingUpdatePolicy;
  onError?: (message: string) => void;
  onScrollIntent?: () => void;
  onInternalLink?: (
    link: {
      headingPath: readonly string[];
      path: string;
      syntax: ProjectInternalLinkSyntax;
    },
    position: { x: number; y: number },
    action: 'open' | 'peek',
  ) => void;
  viewRef?: RefObject<HTMLDivElement | null>;
}

export function MarkdownReadingView({
  ariaLabel,
  content,
  onError,
  onInternalLink,
  onScrollIntent,
  projectId,
  translate,
  updatePolicy = 'immediate',
  viewRef,
}: MarkdownReadingViewProps) {
  const fallbackRef = useRef<HTMLDivElement>(null);
  const containerRef = viewRef ?? fallbackRef;
  const renderedContentRef = useRef<string | undefined>(undefined);
  const renderedProjectIdRef = useRef<string | undefined>(undefined);
  const latestContentRef = useRef(content);
  const latestProjectIdRef = useRef(projectId);
  const frameRef = useRef<number | undefined>(undefined);
  const idleTimerRef = useRef<number | undefined>(undefined);
  const maxTimerRef = useRef<number | undefined>(undefined);
  const renderGenerationRef = useRef(0);
  const [pendingLink, setPendingLink] = useState<{
    anchor: HTMLAnchorElement;
    url: string;
  }>();

  useEffect(() => {
    latestContentRef.current = content;
    latestProjectIdRef.current = projectId;
    renderGenerationRef.current += 1;
    const scheduledContainer = containerRef.current;
    const virtualScale = shouldVirtualizeSource(content);
    if (
      scheduledContainer &&
      (updatePolicy === 'split' || virtualScale) &&
      (renderedContentRef.current !== content ||
        renderedProjectIdRef.current !== projectId)
    ) {
      scheduledContainer.setAttribute('aria-busy', 'true');
    }

    const renderLatest = (): void => {
      cancelScheduledRender(frameRef, idleTimerRef, maxTimerRef);
      const container = containerRef.current;
      const latest = latestContentRef.current;
      const latestProjectId = latestProjectIdRef.current;
      const generation = renderGenerationRef.current;
      if (!container) {
        return;
      }
      if (
        renderedContentRef.current === latest &&
        renderedProjectIdRef.current === latestProjectId
      ) {
        container.removeAttribute('aria-busy');
        return;
      }
      if (shouldVirtualizeSource(latest)) {
        void renderMarkdownIntoCooperatively(container, latest, {
          cancelled: () => renderGenerationRef.current !== generation,
          projectId: latestProjectId,
        }).then((rendered) => {
          if (!rendered || renderGenerationRef.current !== generation) {
            return;
          }
          renderedContentRef.current = latest;
          renderedProjectIdRef.current = latestProjectId;
          container.removeAttribute('aria-busy');
          setPendingLink(undefined);
        });
        return;
      }
      renderMarkdownInto(container, latest, {
        projectId: latestProjectId,
      });
      container.removeAttribute('aria-busy');
      renderedContentRef.current = latest;
      renderedProjectIdRef.current = latestProjectId;
      setPendingLink(undefined);
    };

    if (
      renderedContentRef.current === undefined ||
      updatePolicy === 'immediate'
    ) {
      renderLatest();
      return;
    }

    if (!isLargeMarkdownDocument(content)) {
      if (frameRef.current === undefined) {
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = undefined;
          renderLatest();
        });
      }
      return;
    }

    if (idleTimerRef.current !== undefined) {
      window.clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = window.setTimeout(
      renderLatest,
      virtualScale ? VIRTUAL_SPLIT_PREVIEW_IDLE_MS : SPLIT_PREVIEW_IDLE_MS,
    );
    if (virtualScale) {
      return;
    }
    if (maxTimerRef.current === undefined) {
      maxTimerRef.current = window.setTimeout(
        renderLatest,
        SPLIT_PREVIEW_MAX_LAG_MS,
      );
    }
  }, [containerRef, content, projectId, updatePolicy]);

  useEffect(
    () => () => {
      renderGenerationRef.current += 1;
      cancelScheduledRender(frameRef, idleTimerRef, maxTimerRef);
    },
    [],
  );

  useEffect(() => {
    const mediaChanged = (event: Event): void => {
      const removed = removedMediaAssetIds(event);
      const container = containerRef.current;
      if (!container || removed.size === 0) {
        return;
      }
      for (const figure of container.querySelectorAll<HTMLElement>(
        '.markdown-image, .markdown-media',
      )) {
        const assetId =
          figure.dataset.imageAssetId ?? figure.dataset.mediaNodeId ?? '';
        if (!removed.has(assetId)) {
          continue;
        }
        figure.classList.add(
          figure.classList.contains('markdown-image')
            ? 'markdown-image--missing'
            : 'markdown-media--missing',
        );
        figure
          .querySelector<HTMLImageElement | HTMLMediaElement>(
            '.markdown-image__content, .markdown-media__content',
          )
          ?.removeAttribute('src');
      }
    };
    window.addEventListener(MEDIA_LIBRARY_CHANGED_EVENT, mediaChanged);
    return () =>
      window.removeEventListener(MEDIA_LIBRARY_CHANGED_EVENT, mediaChanged);
  }, [containerRef]);

  const closeLink = useCallback(() => setPendingLink(undefined), []);

  function requestLink(target: EventTarget | null): boolean {
    const anchor =
      target instanceof Element
        ? target.closest<HTMLAnchorElement>('a[data-markdown-external-url]')
        : null;
    if (!anchor || !containerRef.current?.contains(anchor)) {
      return false;
    }
    setPendingLink({
      anchor,
      url: anchor.dataset.markdownExternalUrl!,
    });
    return true;
  }

  function requestInternalLink(
    target: EventTarget | null,
    action: 'open' | 'peek',
  ): boolean {
    const anchor =
      target instanceof Element
        ? target.closest<HTMLAnchorElement>('a[data-markdown-internal-path]')
        : null;
    if (!anchor || !containerRef.current?.contains(anchor)) {
      return false;
    }
    let headingPath: readonly string[] = [];
    try {
      const parsed = JSON.parse(
        anchor.dataset.markdownInternalHeadings ?? '[]',
      );
      if (
        Array.isArray(parsed) &&
        parsed.every((part) => typeof part === 'string')
      ) {
        headingPath = parsed;
      }
    } catch {
      return false;
    }
    const syntax =
      anchor.dataset.markdownInternalSyntax === 'wikilink'
        ? 'wikilink'
        : 'markdown';
    const bounds = anchor.getBoundingClientRect();
    onInternalLink?.(
      {
        headingPath,
        path: anchor.dataset.markdownInternalPath ?? '',
        syntax,
      },
      { x: bounds.left, y: bounds.bottom },
      action,
    );
    return true;
  }

  function handleClick(event: MouseEvent<HTMLDivElement>): void {
    if (
      requestInternalLink(event.target, 'open') ||
      requestLink(event.target)
    ) {
      event.preventDefault();
    }
  }

  function handlePointerOver(event: PointerEvent<HTMLDivElement>): void {
    if (
      (event.ctrlKey || event.metaKey) &&
      requestInternalLink(event.target, 'peek')
    ) {
      event.preventDefault();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (
      [
        'ArrowDown',
        'ArrowUp',
        'End',
        'Home',
        'PageDown',
        'PageUp',
        ' ',
      ].includes(event.key)
    ) {
      onScrollIntent?.();
    }
    if (
      (event.key === 'Enter' || event.key === ' ') &&
      (requestInternalLink(event.target, 'open') || requestLink(event.target))
    ) {
      event.preventDefault();
    }
  }

  return (
    <>
      <div
        aria-label={ariaLabel}
        className="markdown-view"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onPointerDown={onScrollIntent}
        onPointerOver={handlePointerOver}
        onWheel={onScrollIntent}
        ref={containerRef}
        role="document"
        tabIndex={0}
      />
      {pendingLink ? (
        <ExternalLinkPopover
          anchor={pendingLink.anchor}
          onClose={closeLink}
          onOpen={async () => {
            try {
              const result = await window.flyoff.openExternalLink({
                url: pendingLink.url,
              });
              if (!result.ok) {
                onError?.(translate('projects.linkOpenFailed'));
              }
            } catch {
              onError?.(translate('projects.linkOpenFailed'));
            }
          }}
          translate={translate}
          url={pendingLink.url}
        />
      ) : null}
    </>
  );
}
