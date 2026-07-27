import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';

import searchIcon from '../../../public/images/icons/actions/search.svg';
import { MaskedIcon } from '../components/MaskedIcon';

export interface SearchComposerSuggestion {
  description: string;
  id: string;
  insertion: string;
  label: string;
  caretOffset?: number;
}

export interface SearchComposerProps {
  ariaLabel: string;
  optionsLabel: string;
  placeholder: string;
  suggestions: readonly SearchComposerSuggestion[];
  value: string;
  onChange: (value: string) => void;
  progressText?: string;
  showSuggestions?: boolean;
  statusText?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
}

export function SearchComposer({
  ariaLabel,
  onChange,
  optionsLabel,
  placeholder,
  progressText = '',
  showSuggestions = true,
  statusText,
  suggestions,
  value,
  inputRef: externalInputRef,
}: SearchComposerProps) {
  const generatedId = useId();
  const optionsId = `flyoff-search-options-${generatedId}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const suggestionsOpen =
    showSuggestions && open && value.length === 0 && suggestions.length > 0;

  function input(): HTMLInputElement | null {
    return externalInputRef?.current ?? inputRef.current;
  }

  function insertSuggestion(suggestion: SearchComposerSuggestion): void {
    const inputElement = input();
    const start = inputElement?.selectionStart ?? value.length;
    const end = inputElement?.selectionEnd ?? start;
    const prefix =
      start > 0 && !/\s/u.test(value[start - 1]!) ? ' ' : '';
    const insertion = `${prefix}${suggestion.insertion}`;
    const next = `${value.slice(0, start)}${insertion}${value.slice(end)}`;
    const caret = start + insertion.length + (suggestion.caretOffset ?? 0);

    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => {
      inputElement?.focus();
      inputElement?.setSelectionRange(caret, caret);
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape' && suggestionsOpen) {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (
      showSuggestions &&
      value.length === 0 &&
      (event.key === 'ArrowDown' || event.key === 'ArrowUp')
    ) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => {
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        return (current + direction + suggestions.length) % suggestions.length;
      });
      return;
    }
    if (event.key === 'Enter' && suggestionsOpen && activeIndex >= 0) {
      event.preventDefault();
      insertSuggestion(suggestions[activeIndex]!);
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
          aria-controls={suggestionsOpen ? optionsId : undefined}
          aria-expanded={suggestionsOpen}
          aria-label={ariaLabel}
          aria-owns={suggestionsOpen ? optionsId : undefined}
          onChange={(event) => {
            const next = event.currentTarget.value;
            onChange(next);
            setOpen(showSuggestions && next.length === 0);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(showSuggestions && value.length === 0)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          ref={(element) => {
            inputRef.current = element;
            if (externalInputRef) {
              externalInputRef.current = element;
            }
          }}
          spellCheck={false}
          type="search"
          value={value}
        />
      </label>
      {suggestionsOpen ? (
        <div
          aria-label={optionsLabel}
          className="project-sidebar__search-options"
          id={optionsId}
          role="listbox"
        >
          <p>{optionsLabel}</p>
          {suggestions.map((suggestion, index) => (
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
              <span>{suggestion.description}</span>
            </button>
          ))}
        </div>
      ) : null}
      {statusText && !suggestionsOpen ? (
        <p className="project-sidebar__search-status" role="status">
          {statusText}
        </p>
      ) : null}
      <span className="project-sidebar__search-progress" aria-live="polite">
        {progressText}
      </span>
    </div>
  );
}
