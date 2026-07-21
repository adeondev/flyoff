import { useState } from 'react';

import type {
  ProjectResult,
  ProjectTreeNode,
  TrashProjectNodeRequest,
  TrashProjectNodeOutcome,
} from '../../shared/contracts';
import { Dialog } from '../components/dialog';
import type { Translate } from '../pages/page-types';

export interface TrashProjectNodeDialogProps {
  node: ProjectTreeNode;
  translate: Translate;
  onCancel: () => void;
  onTrash: (
    request: TrashProjectNodeRequest,
  ) => Promise<ProjectResult<TrashProjectNodeOutcome>>;
  onTrashed: (node: ProjectTreeNode) => void;
}

export function TrashProjectNodeDialog({
  node,
  onCancel,
  onTrash,
  onTrashed,
  translate,
}: TrashProjectNodeDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function confirm(): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      const result = await onTrash({ nodeId: node.nodeId });
      if (result.ok) {
        onTrashed(node);
      } else {
        setError(result.error.message);
      }
    } catch (operationError) {
      setError(String(operationError));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      busy={pending}
      closeLabel={translate('windowControls.close')}
      description={
        node.kind === 'folder'
          ? translate('projects.deleteFolderDescription')
          : translate('projects.deletePageDescription')
      }
      footerEnd={
        <button
          className="flyoff-dialog__button--danger"
          disabled={pending}
          onClick={() => void confirm()}
          type="button"
        >
          {translate('projects.delete')}
        </button>
      }
      footerStart={
        <button
          data-dialog-initial-focus
          disabled={pending}
          onClick={onCancel}
          type="button"
        >
          {translate('projects.cancel')}
        </button>
      }
      onCancel={onCancel}
      title={translate('projects.deleteTitle')}
    >
      {error ? (
        <p className="flyoff-dialog__error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
