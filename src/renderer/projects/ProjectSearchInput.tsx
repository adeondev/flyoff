import { useRef, useState, type KeyboardEvent } from 'react';

import searchIcon from '../../../public/images/icons/actions/search.svg';
import { MaskedIcon } from '../components/MaskedIcon';
import type { Translate } from '../pages/page-types';
import { useFlyoffPreferences } from '../preferences';

interface SearchSuggestion {
  descriptionKey: Parameters<Translate>[0];
  id: string;
  insertion: string;
  label: string;
  caretOffset?: number;
}

const SUGGESTIONS: readonly SearchSuggestion[] = [
  {
    descriptionKey: 'projects.searchPathDescription',
    id: 'path',
    insertion: 'path:',
    label: 'path:',
  },
  {
    descriptionKey: 'projects.searchFileDescription',
    id: 'file',
    insertion: 'file:',
    label: 'file:',
  },
  {
    descriptionKey: 'projects.searchTagDescription',
    id: 'tag',
    insertion: 'tag:',
    label: 'tag:',
  },
  {
    caretOffset: -1,
    descriptionKey: 'projects.searchLineDescription',
    id: 'line',
    insertion: 'line:()',
    label: 'line:',
  },
  {
    caretOffset: -1,
    descriptionKey: 'projects.searchSectionDescription',
    id: 'section',
    insertion: 'section:()',
    label: 'section:',
  },
  {
    caretOffset: -1,
    descriptionKey: 'projects.searchPropertyDescription',
    id: 'property',
    insertion: '[]',
    label: '[property]',
  },
];

export interface ProjectSearchInputProps {
  searching: boolean;
  skippedLockedCount: number;
  translate: Translate;
  value: string;
  onChange: (value: string) => void;
}

export function ProjectSearchInput({
  onChange,
  searching,
  skippedLockedCount,
  translate,
  value,
}: ProjectSearchInputProps) {
  const { preferences } = useFlyoffPreferences();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const showTips = preferences.workspace.showSearchTips;
  const suggestionsOpen = showTips && open && value.length === 0;

  function insertSuggestion(suggestion: SearchSuggestion): void {
    const input = inputRef.current;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? start;
    const prefix =
      start > 0 && !/\s/u.test(value[start - 1]!) ? ' ' : '';
    const insertion = `${prefix}${suggestion.insertion}`;
    const next = `${value.slice(0, start)}${insertion}${value.slice(end)}`;
    const caret =
      start +
      insertion.length +
      (suggestion.caretOffset ?? 0);

    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(caret, caret);
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape' && suggestionsOpen) {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (
      showTips &&
      value.length === 0 &&
      (event.key === 'ArrowDown' || event.key === 'ArrowUp')
    ) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => {
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        return (current + direction + SUGGESTIONS.length) % SUGGESTIONS.length;
      });
      return;
    }
    if (event.key === 'Enter' && suggestionsOpen && activeIndex >= 0) {
      event.preventDefault();
      insertSuggestion(SUGGESTIONS[activeIndex]!);
    }
  }

  return (
    <div
      className="project-sidebar__search-composer"
      onBlur={(event) => {
        if (
          !event.relatedTarget ||
          !rootRef.current?.contains(event.relatedTarget as Node)
        ) {
          setOpen(false);
          setActiveIndex(-1);
        }
      }}
      ref={rootRef}
    >
      <label className="project-sidebar__search">
        <MaskedIcon
          className="project-sidebar__search-icon"
          icon={searchIcon}
        />
        <input
          aria-controls={
            suggestionsOpen ? 'project-search-suggestions' : undefined
          }
          aria-expanded={suggestionsOpen}
          aria-label={translate('projects.searchProject')}
          aria-owns={
            suggestionsOpen ? 'project-search-suggestions' : undefined
          }
          onChange={(event) => {
            const next = event.target.value;
            onChange(next);
            setOpen(showTips && next.length === 0);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(showTips && value.length === 0)}
          onKeyDown={handleKeyDown}
          placeholder={translate('projects.searchProject')}
          ref={inputRef}
          spellCheck={false}
          type="search"
          value={value}
        />
      </label>
      {suggestionsOpen ? (
        <div
          aria-label={translate('projects.searchOptions')}
          className="project-sidebar__search-options"
          id="project-search-suggestions"
          role="listbox"
        >
          <p>{translate('projects.searchOptions')}</p>
          {SUGGESTIONS.map((suggestion, index) => (
            <button
              aria-selected={activeIndex === index}
              className="project-sidebar__search-option"
              key={suggestion.id}
              onClick={() => insertSuggestion(suggestion)}
              onPointerMove={() => setActiveIndex(index)}
              role="option"
              type="button"
            >
              <code>{suggestion.label}</code>
              <span>{translate(suggestion.descriptionKey)}</span>
            </button>
          ))}
        </div>
      ) : null}
      {skippedLockedCount > 0 && !suggestionsOpen ? (
        <p className="project-sidebar__search-status" role="status">
          {translate('projects.searchLockedSkipped')}
        </p>
      ) : null}
      <span className="project-sidebar__search-progress" aria-live="polite">
        {searching ? translate('projects.searching') : ''}
      </span>
    </div>
  );
}
