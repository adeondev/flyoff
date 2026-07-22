import { parse as parseTwemoji } from '@twemoji/parser';

import {
  isSpellcheckCapabilities,
  type SpellcheckCapabilities,
} from './spellcheck';
import {
  copyProjectGraphSettings,
  DEFAULT_PROJECT_GRAPH_SETTINGS,
  normalizeProjectGraphSettings,
  type ProjectGraphSettings,
} from './project-graph-settings';

export const PREFERENCES_VERSION = 8 as const;
export const PREFERENCES_MAX_BYTES = 64 * 1_024;

export const GET_PREFERENCES_CHANNEL = 'flyoff:preferences:get' as const;
export const SAVE_PREFERENCES_CHANNEL = 'flyoff:preferences:save' as const;
export const RESET_PREFERENCES_CHANNEL = 'flyoff:preferences:reset' as const;
export const APPLY_WINDOW_THEME_CHANNEL =
  'flyoff:preferences:apply-window-theme' as const;

export const STARTUP_BEHAVIORS = ['ask', 'restore', 'fresh'] as const;
export const FLYOFF_THEMES = ['flyoff', 'basalt'] as const;
export const ACCENT_STRENGTHS = ['subtle', 'standard', 'strong'] as const;
export const ACCENT_COLOR_PRESETS = [
  '#8F4FC4',
  '#7048B8',
  '#5D4DB2',
  '#4557A8',
  '#3568A4',
  '#267589',
  '#26766E',
  '#367746',
  '#5D7330',
  '#806421',
  '#925329',
  '#984537',
  '#983D54',
  '#854365',
  '#695376',
  '#536174',
] as const;
export const INTERFACE_FONTS = ['inter', 'system'] as const;
export const INTERFACE_DENSITIES = ['compact', 'comfortable'] as const;
export const BORDER_CONTRASTS = ['soft', 'strong'] as const;
export const SCROLLBAR_WIDTHS = ['thin', 'standard'] as const;
export const MOTION_PREFERENCES = ['system', 'full', 'reduced'] as const;
export const TAB_WIDTHS = ['compact', 'balanced', 'wide'] as const;
export const EDITOR_MODES = ['edit', 'reading', 'split'] as const;
export const EDITOR_CHROME_LAYOUTS = ['focus', 'classic'] as const;
export const SOURCE_STYLES = ['live', 'raw'] as const;
export const NOTE_FONTS = ['arial', 'system', 'serif', 'monospace'] as const;
export const CONTENT_WIDTHS = ['narrow', 'comfortable', 'full'] as const;
export const CONTENT_PADDINGS = ['compact', 'normal', 'wide'] as const;
export const TAB_SIZES = [2, 4, 8] as const;
export const AUTOSAVE_DELAYS = [0, 300, 500, 1_000, 2_000] as const;
export const TAB_CLOSE_VISIBILITIES = ['hover', 'always'] as const;
export const TREE_DENSITIES = ['compact', 'comfortable'] as const;
export const PROPERTIES_DENSITIES = ['compact', 'full'] as const;
export const ACTIVE_PANE_INDICATORS = ['off', 'subtle', 'strong'] as const;
export const FOCUS_INDICATORS = ['standard', 'strong'] as const;
export const SPELLCHECK_SUGGESTION_LIMITS = [3, 5, 8] as const;
export const EMOJI_SKIN_TONES = [0, 1, 2, 3, 4, 5] as const;
export const EMOJI_RECENT_LIMIT = 24;

export const NOTE_FONT_SIZE_MIN = 12;
export const NOTE_FONT_SIZE_MAX = 24;
export const NOTE_LINE_HEIGHT_MIN = 1.3;
export const NOTE_LINE_HEIGHT_MAX = 2;
export const PREFERENCE_LANGUAGE_LIMIT = 16;

