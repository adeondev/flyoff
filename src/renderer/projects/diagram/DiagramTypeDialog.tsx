import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

import type { DiagramType } from '../../../shared/diagram';
import type { Translate } from '../../pages/page-types';

interface DiagramTypeDialogProps {
  translate: Translate;
  onCancel: () => void;
  onSelect: (diagramType: DiagramType) => void;
}

const choices: readonly {
  type: DiagramType;
  key: Parameters<Translate>[0];
  symbol: string;
}[] = [
  { type: 'class', key: 'diagram.typeClass', symbol: '▤' },
  { type: 'use-case', key: 'diagram.typeUseCase', symbol: '◯' },
  { type: 'sequence', key: 'diagram.typeSequence', symbol: '⇢' },
  { type: 'activity', key: 'diagram.typeActivity', symbol: '◆' },
];

export function DiagramTypeDialog({
  onCancel,
  onSelect,
  translate,
}: DiagramTypeDialogProps) {
  const titleId = useId();
  const firstButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    firstButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);
  return createPortal(
    <div className="diagram-dialog-backdrop" onPointerDown={onCancel}>
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="diagram-type-dialog"
        onPointerDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <h2 id={titleId}>{translate('diagram.chooseType')}</h2>
        <p>{translate('diagram.chooseTypeDescription')}</p>
        <div className="diagram-type-dialog__choices">
          {choices.map((choice, index) => (
            <button
              key={choice.type}
              onClick={() => onSelect(choice.type)}
              ref={index === 0 ? firstButtonRef : undefined}
              type="button"
            >
              <span aria-hidden="true">{choice.symbol}</span>
              {translate(choice.key)}
            </button>
          ))}
        </div>
        <button className="diagram-type-dialog__cancel" onClick={onCancel} type="button">
          {translate('projects.cancel')}
        </button>
      </div>
    </div>,
    document.body,
  );
}
