import { useState } from 'react';

import type {
  ProjectResult,
  ProjectTreeNode,
  TrashProjectNodeOutcome,
  TrashProjectNodesRequest,
} from '../../shared/contracts';
import { Dialog } from '../components/dialog';
import type { Translate } from '../pages/page-types';

interface TrashProjectNodesDialogProps {
  nodes: readonly ProjectTreeNode[];
  onCancel: () => void;
  onTrash: (
    request: TrashProjectNodesRequest,
  ) => Promise<ProjectResult<TrashProjectNodeOutcome>>;
  onTrashed: (nodes: readonly ProjectTreeNode[]) => void;
  translate: Translate;
  warning?: string;
}

export function TrashProjectNodesDialog({
  nodes,
  onCancel,
  onTrash,
  onTrashed,
  translate,
  warning,
}: TrashProjectNodesDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function confirm(): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      const result = await onTrash({
        nodeIds: nodes.map(({ nodeId }) => nodeId),
      });
      if (result.ok) {
        onTrashed(nodes);
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
      description={`${nodes.length} ${translate('projects.itemsSelected')}`}
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
      title={translate('projects.trashSelected')}
    >
      {warning ? <p role="note">{warning}</p> : null}
      {error ? (
        <p className="flyoff-dialog__error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
