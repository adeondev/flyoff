import type {
  DiagramDocument,
  DiagramElement,
  DiagramRelationship,
} from '../../../shared/diagram';
import { DropdownMenu, type MenuItem } from '../../components/menu';
import { getTooltipTargetProps } from '../../components/tooltip';
import type { Translate } from '../../pages/page-types';
import type { DiagramEditorTool } from './DiagramCanvas';
import { DiagramToolIcon } from './DiagramToolIcon';
import type { ActivityPartitionSide } from './diagram-geometry';

const ELEMENTS: Record<DiagramDocument['diagramType'], readonly DiagramElement['kind'][]> = {
  class: ['package', 'class', 'interface', 'enumeration'],
  'use-case': ['actor', 'use-case', 'system-boundary'],
  sequence: ['actor', 'lifeline', 'activation'],
  activity: [
    'activity-partition',
    'action',
    'object-node',
    'initial-node',
    'activity-final',
    'flow-final',
    'decision',
    'merge',
    'fork',
    'join',
  ],
};

const RELATIONSHIPS: Record<
  DiagramDocument['diagramType'],
  readonly DiagramRelationship['kind'][]
> = {
  class: [
    'association',
    'directed-association',
    'aggregation',
    'composition',
    'generalization',
    'realization',
    'dependency',
  ],
  'use-case': ['association', 'include', 'extend', 'generalization'],
  sequence: [
    'message-synchronous',
    'message-asynchronous',
    'message-return',
    'self-message',
  ],
  activity: ['control-flow', 'object-flow'],
};

const elementKeys: Record<DiagramElement['kind'], Parameters<Translate>[0]> = {
  package: 'diagram.elementPackage',
  class: 'diagram.elementClass',
  interface: 'diagram.elementInterface',
  enumeration: 'diagram.elementEnumeration',
  actor: 'diagram.elementActor',
  'use-case': 'diagram.elementUseCase',
  'system-boundary': 'diagram.elementSystemBoundary',
  lifeline: 'diagram.elementLifeline',
  activation: 'diagram.elementActivation',
  'activity-partition': 'diagram.elementPartition',
  action: 'diagram.elementAction',
  'object-node': 'diagram.elementObjectNode',
  'initial-node': 'diagram.elementInitialNode',
  'activity-final': 'diagram.elementActivityFinal',
  'flow-final': 'diagram.elementFlowFinal',
  decision: 'diagram.elementDecision',
  merge: 'diagram.elementMerge',
  fork: 'diagram.elementFork',
  join: 'diagram.elementJoin',
};

const relationshipKeys: Record<DiagramRelationship['kind'], Parameters<Translate>[0]> = {
  association: 'diagram.relationAssociation',
  'directed-association': 'diagram.relationDirectedAssociation',
  aggregation: 'diagram.relationAggregation',
  composition: 'diagram.relationComposition',
  generalization: 'diagram.relationGeneralization',
  realization: 'diagram.relationRealization',
  dependency: 'diagram.relationDependency',
  include: 'diagram.relationInclude',
  extend: 'diagram.relationExtend',
  'message-synchronous': 'diagram.relationMessageSynchronous',
  'message-asynchronous': 'diagram.relationMessageAsynchronous',
  'message-return': 'diagram.relationMessageReturn',
  'self-message': 'diagram.relationSelfMessage',
  'control-flow': 'diagram.relationControlFlow',
  'object-flow': 'diagram.relationObjectFlow',
};

