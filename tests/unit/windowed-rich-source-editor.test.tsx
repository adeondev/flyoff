// @vitest-environment jsdom

import { createRef, useState } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RichSourceEditor } from '../../src/renderer/projects/RichSourceEditor';
import {
  readSelection,
  readSource,
  writeSelection,
} from '../../src/renderer/projects/source-caret';
import type { Translate } from '../../src/renderer/pages/page-types';
import type { FlyoffApi } from '../../src/shared/contracts';

const translate: Translate = (key) => key;

function largeSource(lines = 15_000): string {
  return Array.from(
    { length: lines },
    (_, index) =>
      index % 41 === 0
        ? `## Heading ${index}`
        : `Line ${index} with **Markdown**, ==color== and a [[link]].`,
  ).join('\n');
}

function deferred<T>() {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('windowed rich source editor', () => {
  afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.performanceDiagnosticAblation;
    Reflect.deleteProperty(window, 'flyoff');
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('uses an empty static rectangle for the diagnostic editor ablation', () => {
    document.documentElement.dataset.performanceDiagnosticAblation =
      'editor-static';
    const editorRef = createRef<HTMLDivElement>();
    const value = largeSource();

    render(
      <RichSourceEditor
        ariaLabel="Editor"
        editorRef={editorRef}
        nodeId="large-note"
        onRedo={vi.fn()}
        onSelectionChange={vi.fn()}
        onTransaction={vi.fn()}
        onUndo={vi.fn()}
        selection={{ direction: 'none', end: 0, start: 0 }}
        translate={translate}
        value={value}
      />,
    );

    const editor = editorRef.current!;
    expect(editor.dataset.performanceStaticEditor).toBe('true');
    expect(editor.childElementCount).toBe(0);
    expect(editor.querySelector('.source-window')).toBeNull();
    expect(
      (editor as HTMLDivElement & {
        __flyoffSourceLayoutWork?: unknown;
      }).__flyoffSourceLayoutWork,
    ).toBeUndefined();
  });

  it('keeps the complete model while mounting only a bounded viewport', () => {
    const editorRef = createRef<HTMLDivElement>();
    const value = largeSource();

    render(
      <RichSourceEditor
        ariaLabel="Editor"
        editorRef={editorRef}
        nodeId="large-note"
        onRedo={vi.fn()}
        onSelectionChange={vi.fn()}
        onTransaction={vi.fn()}
        onUndo={vi.fn()}
        selection={{ direction: 'none', end: 0, start: 0 }}
        translate={translate}
        value={value}
      />,
    );

    const editor = editorRef.current!;
    expect(editor.dataset.windowed).toBe('true');
    expect(readSource(editor)).toBe(value);
    expect(editor.querySelectorAll('.md-line').length).toBeLessThanOrEqual(
      300,
    );
    expect(editor.querySelectorAll('.md-line').length).toBeGreaterThan(0);
    expect(
      editor.querySelector<HTMLTextAreaElement>('.source-window__input')
        ?.value.length,
    ).toBeLessThanOrEqual(8_192);
    expect(editor.dataset.sourceLength).toBe(String(value.length));
  });

  it('reveals distant selections without mounting the intervening lines', () => {
    const editorRef = createRef<HTMLDivElement>();
    const value = largeSource();
    render(
      <RichSourceEditor
        ariaLabel="Editor"
        editorRef={editorRef}
        nodeId="large-note"
        onRedo={vi.fn()}
        onSelectionChange={vi.fn()}
        onTransaction={vi.fn()}
        onUndo={vi.fn()}
        selection={{ direction: 'none', end: 0, start: 0 }}
        translate={translate}
        value={value}
      />,
    );

    const editor = editorRef.current!;
    const target = value.indexOf('Line 14500');
    act(() => writeSelection(editor, target));

    const targetLine = value.slice(0, target).split('\n').length;
    expect(
      editor.querySelector(`.md-line[data-line="${targetLine}"]`),
    ).not.toBeNull();
    expect(editor.querySelectorAll('.md-line').length).toBeLessThanOrEqual(
      300,
    );
    expect(editor.scrollTop).toBeGreaterThan(0);
  });

  it('focuses a false-to-true autofocus transition without moving the viewport', () => {
    const editorRef = createRef<HTMLDivElement>();
    const value = largeSource(2_100);
    const properties = {
      ariaLabel: 'Editor',
      autoFocus: false,
      editorRef,
      nodeId: 'large-note',
      onRedo: vi.fn(),
      onSelectionChange: vi.fn(),
      onTransaction: vi.fn(),
      onUndo: vi.fn(),
      selection: { direction: 'none' as const, end: 0, start: 0 },
      translate,
      value,
    };
    const view = render(<RichSourceEditor {...properties} />);
    const editor = editorRef.current!;
    const input = editor.querySelector<HTMLTextAreaElement>(
      '.source-window__input',
    )!;
    const target = value.indexOf('Line 1900');
    editor.scrollTop = 12_345;

    view.rerender(
      <RichSourceEditor
        {...properties}
        autoFocus
        selection={{ direction: 'none', end: target, start: target }}
      />,
    );

    expect(editor.ownerDocument.activeElement).toBe(input);
    expect(readSelection(editor)).toEqual({
      direction: 'none',
      end: target,
      start: target,
    });
    expect(editor.scrollTop).toBe(12_345);
  });

  it.each([
    {
      label: 'note',
      next: {
        nodeId: 'second-note',
        projectId: 'project-a',
        viewId: 'primary',
      },
    },
    {
      label: 'project',
      next: {
        nodeId: 'first-note',
        projectId: 'project-b',
        viewId: 'primary',
      },
    },
    {
      label: 'view',
      next: {
        nodeId: 'first-note',
        projectId: 'project-a',
        viewId: 'secondary',
      },
    },
  ])(
    'does not reuse focused local selection across a $label identity change',
    ({ next }) => {
      const editorRef = createRef<HTMLDivElement>();
      const value = largeSource(2_100);
      const local = value.indexOf('Line 1700');
      const controlled = value.indexOf('Line 120');
      const properties = {
        ariaLabel: 'Editor',
        editorRef,
        nodeId: 'first-note',
        onRedo: vi.fn(),
        onSelectionChange: vi.fn(),
        onTransaction: vi.fn(),
        onUndo: vi.fn(),
        projectId: 'project-a',
        selection: { direction: 'none' as const, end: 0, start: 0 },
        translate,
        value,
        viewId: 'primary',
      };
      const view = render(<RichSourceEditor {...properties} />);
      const editor = editorRef.current!;
      const input = editor.querySelector<HTMLTextAreaElement>(
        '.source-window__input',
      )!;
      act(() => {
        input.focus();
        writeSelection(editor, local);
      });

      view.rerender(
        <RichSourceEditor
          {...properties}
          {...next}
          selection={{
            direction: 'none',
            end: controlled,
            start: controlled,
          }}
        />,
      );

      expect(readSelection(editorRef.current!)).toEqual({
        direction: 'none',
        end: controlled,
        start: controlled,
      });
    },
  );

  it('commits text input against model offsets', () => {
    const editorRef = createRef<HTMLDivElement>();
    const value = largeSource(2_100);
    const onTransaction = vi.fn();
    render(
      <RichSourceEditor
        ariaLabel="Editor"
        editorRef={editorRef}
        nodeId="large-note"
        onRedo={vi.fn()}
        onSelectionChange={vi.fn()}
        onTransaction={onTransaction}
        onUndo={vi.fn()}
        selection={{ direction: 'none', end: 0, start: 0 }}
        translate={translate}
        value={value}
      />,
    );

    const input = editorRef.current!.querySelector<HTMLTextAreaElement>(
      '.source-window__input',
    )!;
    act(() => {
      input.focus();
      input.setSelectionRange(0, 0);
      fireEvent(
        input,
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'X',
          inputType: 'insertText',
        }),
      );
    });

    expect(onTransaction).toHaveBeenCalledTimes(1);
    expect(onTransaction.mock.calls[0]?.[0].after.content).toBe(`X${value}`);
    expect(readSource(editorRef.current!)).toBe(`X${value}`);
  });

  it('promotes across 2,000 lines without losing focus or selection and keeps the mode sticky per note', () => {
    const editorRef = createRef<HTMLDivElement>();
    const initial = largeSource(1_999);
    const promoted = `${initial}\nFinal line`;
    const selection = initial.indexOf('Line 1800');
    const properties = {
      ariaLabel: 'Editor',
      editorRef,
      nodeId: 'promoted-note',
      onRedo: vi.fn(),
      onSelectionChange: vi.fn(),
      onTransaction: vi.fn(),
      onUndo: vi.fn(),
      selection: { direction: 'none' as const, end: 0, start: 0 },
      translate,
    };
    const view = render(
      <RichSourceEditor {...properties} value={initial} />,
    );

    const legacy = editorRef.current!;
    expect(legacy.dataset.windowed).toBeUndefined();
    act(() => {
      legacy.focus();
      writeSelection(legacy, selection);
    });

    view.rerender(
      <RichSourceEditor {...properties} value={promoted} />,
    );

    const windowed = editorRef.current!;
    const input = windowed.querySelector<HTMLTextAreaElement>(
      '.source-window__input',
    )!;
    expect(windowed).not.toBe(legacy);
    expect(windowed.dataset.windowed).toBe('true');
    expect(document.activeElement).toBe(input);
    expect(readSelection(windowed)).toEqual({
      direction: 'none',
      end: selection,
      start: selection,
    });

    view.rerender(<RichSourceEditor {...properties} value="" />);

    expect(editorRef.current).toBe(windowed);
    expect(editorRef.current!.dataset.windowed).toBe('true');
    expect(readSource(editorRef.current!)).toBe('');

    view.rerender(
      <RichSourceEditor
        {...properties}
        nodeId="other-note"
        value="Small note"
      />,
    );
    expect(editorRef.current!.dataset.windowed).toBeUndefined();

    view.rerender(
      <RichSourceEditor {...properties} value={initial} />,
    );
    expect(editorRef.current!.dataset.windowed).toBe('true');
  });

  it('uses the new controlled selection when an unfocused note is promoted', () => {
    const editorRef = createRef<HTMLDivElement>();
    const initial = largeSource(1_999);
    const promoted = `${initial}\nFinal line`;
    const target = promoted.indexOf('Line 1900');
    const properties = {
      ariaLabel: 'Editor',
      editorRef,
      nodeId: 'controlled-promotion',
      onRedo: vi.fn(),
      onSelectionChange: vi.fn(),
      onTransaction: vi.fn(),
      onUndo: vi.fn(),
      translate,
    };
    const view = render(
      <RichSourceEditor
        {...properties}
        selection={{ direction: 'none', end: 0, start: 0 }}
        value={initial}
      />,
    );

    view.rerender(
      <RichSourceEditor
        {...properties}
        selection={{ direction: 'none', end: target, start: target }}
        value={promoted}
      />,
    );

    expect(readSelection(editorRef.current!)).toEqual({
      direction: 'none',
      end: target,
      start: target,
    });
  });

  it('promotes after paste and remains windowed when undo shrinks below the threshold', () => {
    const editorRef = createRef<HTMLDivElement>();
    const initial = largeSource(1_999);
    let legacyLinesAtTransaction = 0;

    function Harness() {
      const [state, setState] = useState({
        content: initial,
        selection: {
          direction: 'none' as const,
          end: initial.length,
          start: initial.length,
        },
      });

      return (
        <RichSourceEditor
          ariaLabel="Editor"
          editorRef={editorRef}
          nodeId="pasted-note"
          onRedo={vi.fn()}
          onSelectionChange={(selection) =>
            setState((current) => ({ ...current, selection }))
          }
          onTransaction={({ after }) => {
            legacyLinesAtTransaction =
              editorRef.current?.querySelectorAll('.md-line').length ?? 0;
            setState(after);
          }}
          onUndo={() =>
            setState({
              content: initial,
              selection: {
                direction: 'none',
                end: initial.length,
                start: initial.length,
              },
            })
          }
          selection={state.selection}
          translate={translate}
          value={state.content}
        />
      );
    }

    render(<Harness />);
    const legacy = editorRef.current!;
    act(() => {
      legacy.focus();
      writeSelection(legacy, initial.length);
    });
    fireEvent.paste(legacy, {
      clipboardData: {
        getData: (format: string) =>
          format === 'text/plain' ? '\nFinal line' : '',
      },
    });

    const windowed = editorRef.current!;
    const input = windowed.querySelector<HTMLTextAreaElement>(
      '.source-window__input',
    )!;
    expect(windowed.dataset.windowed).toBe('true');
    expect(readSource(windowed)).toBe(`${initial}\nFinal line`);
    expect(document.activeElement).toBe(input);
    expect(legacyLinesAtTransaction).toBe(1_999);
    expect(readSelection(windowed)).toEqual({
      direction: 'none',
      end: initial.length + 11,
      start: initial.length + 11,
    });

    fireEvent(
      input,
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'historyUndo',
      }),
    );

    expect(editorRef.current).toBe(windowed);
    expect(editorRef.current!.dataset.windowed).toBe('true');
    expect(readSource(editorRef.current!)).toBe(initial);
  });

  it('promotes a large paste without materializing it in the legacy DOM', () => {
    const editorRef = createRef<HTMLDivElement>();
    const pasted = largeSource();
    let legacyLinesAtTransaction = 0;

    function Harness() {
      const [state, setState] = useState({
        content: '',
        selection: {
          direction: 'none' as const,
          end: 0,
          start: 0,
        },
      });

      return (
        <RichSourceEditor
          ariaLabel="Editor"
          editorRef={editorRef}
          nodeId="large-paste"
          onRedo={vi.fn()}
          onSelectionChange={(selection) =>
            setState((current) => ({ ...current, selection }))
          }
          onTransaction={({ after }) => {
            legacyLinesAtTransaction =
              editorRef.current?.querySelectorAll('.md-line').length ?? 0;
            setState(after);
          }}
          onUndo={vi.fn()}
          selection={state.selection}
          translate={translate}
          value={state.content}
        />
      );
    }

    render(<Harness />);
    const legacy = editorRef.current!;
    act(() => legacy.focus());
    fireEvent.paste(legacy, {
      clipboardData: {
        getData: (format: string) =>
          format === 'text/plain' ? pasted : '',
      },
    });

    const windowed = editorRef.current!;
    expect(legacyLinesAtTransaction).toBe(1);
    expect(windowed.dataset.windowed).toBe('true');
    expect(readSource(windowed)).toBe(pasted);
    expect(readSelection(windowed)).toEqual({
      direction: 'none',
      end: pasted.length,
      start: pasted.length,
    });
    expect(windowed.querySelectorAll('.md-line').length).toBeLessThanOrEqual(
      300,
    );
  });

  it('keeps IME input native until composition commits once', () => {
    vi.useFakeTimers();
    const editorRef = createRef<HTMLDivElement>();
    const value = largeSource(2_100);
    const onTransaction = vi.fn();
    render(
      <RichSourceEditor
        ariaLabel="Editor"
        editorRef={editorRef}
        nodeId="large-note"
        onRedo={vi.fn()}
        onSelectionChange={vi.fn()}
        onTransaction={onTransaction}
        onUndo={vi.fn()}
        selection={{ direction: 'none', end: 0, start: 0 }}
        translate={translate}
        value={value}
      />,
    );

    const editor = editorRef.current!;
    const input = editor.querySelector<HTMLTextAreaElement>(
      '.source-window__input',
    )!;
    const globalOffset = value.indexOf('Line 1800');
    act(() => {
      writeSelection(editor, globalOffset);
      input.focus();
      fireEvent.compositionStart(input, { data: '' });
    });
    const localOffset = input.selectionStart;
    const beforeComposition = input.value;

    act(() => {
      input.setRangeText('字', localOffset, localOffset, 'end');
      fireEvent.input(input, {
        data: '字',
        inputType: 'insertCompositionText',
        isComposing: true,
      });
    });

    expect(input.value).toBe(
      `${beforeComposition.slice(0, localOffset)}字${beforeComposition.slice(localOffset)}`,
    );
    expect(readSource(editor)).toBe(value);
    expect(onTransaction).not.toHaveBeenCalled();

    act(() => {
      fireEvent.compositionEnd(input, { data: '字' });
      vi.runAllTimers();
    });

    expect(onTransaction).toHaveBeenCalledTimes(1);
    expect(onTransaction.mock.calls[0]?.[0].after.content).toBe(
      `${value.slice(0, globalOffset)}字${value.slice(globalOffset)}`,
    );
  });

  it('discards native composition when controlled content changes', () => {
    vi.useFakeTimers();
    const editorRef = createRef<HTMLDivElement>();
    const value = largeSource(2_100);
    const external = `${value}\nExternal update`;
    const onTransaction = vi.fn();
    const properties = {
      ariaLabel: 'Editor',
      editorRef,
      nodeId: 'large-note',
      onRedo: vi.fn(),
      onSelectionChange: vi.fn(),
      onTransaction,
      onUndo: vi.fn(),
      selection: { direction: 'none' as const, end: 0, start: 0 },
      translate,
      viewId: 'primary',
    };
    const view = render(
      <RichSourceEditor {...properties} value={value} />,
    );
    const editor = editorRef.current!;
    const input = editor.querySelector<HTMLTextAreaElement>(
      '.source-window__input',
    )!;

    act(() => {
      input.focus();
      fireEvent.compositionStart(input, { data: '' });
      input.setRangeText('字', 0, 0, 'end');
      fireEvent.input(input, {
        data: '字',
        inputType: 'insertCompositionText',
        isComposing: true,
      });
    });
    view.rerender(
      <RichSourceEditor
        {...properties}
        selection={{
          direction: 'none',
          end: external.length,
          start: external.length,
        }}
        value={external}
      />,
    );
    act(() => {
      fireEvent.compositionEnd(input, { data: '字' });
      vi.runAllTimers();
    });

    expect(onTransaction).not.toHaveBeenCalled();
    expect(readSource(editorRef.current!)).toBe(external);

    act(() => {
      fireEvent(
        input,
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: '!',
          inputType: 'insertText',
        }),
      );
    });

    expect(onTransaction).toHaveBeenCalledTimes(1);
    expect(onTransaction.mock.calls[0]?.[0].after.content).toBe(
      `${external}!`,
    );
  });

  it.each([
    ['note', 'replacement-note', 'primary'],
    ['view', 'large-note', 'secondary'],
  ])(
    'invalidates composition when the controlled %s identity changes',
    (_identity, nextNodeId, nextViewId) => {
      vi.useFakeTimers();
      const editorRef = createRef<HTMLDivElement>();
      const value = largeSource(2_100);
      const onTransaction = vi.fn();
      const properties = {
        ariaLabel: 'Editor',
        editorRef,
        onRedo: vi.fn(),
        onSelectionChange: vi.fn(),
        onTransaction,
        onUndo: vi.fn(),
        selection: { direction: 'none' as const, end: 0, start: 0 },
        translate,
        value,
      };
      const view = render(
        <RichSourceEditor
          {...properties}
          nodeId="large-note"
          viewId="primary"
        />,
      );
      const input =
        editorRef.current!.querySelector<HTMLTextAreaElement>(
          '.source-window__input',
        )!;

      act(() => {
        input.focus();
        fireEvent.compositionStart(input, { data: '' });
        input.setRangeText('字', 0, 0, 'end');
        fireEvent.input(input, {
          data: '字',
          inputType: 'insertCompositionText',
          isComposing: true,
        });
      });
      view.rerender(
        <RichSourceEditor
          {...properties}
          nodeId={nextNodeId}
          viewId={nextViewId}
        />,
      );
      act(() => {
        fireEvent.compositionEnd(input, { data: '字' });
        vi.runAllTimers();
      });

      expect(onTransaction).not.toHaveBeenCalled();
      expect(readSource(editorRef.current!)).toBe(value);
    },
  );

  it('ignores a pending spellcheck result after spellcheck is disabled', async () => {
    vi.useFakeTimers();
    const request = deferred<string[]>();
    const checkSpellcheckWords = vi.fn(() => request.promise);
    Object.defineProperty(window, 'flyoff', {
      configurable: true,
      value: {
        checkSpellcheckWords,
      } satisfies Partial<FlyoffApi>,
    });
    const editorRef = createRef<HTMLDivElement>();
    const value = `mistakeword\n${largeSource(2_099)}`;
    const properties = {
      ariaLabel: 'Editor',
      editorRef,
      nodeId: 'large-note',
      onRedo: vi.fn(),
      onSelectionChange: vi.fn(),
      onTransaction: vi.fn(),
      onUndo: vi.fn(),
      selection: { direction: 'none' as const, end: 0, start: 0 },
      spellCheck: true,
      translate,
      value,
    };
    const view = render(<RichSourceEditor {...properties} />);

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });
    expect(checkSpellcheckWords).toHaveBeenCalled();

    view.rerender(<RichSourceEditor {...properties} spellCheck={false} />);
    await act(async () => {
      request.resolve(['mistakeword']);
      await request.promise;
      await Promise.resolve();
    });

    expect(
      editorRef.current?.querySelector('.md-spelling-error'),
    ).toBeNull();
  });

  it('refreshes spellcheck once after scripted scroll frames become idle', async () => {
    vi.useFakeTimers();
    const checkSpellcheckWords = vi.fn(async () => []);
    Object.defineProperty(window, 'flyoff', {
      configurable: true,
      value: {
        checkSpellcheckWords,
      } satisfies Partial<FlyoffApi>,
    });
    const editorRef = createRef<HTMLDivElement>();
    const lines = largeSource(2_099).split('\n');
    lines[10] = 'viewportonlyword';
    render(
      <RichSourceEditor
        ariaLabel="Editor"
        editorRef={editorRef}
        nodeId="large-note"
        onRedo={vi.fn()}
        onSelectionChange={vi.fn()}
        onTransaction={vi.fn()}
        onUndo={vi.fn()}
        selection={{ direction: 'none', end: 0, start: 0 }}
        spellCheck
        translate={translate}
        value={`mistakeword\n${lines.join('\n')}`}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });
    checkSpellcheckWords.mockClear();
    const editor = editorRef.current!;
    expect(editor.textContent).not.toContain('viewportonlyword');

    for (let index = 1; index <= 10; index += 1) {
      editor.scrollTop = index * 100;
      fireEvent.scroll(editor);
      fireEvent(editor, new Event('scrollend', { bubbles: true }));
      act(() => vi.advanceTimersByTime(16));
    }

    expect(editor.textContent).toContain('viewportonlyword');
    expect(checkSpellcheckWords).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(99);
      await Promise.resolve();
    });
    expect(checkSpellcheckWords).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(checkSpellcheckWords).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(40);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(checkSpellcheckWords).toHaveBeenCalledOnce();
  });

  it('does not let an older rejected spellcheck clear newer results', async () => {
    vi.useFakeTimers();
    const stale = deferred<string[]>();
    const checkSpellcheckWords = vi
      .fn()
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValue(['mistakeword']);
    Object.defineProperty(window, 'flyoff', {
      configurable: true,
      value: {
        checkSpellcheckWords,
      } satisfies Partial<FlyoffApi>,
    });
    const editorRef = createRef<HTMLDivElement>();
    const value = `mistakeword\n${largeSource(2_099)}`;
    const properties = {
      ariaLabel: 'Editor',
      editorRef,
      nodeId: 'large-note',
      onRedo: vi.fn(),
      onSelectionChange: vi.fn(),
      onTransaction: vi.fn(),
      onUndo: vi.fn(),
      selection: { direction: 'none' as const, end: 0, start: 0 },
      spellCheck: true,
      spellcheckScope: 'pt-BR',
      translate,
      value,
    };
    const view = render(<RichSourceEditor {...properties} />);
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    view.rerender(
      <RichSourceEditor {...properties} spellcheckScope="en-US" />,
    );
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      editorRef.current?.querySelector('.md-spelling-error')?.textContent,
    ).toBe('mistakeword');

    await act(async () => {
      stale.reject(new Error('stale request'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      editorRef.current?.querySelector('.md-spelling-error')?.textContent,
    ).toBe('mistakeword');
  });

  it.each([
    {
      label: 'scope',
      nextNodeId: 'large-note',
      nextScope: 'en-US',
    },
    {
      label: 'note',
      nextNodeId: 'other-note',
      nextScope: 'pt-BR',
    },
  ])(
    'does not reuse cached spelling results after a $label change',
    async ({ nextNodeId, nextScope }) => {
      vi.useFakeTimers();
      const checkSpellcheckWords = vi
        .fn()
        .mockResolvedValueOnce(['mistakeword'])
        .mockResolvedValueOnce([]);
      Object.defineProperty(window, 'flyoff', {
        configurable: true,
        value: {
          checkSpellcheckWords,
        } satisfies Partial<FlyoffApi>,
      });
      const editorRef = createRef<HTMLDivElement>();
      const value = `mistakeword\n${largeSource(2_099)}`;
      const properties = {
        ariaLabel: 'Editor',
        editorRef,
        nodeId: 'large-note',
        onRedo: vi.fn(),
        onSelectionChange: vi.fn(),
        onTransaction: vi.fn(),
        onUndo: vi.fn(),
        selection: { direction: 'none' as const, end: 0, start: 0 },
        spellCheck: true,
        spellcheckScope: 'pt-BR',
        translate,
        value,
      };
      const view = render(<RichSourceEditor {...properties} />);
      await act(async () => {
        vi.advanceTimersByTime(200);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(
        editorRef.current?.querySelector('.md-spelling-error')?.textContent,
      ).toBe('mistakeword');

      view.rerender(
        <RichSourceEditor
          {...properties}
          nodeId={nextNodeId}
          spellcheckScope={nextScope}
        />,
      );
      await act(async () => {
        vi.advanceTimersByTime(200);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(checkSpellcheckWords).toHaveBeenCalledTimes(2);
      expect(
        editorRef.current?.querySelector('.md-spelling-error'),
      ).toBeNull();
    },
  );

  it('copies a full-document selection through the bounded input mirror', () => {
    const editorRef = createRef<HTMLDivElement>();
    const value = largeSource(2_100);
    render(
      <RichSourceEditor
        ariaLabel="Editor"
        editorRef={editorRef}
        nodeId="large-note"
        onRedo={vi.fn()}
        onSelectionChange={vi.fn()}
        onTransaction={vi.fn()}
        onUndo={vi.fn()}
        selection={{ direction: 'none', end: 0, start: 0 }}
        translate={translate}
        value={value}
      />,
    );

    const input = editorRef.current!.querySelector<HTMLTextAreaElement>(
      '.source-window__input',
    )!;
    act(() => {
      input.focus();
      fireEvent.keyDown(input, { ctrlKey: true, key: 'a' });
    });
    const clipboard = { setData: vi.fn() };
    const copy = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(copy, 'clipboardData', { value: clipboard });
    act(() => input.dispatchEvent(copy));

    expect(copy.defaultPrevented).toBe(true);
    expect(clipboard.setData).toHaveBeenCalledWith('text/plain', value);
    expect(input.value.length).toBeLessThanOrEqual(8_192);
  });
});
