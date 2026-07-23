import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type UIEvent,
} from 'react';

import arrowLeftIcon from '../../../public/images/icons/actions/arrow-left.svg';
import chevronIcon from '../../../public/images/icons/actions/chevron-right.svg';
import copyIcon from '../../../public/images/icons/twine/copy.svg';
import deleteIcon from '../../../public/images/icons/twine/delete.svg';
import downIcon from '../../../public/images/icons/twine/down.svg';
import editIcon from '../../../public/images/icons/twine/edit.svg';
import regenerateIcon from '../../../public/images/icons/twine/regenerate.svg';
import shareIcon from '../../../public/images/icons/twine/share.svg';
import fileIcon from '../../../public/images/icons/instances/file.svg';
import twineIcon from '../../../public/images/twine/icon.svg';
import { MaskedIcon } from '../components/MaskedIcon';
import { DropdownMenu, type MenuItem } from '../components/menu';
import { getTooltipTargetProps } from '../components/tooltip';
import type { Translate } from '../pages/page-types';
import { formatTwineFileSize } from './TwineAttachments';
import { TwineMarkdown } from './TwineMarkdown';
import { TwineThoughtPanel } from './TwineThoughtPanel';
import { twinePlainTextFromMarkdown } from './twine-content';
import type {
  TwineConversationScrollState,
  TwineMessage,
} from './twine-types';