export type StartupBehavior = (typeof STARTUP_BEHAVIORS)[number];
export type FlyoffTheme = (typeof FLYOFF_THEMES)[number];
export type AccentStrength = (typeof ACCENT_STRENGTHS)[number];
export type InterfaceFont = (typeof INTERFACE_FONTS)[number];
export type InterfaceDensity = (typeof INTERFACE_DENSITIES)[number];
export type BorderContrast = (typeof BORDER_CONTRASTS)[number];
export type ScrollbarWidth = (typeof SCROLLBAR_WIDTHS)[number];
export type MotionPreference = (typeof MOTION_PREFERENCES)[number];
export type TabWidth = (typeof TAB_WIDTHS)[number];
export type PreferredEditorMode = (typeof EDITOR_MODES)[number];
export type EditorChromeLayout = (typeof EDITOR_CHROME_LAYOUTS)[number];
export type SourceStyle = (typeof SOURCE_STYLES)[number];
export type NoteFont = (typeof NOTE_FONTS)[number];
export type ContentWidth = (typeof CONTENT_WIDTHS)[number];
export type ContentPadding = (typeof CONTENT_PADDINGS)[number];
export type EditorTabSize = (typeof TAB_SIZES)[number];
export type AutosaveDelay = (typeof AUTOSAVE_DELAYS)[number];
export type TabCloseVisibility = (typeof TAB_CLOSE_VISIBILITIES)[number];
export type TreeDensity = (typeof TREE_DENSITIES)[number];
export type PropertiesDensity = (typeof PROPERTIES_DENSITIES)[number];
export type ActivePaneIndicator = (typeof ACTIVE_PANE_INDICATORS)[number];
export type FocusIndicator = (typeof FOCUS_INDICATORS)[number];
export type SpellcheckSuggestionLimit =
  (typeof SPELLCHECK_SUGGESTION_LIMITS)[number];
export type EmojiSkinTone = (typeof EMOJI_SKIN_TONES)[number];

export interface FlyoffPreferences {
  version: typeof PREFERENCES_VERSION;
  general: {
    startupBehavior: StartupBehavior;
    focusEditorOnOpen: boolean;
    saveOnWindowBlur: boolean;
    autosaveDelayMs: AutosaveDelay;
    hardwareAcceleration: boolean;
  };
  graph: ProjectGraphSettings;
  appearance: {
    theme: FlyoffTheme;
    accentColor: string | null;
    accentStrength: AccentStrength;
    interfaceFont: InterfaceFont;
    density: InterfaceDensity;
    borderContrast: BorderContrast;
    scrollbarWidth: ScrollbarWidth;
    motion: MotionPreference;
    tabWidth: TabWidth;
    activePaneIndicator: ActivePaneIndicator;
  };
  editor: {
    defaultMode: PreferredEditorMode;
    chromeLayout: EditorChromeLayout;
    sourceStyle: SourceStyle;
    showToolbar: boolean;
    toolbarCollapsed: boolean;
    showLineNumbers: boolean;
    showStatusBar: boolean;
    wrapLongLines: boolean;
    noteFont: NoteFont;
    fontSize: number;
    lineHeight: number;
    contentWidth: ContentWidth;
    contentPadding: ContentPadding;
    tabSize: EditorTabSize;
    syncSplitScroll: boolean;
    highlightActiveLine: boolean;
    fontLigatures: boolean;
    emojiRecent: readonly string[];
    emojiSkinTone: EmojiSkinTone;
  };
  workspace: {
    showTabIcons: boolean;
    tabCloseVisibility: TabCloseVisibility;
    treeDensity: TreeDensity;
    showSearchTips: boolean;
    showPaneDropLabels: boolean;
  };
  documents: {
    showPath: boolean;
    propertiesDensity: PropertiesDensity;
    showFileExtensions: boolean;
  };
  spellcheck: {
    enabled: boolean;
    languages: readonly string[];
    checkCodeBlocks: boolean;
    suggestionLimit: SpellcheckSuggestionLimit;
    allowPersonalDictionary: boolean;
  };
  accessibility: {
    focusIndicator: FocusIndicator;
    reduceTransparency: boolean;
  };
  security: {
    lockProtectedOnWindowBlur: boolean;
  };
}

export interface PreferencesSpellcheckState extends SpellcheckCapabilities {
  availableLanguages: readonly string[];
  activeLanguages: readonly string[];
}

export interface PreferencesSnapshot {
  preferences: FlyoffPreferences;
  spellcheck: PreferencesSpellcheckState;
  runtime: {
    hardwareAccelerationEnabled: boolean;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function includes<T extends string | number>(
  values: readonly T[],
  value: unknown,
): value is T {
  return values.includes(value as T);
}

export function isFlyoffTheme(value: unknown): value is FlyoffTheme {
  return includes(FLYOFF_THEMES, value);
}

function normalizedLanguageList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value.flatMap((language) =>
        typeof language === 'string' &&
        language.trim().length > 0 &&
        language.trim().length <= 64
          ? [language.trim()]
          : [],
      ),
    ),
  ].slice(0, PREFERENCE_LANGUAGE_LIMIT);
}

function boundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  precision = 2,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  const factor = 10 ** precision;
  return (
    Math.round(Math.min(maximum, Math.max(minimum, value)) * factor) / factor
  );
}

