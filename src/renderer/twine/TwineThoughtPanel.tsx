import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type UIEvent,
} from 'react';

import chevronIcon from '../../../public/images/icons/actions/chevron-right.svg';
import { MaskedIcon } from '../components/MaskedIcon';
import type { Translate } from '../pages/page-types';
import { TwineMarkdown } from './TwineMarkdown';
import type { TwineMessage } from './twine-types';

interface TwineThoughtPanelProps {
  answerVisible: boolean;
  cacheKey: string;
  message: TwineMessage;
  translate: Translate;
}

const THOUGHT_BOTTOM_THRESHOLD = 16;

function elapsedThinking(message: TwineMessage): string {
  const duration =
    message.thinkingDurationMs ??
    (message.thinkingStartedAt ? Date.now() - message.thinkingStartedAt : 0);
  return `${Math.max(1, Math.round(duration / 1000))}s`;
}

export function TwineThoughtPanel({
  answerVisible,
  cacheKey,
  message,
  translate,
}: TwineThoughtPanelProps) {
  const [open, setOpen] = useState(
    message.status === 'streaming' && !answerVisible,
  );
  const scrollerRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const manualIntentRef = useRef(false);
  const manualIntentTimerRef = useRef<number | undefined>(undefined);
  const scrollFrameRef = useRef<number | undefined>(undefined);
  const previousAnswerVisibleRef = useRef(answerVisible);

  function isAtBottom(element: HTMLElement): boolean {
    return (
      element.scrollHeight - element.scrollTop - element.clientHeight <=
      THOUGHT_BOTTOM_THRESHOLD
    );
  }

  const scrollToBottom = useCallback((): void => {
    const scroller = scrollerRef.current;
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, []);

  const scheduleScrollToBottom = useCallback((): void => {
    if (!open || !followRef.current || scrollFrameRef.current !== undefined) {
      return;
    }
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = undefined;
      scrollToBottom();
    });
  }, [open, scrollToBottom]);

  function markManualIntent(): void {
    manualIntentRef.current = true;
    if (manualIntentTimerRef.current !== undefined) {
      clearTimeout(manualIntentTimerRef.current);
    }
    manualIntentTimerRef.current = window.setTimeout(() => {
      manualIntentRef.current = false;
      manualIntentTimerRef.current = undefined;
    }, 180);
  }

  useLayoutEffect(() => {
    if (answerVisible && !previousAnswerVisibleRef.current) {
      setOpen(false);
    }
    previousAnswerVisibleRef.current = answerVisible;
  }, [answerVisible]);

  useLayoutEffect(() => {
    if (open) {
      scheduleScrollToBottom();
    }
  }, [open, scheduleScrollToBottom]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const content = scroller?.querySelector<HTMLElement>('.twine-markdown');
    if (!open || !scroller || !content || typeof ResizeObserver !== 'function') {
      return;
    }
    const observer = new ResizeObserver(scheduleScrollToBottom);
    observer.observe(content);
    scheduleScrollToBottom();
    return () => observer.disconnect();
  }, [open, scheduleScrollToBottom]);

  useEffect(
    () => () => {
      if (manualIntentTimerRef.current !== undefined) {
        clearTimeout(manualIntentTimerRef.current);
      }
      if (scrollFrameRef.current !== undefined) {
        cancelAnimationFrame(scrollFrameRef.current);
      }
    },
    [],
  );

  function handleScroll(event: UIEvent<HTMLDivElement>): void {
    const element = event.currentTarget;
    if (isAtBottom(element)) {
      followRef.current = true;
    } else if (manualIntentRef.current) {
      followRef.current = false;
    }
  }

  const thinking = message.status === 'streaming' && !answerVisible;
  const content = (
    <div
      aria-label={thinking ? translate('twine.thinkingNow') : undefined}
      className="twine-thought__content"
      onPointerDown={markManualIntent}
      onScroll={handleScroll}
      onTouchStart={markManualIntent}
      onWheel={(event) => {
        markManualIntent();
        if (event.deltaY < 0) {
          followRef.current = false;
        }
      }}
      ref={scrollerRef}
    >
      <TwineMarkdown
        cacheKey={cacheKey}
        source={message.thought ?? ''}
        streaming={message.status === 'streaming'}
      />
    </div>
  );

  if (thinking) {
    return <div className="twine-thought twine-thought--active">{content}</div>;
  }

  return (
    <details
      className="twine-thought"
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        setOpen(nextOpen);
        if (nextOpen) {
          followRef.current = true;
          scheduleScrollToBottom();
        }
      }}
      open={open}
    >
      <summary>
        <span>{`${translate('twine.thoughtFor')} ${elapsedThinking(message)}`}</span>
        <MaskedIcon icon={chevronIcon} />
      </summary>
      <div className="twine-thought__reveal">{content}</div>
    </details>
  );
}
