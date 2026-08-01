// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDescriptor } from '../../src/renderer/components/tabs/tab-state';
import { SettingsPage } from '../../src/renderer/pages/SettingsPage';
import {
  FlyoffPreferencesProvider,
  useFlyoffPreferencesController,
  type FlyoffPreferencesContextValue,
} from '../../src/renderer/preferences';
import {
  createDefaultFlyoffPreferences,
  INTERNAL_PAGE_IDS,
  type PreferencesSnapshot,
} from '../../src/shared/contracts';
import { enUS, type TranslationKey } from '../../src/shared/i18n';

function translate(key: TranslationKey): string {
  const [section, entry] = key.split('.') as [
    keyof typeof enUS,
    string,
  ];
  return (enUS[section] as unknown as Record<string, string>)[entry] ?? key;
}

function snapshot(
  preferences = createDefaultFlyoffPreferences(),
): PreferencesSnapshot {
  return {
    preferences,
    runtime: {
      hardwareAccelerationEnabled: true,
      graphicsBackend: 'automatic',
      graphicsBackendSelectionAvailable: true,
    },
    spellcheck: {
      provider: 'chromium-hunspell',
      canSelectLanguages: true,
      downloadsDictionaries: true,
      availableLanguages: ['en-US', 'pt-BR'],
      activeLanguages: ['en-US'],
    },
  };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'flyoff');
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.accent;
  delete document.documentElement.dataset.interfaceFont;
  delete document.documentElement.dataset.density;
  delete document.documentElement.dataset.borderContrast;
  delete document.documentElement.dataset.scrollbarWidth;
  delete document.documentElement.dataset.motion;
  delete document.documentElement.dataset.tabWidth;
  delete document.documentElement.dataset.tabIcons;
  delete document.documentElement.dataset.tabClose;
  delete document.documentElement.dataset.treeDensity;
  delete document.documentElement.dataset.activePaneIndicator;
  delete document.documentElement.dataset.paneDropLabels;
  delete document.documentElement.dataset.fontLigatures;
  delete document.documentElement.dataset.highlightActiveLine;
  delete document.documentElement.dataset.focusIndicator;
  delete document.documentElement.dataset.reduceTransparency;
  document.documentElement.removeAttribute('style');
});

