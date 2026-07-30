import { describe, expect, it } from 'vitest';

import {
  MarkdownHistoryStore,
  type SourceEditTransaction,
  type SourceEditorState,
} from '../../src/renderer/projects/markdown-history';
import type { SourceSelection } from '../../src/renderer/projects/source-caret';

function selection(
  start: number,
  end = start,
  direction: SourceSelection['direction'] = start === end ? 'none' : 'forward',
): SourceSelection {
  return { start, end, direction };
}

function transaction(
  before: string,
  after: string,
  beforeSelection: SourceSelection,
  afterSelection: SourceSelection,
  inputType = 'insertText',
  timestamp = 0,
): SourceEditTransaction {
  return {
    before: { content: before, selection: beforeSelection },
    after: { content: after, selection: afterSelection },
    inputType,
    timestamp,
  };
}

describe('MarkdownHistoryStore', () => {
  it('coalesces contiguous typing inside 750 ms and restores selections', () => {
    const history = new MarkdownHistoryStore();
    history.record('note', transaction('', 'a', selection(0), selection(1)));
    history.record(
      'note',
      transaction('a', 'ab', selection(1), selection(2), 'insertText', 500),
    );

    expect(
      history.undo('note', { content: 'ab', selection: selection(2) }),
    ).toEqual({ content: '', selection: selection(0) });
    expect(history.canUndo('note')).toBe(false);
    expect(
      history.redo('note', { content: '', selection: selection(0) }),
    ).toEqual({ content: 'ab', selection: selection(2) });
  });

  it('coalesces typing that continues inside newly inserted markup', () => {
    const history = new MarkdownHistoryStore();
    history.record(
      'note',
      transaction(
        '',
        '[a]{color=#8F4FC4}',
        selection(0),
        selection(2),
      ),
    );
    history.record(
      'note',
      transaction(
        '[a]{color=#8F4FC4}',
        '[ab]{color=#8F4FC4}',
        selection(2),
        selection(3),
        'insertText',
        100,
      ),
    );

    expect(
      history.undo('note', {
        content: '[ab]{color=#8F4FC4}',
        selection: selection(3),
      }),
    ).toEqual({ content: '', selection: selection(0) });
  });

  it('keeps large-note typing local while preserving complete undo and redo', () => {
    const lines = Array.from(
      { length: 15_000 },
      (_, index) => `line ${index}`,
    );
    const before = lines.join('\n');
    const start = before.indexOf('line 7500') + 'line '.length;
    const after =
      before.slice(0, start) + 'X' + before.slice(start);
    const history = new MarkdownHistoryStore();

    history.record(
      'note',
      transaction(
        before,
        after,
        selection(start),
        selection(start + 1),
      ),
    );

    const undone = history.undo('note', {
      content: after,
      selection: selection(start + 1),
    });
    expect(undone).toEqual({
      content: before,
      selection: selection(start),
    });
    expect(history.redo('note', undone!)).toEqual({
      content: after,
      selection: selection(start + 1),
    });
  });

  it('derives local history around CRLF, multiline input and line deletion', () => {
    const history = new MarkdownHistoryStore();
    const first = 'one\r\ntwo\r\nthree';
    const insertion = first.indexOf('two') + 1;
    const second =
      first.slice(0, insertion) + '\nnew' + first.slice(insertion);
    history.record(
      'note',
      transaction(
        first,
        second,
        selection(insertion),
        selection(insertion + 4),
        'insertFromPaste',
      ),
    );

    const lineStart = second.indexOf('two');
    const lineEnd = second.indexOf('\r\n', lineStart) + 2;
    const third = second.slice(0, lineStart) + second.slice(lineEnd);
    history.record(
      'note',
      transaction(
        second,
        third,
        selection(lineStart + 1),
        selection(lineStart),
        'deleteEntireSoftLine',
        100,
      ),
    );

    const restoredSecond = history.undo('note', {
      content: third,
      selection: selection(lineStart),
    });
    expect(restoredSecond?.content).toBe(second);
    expect(history.undo('note', restoredSecond!)?.content).toBe(first);
  });

  it('does not coalesce after the window or after a moved selection', () => {
    const history = new MarkdownHistoryStore();
    history.record('note', transaction('', 'a', selection(0), selection(1)));
    history.record(
      'note',
      transaction('a', 'ab', selection(0), selection(2), 'insertText', 751),
    );

    const first = history.undo('note', {
      content: 'ab',
      selection: selection(2),
    });
    expect(first?.content).toBe('a');
    expect(history.undo('note', first!)).toEqual({
      content: '',
      selection: selection(0),
    });
  });

  it('coalesces backward deletion in its editing direction', () => {
    const history = new MarkdownHistoryStore();
    history.record(
      'note',
      transaction(
        'abc',
        'ab',
        selection(3),
        selection(2),
        'deleteContentBackward',
      ),
    );
    history.record(
      'note',
      transaction(
        'ab',
        'a',
        selection(2),
        selection(1),
        'deleteContentBackward',
        100,
      ),
    );

    expect(
      history.undo('note', { content: 'a', selection: selection(1) }),
    ).toEqual({ content: 'abc', selection: selection(3) });
  });

  it('keeps Enter, paste, toolbar and IME as independent steps', () => {
    const history = new MarkdownHistoryStore();
    const operations = [
      ['', '\n', 'insertParagraph'],
      ['\n', '\npaste', 'insertFromPaste'],
      ['\npaste', '**\npaste**', 'toolbar:strong'],
      ['**\npaste**', '**\npaste**字', 'insertCompositionText'],
    ] as const;

    for (const [before, after, inputType] of operations) {
      history.record(
        'note',
        transaction(
          before,
          after,
          selection(before.length),
          selection(after.length),
          inputType,
        ),
      );
    }

    let state: SourceEditorState = {
      content: operations.at(-1)![1],
      selection: selection(operations.at(-1)![1].length),
    };
    for (const [expected] of [...operations].reverse()) {
      state = history.undo('note', state)!;
      expect(state.content).toBe(expected);
    }
  });

  it('invalidates redo after a fresh edit and isolates notes', () => {
    const history = new MarkdownHistoryStore();
    history.record('one', transaction('', 'a', selection(0), selection(1)));
    history.record('two', transaction('', 'b', selection(0), selection(1)));
    expect(
      history.undo('one', { content: 'a', selection: selection(1) }),
    )?.toMatchObject({ content: '' });

    history.record(
      'one',
      transaction('', 'x', selection(0), selection(1), 'insertFromPaste'),
    );

    expect(history.canRedo('one')).toBe(false);
    expect(history.canUndo('two')).toBe(true);
  });

  it('clears a divergent timeline without modifying content', () => {
    const history = new MarkdownHistoryStore();
    history.record('note', transaction('a', 'ab', selection(1), selection(2)));

    expect(
      history.undo('note', { content: 'external', selection: selection(0) }),
    ).toBeUndefined();
    expect(history.canUndo('note')).toBe(false);
    expect(history.canRedo('note')).toBe(false);
  });

  it('evicts the least-recently-used payload when the byte limit is hit', () => {
    const history = new MarkdownHistoryStore(4);
    history.record(
      'old',
      transaction('', 'abc', selection(0), selection(3), 'insertFromPaste'),
    );
    history.record(
      'new',
      transaction('', 'd', selection(0), selection(1), 'insertFromPaste'),
    );

    expect(history.canUndo('old')).toBe(false);
    expect(history.canUndo('new')).toBe(true);
  });

  it('retains at most one thousand transactions per note', () => {
    const history = new MarkdownHistoryStore();
    let content = '';

    for (let index = 0; index < 1_001; index += 1) {
      const next = `${content}x`;
      history.record(
        'note',
        transaction(
          content,
          next,
          selection(content.length),
          selection(next.length),
          'insertFromPaste',
          index,
        ),
      );
      content = next;
    }

    let state: SourceEditorState = {
      content,
      selection: selection(content.length),
    };
    for (let index = 0; index < 1_000; index += 1) {
      state = history.undo('note', state)!;
    }
    expect(state.content).toBe('x');
    expect(history.canUndo('note')).toBe(false);
  });
});
