import type { Translate } from '../pages/page-types';
import { useFlyoffPreferences } from '../preferences';
import {
  SearchComposer,
  type SearchComposerSuggestion,
} from './SearchComposer';

interface ProjectSearchSuggestion {
  descriptionKey: Parameters<Translate>[0];
  id: string;
  insertion: string;
  label: string;
  caretOffset?: number;
}

const SUGGESTIONS: readonly ProjectSearchSuggestion[] = [
  {
    descriptionKey: 'projects.searchPathDescription',
    id: 'path',
    insertion: 'path:',
    label: 'path:',
  },
  {
    descriptionKey: 'projects.searchFileDescription',
    id: 'file',
    insertion: 'file:',
    label: 'file:',
  },
  {
    descriptionKey: 'projects.searchTagDescription',
    id: 'tag',
    insertion: 'tag:',
    label: 'tag:',
  },
  {
    caretOffset: -1,
    descriptionKey: 'projects.searchLineDescription',
    id: 'line',
    insertion: 'line:()',
    label: 'line:',
  },
  {
    caretOffset: -1,
    descriptionKey: 'projects.searchSectionDescription',
    id: 'section',
    insertion: 'section:()',
    label: 'section:',
  },
  {
    caretOffset: -1,
    descriptionKey: 'projects.searchPropertyDescription',
    id: 'property',
    insertion: '[]',
    label: '[property]',
  },
];

export interface ProjectSearchInputProps {
  searching: boolean;
  skippedLockedCount: number;
  translate: Translate;
  value: string;
  onChange: (value: string) => void;
}

export function ProjectSearchInput({
  onChange,
  searching,
  skippedLockedCount,
  translate,
  value,
}: ProjectSearchInputProps) {
  const { preferences } = useFlyoffPreferences();
  const suggestions: readonly SearchComposerSuggestion[] = SUGGESTIONS.map(
    (suggestion) => ({
      ...suggestion,
      description: translate(suggestion.descriptionKey),
    }),
  );

  return (
    <SearchComposer
      ariaLabel={translate('projects.searchProject')}
      onChange={onChange}
      optionsLabel={translate('projects.searchOptions')}
      placeholder={translate('projects.searchProject')}
      progressText={searching ? translate('projects.searching') : ''}
      showSuggestions={preferences.workspace.showSearchTips}
      statusText={
        skippedLockedCount > 0
          ? translate('projects.searchLockedSkipped')
          : undefined
      }
      suggestions={suggestions}
      value={value}
    />
  );
}
