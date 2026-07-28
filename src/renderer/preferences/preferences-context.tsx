import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  createDefaultFlyoffPreferences,
  normalizeFlyoffPreferences,
  type FlyoffApi,
  type FlyoffPreferences,
  type PreferencesSnapshot,
  type PreferencesSpellcheckState,
} from '../../shared/contracts';

const SAVE_DELAY_MS = 180;

type PreferenceSection = Exclude<keyof FlyoffPreferences, 'version'>;
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface FlyoffPreferencesContextValue {
  preferences: FlyoffPreferences;
  runtime: PreferencesSnapshot['runtime'];
  spellcheck: PreferencesSpellcheckState;
  ready: boolean;
  saveStatus: SaveStatus;
  update: (
    updater: (current: FlyoffPreferences) => FlyoffPreferences,
  ) => void;
  resetAll: () => void;
  resetSection: (section: PreferenceSection) => void;
  restartApplication: () => Promise<void>;
}

const defaultSpellcheck: PreferencesSpellcheckState = {
  provider: 'bundled-hunspell',
  canSelectLanguages: true,
  downloadsDictionaries: false,
  availableLanguages: [],
  activeLanguages: [],
};

const fallbackValue: FlyoffPreferencesContextValue = {
  preferences: createDefaultFlyoffPreferences(),
  runtime: { hardwareAccelerationEnabled: true },
  spellcheck: defaultSpellcheck,
  ready: true,
  saveStatus: 'idle',
  update: () => undefined,
  resetAll: () => undefined,
  resetSection: () => undefined,
  restartApplication: () => Promise.resolve(),
};

const PreferencesContext =
  createContext<FlyoffPreferencesContextValue>(fallbackValue);

function api(): Partial<FlyoffApi> {
  return window.flyoff as Partial<FlyoffApi>;
}

function applyDocumentPreferences(preferences: FlyoffPreferences): void {
  const root = document.documentElement;
  root.dataset.theme = preferences.appearance.theme;
  root.dataset.accent = preferences.appearance.accentStrength;
  if (preferences.appearance.accentColor) {
    root.dataset.customAccent = 'true';
    root.style.setProperty(
      '--preference-accent-color',
      preferences.appearance.accentColor,
    );
  } else {
    delete root.dataset.customAccent;
    root.style.removeProperty('--preference-accent-color');
  }
  root.dataset.interfaceFont = preferences.appearance.interfaceFont;
  root.dataset.density = preferences.appearance.density;
  root.dataset.borderContrast = preferences.appearance.borderContrast;
  root.dataset.scrollbarWidth = preferences.appearance.scrollbarWidth;
  root.dataset.motion = preferences.appearance.motion;
  root.dataset.tabWidth = preferences.appearance.tabWidth;
  root.dataset.activePaneIndicator =
    preferences.appearance.activePaneIndicator;
  root.dataset.tabIcons = String(preferences.workspace.showTabIcons);
  root.dataset.tabClose = preferences.workspace.tabCloseVisibility;
  root.dataset.treeDensity = preferences.workspace.treeDensity;
  root.dataset.paneDropLabels = String(
    preferences.workspace.showPaneDropLabels,
  );
  root.dataset.fontLigatures = String(preferences.editor.fontLigatures);
  root.dataset.highlightActiveLine = String(
    preferences.editor.highlightActiveLine,
  );
  root.dataset.hideColorMarkup = String(preferences.editor.hideColorMarkup);
  root.dataset.focusIndicator =
    preferences.accessibility.focusIndicator;
  root.dataset.reduceTransparency = String(
    preferences.accessibility.reduceTransparency,
  );
  root.style.setProperty(
    '--preference-note-font-size',
    `${preferences.editor.fontSize}px`,
  );
  root.style.setProperty(
    '--preference-note-line-height',
    String(preferences.editor.lineHeight),
  );
  root.style.setProperty(
    '--preference-editor-tab-size',
    String(preferences.editor.tabSize),
  );
}

