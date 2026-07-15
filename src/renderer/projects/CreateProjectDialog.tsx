import { useState, type FormEvent } from 'react';

import type {
  CreateProjectRequest,
  ProjectLocationSelection,
  ProjectResult,
  ProjectSummary,
} from '../../shared/contracts';
import type { Translate } from '../pages/page-types';
import { ProjectDialog } from './ProjectDialog';

export interface CreateProjectDialogProps {
  open: boolean;
  translate: Translate;
  onCancel: () => void;
  onCreated: (project: ProjectSummary) => void;
  onCreate: (
    request: CreateProjectRequest,
  ) => Promise<ProjectResult<ProjectSummary>>;
  onSelectLocation: () => Promise<ProjectResult<ProjectLocationSelection>>;
}

type CreateProjectDialogContentProps = Omit<CreateProjectDialogProps, 'open'>;

function CreateProjectDialogContent({
  onCancel,
  onCreate,
  onCreated,
  onSelectLocation,
  translate,
}: CreateProjectDialogContentProps) {
  const [name, setName] = useState('');
  const [selection, setSelection] = useState<ProjectLocationSelection>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function chooseLocation(): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      const result = await onSelectLocation();
      if (result.ok) {
        setSelection(result.value);
      } else if (result.error.code !== 'cancelled') {
        setError(result.error.message);
      }
    } catch (operationError) {
      setError(String(operationError));
    } finally {
      setPending(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selection || !name.trim()) {
      setError(
        selection
          ? translate('projects.operationFailed')
          : translate('projects.locationNotSelected'),
      );
      return;
    }

    setPending(true);
    setError(undefined);
    try {
      const result = await onCreate({
        name,
        selectionToken: selection.token,
      });
      if (result.ok) {
        onCreated(result.value);
      } else {
        setSelection(undefined);
        setError(result.error.message);
      }
    } catch (operationError) {
      setSelection(undefined);
      setError(String(operationError));
    } finally {
      setPending(false);
    }
  }

  return (
    <ProjectDialog
      busy={pending}
      onCancel={onCancel}
      title={translate('projects.createProject')}
    >
      <form className="project-dialog__form" onSubmit={(event) => void submit(event)}>
        <label>
          <span>{translate('projects.projectName')}</span>
          <input
            autoComplete="off"
            data-dialog-initial-focus
            disabled={pending}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </label>
        <div className="project-dialog__field">
          <span>{translate('projects.location')}</span>
          <div className="project-dialog__location">
            <output title={selection?.location}>
              {selection?.location ?? translate('projects.locationNotSelected')}
            </output>
            <button
              disabled={pending}
              onClick={() => void chooseLocation()}
              type="button"
            >
              {translate('projects.chooseLocation')}
            </button>
          </div>
        </div>
        {error ? (
          <p className="project-dialog__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="project-dialog__actions">
          <button disabled={pending} onClick={onCancel} type="button">
            {translate('projects.cancel')}
          </button>
          <button
            className="project-dialog__primary"
            disabled={pending || !selection || !name.trim()}
            type="submit"
          >
            {pending
              ? translate('projects.creatingProject')
              : translate('projects.create')}
          </button>
        </div>
      </form>
    </ProjectDialog>
  );
}

export function CreateProjectDialog({
  open,
  ...props
}: CreateProjectDialogProps) {
  return open ? <CreateProjectDialogContent {...props} /> : null;
}
