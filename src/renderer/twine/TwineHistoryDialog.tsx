import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  TwineConversationFilter,
  TwineConversationMutationRequest,
  TwineConversationQuery,
  TwineConversationQueryResult,
  TwineConversationSearchResult,
  TwineConversationSort,
  TwineConversationSummary,
} from '../../shared/contracts';
import activeIcon from '../../../public/images/icons/twine/active.svg';
import archiveIcon from '../../../public/images/icons/twine/archive.svg';
import archivedIcon from '../../../public/images/icons/twine/archived.svg';
import conversationIcon from '../../../public/images/icons/twine/conversation.svg';
import deleteIcon from '../../../public/images/icons/twine/delete.svg';
import filterIcon from '../../../public/images/icons/twine/filter.svg';
import historyIcon from '../../../public/images/icons/twine/history.svg';
import moreIcon from '../../../public/images/icons/twine/more.svg';
import pinIcon from '../../../public/images/icons/twine/pin.svg';
import pinnedIcon from '../../../public/images/icons/twine/pinned.svg';
import renameIcon from '../../../public/images/icons/twine/rename.svg';
import searchIcon from '../../../public/images/icons/twine/search.svg';
import sortIcon from '../../../public/images/icons/twine/sort.svg';
import unarchiveIcon from '../../../public/images/icons/twine/unarchive.svg';
import unpinIcon from '../../../public/images/icons/twine/unpin.svg';
import { Dialog } from '../components/dialog';
import { MaskedIcon } from '../components/MaskedIcon';
import { DropdownMenu, type MenuItem } from '../components/menu';
import { getTooltipTargetProps } from '../components/tooltip';
import type { Translate } from '../pages/page-types';

interface TwineHistoryDialogProps {
  activeConversationId: string | null;
  initialConversations: readonly TwineConversationSummary[];
  onCancel: () => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onOpen: (id: string) => void;
  onQuery: (
    query: TwineConversationQuery,
  ) => Promise<TwineConversationQueryResult>;
  onUpdate: (request: TwineConversationMutationRequest) => Promise<void>;
  translate: Translate;
}

interface HistorySection {
  conversations: readonly TwineConversationSearchResult[];
  id: string;
  label: string;
}

