import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type UIEvent,
} from 'react';

import arrowLeftIcon from '../../../public/images/icons/actions/arrow-left.svg';
import chevronIcon from '../../../public/images/icons/actions/chevron-right.svg';
import refreshIcon from '../../../public/images/icons/actions/refresh.svg';
import deleteIcon from '../../../public/images/icons/twine/delete.svg';
import downIcon from '../../../public/images/icons/twine/down.svg';
import editIcon from '../../../public/images/icons/twine/edit.svg';
import fileIcon from '../../../public/images/icons/instances/file.svg';
import twineIcon from '../../../public/images/twine/icon.svg';
import { MaskedIcon } from '../components/MaskedIcon';
import { getTooltipTargetProps } from '../components/tooltip';
import type { Translate } from '../pages/page-types';
import { formatTwineFileSize } from './TwineAttachments';
import { TwineMarkdown } from './TwineMarkdown';
import type {
  TwineConversationScrollState,
  TwineMessage,
} from './twine-types';

interface TwineConversationProps {
  active: boolean;
  conversationId: string | null;
  initialScrollState?: TwineConversationScrollState;
  messages: readonly TwineMessage[];
  onDelete: (messageId: string) => void;
  onEdit: (messageId: string, text: string) => void;
  onRegenerate: (messageId: string) => void;
  onRewind: (messageId: string) => void;
  onScrollStateChange: (state: TwineConversationScrollState) => void;
  onVariantChange: (offset: -1 | 1) => void;
  translate: Translate;
  variant?: {
    anchorMessageId?: string;
    index: number;
    total: number;
  };
}

const BOTTOM_THRESHOLD = 96;

function elapsedThinking(message: TwineMessage): string {
  const duration = message.thinkingDurationMs ??
    (message.thinkingStartedAt ? Date.now() - message.thinkingStartedAt : 0);
  return `${Math.max(1, Math.round(duration / 1000))}s`;
}

