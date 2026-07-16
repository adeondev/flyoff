import {
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from 'react';

import { highlightSource } from './markdown-highlight';

export interface SourceEditorProps {
  ariaLabel: string;
  autoFocus?: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onScroll?: (scrollTop: number) => void;
}

export function SourceEditor({
  ariaLabel,
  autoFocus = false,
  onChange,
  onKeyDown,
  onScroll,
  textareaRef,
  value,
}: SourceEditorProps) {
  const highlightRef = useRef<HTMLPreElement>(null);

  // highlightSource escapes every character of the note; the only markup in the
  // result is the line and token spans this module emits.
  const html = useMemo(() => highlightSource(value), [value]);

  useEffect(() => {
    const textarea = textareaRef.current;
    const highlight = highlightRef.current;

    if (textarea && highlight) {
      highlight.scrollTop = textarea.scrollTop;
      highlight.scrollLeft = textarea.scrollLeft;
    }
  }, [html, textareaRef]);

  return (
    <div className="markdown-source">
      <pre
        aria-hidden="true"
        className="markdown-source__highlight"
        dangerouslySetInnerHTML={{ __html: html }}
        ref={highlightRef}
      />
      <textarea
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        className="markdown-source__input"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onScroll={(event) => {
          const highlight = highlightRef.current;
          if (highlight) {
            highlight.scrollTop = event.currentTarget.scrollTop;
            highlight.scrollLeft = event.currentTarget.scrollLeft;
          }
          onScroll?.(event.currentTarget.scrollTop);
        }}
        ref={textareaRef}
        spellCheck={false}
        value={value}
      />
    </div>
  );
}