function asSearchResults(
  conversations: readonly TwineConversationSummary[],
): TwineConversationSearchResult[] {
  return conversations.map((conversation) => ({ ...conversation }));
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function recentSections(
  conversations: readonly TwineConversationSearchResult[],
  sort: TwineConversationSort,
  translate: Translate,
): HistorySection[] {
  if (sort === 'title') {
    return conversations.length > 0
      ? [
          {
            conversations,
            id: 'conversations',
            label: translate('twine.historyAllConversations'),
          },
        ]
      : [];
  }
  const today = startOfDay(Date.now());
  const buckets = [
    {
      id: 'today',
      label: translate('twine.historyToday'),
      minimum: today,
    },
    {
      id: 'week',
      label: translate('twine.historyLastSevenDays'),
      minimum: today - 6 * 86_400_000,
    },
    {
      id: 'month',
      label: translate('twine.historyLastThirtyDays'),
      minimum: today - 29 * 86_400_000,
    },
    {
      id: 'older',
      label: translate('twine.historyOlder'),
      minimum: Number.NEGATIVE_INFINITY,
    },
  ];
  const sections = buckets.map((bucket, index) => ({
    conversations: conversations.filter((conversation) => {
      const maximum = index === 0 ? Number.POSITIVE_INFINITY : buckets[index - 1]!.minimum;
      return (
        conversation.activityAt >= bucket.minimum &&
        conversation.activityAt < maximum
      );
    }),
    id: bucket.id,
    label: bucket.label,
  }));
  return (sort === 'oldest' ? sections.reverse() : sections).filter(
    ({ conversations: entries }) => entries.length > 0,
  );
}

function historySections(
  conversations: readonly TwineConversationSearchResult[],
  sort: TwineConversationSort,
  translate: Translate,
): HistorySection[] {
  const pinned = conversations.filter(
    ({ archivedAt, pinnedAt }) => archivedAt === null && pinnedAt !== null,
  );
  const recent = conversations.filter(
    ({ archivedAt, pinnedAt }) => archivedAt === null && pinnedAt === null,
  );
  const archived = conversations.filter(({ archivedAt }) => archivedAt !== null);
  return [
    ...(pinned.length > 0
      ? [
          {
            conversations: pinned,
            id: 'pinned',
            label: translate('twine.historyPinned'),
          },
        ]
      : []),
    ...recentSections(recent, sort, translate),
    ...(archived.length > 0
      ? [
          {
            conversations: archived,
            id: 'archived',
            label: translate('twine.historyArchived'),
          },
        ]
      : []),
  ];
}

export function TwineHistoryDialog({
  activeConversationId,
  initialConversations,
  onCancel,
  onCreate,
  onDelete,
  onOpen,
  onQuery,
  onUpdate,
  translate,
}: TwineHistoryDialogProps) {
  const [filter, setFilter] = useState<TwineConversationFilter>('active');
  const [sort, setSort] = useState<TwineConversationSort>('recent');
  const [query, setQuery] = useState('');
  const [conversations, setConversations] = useState(
    asSearchResults(initialConversations),
  );
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [editingTitle, setEditingTitle] = useState('');
  const queryRevision = useRef(0);
  const renameFormRef = useRef<HTMLFormElement>(null);
  const onQueryRef = useRef(onQuery);

  useEffect(() => {
    onQueryRef.current = onQuery;
  }, [onQuery]);

  useEffect(() => {
    if (!editingId) {
      return;
    }

    function cancelRenameOutside(event: PointerEvent): void {
      if (
        event.target instanceof Node &&
        !renameFormRef.current?.contains(event.target)
      ) {
        setEditingId(undefined);
      }
    }

    document.addEventListener('pointerdown', cancelRenameOutside, true);
    return () => {
      document.removeEventListener('pointerdown', cancelRenameOutside, true);
    };
  }, [editingId]);

  const refresh = useCallback(async (): Promise<void> => {
    const revision = ++queryRevision.current;
    queueMicrotask(() => {
      if (revision === queryRevision.current) {
        setBusy(true);
      }
    });
    try {
      const result = await onQueryRef.current({
        filter: query.trim() && filter === 'active' ? 'all' : filter,
        query,
        sort,
      });
      if (revision === queryRevision.current) {
        setConversations([...result.conversations]);
      }
    } finally {
      if (revision === queryRevision.current) {
        setBusy(false);
      }
    }
  }, [filter, query, sort]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (query || filter !== 'active' || sort !== 'recent') {
      return;
    }
    queueMicrotask(() => {
      setConversations(asSearchResults(initialConversations));
    });
  }, [filter, initialConversations, query, sort]);

  const sections = useMemo(
    () => historySections(conversations, sort, translate),
    [conversations, sort, translate],
  );
  const filterItems = useMemo<readonly MenuItem[]>(
    () => [
      {
        checked: filter === 'active',
        id: 'active',
        icon: activeIcon,
        kind: 'action',
        label: translate('twine.historyFilterActive'),
      },
      {
        checked: filter === 'pinned',
        id: 'pinned',
        icon: pinnedIcon,
        kind: 'action',
        label: translate('twine.historyPinned'),
      },
      {
        checked: filter === 'archived',
        id: 'archived',
        icon: archivedIcon,
        kind: 'action',
        label: translate('twine.historyArchived'),
      },
      {
        checked: filter === 'all',
        id: 'all',
        icon: historyIcon,
        kind: 'action',
        label: translate('twine.historyFilterAll'),
      },
    ],
    [filter, translate],
  );
  const sortItems = useMemo<readonly MenuItem[]>(
    () => [
      {
        checked: sort === 'recent',
        id: 'recent',
        kind: 'action',
        label: translate('twine.historySortRecent'),
      },
      {
        checked: sort === 'oldest',
        id: 'oldest',
        kind: 'action',
        label: translate('twine.historySortOldest'),
      },
      {
        checked: sort === 'title',
        id: 'title',
        kind: 'action',
        label: translate('twine.historySortTitle'),
      },
    ],
    [sort, translate],
  );

  async function updateConversation(
    request: TwineConversationMutationRequest,
  ): Promise<void> {
    await onUpdate(request);
    await refresh();
  }

  async function saveRename(id: string): Promise<void> {
    const title = editingTitle.trim();
    if (!title) {
      return;
    }
    setEditingId(undefined);
    await updateConversation({ id, title, type: 'rename' });
  }

  return (
    <Dialog
      bodyPadding="none"
      className="twine-history-dialog"
      closeLabel={translate('windowControls.close')}
      closeOnBackdrop
      onCancel={onCancel}
      restoreFocus={false}
      size="wide"
      title={translate('twine.history')}
    >
      <div className="twine-history">
        <div className="twine-history__toolbar">
          <label className="twine-history__search">
            <MaskedIcon className="twine-history__search-icon" icon={searchIcon} />
            <input
              aria-label={translate('twine.historySearch')}
              data-dialog-initial-focus
              onChange={(event) => setQuery(event.target.value)}
              placeholder={translate('twine.historySearchPlaceholder')}
              type="search"
              value={query}
            />
          </label>
          <DropdownMenu
            items={filterItems}
            menuClassName="twine-history-menu"
            onAction={(id) => setFilter(id as TwineConversationFilter)}
            trigger={(props) => (
              <button className="twine-history__select" type="button" {...props}>
                <MaskedIcon
                  className="twine-history__button-icon"
                  icon={filterIcon}
                />
                {filter === 'active'
                  ? translate('twine.historyFilterActive')
                  : filter === 'pinned'
                    ? translate('twine.historyFilterPinned')
                    : filter === 'archived'
                      ? translate('twine.historyFilterArchived')
                      : translate('twine.historyFilterAll')}
              </button>
            )}
          />
          <DropdownMenu
            items={sortItems}
            menuClassName="twine-history-menu"
            onAction={(id) => setSort(id as TwineConversationSort)}
            trigger={(props) => (
              <button className="twine-history__select" type="button" {...props}>
                <MaskedIcon
                  className="twine-history__button-icon"
                  icon={sortIcon}
                />
                {sort === 'recent'
                  ? translate('twine.historySortRecent')
                  : sort === 'oldest'
                    ? translate('twine.historySortOldest')
                    : translate('twine.historySortTitle')}
              </button>
            )}
          />
          <button className="twine-history__new" onClick={onCreate} type="button">
            <MaskedIcon
              className="twine-history__button-icon"
              icon={conversationIcon}
            />
            <span>{translate('twine.newConversation')}</span>
          </button>
        </div>
        <div aria-busy={busy} className="twine-history__results">
          {sections.length === 0 ? (
            <p className="twine-history__empty">
              {translate('twine.historyEmpty')}
            </p>
          ) : (
            sections.map((section) => (
              <section className="twine-history__section" key={section.id}>
                <h3>{section.label}</h3>
                <ul>
                  {section.conversations.map((conversation) => {
                    const menuItems: readonly MenuItem[] = [
                      {
                        id: 'pin',
                        icon:
                          conversation.pinnedAt === null ? pinIcon : unpinIcon,
                        kind: 'action',
                        label: translate(
                          conversation.pinnedAt === null
                            ? 'twine.pinConversation'
                            : 'twine.unpinConversation',
                        ),
                      },
                      {
                        id: 'rename',
                        icon: renameIcon,
                        kind: 'action',
                        label: translate('twine.renameConversation'),
                      },
                      {
                        id: 'archive',
                        icon:
                          conversation.archivedAt === null
                            ? archiveIcon
                            : unarchiveIcon,
                        kind: 'action',
                        label: translate(
                          conversation.archivedAt === null
                            ? 'twine.archiveConversation'
                            : 'twine.unarchiveConversation',
                        ),
                      },
                      { id: 'separator', kind: 'separator' },
                      {
                        id: 'delete',
                        icon: deleteIcon,
                        kind: 'action',
                        label: translate('twine.deleteConversation'),
                        tone: 'danger',
                      },
                    ];
                    return (
                      <li
                        className="twine-history__conversation"
                        data-active={conversation.id === activeConversationId}
                        key={conversation.id}
                      >
                        {editingId === conversation.id ? (
                          <form
                            className="twine-history__rename"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void saveRename(conversation.id);
                            }}
                            ref={renameFormRef}
                          >
                            <input
                              autoFocus
                              maxLength={120}
                              onChange={(event) => setEditingTitle(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Escape') {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setEditingId(undefined);
                                }
                              }}
                              value={editingTitle}
                            />
                            <button disabled={!editingTitle.trim()} type="submit">
                              {translate('twine.saveConversationName')}
                            </button>
                          </form>
                        ) : (
                          <button
                            aria-current={
                              conversation.id === activeConversationId
                                ? 'page'
                                : undefined
                            }
                            className="twine-history__open"
                            onClick={() => onOpen(conversation.id)}
                            type="button"
                          >
                            <span className="twine-history__title">
                              {conversation.title}
                            </span>
                            {conversation.matchSnippet ? (
                              <span className="twine-history__snippet">
                                {conversation.matchSnippet}
                              </span>
                            ) : null}
                            <time dateTime={new Date(conversation.activityAt).toISOString()}>
                              {new Intl.DateTimeFormat(undefined, {
                                dateStyle: 'medium',
                              }).format(conversation.activityAt)}
                            </time>
                          </button>
                        )}
                        {editingId !== conversation.id ? (
                          <DropdownMenu
                            items={menuItems}
                            menuClassName="twine-history-menu"
                            onAction={(action) => {
                              if (action === 'rename') {
                                setEditingId(conversation.id);
                                setEditingTitle(conversation.title);
                              } else if (action === 'pin') {
                                void updateConversation({
                                  id: conversation.id,
                                  pinned: conversation.pinnedAt === null,
                                  type: 'pin',
                                });
                              } else if (action === 'archive') {
                                void updateConversation({
                                  archived: conversation.archivedAt === null,
                                  id: conversation.id,
                                  type: 'archive',
                                });
                              } else if (action === 'delete') {
                                onDelete(conversation.id);
                              }
                            }}
                            placement="bottom-end"
                            trigger={(props) => {
                              const label = `${translate('twine.conversationActions')}: ${conversation.title}`;
                              return (
                                <button
                                  aria-label={label}
                                  className="twine-history__more"
                                  type="button"
                                  {...props}
                                  {...getTooltipTargetProps(label, 'left')}
                                >
                                  <MaskedIcon
                                    className="twine-history__more-icon"
                                    icon={moreIcon}
                                  />
                                </button>
                              );
                            }}
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}
