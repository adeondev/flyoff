// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  normalizeSourceText,
  sourceTextFromTransfer,
} from '../../src/renderer/projects/source-clipboard';

function transfer(plain: string, html = '') {
  return {
    getData(format: string): string {
      return format === 'text/html' ? html : plain;
    },
  };
}

describe('source clipboard normalization', () => {
  it('normalizes every logical line ending', () => {
    expect(normalizeSourceText('a\r\nb\rc\u0085d\u2028e\u2029f')).toBe(
      'a\nb\nc\nd\ne\nf',
    );
  });

  it('reconstructs HTML block and break boundaries when plain text loses them', () => {
    expect(
      sourceTextFromTransfer(
        transfer('onetwothree', '<div>one</div><p>two<br>three</p>'),
        document,
      ),
    ).toBe('one\ntwo\nthree');
  });

  it('keeps normalized multiline plain text as the authoritative payload', () => {
    expect(
      sourceTextFromTransfer(
        transfer('one\r\n\r\nthree', '<p>different</p>'),
        document,
      ),
    ).toBe('one\n\nthree');
  });

  it('extracts text without returning clipboard markup', () => {
    expect(
      sourceTextFromTransfer(
        transfer('', '<p>Hello <strong>world</strong></p><script>bad()</script>'),
        document,
      ),
    ).toBe('Hello world');
  });
});