function isSingleSupportedEmoji(value: string): boolean {
  const entities = parseTwemoji(value, {
    assetType: 'svg',
    buildUrl: (codepoint) => codepoint,
  });
  return (
    entities.length === 1 &&
    entities[0]?.indices[0] === 0 &&
    entities[0]?.indices[1] === value.length
  );
}

export function normalizeAccentColor(value: unknown): string | null {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
    return null;
  }
  const normalized = value.toUpperCase();
  return ACCENT_COLOR_PRESETS.some((preset) => preset === normalized)
    ? normalized
    : null;
}

export function createDefaultFlyoffPreferences(): FlyoffPreferences {
  return {
    version: PREFERENCES_VERSION,
    general: {
      startupBehavior: 'ask',
      focusEditorOnOpen: true,
      saveOnWindowBlur: true,
      autosaveDelayMs: 500,
      hardwareAcceleration: true,
    },
    graph: copyProjectGraphSettings(DEFAULT_PROJECT_GRAPH_SETTINGS),
    appearance: {
      theme: 'flyoff',
      accentColor: null,
      accentStrength: 'standard',
      interfaceFont: 'inter',
      density: 'comfortable',
      borderContrast: 'soft',
      scrollbarWidth: 'thin',
      motion: 'system',
      tabWidth: 'balanced',
      activePaneIndicator: 'subtle',
    },
    editor: {
      defaultMode: 'edit',
      chromeLayout: 'focus',
      sourceStyle: 'live',
      showToolbar: true,
      toolbarCollapsed: false,
      showLineNumbers: true,
      showStatusBar: true,
      wrapLongLines: true,
      noteFont: 'arial',
      fontSize: 15,
      lineHeight: 1.55,
      contentWidth: 'full',
      contentPadding: 'normal',
      tabSize: 2,
      syncSplitScroll: true,
      highlightActiveLine: true,
      fontLigatures: true,
      emojiRecent: [],
      emojiSkinTone: 0,
    },
    workspace: {
      showTabIcons: true,
      tabCloseVisibility: 'always',
      treeDensity: 'comfortable',
      showSearchTips: true,
      showPaneDropLabels: true,
    },
    documents: {
      showPath: true,
      propertiesDensity: 'full',
      showFileExtensions: false,
    },
    spellcheck: {
      enabled: true,
      languages: [],
      checkCodeBlocks: false,
      suggestionLimit: 5,
      allowPersonalDictionary: true,
    },
    accessibility: {
      focusIndicator: 'standard',
      reduceTransparency: false,
    },
    security: {
      lockProtectedOnWindowBlur: false,
    },
  };
}

