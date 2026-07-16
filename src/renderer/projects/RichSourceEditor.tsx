import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from 'react';

import { highlightSource } from './markdown-highlight';
import {
  readCaret,
  readSelection,
  readSource,
  replaceRange,
  writeCaret,
} from './source-caret';

export interface RichSourceEditorProps {
  ariaLabel: string;
  autoFocus?: boolean;
  editorRef: RefObject<HTMLDivElement | null>;
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  onScroll?: (scrollTop: number) => void;
}

// highlightSource escapes every character of the note, so the only markup it
// produces is the line and token spans this module owns.
function render(root: HTMLElement, source: string, caret?: number): void {
  root.innerHTML = highlightSource(source);

  if (caret !== undefined) {
    writeCaret(root, caret);
  }
}

export function RichSourceEditor({
  ariaLabel,
  autoFocus = false,
  editorRef,
  onChange,
  onKeyDown,
  onScroll,
  value,
}: RichSourceEditorProps) {
  const composingRef = useRef(false);
  const changeRef = useRef(onChange);

  useEffect(() => {
    changeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const root = editorRef.current;

    if (root && readSource(root) !== value) {
      render(root, value);
    }
  }, [editorRef, value]);

  useEffect(() => {
    const root = editorRef.current;

    if (!root) {
      return;
    }

    function commit(source: string, caret: number): void {
      if (root) {
        render(root, source, caret);
      }
      changeRef.current(source);
    }

    function handleInput(): void {
      if (!root || composingRef.current) {
        return;
      }

      commit(readSource(root), readCaret(root));
    }

    // The browser decides its own structure for Enter, so the newline is
    // applied to the source instead and the editor re-renders from that.
    function handleBeforeInput(event: InputEvent): void {
      if (
        !root ||
        (event.inputType !== 'insertParagraph' &&
          event.inputType !== 'insertLineBreak')
      ) {
        return;
      }

      event.preventDefault();
      const { end, start } = readSelection(root);
      commit(replaceRange(readSource(root), start, end, '\n'), start + 1);
    }

    function handleCompositionStart(): void {
      composingRef.current = true;
    }

    function handleCompositionEnd(): void {
      composingRef.current = false;
      handleInput();
    }

    root.addEventListener('input', handleInput);
    root.addEventListener('beforeinput', handleBeforeInput);
    root.addEventListener('compositionstart', handleCompositionStart);
    root.addEventListener('compositionend', handleCompositionEnd);

    return () => {
      root.removeEventListener('input', handleInput);
      root.removeEventListener('beforeinput', handleBeforeInput);
      root.removeEventListener('compositionstart', handleCompositionStart);
      root.removeEventListener('compositionend', handleCompositionEnd);
    };
  }, [editorRef]);

  useEffect(() => {
    if (autoFocus) {
      editorRef.current?.focus();
    }
  }, [autoFocus, editorRef]);

  return (
    <div
      aria-label={ariaLabel}
      aria-multiline="true"
      className="markdown-source__editor"
      contentEditable="plaintext-only"
      onKeyDown={onKeyDown}
      onScroll={(event) => onScroll?.(event.currentTarget.scrollTop)}
      ref={editorRef}
      role="textbox"
      spellCheck={false}
      suppressContentEditableWarning
      tabIndex={0}
    />
  );
}