export function useFlyoffPreferencesController():
  FlyoffPreferencesContextValue {
  const [preferences, setPreferences] = useState(
    createDefaultFlyoffPreferences,
  );
  const [spellcheck, setSpellcheck] =
    useState<PreferencesSpellcheckState>(defaultSpellcheck);
  const [runtime, setRuntime] = useState<PreferencesSnapshot['runtime']>({
    hardwareAccelerationEnabled: true,
  });
  const [ready, setReady] = useState(() => !api().getPreferences);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const preferencesRef = useRef(preferences);
  const revisionRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useLayoutEffect(() => {
    applyDocumentPreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    let active = true;
    const operation = api().getPreferences;
    if (!operation) {
      return;
    }

    void operation()
      .then((snapshot) => {
        if (!active || revisionRef.current !== 0) {
          return;
        }
        preferencesRef.current = snapshot.preferences;
        setPreferences(snapshot.preferences);
        setSpellcheck(snapshot.spellcheck);
        setRuntime(snapshot.runtime);
      })
      .catch(() => {
        if (active) {
          setSaveStatus('error');
        }
      })
      .finally(() => {
        if (active) {
          setReady(true);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  const persist = useCallback(
    (
      next: FlyoffPreferences,
      revision: number,
    ): Promise<void> => {
      const operation = api().savePreferences;
      if (!operation) {
        setSaveStatus('saved');
        return Promise.resolve();
      }

      const pending = saveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          setSaveStatus('saving');
          const snapshot = await operation(next);
          if (revision === revisionRef.current) {
            preferencesRef.current = snapshot.preferences;
            setPreferences(snapshot.preferences);
            setSpellcheck(snapshot.spellcheck);
            setRuntime(snapshot.runtime);
            setSaveStatus('saved');
          }
        })
        .catch((error: unknown) => {
          if (revision === revisionRef.current) {
            setSaveStatus('error');
          }
          throw error;
        });
      saveQueueRef.current = pending.catch(() => undefined);
      return pending;
    },
    [],
  );

  const update = useCallback(
    (
      updater: (current: FlyoffPreferences) => FlyoffPreferences,
    ): void => {
      const next = normalizeFlyoffPreferences(
        updater(preferencesRef.current),
      );
      const themeChanged =
        next.appearance.theme !==
        preferencesRef.current.appearance.theme;
      preferencesRef.current = next;
      revisionRef.current += 1;
      const revision = revisionRef.current;
      setPreferences(next);
      setSaveStatus('idle');
      if (themeChanged) {
        void api().applyWindowTheme?.(next.appearance.theme);
      }

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        void persist(next, revision).catch(() => undefined);
      }, SAVE_DELAY_MS);
    },
    [persist],
  );

  const resetAll = useCallback((): void => {
    const next = createDefaultFlyoffPreferences();
    preferencesRef.current = next;
    revisionRef.current += 1;
    const revision = revisionRef.current;
    setPreferences(next);
    setSaveStatus('saving');
    void api().applyWindowTheme?.(next.appearance.theme);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }

    const operation = api().resetPreferences;
    if (!operation) {
      setSaveStatus('saved');
      return;
    }
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const snapshot = await operation();
        if (revision === revisionRef.current) {
          preferencesRef.current = snapshot.preferences;
          setPreferences(snapshot.preferences);
          setSpellcheck(snapshot.spellcheck);
          setRuntime(snapshot.runtime);
          setSaveStatus('saved');
        }
      })
      .catch(() => {
        if (revision === revisionRef.current) {
          setSaveStatus('error');
        }
      });
  }, []);

  const resetSection = useCallback(
    (section: PreferenceSection): void => {
      const defaults = createDefaultFlyoffPreferences();
      update((current) => ({
        ...current,
        [section]: defaults[section],
      }));
    },
    [update],
  );

  const restartApplication = useCallback(async (): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    await persist(preferencesRef.current, revisionRef.current);
    const restart = api().restartApplication;
    if (!restart) {
      throw new Error('The application restart bridge is unavailable.');
    }
    await restart();
  }, [persist]);

  return useMemo(
    () => ({
      preferences,
      runtime,
      spellcheck,
      ready,
      saveStatus,
      update,
      resetAll,
      resetSection,
      restartApplication,
    }),
    [
      preferences,
      ready,
      resetAll,
      resetSection,
      restartApplication,
      runtime,
      saveStatus,
      spellcheck,
      update,
    ],
  );
}

export function FlyoffPreferencesProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: FlyoffPreferencesContextValue;
}) {
  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function useFlyoffPreferences(): FlyoffPreferencesContextValue {
  return useContext(PreferencesContext);
}