export function normalizeFlyoffPreferences(value: unknown): FlyoffPreferences {
  const defaults = createDefaultFlyoffPreferences();
  if (!isRecord(value)) {
    return defaults;
  }

  const general = isRecord(value.general) ? value.general : {};
  const graph = isRecord(value.graph) ? value.graph : {};
  const appearance = isRecord(value.appearance) ? value.appearance : {};
  const editor = isRecord(value.editor) ? value.editor : {};
  const workspace = isRecord(value.workspace) ? value.workspace : {};
  const documents = isRecord(value.documents) ? value.documents : {};
  const spellcheck = isRecord(value.spellcheck) ? value.spellcheck : {};
  const accessibility = isRecord(value.accessibility)
    ? value.accessibility
    : {};
  const security = isRecord(value.security) ? value.security : {};
  const emojiRecent = Array.isArray(editor.emojiRecent)
    ? [
        ...new Set(
          editor.emojiRecent.flatMap((emoji) =>
            typeof emoji === 'string' &&
            emoji.length > 0 &&
            emoji.length <= 64 &&
            isSingleSupportedEmoji(emoji)
              ? [emoji]
              : [],
          ),
        ),
      ].slice(0, EMOJI_RECENT_LIMIT)
    : defaults.editor.emojiRecent;

  return {
    version: PREFERENCES_VERSION,
    general: {
      startupBehavior: includes(
        STARTUP_BEHAVIORS,
        general.startupBehavior,
      )
        ? general.startupBehavior
        : defaults.general.startupBehavior,
      focusEditorOnOpen:
        typeof general.focusEditorOnOpen === 'boolean'
          ? general.focusEditorOnOpen
          : defaults.general.focusEditorOnOpen,
      saveOnWindowBlur:
        typeof general.saveOnWindowBlur === 'boolean'
          ? general.saveOnWindowBlur
          : defaults.general.saveOnWindowBlur,
      autosaveDelayMs: includes(AUTOSAVE_DELAYS, general.autosaveDelayMs)
        ? general.autosaveDelayMs
        : defaults.general.autosaveDelayMs,
      hardwareAcceleration:
        typeof general.hardwareAcceleration === 'boolean'
          ? general.hardwareAcceleration
          : defaults.general.hardwareAcceleration,
    },
    graph: normalizeProjectGraphSettings(graph),
    appearance: {
      theme: includes(FLYOFF_THEMES, appearance.theme)
        ? appearance.theme
        : defaults.appearance.theme,
      accentColor: normalizeAccentColor(appearance.accentColor),
      accentStrength: includes(
        ACCENT_STRENGTHS,
        appearance.accentStrength,
      )
        ? appearance.accentStrength
        : defaults.appearance.accentStrength,
      interfaceFont: includes(INTERFACE_FONTS, appearance.interfaceFont)
        ? appearance.interfaceFont
        : defaults.appearance.interfaceFont,
      density: includes(INTERFACE_DENSITIES, appearance.density)
        ? appearance.density
        : defaults.appearance.density,
      borderContrast: includes(
        BORDER_CONTRASTS,
        appearance.borderContrast,
      )
        ? appearance.borderContrast
        : defaults.appearance.borderContrast,
      scrollbarWidth: includes(
        SCROLLBAR_WIDTHS,
        appearance.scrollbarWidth,
      )
        ? appearance.scrollbarWidth
        : defaults.appearance.scrollbarWidth,
      motion: includes(MOTION_PREFERENCES, appearance.motion)
        ? appearance.motion
        : defaults.appearance.motion,
      tabWidth: includes(TAB_WIDTHS, appearance.tabWidth)
        ? appearance.tabWidth
        : defaults.appearance.tabWidth,
      activePaneIndicator: includes(
        ACTIVE_PANE_INDICATORS,
        appearance.activePaneIndicator,
      )
        ? appearance.activePaneIndicator
        : defaults.appearance.activePaneIndicator,
    },
    editor: {
      defaultMode: includes(EDITOR_MODES, editor.defaultMode)
        ? editor.defaultMode
        : defaults.editor.defaultMode,
      chromeLayout: includes(EDITOR_CHROME_LAYOUTS, editor.chromeLayout)
        ? editor.chromeLayout
        : defaults.editor.chromeLayout,
      sourceStyle: includes(SOURCE_STYLES, editor.sourceStyle)
        ? editor.sourceStyle
        : defaults.editor.sourceStyle,
      showToolbar:
        typeof editor.showToolbar === 'boolean'
          ? editor.showToolbar
          : defaults.editor.showToolbar,
      toolbarCollapsed:
        typeof editor.toolbarCollapsed === 'boolean'
          ? editor.toolbarCollapsed
          : defaults.editor.toolbarCollapsed,
      showLineNumbers:
        typeof editor.showLineNumbers === 'boolean'
          ? editor.showLineNumbers
          : defaults.editor.showLineNumbers,
      showStatusBar:
        typeof editor.showStatusBar === 'boolean'
          ? editor.showStatusBar
          : defaults.editor.showStatusBar,
      wrapLongLines:
        typeof editor.wrapLongLines === 'boolean'
          ? editor.wrapLongLines
          : defaults.editor.wrapLongLines,
      noteFont: includes(NOTE_FONTS, editor.noteFont)
        ? editor.noteFont
        : defaults.editor.noteFont,
      fontSize: boundedNumber(
        editor.fontSize,
        defaults.editor.fontSize,
        NOTE_FONT_SIZE_MIN,
        NOTE_FONT_SIZE_MAX,
        0,
      ),
      lineHeight: boundedNumber(
        editor.lineHeight,
        defaults.editor.lineHeight,
        NOTE_LINE_HEIGHT_MIN,
        NOTE_LINE_HEIGHT_MAX,
      ),
      contentWidth: includes(CONTENT_WIDTHS, editor.contentWidth)
        ? editor.contentWidth
        : defaults.editor.contentWidth,
      contentPadding: includes(CONTENT_PADDINGS, editor.contentPadding)
        ? editor.contentPadding
        : defaults.editor.contentPadding,
      tabSize: includes(TAB_SIZES, editor.tabSize)
        ? editor.tabSize
        : defaults.editor.tabSize,
      syncSplitScroll:
        typeof editor.syncSplitScroll === 'boolean'
          ? editor.syncSplitScroll
          : defaults.editor.syncSplitScroll,
      highlightActiveLine:
        typeof editor.highlightActiveLine === 'boolean'
          ? editor.highlightActiveLine
          : defaults.editor.highlightActiveLine,
      fontLigatures:
        typeof editor.fontLigatures === 'boolean'
          ? editor.fontLigatures
          : defaults.editor.fontLigatures,
      emojiRecent,
      emojiSkinTone: includes(EMOJI_SKIN_TONES, editor.emojiSkinTone)
        ? editor.emojiSkinTone
        : defaults.editor.emojiSkinTone,
    },
    workspace: {
      showTabIcons:
        typeof workspace.showTabIcons === 'boolean'
          ? workspace.showTabIcons
          : defaults.workspace.showTabIcons,
      tabCloseVisibility: includes(
        TAB_CLOSE_VISIBILITIES,
        workspace.tabCloseVisibility,
      )
        ? workspace.tabCloseVisibility
        : defaults.workspace.tabCloseVisibility,
      treeDensity: includes(TREE_DENSITIES, workspace.treeDensity)
        ? workspace.treeDensity
        : defaults.workspace.treeDensity,
      showSearchTips:
        typeof workspace.showSearchTips === 'boolean'
          ? workspace.showSearchTips
          : defaults.workspace.showSearchTips,
      showPaneDropLabels:
        typeof workspace.showPaneDropLabels === 'boolean'
          ? workspace.showPaneDropLabels
          : defaults.workspace.showPaneDropLabels,
    },
    documents: {
      showPath:
        typeof documents.showPath === 'boolean'
          ? documents.showPath
          : defaults.documents.showPath,
      propertiesDensity: includes(
        PROPERTIES_DENSITIES,
        documents.propertiesDensity,
      )
        ? documents.propertiesDensity
        : defaults.documents.propertiesDensity,
      showFileExtensions:
        typeof documents.showFileExtensions === 'boolean'
          ? documents.showFileExtensions
          : defaults.documents.showFileExtensions,
    },
    spellcheck: {
      enabled:
        typeof spellcheck.enabled === 'boolean'
          ? spellcheck.enabled
          : defaults.spellcheck.enabled,
      languages: normalizedLanguageList(spellcheck.languages),
      checkCodeBlocks:
        typeof spellcheck.checkCodeBlocks === 'boolean'
          ? spellcheck.checkCodeBlocks
          : defaults.spellcheck.checkCodeBlocks,
      suggestionLimit: includes(
        SPELLCHECK_SUGGESTION_LIMITS,
        spellcheck.suggestionLimit,
      )
        ? spellcheck.suggestionLimit
        : defaults.spellcheck.suggestionLimit,
      allowPersonalDictionary:
        typeof spellcheck.allowPersonalDictionary === 'boolean'
          ? spellcheck.allowPersonalDictionary
          : defaults.spellcheck.allowPersonalDictionary,
    },
    accessibility: {
      focusIndicator: includes(
        FOCUS_INDICATORS,
        accessibility.focusIndicator,
      )
        ? accessibility.focusIndicator
        : defaults.accessibility.focusIndicator,
      reduceTransparency:
        typeof accessibility.reduceTransparency === 'boolean'
          ? accessibility.reduceTransparency
          : defaults.accessibility.reduceTransparency,
    },
    security: {
      lockProtectedOnWindowBlur:
        typeof security.lockProtectedOnWindowBlur === 'boolean'
          ? security.lockProtectedOnWindowBlur
          : defaults.security.lockProtectedOnWindowBlur,
    },
  };
}

