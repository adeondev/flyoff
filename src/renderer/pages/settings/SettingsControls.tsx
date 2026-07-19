import {
  useCallback,
  type ReactNode,
} from 'react';

import type { FlyoffPreferences } from '../../../shared/contracts';
import {
  DropdownMenu,
  type MenuItem,
} from '../../components/menu';
import type { Translate } from '../page-types';
import { useFlyoffPreferences } from '../../preferences';

export type PreferenceSection = Exclude<
  keyof FlyoffPreferences,
  'version'
>;

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .trim();
}

export function settingMatches(
  query: string,
  ...values: readonly string[]
): boolean {
  const normalized = normalizeSearch(query);
  return (
    normalized.length === 0 ||
    values.some((value) => normalizeSearch(value).includes(normalized))
  );
}

export function usePreferenceSection<K extends PreferenceSection>(
  section: K,
): [
  FlyoffPreferences[K],
  (patch: Partial<FlyoffPreferences[K]>) => void,
] {
  const { preferences, update } = useFlyoffPreferences();
  const apply = useCallback(
    (patch: Partial<FlyoffPreferences[K]>) => {
      update((current) => ({
        ...current,
        [section]: {
          ...current[section],
          ...patch,
        },
      }));
    },
    [section, update],
  );

  return [preferences[section], apply];
}

export function SettingsSection({
  children,
  description,
  id,
  onReset,
  title,
  translate,
}: {
  children: ReactNode;
  description: string;
  id: string;
  onReset?: () => void;
  title: string;
  translate: Translate;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="settings-section"
      id={id}
    >
      <header className="settings-section__header">
        <div>
          <h2 id={`${id}-title`}>{title}</h2>
          <p>{description}</p>
        </div>
        {onReset ? (
          <button
            className="settings-section__reset"
            onClick={onReset}
            type="button"
          >
            {translate('settings.resetSection')}
          </button>
        ) : null}
      </header>
      <div className="settings-section__rows">{children}</div>
    </section>
  );
}

export function SettingRow({
  children,
  description,
  keywords = [],
  query,
  title,
}: {
  children: ReactNode;
  description: string;
  keywords?: readonly string[];
  query: string;
  title: string;
}) {
  const visible = settingMatches(query, title, description, ...keywords);

  return (
    <div className="settings-row" hidden={!visible}>
      <div className="settings-row__copy">
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}

export function SettingsToggle({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="settings-toggle"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span aria-hidden="true" />
    </button>
  );
}

export interface SettingsSelectOption {
  label: string;
  value: string;
}

export function SettingsSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (event: { currentTarget: { value: string } }) => void;
  options: readonly SettingsSelectOption[];
  value: string;
}) {
  const selected = options.find((option) => option.value === value);
  const items: readonly MenuItem[] = options.map((option) => ({
    kind: 'action',
    id: option.value,
    label: option.label,
    checked: option.value === value,
  }));

  return (
    <DropdownMenu
      items={items}
      onAction={(nextValue) => {
        if (nextValue !== value) {
          onChange({ currentTarget: { value: nextValue } });
        }
      }}
      trigger={(props) => (
        <button
          {...props}
          aria-label={label}
          className="settings-select"
          type="button"
        >
          <span className="settings-select__value">
            {selected?.label ?? value}
          </span>
          <span aria-hidden="true" className="settings-select__chevron">
            ⌄
          </span>
        </button>
      )}
    />
  );
}

export function SettingsRange({
  label,
  maximum,
  minimum,
  onChange,
  output,
  step,
  value,
}: {
  label: string;
  maximum: number;
  minimum: number;
  onChange: (value: number) => void;
  output: string;
  step: number;
  value: number;
}) {
  return (
    <div className="settings-range">
      <input
        aria-label={label}
        aria-valuetext={output}
        max={maximum}
        min={minimum}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
        step={step}
        type="range"
        value={value}
      />
      <span aria-hidden="true" className="settings-range__output">
        {output}
      </span>
    </div>
  );
}
