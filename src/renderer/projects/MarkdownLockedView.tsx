import { useState, type FormEvent } from 'react';

import {
  type MarkdownDocument,
  type ProjectResult,
} from '../../shared/contracts';
import { getTooltipTargetProps } from '../components/tooltip';
import type { Translate } from '../pages/page-types';
import { PasswordField } from './PasswordField';
import { projectFailureMessage } from './project-result-message';

interface MarkdownLockedViewProps {
  title: string;
  translate: Translate;
  onUnlock: (password: string) => Promise<ProjectResult<MarkdownDocument>>;
}

export function MarkdownLockedView({
  onUnlock,
  title,
  translate,
}: MarkdownLockedViewProps) {
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!password || pending) {
      return;
    }

    setPending(true);
    setError(undefined);
    try {
      const result = await onUnlock(password);
      if (!result.ok) {
        setError(projectFailureMessage(result.error, translate));
      } else {
        setPassword('');
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setPending(false);
    }
  }

  return (
    <main aria-busy={pending} className="markdown-locked">
      <div className="markdown-locked__panel">
        <h1 {...getTooltipTargetProps(title, 'bottom')}>{title}</h1>
        <p>{translate('projects.propertiesLocked')}</p>
        <form onSubmit={(event) => void submit(event)}>
          <PasswordField
            autoComplete="current-password"
            autoFocus
            disabled={pending}
            label={translate('projects.propertiesPassword')}
            onChange={(event) => setPassword(event.target.value)}
            translate={translate}
            value={password}
          />
          <button disabled={pending || !password} type="submit">
            {translate('projects.propertiesUnlock')}
          </button>
        </form>
        <div className="markdown-locked__status">
          {error ? <p role="alert">{error}</p> : null}
        </div>
      </div>
    </main>
  );
}