export function isFlyoffPreferences(
  value: unknown,
): value is FlyoffPreferences {
  if (!isRecord(value) || value.version !== PREFERENCES_VERSION) {
    return false;
  }

  return hasSameStructure(value, normalizeFlyoffPreferences(value));
}

function hasSameStructure(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => hasSameStructure(entry, right[index]))
    );
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) {
      return false;
    }
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          key === rightKeys[index] &&
          hasSameStructure(left[key], right[key]),
      )
    );
  }
  return Object.is(left, right);
}

function isLanguageList(
  value: unknown,
  maximum = 512,
): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every(
      (language) =>
        typeof language === 'string' &&
        language.length > 0 &&
        language.length <= 64,
    )
  );
}

export function isPreferencesSnapshot(
  value: unknown,
): value is PreferencesSnapshot {
  if (
    !isRecord(value) ||
    !isRecord(value.spellcheck) ||
    !isRecord(value.runtime)
  ) {
    return false;
  }

  return (
    Object.keys(value).length === 3 &&
    Object.keys(value.spellcheck).length === 5 &&
    Object.keys(value.runtime).length === 1 &&
    isFlyoffPreferences(value.preferences) &&
    isSpellcheckCapabilities(value.spellcheck) &&
    isLanguageList(value.spellcheck.availableLanguages) &&
    isLanguageList(value.spellcheck.activeLanguages) &&
    typeof value.runtime.hardwareAccelerationEnabled === 'boolean'
  );
}
