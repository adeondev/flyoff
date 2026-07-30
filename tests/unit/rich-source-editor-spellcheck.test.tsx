// @vitest-environment jsdom

import { createRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RichSourceEditor } from '../../src/renderer/projects/RichSourceEditor';
import type { Translate } from '../../src/renderer/pages/page-types';
import type { FlyoffApi } from '../../src/shared/contracts';

const translate: Translate = (key) => key;

describe('rich source editor spellcheck', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const checkSpellcheckWords = vi.fn(
      async ({ words }: { words: readonly string[] }) =>
        words.filter((word) => word.startsWith('mistake')),
    );
    Object.defineProperty(window, 'flyoff', {
      configurable: true,
      value: {
        checkSpellcheckWords,
      } satisfies Partial<FlyoffApi>,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps every dirty line queued across the spellcheck debounce', async () => {
    const editorRef = createRef<HTMLDivElement>();
    const lines = Array.from(
      { length: 80 },
      (_, index) => `ordinary line ${index} ${'x'.repeat(900)}`,
    );
    const properties = {
      ariaLabel: 'Editor',
      checkCodeBlocks: false,
      editorRef,
      nodeId: 'note',
      onRedo: vi.fn(),
      onSelectionChange: vi.fn(),
      onTransaction: vi.fn(),
      onUndo: vi.fn(),
      selection: { direction: 'none' as const, end: 0, start: 0 },
      spellCheck: true,
      translate,
    };
    const view = render(
      <RichSourceEditor {...properties} value={lines.join('\n')} />,
    );
    expect(editorRef.current?.getAttribute('spellcheck')).toBe('false');

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    lines[2] = 'mistakeone';
    view.rerender(
      <RichSourceEditor {...properties} value={lines.join('\n')} />,
    );
    lines[5] = 'mistaketwo';
    view.rerender(
      <RichSourceEditor {...properties} value={lines.join('\n')} />,
    );

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(
      editorRef.current?.children[2]?.querySelector('.md-spelling-error')
        ?.textContent,
    ).toBe('mistakeone');
    expect(
      editorRef.current?.children[5]?.querySelector('.md-spelling-error')
        ?.textContent,
    ).toBe('mistaketwo');
  });
});
