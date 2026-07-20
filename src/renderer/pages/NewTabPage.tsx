import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import flickBooks from '../../../public/images/flick/flick_books.png';
import searchIcon from '../../../public/images/icons/actions/search.svg';
import noteIcon from '../../../public/images/icons/instances/note.svg';
import { MaskedIcon } from '../components/MaskedIcon';
import { TwemojiText } from '../components/twemoji';
import type { InternalPageProps } from './page-types';

export interface NewTabNoteItem {
  nodeId: string;
  name: string;
  path: string;
  excerpt?: string;
  line?: number;
}

export interface NewTabSearchOutcome {
  results: readonly NewTabNoteItem[];
  skippedLockedCount: number;
}

export interface NewTabPageProps extends InternalPageProps {
  frequentNotes?: readonly NewTabNoteItem[];
  recentNotes?: readonly NewTabNoteItem[];
  onOpenNote?: (note: NewTabNoteItem) => void;
  onSearch?: (query: string) => Promise<NewTabSearchOutcome>;
}

const SEARCH_DELAY_MS = 120;

export function NewTabPage({
  active,
  frequentNotes = [],
  onOpenNote,
  onSearch,
  recentNotes = [],
  translate,
}: NewTabPageProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const searchSequenceRef = useRef(0);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly NewTabNoteItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [skippedLockedCount, setSkippedLockedCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const normalizedQuery = query.trim();

  useEffect(() => {
    if (active) {
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [active]);

  useEffect(() => {
    if (!normalizedQuery || !onSearch) {
      return;
    }

    const sequence = searchSequenceRef.current;
    let disposed = false;
    const timer = window.setTimeout(() => {
      void onSearch(normalizedQuery)
        .then((outcome) => {
          if (disposed || searchSequenceRef.current !== sequence) {
            return;
          }
          setResults(outcome.results);
          setSkippedLockedCount(outcome.skippedLockedCount);
          setSearching(false);
        })
        .catch(() => {
          if (disposed || searchSequenceRef.current !== sequence) {
            return;
          }
          setResults([]);
          setSkippedLockedCount(0);
          setSearching(false);
        });
    }, SEARCH_DELAY_MS);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [normalizedQuery, onSearch]);

  const selectableItems = useMemo(
    () =>
      normalizedQuery
        ? results
        : [...frequentNotes, ...recentNotes],
    [frequentNotes, normalizedQuery, recentNotes, results],
  );

  function openNote(note: NewTabNoteItem): void {
    onOpenNote?.(note);
  }

  function handleSearchKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
  ): void {
    if (event.key === 'Escape') {
      if (query) {
        event.preventDefault();
        setQuery('');
      }
      return;
    }
    if (
      selectableItems.length > 0 &&
      (event.key === 'ArrowDown' || event.key === 'ArrowUp')
    ) {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => {
        const start = current < 0 ? (direction > 0 ? -1 : 0) : current;
        return (
          (start + direction + selectableItems.length) %
          selectableItems.length
        );
      });
      return;
    }
    if (event.key === 'Enter' && activeIndex >= 0) {
      const note = selectableItems[activeIndex];
      if (note) {
        event.preventDefault();
        openNote(note);
      }
    }
  }

  function renderNote(
    note: NewTabNoteItem,
    index: number,
  ) {
    return (
      <button
        aria-selected={activeIndex === index}
        className="new-tab-page__note"
        id={`new-tab-note-${note.nodeId}`}
        key={note.nodeId}
        onClick={() => openNote(note)}
        onFocus={() => setActiveIndex(index)}
        onPointerMove={() => setActiveIndex(index)}
        role="option"
        type="button"
      >
        <span aria-hidden="true" className="new-tab-page__note-icon">
          <MaskedIcon icon={noteIcon} />
        </span>
        <span className="new-tab-page__note-body">
          <TwemojiText className="new-tab-page__note-name" text={note.name} />
          <TwemojiText className="new-tab-page__note-path" text={note.path} />
          {note.excerpt ? (
            <span className="new-tab-page__note-excerpt">
              {note.line ? `${note.line}: ` : ''}
              <TwemojiText text={note.excerpt} />
            </span>
          ) : null}
        </span>
      </button>
    );
  }

  const recentOffset = frequentNotes.length;

  return (
    <section className="new-tab-page">
      <div className="new-tab-page__content">
        <label className="new-tab-page__search">
          <MaskedIcon
            className="new-tab-page__search-icon"
            icon={searchIcon}
          />
          <input
            aria-activedescendant={
              activeIndex >= 0
                ? `new-tab-note-${selectableItems[activeIndex]?.nodeId}`
                : undefined
            }
            aria-label={translate('pages.searchDen')}
            onChange={(event) => {
              const next = event.target.value;
              const hasQuery = next.trim().length > 0;
              searchSequenceRef.current += 1;
              setQuery(next);
              setActiveIndex(-1);
              setResults([]);
              setSkippedLockedCount(0);
              setSearching(Boolean(onSearch && hasQuery));
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder={translate('pages.searchDen')}
            ref={inputRef}
            spellCheck={false}
            type="search"
            value={query}
          />
        </label>

        {normalizedQuery ? (
          <div
            aria-label={translate('pages.searchResults')}
            className="new-tab-page__results"
            role="listbox"
          >
            {results.map((note, index) => renderNote(note, index))}
            {!searching && results.length === 0 ? (
              <p className="new-tab-page__empty">
                {translate('projects.noSearchResults')}
              </p>
            ) : null}
            {searching ? (
              <p className="new-tab-page__empty">
                {translate('projects.searching')}
              </p>
            ) : null}
            {skippedLockedCount > 0 ? (
              <p className="new-tab-page__locked">
                {translate('projects.searchLockedSkipped')}
              </p>
            ) : null}
          </div>
        ) : (
          <>
            <div className="new-tab-page__activity">
              <section>
                <h2>{translate('pages.frequentNotes')}</h2>
                <div role="listbox">
                  {frequentNotes.length > 0 ? (
                    frequentNotes.map((note, index) =>
                      renderNote(note, index),
                    )
                  ) : (
                    <p className="new-tab-page__empty">
                      {translate('pages.noFrequentNotes')}
                    </p>
                  )}
                </div>
              </section>
              <section>
                <h2>{translate('pages.recentlyClosed')}</h2>
                <div role="listbox">
                  {recentNotes.length > 0 ? (
                    recentNotes.map((note, index) =>
                      renderNote(note, recentOffset + index),
                    )
                  ) : (
                    <p className="new-tab-page__empty">
                      {translate('pages.noRecentlyClosed')}
                    </p>
                  )}
                </div>
              </section>
            </div>
            <div className="new-tab-page__books-frame">
              <img
                alt=""
                aria-hidden="true"
                className="new-tab-page__books"
                src={flickBooks}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
