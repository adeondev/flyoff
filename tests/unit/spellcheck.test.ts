import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  ElectronSpellcheckService,
  SpellcheckLanguageSelectionUnsupportedError,
  UnsupportedSpellcheckLanguagesError,
  getSpellcheckCapabilities,
  type ElectronSpellcheckSession,
} from '../../src/main/services/spellcheck';

interface FakeSession {
  availableSpellCheckerLanguages: string[];
  getSpellCheckerLanguages: ReturnType<typeof vi.fn>;
  setSpellCheckerLanguages: ReturnType<typeof vi.fn>;
  events: EventEmitter;
}

function createSession(
  available = ['en-US', 'pt-BR'],
  active = ['pt-BR'],
): FakeSession & ElectronSpellcheckSession {
  const events = new EventEmitter();
  const session: FakeSession = {
    availableSpellCheckerLanguages: [...available],
    getSpellCheckerLanguages: vi.fn(() => [...active]),
    setSpellCheckerLanguages: vi.fn(),
    events,
  };

  return Object.assign(session, {
    on: events.on.bind(events),
    removeListener: events.removeListener.bind(events),
  }) as FakeSession & ElectronSpellcheckSession;
}

describe('spellcheck capabilities', () => {
  it.each(['win32', 'linux'] as const)(
    'uses Chromium Hunspell on %s',
    (platform) => {
      expect(getSpellcheckCapabilities(platform)).toEqual({
        provider: 'chromium-hunspell',
        canSelectLanguages: true,
        downloadsDictionaries: true,
      });
    },
  );

  it('delegates spellchecking to macOS', () => {
    expect(getSpellcheckCapabilities('darwin')).toEqual({
      provider: 'macos-native',
      canSelectLanguages: false,
      downloadsDictionaries: false,
    });
  });
});

describe('ElectronSpellcheckService', () => {
  it('returns defensive copies of available and active languages', () => {
    const session = createSession();
    const service = new ElectronSpellcheckService(session, 'linux');

    const available = service.getAvailableLanguages() as string[];
    const active = service.getActiveLanguages() as string[];
    available.push('fr-FR');
    active.push('en-US');

    expect(session.availableSpellCheckerLanguages).toEqual(['en-US', 'pt-BR']);
    expect(service.getActiveLanguages()).toEqual(['pt-BR']);
  });

  it('normalizes and de-duplicates supported language selections', () => {
    const session = createSession();
    const service = new ElectronSpellcheckService(session, 'win32');

    service.setActiveLanguages([' pt-BR ', 'en-US', 'pt-BR']);

    expect(session.setSpellCheckerLanguages).toHaveBeenCalledOnce();
    expect(session.setSpellCheckerLanguages).toHaveBeenCalledWith([
      'pt-BR',
      'en-US',
    ]);
  });

  it('rejects empty and unavailable language codes', () => {
    const service = new ElectronSpellcheckService(createSession(), 'linux');

    expect(() => service.setActiveLanguages([' '])).toThrow(TypeError);

    try {
      service.setActiveLanguages(['fr-FR', 'de-DE']);
      throw new Error('Expected unsupported languages to be rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedSpellcheckLanguagesError);
      expect(
        (error as UnsupportedSpellcheckLanguagesError).languageCodes,
      ).toEqual(['fr-FR', 'de-DE']);
    }
  });

  it('does not allow explicit language selection on macOS', () => {
    const session = createSession();
    const service = new ElectronSpellcheckService(session, 'darwin');

    expect(() => service.setActiveLanguages(['pt-BR'])).toThrow(
      SpellcheckLanguageSelectionUnsupportedError,
    );
    expect(session.setSpellCheckerLanguages).not.toHaveBeenCalled();
  });

  it('forwards Chromium dictionary events and removes all listeners', () => {
    const session = createSession();
    const service = new ElectronSpellcheckService(session, 'linux');
    const listener = vi.fn();
    const unsubscribe = service.onDictionaryDownload(listener);

    session.events.emit('spellcheck-dictionary-download-begin', {}, 'pt-BR');
    session.events.emit('spellcheck-dictionary-download-success', {}, 'pt-BR');
    session.events.emit('spellcheck-dictionary-download-failure', {}, 'en-US');
    session.events.emit('spellcheck-dictionary-initialized', {}, 'en-US');

    expect(listener.mock.calls.map(([event]) => event)).toEqual([
      { type: 'download-started', languageCode: 'pt-BR' },
      { type: 'download-succeeded', languageCode: 'pt-BR' },
      { type: 'download-failed', languageCode: 'en-US' },
      { type: 'dictionary-initialized', languageCode: 'en-US' },
    ]);

    unsubscribe();
    unsubscribe();
    session.events.emit('spellcheck-dictionary-download-begin', {}, 'en-US');

    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('does not subscribe to download events on macOS', () => {
    const session = createSession();
    const service = new ElectronSpellcheckService(session, 'darwin');
    const listener = vi.fn();

    service.onDictionaryDownload(listener)();
    session.events.emit('spellcheck-dictionary-download-begin', {}, 'pt-BR');

    expect(listener).not.toHaveBeenCalled();
    expect(session.events.eventNames()).toEqual([]);
  });
});
