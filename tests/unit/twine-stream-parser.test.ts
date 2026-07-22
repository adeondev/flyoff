import { describe, expect, it } from 'vitest';

import { TwineStreamParser } from '../../src/main/twine';

describe('Twine Gemma stream parser', () => {
  it('separates thought markers split across chunks', () => {
    const parser = new TwineStreamParser(true);
    const events = [
      ...parser.push('<|chan'),
      ...parser.push('nel>thought\nChecking'),
      ...parser.push(' facts<chan'),
      ...parser.push('nel|>Final **answer**'),
      ...parser.flush(),
    ];

    expect(events).toEqual([
      { text: 'Checking', type: 'thought-delta' },
      { text: ' facts', type: 'thought-delta' },
      { text: 'Final **answer**', type: 'text-delta' },
    ]);
  });

  it('suppresses thought content in low mode', () => {
    const parser = new TwineStreamParser(false);
    const events = [
      ...parser.push('<|channel>thought\nPrivate<channel|>Visible'),
      ...parser.flush(),
    ];

    expect(events).toEqual([{ text: 'Visible', type: 'text-delta' }]);
  });
});
