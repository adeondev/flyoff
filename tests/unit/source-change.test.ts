import { describe, expect, it } from 'vitest';

import { isSourceTextChangeApplicable } from '../../src/renderer/projects/source-change';

describe('source text changes', () => {
  it('accepts an exact localized CRLF and Unicode splice', () => {
    const before = 'alpha\r\nβeta 👩‍💻\r\nomega';
    const from = before.indexOf('βeta');
    const insert = 'γamma 🛰️';
    const after =
      before.slice(0, from) +
      insert +
      before.slice(from + 'βeta 👩‍💻'.length);

    expect(
      isSourceTextChangeApplicable(before, after, {
        from,
        insert,
        to: from + 'βeta 👩‍💻'.length,
      }),
    ).toBe(true);
  });

  it('rejects a matching local splice when content also changed far away', () => {
    const before = Array.from(
      { length: 200 },
      (_, index) => `line ${String(index).padStart(3, '0')}`,
    ).join('\n');
    const from = before.indexOf('line 010') + 5;
    const distant = before.indexOf('line 150') + 5;
    const insert = 'X';
    const locallyChanged =
      before.slice(0, from) + insert + before.slice(from + 1);
    const after =
      locallyChanged.slice(0, distant) +
      'Y' +
      locallyChanged.slice(distant + 1);

    expect(
      isSourceTextChangeApplicable(before, after, {
        from,
        insert,
        to: from + 1,
      }),
    ).toBe(false);
  });

  it('rejects malformed ranges without reading outside the source', () => {
    expect(
      isSourceTextChangeApplicable('abc', 'abc', {
        from: Number.NaN,
        insert: '',
        to: 0,
      }),
    ).toBe(false);
    expect(
      isSourceTextChangeApplicable('abc', 'abc', {
        from: 2,
        insert: '',
        to: 1,
      }),
    ).toBe(false);
    expect(
      isSourceTextChangeApplicable('abc', 'abc', {
        from: 0,
        insert: '',
        to: 4,
      }),
    ).toBe(false);
  });

  it('invalidates a cached result when the change object is mutated', () => {
    const before = 'alpha\nbeta\nomega';
    const after = 'alpha\nBeta\nomega';
    const change = {
      from: before.indexOf('beta'),
      insert: 'Beta',
      to: before.indexOf('beta') + 4,
    };

    expect(
      isSourceTextChangeApplicable(before, after, change),
    ).toBe(true);
    change.insert = 'wrong';
    expect(
      isSourceTextChangeApplicable(before, after, change),
    ).toBe(false);
    change.insert = 'Beta';
    expect(
      isSourceTextChangeApplicable(before, after, change),
    ).toBe(true);
  });
});
