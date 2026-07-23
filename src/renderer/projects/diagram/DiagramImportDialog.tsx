import { useMemo, useState } from 'react';

import type {
  DiagramImportSelection,
  SelectDiagramImportOutcome,
} from '../../../shared/contracts';
import { Dialog } from '../../components/dialog';
import type { Translate } from '../../pages/page-types';

interface DiagramImportDialogProps {
  outcome: SelectDiagramImportOutcome;
  pending: boolean;
  translate: Translate;
  onCancel: () => void;
  onCommit: (selection: DiagramImportSelection, importIds: readonly string[]) => void;
}

export function DiagramImportDialog({
  onCancel,
  onCommit,
  outcome,
  pending,
  translate,
}: DiagramImportDialogProps) {
  const initialIds = useMemo(
    () => (outcome.status === 'ready' ? outcome.diagrams.map(({ importId }) => importId) : []),
    [outcome],
  );
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(initialIds),
  );
  if (outcome.status === 'astah-bridge-required') {
    return (
      <Dialog
        closeLabel={translate('windowControls.close')}
        footerEnd={
          <button className="flyoff-dialog__button--primary" onClick={onCancel} type="button">
            {translate('projects.propertiesOk')}
          </button>
        }
        onCancel={onCancel}
        title={translate('diagram.astahBridgeTitle')}
      >
        <div className="diagram-import-dialog__astah" role="status">
          <p>{translate('diagram.astahBridgeExplanation')}</p>
          <p>{translate('diagram.astahBridgeAlternatives')}</p>
          <code>.spinel-import.json</code>
          <code>.xmi / .xml</code>
        </div>
      </Dialog>
    );
  }
  const fidelityKey = {
    exact: 'diagram.fidelityExact',
    high: 'diagram.fidelityHigh',
    partial: 'diagram.fidelityPartial',
  } as const;
  return (
    <Dialog
      busy={pending}
      closeLabel={translate('windowControls.close')}
      description={`${outcome.fileName} · ${outcome.sourceFormat}`}
      footerEnd={
        <button
          className="flyoff-dialog__button--primary"
          disabled={pending || selectedIds.size === 0}
          onClick={() => onCommit(outcome, [...selectedIds])}
          type="button"
        >
          {translate('diagram.importSelected')}
        </button>
      }
      footerStart={
        <button disabled={pending} onClick={onCancel} type="button">
          {translate('projects.cancel')}
        </button>
      }
      onCancel={onCancel}
      size="wide"
      title={translate('diagram.importTitle')}
    >
      <div className="diagram-import-dialog">
        {outcome.diagrams.map((diagram) => (
          <label className="diagram-import-dialog__item" key={diagram.importId}>
            <input
              checked={selectedIds.has(diagram.importId)}
              className="flyoff-checkbox"
              disabled={pending}
              onChange={(event) => {
                const next = new Set(selectedIds);
                if (event.target.checked) {
                  next.add(diagram.importId);
                } else {
                  next.delete(diagram.importId);
                }
                setSelectedIds(next);
              }}
              type="checkbox"
            />
            <span>
              <strong>{diagram.suggestedName}</strong>
              <small>
                {diagram.diagramType} · {translate('diagram.elements')}: {diagram.elementCount} ·{' '}
                {translate('diagram.relationships')}: {diagram.relationshipCount} ·{' '}
                {translate('diagram.fidelity')}: {translate(fidelityKey[diagram.fidelity])}
              </small>
              {diagram.diagnostics.length > 0 ? (
                <small>{diagram.diagnostics.length} {translate('diagram.diagnostics')}</small>
              ) : null}
            </span>
          </label>
        ))}
      </div>
    </Dialog>
  );
}