interface TwineConversationProps {
  active: boolean;
  conversationId: string | null;
  conversationTitle: string;
  initialScrollState?: TwineConversationScrollState;
  messages: readonly TwineMessage[];
  onDelete: (messageId: string) => void;
  onEditRequest: (messageId: string) => void;
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

export function TwineConversation({
  active,
  conversationId,
  conversationTitle,
  initialScrollState,
  messages,
  onDelete,
  onEditRequest,
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
  const heldManualIntentRef = useRef(false);
  const manualIntentTimerRef = useRef<number | undefined>(undefined);
  const resizeFrameRef = useRef<number | undefined>(undefined);
  const anchorRef = useRef<{
    messageId: string;
    offset: number;
  } | undefined>(undefined);
  const previousMessageCountRef = useRef(messages.length);
  const streamingRequestId = [...messages]
    .reverse()
    .find(
      (message) =>
        message.status === 'streaming' && Boolean(message.streamRequestId),
    )?.streamRequestId;
  const previousStreamingRequestIdRef = useRef(streamingRequestId);
  const conversationIdentityRef = useRef(conversationId);
  const restoredConversationIdRef = useRef<string | null | undefined>(
    undefined,
  );
  const [showJump, setShowJump] = useState(false);
  const [actionAnnouncement, setActionAnnouncement] = useState('');
  const [visibleAnswerKeys, setVisibleAnswerKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const actionAnnouncementTimerRef = useRef<number | undefined>(undefined);

  const scrollToBottom = useCallback((behavior: ScrollBehavior): void => {
    const scroller = scrollRef.current;
    if (!scroller) {
      return;
    }
    if (behavior === 'smooth' && typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({
        behavior,
        top: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
      });
    } else {
      scroller.scrollTop = Math.max(
        0,
        scroller.scrollHeight - scroller.clientHeight,
      );
    }
  }, []);

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

  const activateFollow = useCallback((): void => {
    followRef.current = true;
    anchorRef.current = undefined;
    setShowJump(false);
    const settleAtBottom = () => {
      scrollToBottom('auto');
      const scroller = scrollRef.current;
      if (scroller) {
        persistScrollState(scroller);
      }
    };
    settleAtBottom();
    requestAnimationFrame(settleAtBottom);
  }, [persistScrollState, scrollToBottom]);

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

  function holdManualIntent(): void {
    heldManualIntentRef.current = true;
    manualIntentRef.current = true;
    if (manualIntentTimerRef.current !== undefined) {
      clearTimeout(manualIntentTimerRef.current);
      manualIntentTimerRef.current = undefined;
    }
  }

  function releaseManualIntent(): void {
    if (!heldManualIntentRef.current) {
      return;
    }
    heldManualIntentRef.current = false;
    requestAnimationFrame(pauseFollowing);
    setManualIntent();
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
    if (conversationIdentityRef.current === conversationId) {
      return;
    }
    conversationIdentityRef.current = conversationId;
    previousMessageCountRef.current = messages.length;
    previousStreamingRequestIdRef.current = streamingRequestId;
  }, [conversationId, messages.length, streamingRequestId]);

  useLayoutEffect(() => {
    const startedNewGeneration =
      Boolean(streamingRequestId) &&
      streamingRequestId !== previousStreamingRequestIdRef.current;
    if (
      startedNewGeneration ||
      messages.length > previousMessageCountRef.current
    ) {
      activateFollow();
    }
    previousStreamingRequestIdRef.current = streamingRequestId;
    previousMessageCountRef.current = messages.length;
    if (active && followRef.current) {
      scrollToBottom('auto');
    }
  }, [
    activateFollow,
    active,
    messages.length,
    scrollToBottom,
    streamingRequestId,
    streamingSignature,
  ]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (restoredConversationIdRef.current === conversationId) {
      return;
    }
    restoredConversationIdRef.current = conversationId;
    const saved = initialScrollState;
    followRef.current = saved?.follow ?? true;
    anchorRef.current =
      saved?.anchorMessageId && saved.anchorOffset !== undefined
        ? {
            messageId: saved.anchorMessageId,
            offset: saved.anchorOffset,
          }
        : undefined;
    if (!scroller) {
      setShowJump(false);
      return;
    }
    if (followRef.current) {
      scrollToBottom('auto');
    } else {
      scroller.scrollTop = saved?.scrollTop ?? 0;
    }
    captureAnchor(scroller);
    setShowJump(!followRef.current && !isAtBottom(scroller));
  }, [conversationId, initialScrollState, scrollToBottom]);

  useEffect(() => {
    if (!active || !followRef.current) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      scrollToBottom('auto');
    });
    return () => cancelAnimationFrame(frame);
  }, [active, scrollToBottom]);

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
  }, [
    conversationId,
    messages.length,
    persistScrollState,
    scrollToBottom,
  ]);

  useEffect(
    () => () => {
      if (manualIntentTimerRef.current !== undefined) {
        clearTimeout(manualIntentTimerRef.current);
      }
      if (actionAnnouncementTimerRef.current !== undefined) {
        clearTimeout(actionAnnouncementTimerRef.current);
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

  function announceAction(message: string): void {
    setActionAnnouncement(message);
    if (actionAnnouncementTimerRef.current !== undefined) {
      clearTimeout(actionAnnouncementTimerRef.current);
    }
    actionAnnouncementTimerRef.current = window.setTimeout(() => {
      setActionAnnouncement('');
      actionAnnouncementTimerRef.current = undefined;
    }, 2_000);
  }

  async function copyMessage(
    message: TwineMessage,
    format: 'markdown' | 'text',
  ): Promise<void> {
    try {
      const result = await window.flyoff?.copyTwineContent({
        content:
          format === 'markdown'
            ? message.text
            : twinePlainTextFromMarkdown(message.text),
        format,
      });
      announceAction(
        result?.status === 'success'
          ? translate('twine.copied')
          : translate('twine.copyFailed'),
      );
    } catch {
      announceAction(translate('twine.copyFailed'));
    }
  }

  async function exportMessage(message: TwineMessage): Promise<void> {
    try {
      const result = await window.flyoff?.exportTwineMarkdown({
        content: message.text,
        suggestedName: conversationTitle,
      });
      if (result?.status === 'success') {
        announceAction(translate('twine.exportSaved'));
      } else if (result?.status === 'error' || !result) {
        announceAction(translate('twine.exportFailed'));
      }
    } catch {
      announceAction(translate('twine.exportFailed'));
    }
  }

  function shareItems(): readonly MenuItem[] {
    return [
      {
        id: 'copy-text',
        kind: 'action',
        label: translate('twine.copyText'),
      },
      {
        id: 'copy-markdown',
        kind: 'action',
        label: translate('twine.copyMarkdown'),
      },
      { id: 'share-separator', kind: 'separator' },
      {
        id: 'save-markdown',
        kind: 'action',
        label: translate('twine.saveMarkdown'),
      },
    ];
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
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            holdManualIntent();
          }
        }}
        onPointerCancel={releaseManualIntent}
        onPointerUp={releaseManualIntent}
        onScroll={handleScroll}
        onTouchCancel={releaseManualIntent}
        onTouchEnd={releaseManualIntent}
        onTouchStart={holdManualIntent}
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
                  <TwineThoughtPanel
                    answerVisible={
                      (!message.streamRequestId && message.status !== 'streaming') ||
                      visibleAnswerKeys.has(
                        `${conversationId ?? 'session'}:${message.id}`,
                      )
                    }
                    cacheKey={`${conversationId ?? 'session'}:${message.id}:thought`}
                    message={message}
                    translate={translate}
                  />
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
                {message.text ? (
                  <TwineMarkdown
                    cacheKey={`${conversationId ?? 'session'}:${message.id}:text`}
                    onFirstVisibleGrapheme={
                      message.kind === 'assistant'
                        ? () => {
                            const key = `${conversationId ?? 'session'}:${message.id}`;
                            setVisibleAnswerKeys((current) => {
                              if (current.has(key)) {
                                return current;
                              }
                              return new Set([...current, key]);
                            });
                          }
                        : undefined
                    }
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
                  {variant?.anchorMessageId === message.id && variant.total > 1
                    ? variantControls()
                    : null}
                  {message.kind !== 'system' && message.status !== 'streaming' ? (
                    <div className="twine-message__actions">
                      {message.kind === 'user' ? (
                        <>
                          <button
                            aria-label={translate('twine.editMessage')}
                            onClick={() => onEditRequest(message.id)}
                            type="button"
                            {...getTooltipTargetProps(
                              translate('twine.editMessage'),
                              'bottom',
                            )}
                          >
                            <MaskedIcon icon={editIcon} />
                          </button>
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
                        </>
                      ) : (
                        <>
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
                            aria-label={translate('twine.regenerate')}
                            onClick={() => onRegenerate(message.id)}
                            type="button"
                            {...getTooltipTargetProps(
                              translate('twine.regenerate'),
                              'bottom',
                            )}
                          >
                            <MaskedIcon icon={regenerateIcon} />
                          </button>
                          <button
                            aria-label={translate('twine.copyResponse')}
                            onClick={() => void copyMessage(message, 'markdown')}
                            type="button"
                            {...getTooltipTargetProps(
                              translate('twine.copyResponse'),
                              'bottom',
                            )}
                          >
                            <MaskedIcon icon={copyIcon} />
                          </button>
                          <DropdownMenu
                            items={shareItems()}
                            onAction={(id) => {
                              if (id === 'copy-text') {
                                void copyMessage(message, 'text');
                              } else if (id === 'copy-markdown') {
                                void copyMessage(message, 'markdown');
                              } else if (id === 'save-markdown') {
                                void exportMessage(message);
                              }
                            }}
                            placement="bottom-start"
                            trigger={(props) => (
                              <button
                                {...props}
                                aria-label={translate('twine.shareResponse')}
                                type="button"
                                {...getTooltipTargetProps(
                                  translate('twine.shareResponse'),
                                  'bottom',
                                )}
                              >
                                <MaskedIcon icon={shareIcon} />
                              </button>
                            )}
                          />
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
                        </>
                      )}
                    </div>
                  ) : null}
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
        {actionAnnouncement || (messages.at(-1)?.status === 'error'
          ? translate('twine.generationFailed')
          : messages.some(({ status }) => status === 'streaming')
            ? translate('twine.generating')
            : messages.at(-1)?.kind === 'assistant'
              ? translate('twine.responseReady')
              : '')}
      </p>
    </div>
  );
}
