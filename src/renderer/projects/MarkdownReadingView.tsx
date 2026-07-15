import { useEffect, useRef } from 'react';

import { renderMarkdownInto } from './markdown-render';

export interface MarkdownReadingViewProps {
  ariaLabel: string;
  content: string;
}

export function MarkdownReadingView({
  ariaLabel,
  content,
}: MarkdownReadingViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      renderMarkdownInto(container, content);
    }
  }, [content]);

  return (
    <div
      aria-label={ariaLabel}
      className="markdown-view"
      ref={containerRef}
      role="document"
      tabIndex={0}
    />
  );
}
