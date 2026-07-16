import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';

import type { Translate } from '../pages/page-types';
import { ExternalLinkPopover } from './ExternalLinkPopover';
import { renderMarkdownInto } from './markdown-render';

export interface MarkdownReadingViewProps {
  ariaLabel: string;
  content: string;
  translate: Translate;
  onError?: (message: string) => void;
}

export function MarkdownReadingView({
  ariaLabel,
  content,
  onError,
  translate,
}: MarkdownReadingViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderedContentRef = useRef(content);
  const [pendingLink, setPendingLink] = useState<{
    anchor: HTMLAnchorElement;
    url: string;
  }>();

  useEffect(() => {
    const container = containerRef.current;
    const contentChanged = renderedContentRef.current !== content;
    if (container) {
      renderMarkdownInto(container, content);
    }
    renderedContentRef.current = content;
    if (contentChanged) {
      const frame = requestAnimationFrame(() => setPendingLink(undefined));
      return () => cancelAnimationFrame(frame);
    }
  }, [content]);

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

  function handleClick(event: MouseEvent<HTMLDivElement>): void {
    if (requestLink(event.target)) {
      event.preventDefault();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (
      (event.key === 'Enter' || event.key === ' ') &&
      requestLink(event.target)
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
