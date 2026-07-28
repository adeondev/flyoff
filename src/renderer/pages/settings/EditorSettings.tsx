import {
  NOTE_FONT_SIZE_MAX,
  NOTE_FONT_SIZE_MIN,
  NOTE_LINE_HEIGHT_MAX,
  NOTE_LINE_HEIGHT_MIN,
} from '../../../shared/contracts';
import type { Translate } from '../page-types';
import { useFlyoffPreferences } from '../../preferences';
import {
  SettingRow,
  SettingsRange,
  SettingsSection,
  SettingsSelect,
  SettingsToggle,
  usePreferenceSection,
} from './SettingsControls';

export function EditorSettings({
  query,
  translate,
}: {
  query: string;
  translate: Translate;
}) {
  const [editor, update] = usePreferenceSection('editor');
  const { resetSection } = useFlyoffPreferences();

  return (
    <SettingsSection
      description={translate('settings.sectionEditorDescription')}
      id="settings-editor"
      onReset={() => resetSection('editor')}
      title={translate('settings.sectionEditor')}
      translate={translate}
    >
      <SettingRow
        description={translate('settings.defaultEditorModeDescription')}
        query={query}
        title={translate('settings.defaultEditorMode')}
      >
        <SettingsSelect
          label={translate('settings.defaultEditorMode')}
          onChange={(event) =>
            update({
              defaultMode: event.currentTarget.value as
                | 'edit'
                | 'reading'
                | 'split',
            })
          }
          options={[
            { value: 'edit', label: translate('settings.optionEdit') },
            { value: 'reading', label: translate('settings.optionReading') },
            { value: 'split', label: translate('settings.optionSplit') },
          ]}
          value={editor.defaultMode}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.editorChromeLayoutDescription')}
        query={query}
        title={translate('settings.editorChromeLayout')}
      >
        <SettingsSelect
          label={translate('settings.editorChromeLayout')}
          onChange={(event) =>
            update({
              chromeLayout: event.currentTarget.value as
                | 'focus'
                | 'classic',
            })
          }
          options={[
            { value: 'focus', label: translate('settings.optionFocus') },
            { value: 'classic', label: translate('settings.optionClassic') },
          ]}
          value={editor.chromeLayout}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.sourceStyleDescription')}
        query={query}
        title={translate('settings.sourceStyle')}
      >
        <SettingsSelect
          label={translate('settings.sourceStyle')}
          onChange={(event) =>
            update({
              sourceStyle: event.currentTarget.value as 'live' | 'raw',
            })
          }
          options={[
            { value: 'live', label: translate('settings.optionLive') },
            { value: 'raw', label: translate('settings.optionRaw') },
          ]}
          value={editor.sourceStyle}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.showToolbarDescription')}
        query={query}
        title={translate('settings.showToolbar')}
      >
        <SettingsToggle
          checked={editor.showToolbar}
          label={translate('settings.showToolbar')}
          onChange={(showToolbar) => update({ showToolbar })}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.showLineNumbersDescription')}
        query={query}
        title={translate('settings.showLineNumbers')}
      >
        <SettingsToggle
          checked={editor.showLineNumbers}
          label={translate('settings.showLineNumbers')}
          onChange={(showLineNumbers) => update({ showLineNumbers })}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.showStatusBarDescription')}
        query={query}
        title={translate('settings.showStatusBar')}
      >
        <SettingsToggle
          checked={editor.showStatusBar}
          label={translate('settings.showStatusBar')}
          onChange={(showStatusBar) => update({ showStatusBar })}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.wrapLongLinesDescription')}
        query={query}
        title={translate('settings.wrapLongLines')}
      >
        <SettingsToggle
          checked={editor.wrapLongLines}
          label={translate('settings.wrapLongLines')}
          onChange={(wrapLongLines) => update({ wrapLongLines })}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.noteFontDescription')}
        query={query}
        title={translate('settings.noteFont')}
      >
        <SettingsSelect
          label={translate('settings.noteFont')}
          onChange={(event) =>
            update({
              noteFont: event.currentTarget.value as
                | 'arial'
                | 'system'
                | 'serif'
                | 'monospace',
            })
          }
          options={[
            { value: 'arial', label: translate('settings.optionArial') },
            {
              value: 'system',
              label: translate('settings.optionSystemFont'),
            },
            { value: 'serif', label: translate('settings.optionSerif') },
            {
              value: 'monospace',
              label: translate('settings.optionMonospace'),
            },
          ]}
          value={editor.noteFont}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.fontSizeDescription')}
        query={query}
        title={translate('settings.fontSize')}
      >
        <SettingsRange
          label={translate('settings.fontSize')}
          maximum={NOTE_FONT_SIZE_MAX}
          minimum={NOTE_FONT_SIZE_MIN}
          onChange={(fontSize) => update({ fontSize })}
          output={`${editor.fontSize}px`}
          step={1}
          value={editor.fontSize}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.lineHeightDescription')}
        query={query}
        title={translate('settings.lineHeight')}
      >
        <SettingsRange
          label={translate('settings.lineHeight')}
          maximum={NOTE_LINE_HEIGHT_MAX}
          minimum={NOTE_LINE_HEIGHT_MIN}
          onChange={(lineHeight) => update({ lineHeight })}
          output={editor.lineHeight.toFixed(2)}
          step={0.05}
          value={editor.lineHeight}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.contentWidthDescription')}
        query={query}
        title={translate('settings.contentWidth')}
      >
        <SettingsSelect
          label={translate('settings.contentWidth')}
          onChange={(event) =>
            update({
              contentWidth: event.currentTarget.value as
                | 'narrow'
                | 'comfortable'
                | 'full',
            })
          }
          options={[
            { value: 'narrow', label: translate('settings.optionNarrow') },
            {
              value: 'comfortable',
              label: translate('settings.optionComfortable'),
            },
            { value: 'full', label: translate('settings.optionFullWidth') },
          ]}
          value={editor.contentWidth}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.contentPaddingDescription')}
        query={query}
        title={translate('settings.contentPadding')}
      >
        <SettingsSelect
          label={translate('settings.contentPadding')}
          onChange={(event) =>
            update({
              contentPadding: event.currentTarget.value as
                | 'compact'
                | 'normal'
                | 'wide',
            })
          }
          options={[
            {
              value: 'compact',
              label: translate('settings.optionCompact'),
            },
            {
              value: 'normal',
              label: translate('settings.optionPaddingNormal'),
            },
            {
              value: 'wide',
              label: translate('settings.optionPaddingWide'),
            },
          ]}
          value={editor.contentPadding}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.editorTabSizeDescription')}
        query={query}
        title={translate('settings.editorTabSize')}
      >
        <SettingsSelect
          label={translate('settings.editorTabSize')}
          onChange={(event) =>
            update({
              tabSize: Number(event.currentTarget.value) as 2 | 4 | 8,
            })
          }
          options={[2, 4, 8].map((size) => ({
            value: String(size),
            label: String(size),
          }))}
          value={String(editor.tabSize)}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.syncSplitScrollDescription')}
        query={query}
        title={translate('settings.syncSplitScroll')}
      >
        <SettingsToggle
          checked={editor.syncSplitScroll}
          label={translate('settings.syncSplitScroll')}
          onChange={(syncSplitScroll) => update({ syncSplitScroll })}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.highlightActiveLineDescription')}
        query={query}
        title={translate('settings.highlightActiveLine')}
      >
        <SettingsToggle
          checked={editor.highlightActiveLine}
          label={translate('settings.highlightActiveLine')}
          onChange={(highlightActiveLine) => update({ highlightActiveLine })}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.hideColorMarkupDescription')}
        query={query}
        title={translate('settings.hideColorMarkup')}
      >
        <SettingsToggle
          checked={editor.hideColorMarkup}
          label={translate('settings.hideColorMarkup')}
          onChange={(hideColorMarkup) => update({ hideColorMarkup })}
        />
      </SettingRow>
      <SettingRow
        description={translate('settings.fontLigaturesDescription')}
        query={query}
        title={translate('settings.fontLigatures')}
      >
        <SettingsToggle
          checked={editor.fontLigatures}
          label={translate('settings.fontLigatures')}
          onChange={(fontLigatures) => update({ fontLigatures })}
        />
      </SettingRow>
    </SettingsSection>
  );
}
