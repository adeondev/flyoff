import {
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';

import { renderMarkdownInto } from '../projects/markdown-render';
import { nextGraphemeBoundary } from '../projects/source-grapheme';

interface TwineMarkdownProps {
  cacheKey?: string;
  className?: string;
  onFirstVisibleGrapheme?: () => void;
  source: string;
  streaming?: boolean;
}

interface TypewriterCacheEntry {
  active: boolean;
  visibleSource: string;
}

const DEFAULT_GRAPHEMES_PER_SECOND = 60;
const MIN_GRAPHEMES_PER_SECOND = 4;
const MAX_GRAPHEMES_PER_SECOND = 600;
const TARGET_BUFFER_SECONDS = 0.14;
const CATCH_UP_SECONDS = 0.35;
const MAX_GRAPHEMES_PER_FRAME = 32;
const typewriterCache = new Map<string, TypewriterCacheEntry>();

function graphemeCount(value: string): number {
  let count = 0;
  let offset = 0;
  while (offset < value.length) {
    offset = nextGraphemeBoundary(value, offset);
    count += 1;
  }
  return count;
}

function advanceGraphemes(
  value: string,
  offset: number,
  count: number,
): number {
  let next = offset;
  for (let index = 0; index < count && next < value.length; index += 1) {
    next = nextGraphemeBoundary(value, next);
  }
  return next;
}

function externalUrlFromTarget(target: EventTarget | null): string | undefined {
  return target instanceof Element
    ? target.closest<HTMLElement>('[data-markdown-external-url]')?.dataset
        .markdownExternalUrl
    : undefined;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function TwineMarkdown({
  cacheKey,
  className,
  onFirstVisibleGrapheme,
  source,
  streaming = false,
}: TwineMarkdownProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldTypewrite = streaming && !prefersReducedMotion();
  const cached = cacheKey ? typewriterCache.get(cacheKey) : undefined;
  const cachedSource =
    cached && source.startsWith(cached.visibleSource)
      ? cached.visibleSource
      : undefined;
  const displaySourceRef = useRef(
    cachedSource ?? (shouldTypewrite ? '' : source),
  );
  const targetSourceRef = useRef(source);
  const streamingRef = useRef(streaming);
  const frameRef = useRef<number | undefined>(undefined);
  const typewritingRef = useRef(shouldTypewrite || Boolean(cached?.active));
  const arrivalRateRef = useRef(DEFAULT_GRAPHEMES_PER_SECOND);
  const lastArrivalAtRef = useRef(-1);
  const lastFrameAtRef = useRef<number | undefined>(undefined);
  const revealBudgetRef = useRef(0);
  const firstVisibleReportedRef = useRef(false);
  const onFirstVisibleGraphemeRef = useRef(onFirstVisibleGrapheme);

  useLayoutEffect(() => {
    onFirstVisibleGraphemeRef.current = onFirstVisibleGrapheme;
  }, [onFirstVisibleGrapheme]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const previousTarget = targetSourceRef.current;
    const reportFirstVisibleGrapheme = (visibleSource: string): void => {
      if (visibleSource && !firstVisibleReportedRef.current) {
        firstVisibleReportedRef.current = true;
        onFirstVisibleGraphemeRef.current?.();
      }
    };
    targetSourceRef.current = source;
    streamingRef.current = streaming;
    if (lastArrivalAtRef.current < 0) {
      lastArrivalAtRef.current = performance.now();
    }
    if (displaySourceRef.current && !container.hasChildNodes()) {
      renderMarkdownInto(container, displaySourceRef.current);
      reportFirstVisibleGrapheme(displaySourceRef.current);
    }

    if (prefersReducedMotion()) {
      typewritingRef.current = false;
      if (frameRef.current !== undefined) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = undefined;
      }
      displaySourceRef.current = source;
      renderMarkdownInto(container, source);
      reportFirstVisibleGrapheme(source);
      if (cacheKey) {
        typewriterCache.delete(cacheKey);
      }
      return;
    }

    if (!source.startsWith(displaySourceRef.current)) {
      typewritingRef.current = streaming;
      displaySourceRef.current = source;
      renderMarkdownInto(container, source);
      reportFirstVisibleGrapheme(source);
      if (cacheKey) {
        typewriterCache.delete(cacheKey);
      }
      return;
    }

    if (source.length > previousTarget.length && source.startsWith(previousTarget)) {
      const now = performance.now();
      const elapsed = Math.max(1, now - lastArrivalAtRef.current);
      const appended = graphemeCount(source.slice(previousTarget.length));
      const sample = Math.min(
        MAX_GRAPHEMES_PER_SECOND,
        Math.max(MIN_GRAPHEMES_PER_SECOND, (appended * 1000) / elapsed),
      );
      arrivalRateRef.current = arrivalRateRef.current * 0.65 + sample * 0.35;
      lastArrivalAtRef.current = now;
    }

    if (streaming) {
      typewritingRef.current = true;
    } else if (!typewritingRef.current) {
        displaySourceRef.current = source;
        renderMarkdownInto(container, source);
        reportFirstVisibleGrapheme(source);
      if (cacheKey) {
        typewriterCache.delete(cacheKey);
      }
      return;
    }

    const advance = (timestamp: number) => {
      frameRef.current = undefined;
      const target = targetSourceRef.current;
      const current = displaySourceRef.current;

      if (!target.startsWith(current)) {
        typewritingRef.current = false;
        displaySourceRef.current = target;
        renderMarkdownInto(container, target);
        reportFirstVisibleGrapheme(target);
        if (cacheKey) {
          typewriterCache.delete(cacheKey);
        }
        return;
      }

      if (current === target) {
        revealBudgetRef.current = 0;
        lastFrameAtRef.current = undefined;
        if (!streamingRef.current) {
          typewritingRef.current = false;
          if (cacheKey) {
            typewriterCache.delete(cacheKey);
          }
        }
        return;
      }

      const elapsed = Math.min(
        100,
        Math.max(0, timestamp - (lastFrameAtRef.current ?? timestamp - 16.67)),
      );
      lastFrameAtRef.current = timestamp;
      const backlog = graphemeCount(target.slice(current.length));
      const rate = arrivalRateRef.current;
      const targetBuffer = Math.max(1, rate * TARGET_BUFFER_SECONDS);
      const catchUpRate =
        Math.max(0, backlog - targetBuffer) / CATCH_UP_SECONDS;
      revealBudgetRef.current += ((rate + catchUpRate) * elapsed) / 1000;
      const revealCount = Math.min(
        backlog,
        MAX_GRAPHEMES_PER_FRAME,
        Math.floor(revealBudgetRef.current),
      );
      if (revealCount === 0) {
        frameRef.current = requestAnimationFrame(advance);
        return;
      }
      revealBudgetRef.current -= revealCount;
      const boundary = advanceGraphemes(target, current.length, revealCount);
      const next = target.slice(0, boundary);
      displaySourceRef.current = next;
      renderMarkdownInto(container, next);
      reportFirstVisibleGrapheme(next);
      if (cacheKey) {
        typewriterCache.set(cacheKey, {
          active: streamingRef.current || next !== targetSourceRef.current,
          visibleSource: next,
        });
      }

      if (next !== targetSourceRef.current) {
        frameRef.current = requestAnimationFrame(advance);
      } else if (!streamingRef.current) {
        typewritingRef.current = false;
        if (cacheKey) {
          typewriterCache.delete(cacheKey);
        }
      }
    };

    if (
      typewritingRef.current &&
      displaySourceRef.current !== targetSourceRef.current &&
      frameRef.current === undefined
    ) {
      frameRef.current = requestAnimationFrame(advance);
    }
  }, [cacheKey, source, streaming]);

  useEffect(() => {
    return () => {
      if (frameRef.current !== undefined) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  function openExternalLink(url: string | undefined): void {
    if (url) {
      void window.flyoff?.openExternalLink({ url });
    }
  }

  function handleClick(event: MouseEvent<HTMLDivElement>): void {
    const url = externalUrlFromTarget(event.target);
    if (url) {
      event.preventDefault();
      openExternalLink(url);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    const url = externalUrlFromTarget(event.target);
    if (url) {
      event.preventDefault();
      openExternalLink(url);
    }
  }

  return (
    <div
      className={`markdown-view twine-markdown${className ? ` ${className}` : ''}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      ref={containerRef}
    />
  );
}