describe('settings page', () => {
  it('shows one selected section, searches globally, and updates a theme without icons', () => {
    const preferences = createDefaultFlyoffPreferences();
    const update = vi.fn();
    const value: FlyoffPreferencesContextValue = {
      preferences,
      runtime: {
        hardwareAccelerationEnabled: true,
        graphicsBackend: 'automatic',
        graphicsBackendSelectionAvailable: true,
      },
      spellcheck: snapshot(preferences).spellcheck,
      ready: true,
      saveStatus: 'idle',
      update,
      resetAll: vi.fn(),
      resetSection: vi.fn(),
      restartApplication: vi.fn(() => Promise.resolve()),
    };
    const descriptor = createDescriptor({
      type: 'internal',
      pageId: INTERNAL_PAGE_IDS.settings,
    });

    const { container } = render(
      <FlyoffPreferencesProvider value={value}>
        <SettingsPage
          active
          descriptor={descriptor}
          onScrollChange={vi.fn()}
          onStateChange={vi.fn()}
          title={translate('settings.title')}
          translate={translate}
        />
      </FlyoffPreferencesProvider>,
    );

    expect(container.querySelectorAll('.settings-section')).toHaveLength(1);
    expect(
      screen.getByText(translate('settings.startupBehavior')),
    ).toBeTruthy();
    expect(container.querySelector('img, .masked-icon')).toBeNull();

    fireEvent.click(
      screen.getByRole('button', {
        name: translate('settings.sectionAppearance'),
      }),
    );
    expect(container.querySelectorAll('.settings-section')).toHaveLength(1);
    expect(
      screen.queryByText(translate('settings.startupBehavior')),
    ).toBeNull();
    expect(screen.getByText(translate('settings.theme'))).toBeTruthy();
    expect(container.querySelector('select')).toBeNull();

    fireEvent.click(
      screen.getByRole('button', {
        name: translate('settings.accentStrength'),
      }),
    );
    fireEvent.click(
      screen.getByRole('menuitemcheckbox', {
        name: translate('settings.optionStrong'),
      }),
    );
    const accentUpdater = update.mock.calls.at(-1)?.[0] as
      | ((current: typeof preferences) => typeof preferences)
      | undefined;
    expect(
      accentUpdater?.(preferences).appearance.accentStrength,
    ).toBe('strong');

    const search = screen.getByRole('searchbox', {
      name: translate('settings.search'),
    });
    fireEvent.change(search, { target: { value: 'spellcheck' } });
    expect(container.querySelectorAll('.settings-section')).toHaveLength(9);
    expect(
      screen
        .getByText(translate('settings.startupBehavior'))
        .closest<HTMLElement>('.settings-row')?.hidden,
    ).toBe(true);
    expect(
      screen
        .getByText(translate('settings.spellcheckEnabled'))
        .closest<HTMLElement>('.settings-row')?.hidden,
    ).toBe(false);

    fireEvent.change(search, { target: { value: '' } });
    fireEvent.click(screen.getByRole('radio', { name: /Basalt/ }));
    const updater = update.mock.calls.at(-1)?.[0] as
      | ((current: typeof preferences) => typeof preferences)
      | undefined;
    expect(updater?.(preferences).appearance.theme).toBe('basalt');
  });

  it('loads, applies, and persists appearance changes', async () => {
    const initial = createDefaultFlyoffPreferences();
    initial.appearance.theme = 'basalt';
    const getPreferences = vi.fn(() => Promise.resolve(snapshot(initial)));
    const savePreferences = vi.fn((preferences) =>
      Promise.resolve(snapshot(preferences)),
    );
    Object.defineProperty(window, 'flyoff', {
      configurable: true,
      value: { getPreferences, savePreferences },
    });

    const { result } = renderHook(() => useFlyoffPreferencesController());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(document.documentElement.dataset.theme).toBe('basalt');

    act(() => {
      result.current.update((current) => ({
        ...current,
        appearance: {
          ...current.appearance,
          theme: 'flyoff',
        },
      }));
    });

    expect(document.documentElement.dataset.theme).toBe('flyoff');
    await waitFor(
      () => {
        expect(savePreferences).toHaveBeenCalledOnce();
        expect(savePreferences.mock.calls[0]?.[0].appearance.theme).toBe(
          'flyoff',
        );
      },
      { timeout: 1_000 },
    );
  });

  it('offers the restart-bound OpenGL compatibility backend on Windows', () => {
    const preferences = createDefaultFlyoffPreferences();
    preferences.general.graphicsBackend = 'opengl';
    const update = vi.fn();
    const value: FlyoffPreferencesContextValue = {
      preferences,
      runtime: {
        hardwareAccelerationEnabled: true,
        graphicsBackend: 'automatic',
        graphicsBackendSelectionAvailable: true,
      },
      spellcheck: snapshot(preferences).spellcheck,
      ready: true,
      saveStatus: 'idle',
      update,
      resetAll: vi.fn(),
      resetSection: vi.fn(),
      restartApplication: vi.fn(() => Promise.resolve()),
    };
    const descriptor = createDescriptor({
      type: 'internal',
      pageId: INTERNAL_PAGE_IDS.settings,
    });

    render(
      <FlyoffPreferencesProvider value={value}>
        <SettingsPage
          active
          descriptor={descriptor}
          onScrollChange={vi.fn()}
          onStateChange={vi.fn()}
          title={translate('settings.title')}
          translate={translate}
        />
      </FlyoffPreferencesProvider>,
    );

    expect(
      screen.getByRole('button', {
        name: translate('settings.graphicsBackend'),
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: translate('settings.restartNow'),
      }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', {
        name: translate('settings.graphicsBackend'),
      }),
    );
    fireEvent.click(
      screen.getByRole('menuitemcheckbox', {
        name: translate('settings.automatic'),
      }),
    );
    const updater = update.mock.calls.at(-1)?.[0] as
      | ((current: typeof preferences) => typeof preferences)
      | undefined;
    expect(updater?.(preferences).general.graphicsBackend).toBe('automatic');
  });

  it('omits graphics backend selection when the platform does not support it', () => {
    const preferences = createDefaultFlyoffPreferences();
    const value: FlyoffPreferencesContextValue = {
      preferences,
      runtime: {
        hardwareAccelerationEnabled: true,
        graphicsBackend: 'automatic',
        graphicsBackendSelectionAvailable: false,
      },
      spellcheck: snapshot(preferences).spellcheck,
      ready: true,
      saveStatus: 'idle',
      update: vi.fn(),
      resetAll: vi.fn(),
      resetSection: vi.fn(),
      restartApplication: vi.fn(() => Promise.resolve()),
    };
    const descriptor = createDescriptor({
      type: 'internal',
      pageId: INTERNAL_PAGE_IDS.settings,
    });

    render(
      <FlyoffPreferencesProvider value={value}>
        <SettingsPage
          active
          descriptor={descriptor}
          onScrollChange={vi.fn()}
          onStateChange={vi.fn()}
          title={translate('settings.title')}
          translate={translate}
        />
      </FlyoffPreferencesProvider>,
    );

    expect(
      screen.queryByText(translate('settings.graphicsBackend')),
    ).toBeNull();
  });

  it('persists a GPU preference before requesting a protected restart', async () => {
    const initial = createDefaultFlyoffPreferences();
    const savePreferences = vi.fn((preferences) =>
      Promise.resolve(snapshot(preferences)),
    );
    const restartApplication = vi.fn(() => Promise.resolve());
    Object.defineProperty(window, 'flyoff', {
      configurable: true,
      value: {
        getPreferences: () => Promise.resolve(snapshot(initial)),
        restartApplication,
        savePreferences,
      },
    });
    const { result } = renderHook(() => useFlyoffPreferencesController());

    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => {
      result.current.update((current) => ({
        ...current,
        general: {
          ...current.general,
          hardwareAcceleration: false,
        },
      }));
    });
    await act(() => result.current.restartApplication());

    expect(savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        general: expect.objectContaining({
          hardwareAcceleration: false,
        }),
      }),
    );
    expect(restartApplication).toHaveBeenCalledOnce();
    expect(savePreferences.mock.invocationCallOrder[0]).toBeLessThan(
      restartApplication.mock.invocationCallOrder[0] ?? Number.MAX_VALUE,
    );
  });
});