interface DiagramToolbarProps {
  document: DiagramDocument;
  tool: DiagramEditorTool;
  canUndo: boolean;
  canRedo: boolean;
  translate: Translate;
  onFitView: () => void;
  onAddPartition: (side: ActivityPartitionSide) => void;
  onImport: () => void;
  onExportFlyd: () => void;
  onExportDrawio: () => void;
  onRedo: () => void;
  onToolChange: (tool: DiagramEditorTool) => void;
  onToggleGrid: () => void;
  onToggleSnap: () => void;
  onUndo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

interface IconButtonProps {
  disabled?: boolean;
  icon: Parameters<typeof DiagramToolIcon>[0]['kind'];
  label: string;
  onClick: () => void;
  pressed?: boolean;
}

function IconButton({
  disabled = false,
  icon,
  label,
  onClick,
  pressed,
}: IconButtonProps) {
  return (
    <button
      aria-label={label}
      aria-pressed={pressed}
      className="diagram-toolbar__tool"
      disabled={disabled}
      onClick={onClick}
      type="button"
      {...getTooltipTargetProps(label, 'bottom')}
    >
      <DiagramToolIcon kind={icon} />
    </button>
  );
}

export function DiagramToolbar({
  canRedo,
  canUndo,
  document,
  onAddPartition,
  onFitView,
  onImport,
  onExportFlyd,
  onExportDrawio,
  onRedo,
  onToggleGrid,
  onToggleSnap,
  onToolChange,
  onUndo,
  onZoomIn,
  onZoomOut,
  tool,
  translate,
}: DiagramToolbarProps) {
  const diagramRelationships = RELATIONSHIPS[document.diagramType];
  const hasActivityPartition = document.elements.some(
    ({ kind }) => kind === 'activity-partition',
  );
  const partitionItems: readonly MenuItem[] = [
    {
      kind: 'action',
      id: 'partition:left',
      label: translate('diagram.addPartitionLeft'),
    },
    {
      kind: 'action',
      id: 'partition:right',
      label: translate('diagram.addPartitionRight'),
    },
  ];
  const activeRelationship =
    tool.kind === 'connect' ? tool.relationshipKind : undefined;
  const connectLabel = activeRelationship
    ? `${translate('diagram.connect')}: ${translate(relationshipKeys[activeRelationship])}`
    : translate('diagram.connect');
  const relationshipItems: readonly MenuItem[] = diagramRelationships.map((kind) => ({
    kind: 'action',
    id: `relationship:${kind}`,
    label: translate(relationshipKeys[kind]),
    checked: activeRelationship === kind,
  }));
  const viewItems: readonly MenuItem[] = [
    {
      kind: 'action',
      id: 'view:grid',
      label: translate('diagram.toggleGrid'),
      checked: document.settings.showGrid,
    },
    {
      kind: 'action',
      id: 'view:snap',
      label: translate('diagram.toggleSnap'),
      checked: document.settings.snapToGrid,
    },
  ];
  const fileItems: readonly MenuItem[] = [
    {
      kind: 'action',
      id: 'file:import',
      label: translate('diagram.importDiagram'),
    },
    { kind: 'separator', id: 'file:separator' },
    {
      kind: 'action',
      id: 'file:export-flyd',
      label: `${translate('diagram.exportDiagram')} (.flyd)`,
    },
    {
      kind: 'action',
      id: 'file:export-drawio',
      label: `${translate('diagram.exportDiagram')} (.drawio)`,
    },
  ];

  return (
    <div
      aria-label={translate('diagram.toolbarLabel')}
      className="diagram-toolbar"
      role="toolbar"
    >
      <div
        aria-label={translate('diagram.select')}
        className="diagram-toolbar__group"
        role="group"
      >
        <IconButton
          icon="select"
          label={translate('diagram.select')}
          onClick={() => onToolChange({ kind: 'select' })}
          pressed={tool.kind === 'select'}
        />
      </div>

      <div
        aria-label={translate('diagram.elements')}
        className="diagram-toolbar__group diagram-toolbar__group--elements"
        role="group"
      >
        {ELEMENTS[document.diagramType].map((kind) => {
          const label = translate(elementKeys[kind]);
          if (kind === 'activity-partition' && hasActivityPartition) {
            return (
              <DropdownMenu
                items={partitionItems}
                key={kind}
                onAction={(id) =>
                  onAddPartition(id === 'partition:left' ? 'left' : 'right')
                }
                trigger={(triggerProps) => (
                  <button
                    {...triggerProps}
                    aria-label={label}
                    className="diagram-toolbar__tool diagram-toolbar__tool--menu"
                    type="button"
                    {...getTooltipTargetProps(label, 'bottom')}
                  >
                    <DiagramToolIcon kind={kind} />
                    <DiagramToolIcon kind="chevron-down" />
                  </button>
                )}
              />
            );
          }
          return (
            <IconButton
              icon={kind}
              key={kind}
              label={label}
              onClick={() => onToolChange({ kind: 'create', elementKind: kind })}
              pressed={tool.kind === 'create' && tool.elementKind === kind}
            />
          );
        })}
      </div>

      <div
        aria-label={translate('diagram.relationships')}
        className="diagram-toolbar__group"
        role="group"
      >
        <DropdownMenu
          items={relationshipItems}
          onAction={(id) => {
            const relationshipKind = diagramRelationships.find(
              (kind) => id === `relationship:${kind}`,
            );
            if (relationshipKind) {
              onToolChange({ kind: 'connect', relationshipKind });
            }
          }}
          trigger={(triggerProps) => (
            <button
              {...triggerProps}
              aria-label={connectLabel}
              aria-pressed={tool.kind === 'connect'}
              className="diagram-toolbar__tool diagram-toolbar__tool--menu"
              type="button"
              {...getTooltipTargetProps(connectLabel, 'bottom')}
            >
              <DiagramToolIcon kind="connect" />
              <DiagramToolIcon kind="chevron-down" />
            </button>
          )}
        />
      </div>

      <div className="diagram-toolbar__group diagram-toolbar__group--end" role="group">
        <IconButton
          disabled={!canUndo}
          icon="undo"
          label={translate('diagram.undo')}
          onClick={onUndo}
        />
        <IconButton
          disabled={!canRedo}
          icon="redo"
          label={translate('diagram.redo')}
          onClick={onRedo}
        />
      </div>

      <div className="diagram-toolbar__group" role="group">
        <IconButton
          icon="zoom-out"
          label={translate('diagram.zoomOut')}
          onClick={onZoomOut}
        />
        <IconButton
          icon="zoom-in"
          label={translate('diagram.zoomIn')}
          onClick={onZoomIn}
        />
        <IconButton
          icon="fit-view"
          label={translate('diagram.fitView')}
          onClick={onFitView}
        />
        <DropdownMenu
          items={viewItems}
          onAction={(id) => {
            if (id === 'view:grid') {
              onToggleGrid();
            } else if (id === 'view:snap') {
              onToggleSnap();
            }
          }}
          placement="bottom-end"
          trigger={(triggerProps) => (
            <button
              {...triggerProps}
              aria-label={translate('diagram.viewOptions')}
              className="diagram-toolbar__tool diagram-toolbar__tool--menu"
              type="button"
              {...getTooltipTargetProps(translate('diagram.viewOptions'), 'bottom')}
            >
              <DiagramToolIcon kind="view-options" />
              <DiagramToolIcon kind="chevron-down" />
            </button>
          )}
        />
      </div>

      <div className="diagram-toolbar__group diagram-toolbar__group--last" role="group">
        <DropdownMenu
          items={fileItems}
          onAction={(id) => {
            if (id === 'file:import') {
              onImport();
            } else if (id === 'file:export-flyd') {
              onExportFlyd();
            } else if (id === 'file:export-drawio') {
              onExportDrawio();
            }
          }}
          placement="bottom-end"
          trigger={(triggerProps) => (
            <button
              {...triggerProps}
              aria-label={translate('diagram.fileActions')}
              className="diagram-toolbar__tool diagram-toolbar__tool--menu"
              type="button"
              {...getTooltipTargetProps(translate('diagram.fileActions'), 'bottom')}
            >
              <DiagramToolIcon kind="file-actions" />
              <DiagramToolIcon kind="chevron-down" />
            </button>
          )}
        />
      </div>
    </div>
  );
}