export function TwineConversation({
  active,
  conversationId,
  initialScrollState,
  messages,
  onDelete,
  onEdit,
  onRegenerate,
  onRewind,
  onScrollStateChange,
  onVariantChange,
  translate,
  variant,
}: TwineConversationProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const manualIntentRef = useRef(false);
  const manualIntentTimerRef = useRef<number | undefined>(undefined);
  const resizeFrameRef = useRef<number | undefined>(undefined);
  const anchorRef = useRef<{
    messageId: string;
    offset: number;
  } | undefined>(undefined);
  const previousMessageCountRef = useRef(messages.length);
  const [showJump, setShowJump] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [editingText, setEditingText] = useState('');

  function scrollToBottom(behavior: ScrollBehavior): void {
    const scroller = scrollRef.current;
    if (!scroller) {
      return;
    }
    if (behavior === 'smooth' && typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({ behavior, top: scroller.scrollHeight });
    } else {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }

  function isAtBottom(element: HTMLElement): boolean {
    return (
      element.scrollHeight - element.scrollTop - element.clientHeight <=
      BOTTOM_THRESHOLD
    );
  }

  function captureAnchor(element: HTMLElement): void {
    const scrollerTop = element.getBoundingClientRect().top;
    const candidates = contentRef.current?.querySelectorAll<HTMLElement>(
      '[data-twine-message-id]',
    );
    if (!candidates) {
      return;
    }
    const anchor = Array.from(candidates).find(
      (candidate) => candidate.getBoundingClientRect().bottom > scrollerTop,
    );
    const messageId = anchor?.dataset.twineMessageId;
    if (!anchor || !messageId) {
      anchorRef.current = undefined;
      return;
    }
    anchorRef.current = {
      messageId,
      offset: anchor.getBoundingClientRect().top - scrollerTop,
    };
  }

  const persistScrollState = useCallback((element: HTMLElement): void => {
    onScrollStateChange({
      ...(anchorRef.current
        ? {
            anchorMessageId: anchorRef.current.messageId,
            anchorOffset: anchorRef.current.offset,
          }
        : {}),
      follow: followRef.current,
      scrollTop: element.scrollTop,
    });
  }, [onScrollStateChange]);

  function setManualIntent(): void {
    manualIntentRef.current = true;
    if (manualIntentTimerRef.current !== undefined) {
      clearTimeout(manualIntentTimerRef.current);
    }
    manualIntentTimerRef.current = window.setTimeout(() => {
      manualIntentRef.current = false;
      manualIntentTimerRef.current = undefined;
    }, 180);
  }

  function pauseFollowing(): void {
    const scroller = scrollRef.current;
    if (!scroller || isAtBottom(scroller)) {
      return;
    }
    followRef.current = false;
    setShowJump(true);
    captureAnchor(scroller);
    persistScrollState(scroller);
  }

  const streamingSignature = messages
    .map((message) => `${message.text.length}:${message.thought?.length ?? 0}:${message.status}`)
    .join('|');

  useLayoutEffect(() => {
    if (messages.length > previousMessageCountRef.current) {
      followRef.current = true;
      setShowJump(false);
    }
    previousMessageCountRef.current = messages.length;
    if (active && followRef.current) {
      scrollToBottom('auto');
    }
  }, [active, messages.length, streamingSignature]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) {
      return;
    }
    const saved = initialScrollState;
    followRef.current = saved?.follow ?? true;
    anchorRef.current =
      saved?.anchorMessageId && saved.anchorOffset !== undefined
        ? {
            messageId: saved.anchorMessageId,
            offset: saved.anchorOffset,
          }
        : undefined;
    if (followRef.current) {
      scrollToBottom('auto');
    } else {
      scroller.scrollTop = saved?.scrollTop ?? 0;
    }
    captureAnchor(scroller);
    setShowJump(!followRef.current && !isAtBottom(scroller));
  }, [conversationId, initialScrollState]);

  useEffect(() => {
    if (!active || !followRef.current) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      scrollToBottom('auto');
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content || typeof ResizeObserver !== 'function') {
      return;
    }
    const restoreAfterResize = () => {
      if (resizeFrameRef.current !== undefined) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = undefined;
        if (followRef.current) {
          scrollToBottom('auto');
        } else if (anchorRef.current) {
          const anchor = Array.from(
            content.querySelectorAll<HTMLElement>('[data-twine-message-id]'),
          ).find(
            (candidate) =>
              candidate.dataset.twineMessageId === anchorRef.current?.messageId,
          );
          if (anchor) {
            const currentOffset =
              anchor.getBoundingClientRect().top -
              scroller.getBoundingClientRect().top;
            scroller.scrollTop += currentOffset - anchorRef.current.offset;
          }
        }
        captureAnchor(scroller);
        persistScrollState(scroller);
        setShowJump(!followRef.current && !isAtBottom(scroller));
      });
    };
    const observer = new ResizeObserver(restoreAfterResize);
    observer.observe(scroller);
    observer.observe(content);
    return () => {
      observer.disconnect();
      if (resizeFrameRef.current !== undefined) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
    };
  }, [conversationId, messages.length, persistScrollState]);

  useEffect(
    () => () => {
      if (manualIntentTimerRef.current !== undefined) {
        clearTimeout(manualIntentTimerRef.current);
      }
    },
    [],
  );

  if (messages.length === 0) {
    return (
      <div className="twine-empty-state">
        <div className="twine-empty-state__brand">
          <img aria-hidden="true" src={twineIcon} alt="" />
          <span>{translate('pages.twine')}</span>
        </div>
        {variantControls()}
      </div>
    );
  }

  function handleScroll(event: UIEvent<HTMLDivElement>): void {
    const element = event.currentTarget;
    const atBottom = isAtBottom(element);
    if (atBottom) {
      followRef.current = true;
    } else if (manualIntentRef.current) {
      followRef.current = false;
    }
    captureAnchor(element);
    persistScrollState(element);
    setShowJump(!followRef.current && !atBottom);
  }

  function handleNavigationKey(event: KeyboardEvent<HTMLDivElement>): void {
    if (
      event.key === 'ArrowUp' ||
      event.key === 'PageUp' ||
      event.key === 'Home' ||
      (event.key === ' ' && event.shiftKey)
    ) {
      setManualIntent();
      requestAnimationFrame(pauseFollowing);
    } else if (
      event.key === 'ArrowDown' ||
      event.key === 'PageDown' ||
      event.key === 'End' ||
      event.key === ' '
    ) {
      setManualIntent();
    }
  }

  function submitEdit(event: FormEvent, messageId: string): void {
    event.preventDefault();
    const text = editingText.trim();
    if (text) {
      onEdit(messageId, text);
      setEditingId(undefined);
      setEditingText('');
    }
  }

  function variantControls(): ReactNode {
    if (!variant || variant.total < 2) {
      return null;
    }
    return (
      <div
        aria-label={translate('twine.messageVersions')}
        className="twine-message__variants"
      >
        <button
          aria-label={translate('twine.previousVersion')}
          disabled={variant.index === 0}
          onClick={() => onVariantChange(-1)}
          type="button"
        >
          <MaskedIcon icon={chevronIcon} />
        </button>
        <span>{variant.index + 1}/{variant.total}</span>
        <button
          aria-label={translate('twine.nextVersion')}
          disabled={variant.index === variant.total - 1}
          onClick={() => onVariantChange(1)}
          type="button"
        >
          <MaskedIcon icon={chevronIcon} />
        </button>
      </div>
    );
  }

  return (
    <div className="twine-conversation-shell">
      <div
        aria-label={translate('twine.conversation')}
        className="twine-messages"
        onKeyDown={handleNavigationKey}
        onPointerDown={setManualIntent}
        onScroll={handleScroll}
        onTouchStart={setManualIntent}
        onWheel={(event) => {
          setManualIntent();
          if (event.deltaY < 0) {
            requestAnimationFrame(pauseFollowing);
          }
        }}
        ref={scrollRef}
        role="log"
      >
        <div className="twine-messages__content" ref={contentRef}>
          {messages.map((message) => (
            <article
              className={`twine-message twine-message--${message.kind}`}
              data-twine-message-id={message.id}
              key={message.id}
            >
              <div className="twine-message__body">
                {message.kind === 'assistant' && message.thought ? (
                  <details
                    className="twine-thought"
                    open={message.status === 'streaming' ? true : undefined}
                  >
                    <summary>
                      <span>
                        {message.status === 'streaming'
                          ? translate('twine.thinkingNow')
                          : `${translate('twine.thoughtFor')} ${elapsedThinking(message)}`}
                      </span>
                      <MaskedIcon icon={chevronIcon} />
                    </summary>
                    <TwineMarkdown
                      cacheKey={`${conversationId ?? 'session'}:${message.id}:thought`}
                      source={message.thought}
                      streaming={message.status === 'streaming'}
                    />
                  </details>
                ) : null}
                {message.tools && message.tools.length > 0 ? (
                  <div className="twine-message__tools">
                    {message.tools.map((activity) => (
                      <details key={activity.id}>
                        <summary>
                          {activity.tool === 'search'
                            ? translate('twine.searchedWeb')
                            : activity.phase === 'start'
                              ? translate('twine.executedCode')
                              : translate('twine.codeResult')}
                        </summary>
                        {activity.text ? (
                          <pre><code>{activity.text}</code></pre>
                        ) : null}
                      </details>
                    ))}
                  </div>
                ) : null}
                {editingId === message.id ? (
                  <form
                    className="twine-message__editor"
                    onSubmit={(event) => submitEdit(event, message.id)}
                  >
                    <textarea
                      aria-label={translate('twine.editMessage')}
                      autoFocus
                      onChange={(event) =>
                        setEditingText(event.currentTarget.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          setEditingId(undefined);
                        }
                      }}
                      value={editingText}
                    />
                    <div>
                      <button
                        onClick={() => setEditingId(undefined)}
                        type="button"
                      >
                        {translate('twine.cancel')}
                      </button>
                      <button
                        className="twine-message__save"
                        disabled={!editingText.trim()}
                        type="submit"
                      >
                        {translate('twine.saveEdit')}
                      </button>
                    </div>
                  </form>
                ) : message.text ? (
                  <TwineMarkdown
                    cacheKey={`${conversationId ?? 'session'}:${message.id}:text`}
                    source={message.text}
                    streaming={message.status === 'streaming'}
                  />
                ) : message.status === 'streaming' ? (
                  <span
                    aria-label={translate('twine.generating')}
                    className="twine-message__stream-caret"
                  />
                ) : null}
                {message.attachments.length > 0 ? (
                  <div className="twine-message__attachments">
                    {message.attachments.map((attachment) => (
                      <div
                        className="twine-message__attachment"
                        key={attachment.id}
                      >
                        {attachment.previewUrl ? (
                          <img alt="" aria-hidden="true" src={attachment.previewUrl} />
                        ) : (
                          <MaskedIcon icon={fileIcon} />
                        )}
                        <span>
                          <strong>{attachment.name}</strong>
                          <small>{formatTwineFileSize(attachment.size)}</small>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {message.sources && message.sources.length > 0 ? (
                  <div className="twine-message__sources">
                    <strong>{translate('twine.sources')}</strong>
                    <ol>
                      {message.sources.map((source) => (
                        <li key={source.url}>
                          <button
                            onClick={() =>
                              void window.flyoff?.openExternalLink({
                                url: source.url,
                              })
                            }
                            type="button"
                          >
                            {source.title}
                          </button>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </div>
              {(message.kind !== 'system' && message.status !== 'streaming') ||
              (variant?.anchorMessageId === message.id && variant.total > 1) ? (
                <div className="twine-message__footer">
                  {message.kind !== 'system' && message.status !== 'streaming' ? (
                    <div className="twine-message__actions">
                      {message.kind === 'user' ? (
                        <button
                          aria-label={translate('twine.editMessage')}
                          onClick={() => {
                            setEditingId(message.id);
                            setEditingText(message.text);
                          }}
                          type="button"
                          {...getTooltipTargetProps(
                            translate('twine.editMessage'),
                            'bottom',
                          )}
                        >
                          <MaskedIcon icon={editIcon} />
                        </button>
                      ) : (
                        <button
                          aria-label={translate('twine.regenerate')}
                          onClick={() => onRegenerate(message.id)}
                          type="button"
                          {...getTooltipTargetProps(
                            translate('twine.regenerate'),
                            'bottom',
                          )}
                        >
                          <MaskedIcon icon={refreshIcon} />
                        </button>
                      )}
                      <button
                        aria-label={translate('twine.rewindHere')}
                        onClick={() => onRewind(message.id)}
                        type="button"
                        {...getTooltipTargetProps(
                          translate('twine.rewindHere'),
                          'bottom',
                        )}
                      >
                        <MaskedIcon icon={arrowLeftIcon} />
                      </button>
                      <button
                        aria-label={translate('twine.deleteMessage')}
                        onClick={() => onDelete(message.id)}
                        type="button"
                        {...getTooltipTargetProps(
                          translate('twine.deleteMessage'),
                          'bottom',
                        )}
                      >
                        <MaskedIcon icon={deleteIcon} />
                      </button>
                    </div>
                  ) : null}
                  {variant?.anchorMessageId === message.id && variant.total > 1
                    ? variantControls()
                    : null}
                </div>
              ) : null}
            </article>
          ))}
          <div aria-hidden="true" ref={bottomRef} />
        </div>
      </div>
      {showJump ? (
        <button
          aria-label={translate('twine.jumpToLatest')}
          className="twine-conversation__jump"
          onClick={() => {
            followRef.current = true;
            setShowJump(false);
            scrollToBottom('smooth');
            const scroller = scrollRef.current;
            if (scroller) {
              persistScrollState(scroller);
            }
          }}
          type="button"
          {...getTooltipTargetProps(translate('twine.jumpToLatest'), 'left')}
        >
          <MaskedIcon icon={downIcon} />
        </button>
      ) : null}
      <p aria-live="polite" className="twine-sr-status">
        {messages.at(-1)?.status === 'error'
          ? translate('twine.generationFailed')
          : messages.some(({ status }) => status === 'streaming')
            ? translate('twine.generating')
            : messages.at(-1)?.kind === 'assistant'
              ? translate('twine.responseReady')
              : ''}
      </p>
    </div>
  );
}
