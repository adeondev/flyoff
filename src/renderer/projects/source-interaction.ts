import {
  readSelection,
  readSource,
  sourceOffsetAtPoint,
  writeSelection,
  type SourceSelection,
} from './source-caret';
import {
  expandDoubleClickSelection,
  expandTripleClickSelection,
} from './source-word-selection';

const NAVIGATION_KEYS = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
]);

interface KeyboardNavigation {
  ctrlKey: boolean;
  defaultPrevented: boolean;
  key: string;
  metaKey: boolean;
}

interface SourceMouseSelectionOptions {
  getContent?: () => string;
  isComposing: () => boolean;
  onSelectionChange: (
    content: string,
    selection: SourceSelection,
  ) => void;
}

function collapsedSelection(offset: number): SourceSelection {
  return { start: offset, end: offset, direction: 'none' };
}

function selectionAnchor(selection: SourceSelection): number {
  return selection.direction === 'backward'
    ? selection.end
    : selection.start;
}

function selectionFocus(selection: SourceSelection): number {
  return selection.direction === 'backward'
    ? selection.start
    : selection.end;
}

function directedSelection(
  anchor: number,
  focus: number,
): SourceSelection {
  return {
    start: Math.min(anchor, focus),
    end: Math.max(anchor, focus),
    direction:
      anchor === focus
        ? 'none'
        : anchor < focus
          ? 'forward'
          : 'backward',
  };
}

function revealSelectionFocus(root: HTMLElement): void {
  const selection = root.ownerDocument.getSelection();
  const focusNode = selection?.focusNode;
  if (
    !selection ||
    !focusNode ||
    (focusNode !== root && !root.contains(focusNode))
  ) {
    return;
  }

  const range = root.ownerDocument.createRange();
  try {
    range.setStart(focusNode, selection.focusOffset);
    range.collapse(true);
  } catch {
    return;
  }

  const fallback =
    focusNode.nodeType === Node.ELEMENT_NODE
      ? (focusNode as Element)
      : focusNode.parentElement;
  const caretBounds =
    range.getClientRects()[0] ??
    fallback?.closest('.md-line')?.getBoundingClientRect();
  if (!caretBounds) {
    return;
  }

  const editorBounds = root.getBoundingClientRect();
  if (caretBounds.top < editorBounds.top) {
    root.scrollTop -= editorBounds.top - caretBounds.top;
  } else if (caretBounds.bottom > editorBounds.bottom) {
    root.scrollTop += caretBounds.bottom - editorBounds.bottom;
  }

  if (caretBounds.left < editorBounds.left) {
    root.scrollLeft -= editorBounds.left - caretBounds.left;
  } else if (caretBounds.right > editorBounds.right) {
    root.scrollLeft += caretBounds.right - editorBounds.right;
  }
}

export function revealSourceSelectionAfterNavigation(
  editor: HTMLElement,
  event: KeyboardNavigation,
): void {
  if (event.defaultPrevented || !NAVIGATION_KEYS.has(event.key)) {
    return;
  }

  const platform =
    editor.ownerDocument.documentElement.dataset.platform;
  const documentStart =
    platform === 'darwin'
      ? event.metaKey && event.key === 'ArrowUp'
      : event.ctrlKey && event.key === 'Home';
  const documentEnd =
    platform === 'darwin'
      ? event.metaKey && event.key === 'ArrowDown'
      : event.ctrlKey && event.key === 'End';
  editor.ownerDocument.defaultView?.requestAnimationFrame(() => {
    revealSelectionFocus(editor);
    if (documentStart) {
      editor.scrollTop = 0;
    } else if (documentEnd) {
      editor.scrollTop = editor.scrollHeight;
    }
  });
}

export function installSourceMouseSelection(
  editor: HTMLElement,
  options: SourceMouseSelectionOptions,
): () => void {
  let drag:
    | {
      anchor: number;
      content: string;
    }
    | undefined;

  function publish(
    content: string,
    next: SourceSelection,
  ): void {
    const current = readSelection(editor);
    if (
      next.start === current.start &&
      next.end === current.end &&
      next.direction === current.direction
    ) {
      return;
    }
    writeSelection(editor, next);
    options.onSelectionChange(content, next);
  }

  function handleMouseDown(event: MouseEvent): void {
    if (event.button !== 0 || options.isComposing()) {
      return;
    }

    const content = options.getContent?.() ?? readSource(editor);
    const current = readSelection(editor);
    const offset =
      sourceOffsetAtPoint(editor, event.clientX, event.clientY) ??
      selectionFocus(current);

    if (event.detail === 1) {
      const anchor = event.shiftKey ? selectionAnchor(current) : offset;
      event.preventDefault();
      editor.focus({ preventScroll: true });
      publish(content, directedSelection(anchor, offset));
      drag = { anchor, content };
      return;
    }

    drag = undefined;
    if (event.detail !== 2 && event.detail !== 3) {
      return;
    }

    event.preventDefault();
    editor.focus({ preventScroll: true });
    const pointed = collapsedSelection(offset);
    publish(
      content,
      event.detail === 2
        ? expandDoubleClickSelection(content, pointed)
        : expandTripleClickSelection(content, pointed),
    );
  }

  function handleMouseMove(event: MouseEvent): void {
    if (!drag || (event.buttons & 1) === 0) {
      return;
    }

    const offset = sourceOffsetAtPoint(
      editor,
      event.clientX,
      event.clientY,
    );
    if (offset === undefined) {
      return;
    }

    event.preventDefault();
    publish(
      drag.content,
      directedSelection(drag.anchor, offset),
    );
  }

  function handleMouseUp(event: MouseEvent): void {
    if (event.button === 0) {
      drag = undefined;
    }
  }

  function handleDoubleClick(event: MouseEvent): void {
    if (event.button === 0) {
      event.preventDefault();
    }
  }

  function handleWindowBlur(): void {
    drag = undefined;
  }

  editor.addEventListener('mousedown', handleMouseDown);
  editor.addEventListener('dblclick', handleDoubleClick);
  editor.ownerDocument.addEventListener('mousemove', handleMouseMove);
  editor.ownerDocument.addEventListener('mouseup', handleMouseUp);
  editor.ownerDocument.defaultView?.addEventListener(
    'blur',
    handleWindowBlur,
  );

  return () => {
    editor.removeEventListener('mousedown', handleMouseDown);
    editor.removeEventListener('dblclick', handleDoubleClick);
    editor.ownerDocument.removeEventListener('mousemove', handleMouseMove);
    editor.ownerDocument.removeEventListener('mouseup', handleMouseUp);
    editor.ownerDocument.defaultView?.removeEventListener(
      'blur',
      handleWindowBlur,
    );
  };
}
