import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import {
  createDiagramElement,
  createDiagramRelationship,
  diagramBoundsUnion,
  fitDiagramBounds,
  validateUmlSemantics,
  zoomDiagramAtPoint,
  type DiagramBounds,
  type DiagramDocument,
  type DiagramElement,
  type DiagramPoint,
  type DiagramViewport,
} from '../../../shared/diagram';
import type { ProjectPageComponentProps } from '../project-page-type-registry';
import type { SelectDiagramImportOutcome } from '../../../shared/contracts';
import {
  DiagramCanvas,
  type DiagramEditorTool,
  type DiagramSelection,
} from './DiagramCanvas';
import { DiagramInspector } from './DiagramInspector';
import { DiagramImportDialog } from './DiagramImportDialog';
import { DiagramToolbar } from './DiagramToolbar';
import {
  addAdjacentActivityPartition,
  getEffectiveDiagramNodePresentation,
  type ActivityPartitionSide,
} from './diagram-geometry';
import { readDiagramViewport, updateDiagramViewportState } from './diagram-page-state';
import type { DiagramController } from './diagram-controller';
import './diagram.css';

type DiagramPageLoadState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'unavailable'; message: string };

export function DiagramPage(props: ProjectPageComponentProps) {
  const { nodeId, runtime, translate } = props;
  const controller = runtime.diagram.controller;
  const [state, setState] = useState<DiagramPageLoadState>(() =>
    controller.getSnapshot(nodeId) ? { status: 'ready' } : { status: 'loading' },
  );
  useEffect(() => {
    let mounted = true;
    if (!controller.getSnapshot(nodeId)) {
      void runtime.diagram.readDocument(nodeId).then((result) => {
        if (!mounted) {
          return;
        }
        if (!result.ok) {
          setState({ status: 'unavailable', message: result.error.message });
          return;
        }
        controller.open(result.value);
        setState({ status: 'ready' });
      }).catch((error: unknown) => {
        if (mounted) {
          setState({ status: 'unavailable', message: String(error) });
        }
      });
    }
    return () => {
      mounted = false;
      controller.discardClean(nodeId);
    };
  }, [controller, nodeId, runtime.diagram]);

  if (state.status === 'loading') {
    return <main className="project-content-unavailable" role="status"><p>{translate('projects.loading')}</p></main>;
  }
  if (state.status === 'unavailable') {
    return (
      <main className="project-content-unavailable" role="alert">
        <p>{translate('diagram.unavailable')}</p>
        <small>{state.message}</small>
      </main>
    );
  }
  return <ReadyDiagramPage {...props} controller={controller} />;
}

function ReadyDiagramPage({
  controller,
  node,
  nodeId,
  onStateChange,
  pageState,
  runtime,
  translate,
}: ProjectPageComponentProps & { controller: DiagramController }) {
  const snapshot = useSyncExternalStore(
    (listener) => controller.subscribe(nodeId, listener),
    () => controller.getSnapshot(nodeId)!,
    () => controller.getSnapshot(nodeId)!,
  );
  const [selection, setSelection] = useState<DiagramSelection>();
  const [tool, setTool] = useState<DiagramEditorTool>({ kind: 'select' });
  const [connectionSourceId, setConnectionSourceId] = useState<string>();
  const [viewport, setViewport] = useState(() => readDiagramViewport(pageState));
  const [importOutcome, setImportOutcome] = useState<SelectDiagramImportOutcome>();
  const [importPending, setImportPending] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const document = snapshot.document;
  const diagnostics = useMemo(() => validateUmlSemantics(document), [document]);

  function updateDocument(
    update: (current: DiagramDocument) => DiagramDocument,
    coalesceKey?: string,
  ): void {
    controller.update(nodeId, update, coalesceKey);
  }

  function changeViewport(next: DiagramViewport): void {
    setViewport(next);
    onStateChange(updateDiagramViewportState(pageState, next));
  }

  function createElement(kind: DiagramElement['kind'], point: DiagramPoint): void {
    const lifelineId =
      selection?.kind === 'element' &&
      document.elements.find(({ id }) => id === selection.id)?.kind === 'lifeline'
        ? selection.id
        : document.elements.find((element) => element.kind === 'lifeline')?.id;
    const created = createDiagramElement(kind, {
      x: point.x,
      y: point.y,
      ...(kind === 'activation' && lifelineId ? { lifelineId } : {}),
    });
    const zIndex = Math.max(-1, ...document.presentations.nodes.map(({ zIndex }) => zIndex)) + 1;
    created.presentation.zIndex = kind === 'activity-partition' || kind === 'system-boundary' ? 0 : zIndex;
    updateDocument((current) => ({
      ...current,
      elements: [...current.elements, created.element],
      presentations: {
        ...current.presentations,
        nodes: [...current.presentations.nodes, created.presentation],
      },
    }));
    setSelection({ kind: 'element', id: created.element.id });
    setTool({ kind: 'select' });
  }

  function moveElement(elementId: string, x: number, y: number): void {
    updateDocument((current) => {
      const currentPresentation = current.presentations.nodes.find(
        ({ elementId: candidate }) => candidate === elementId,
      );
      if (!currentPresentation ||
          (currentPresentation.bounds.x === x && currentPresentation.bounds.y === y)) {
        return current;
      }
      const movedBounds = { ...currentPresentation.bounds, x, y };
      const center = {
        x: movedBounds.x + movedBounds.width / 2,
        y: movedBounds.y + movedBounds.height / 2,
      };
      const partitionPresentation = current.presentations.nodes.find((candidate) => {
        const candidateElement = current.elements.find(({ id }) => id === candidate.elementId);
        const bounds = candidate.bounds;
        return candidateElement?.kind === 'activity-partition' &&
          candidate.elementId !== elementId &&
          center.x >= bounds.x && center.x <= bounds.x + bounds.width &&
          center.y >= bounds.y && center.y <= bounds.y + bounds.height;
      });
      return {
        ...current,
        elements: current.elements.map((element) =>
          element.id === elementId && 'partitionId' in element
            ? { ...element, partitionId: partitionPresentation?.elementId }
            : element,
        ),
        presentations: {
          ...current.presentations,
          nodes: current.presentations.nodes.map((presentation) =>
            presentation.id === currentPresentation.id
              ? {
                  ...presentation,
                  bounds: movedBounds,
                  parentPresentationId: partitionPresentation?.id,
                }
              : presentation,
          ),
        },
      };
    }, `drag:${elementId}`);
  }

  function resizeElement(elementId: string, bounds: DiagramBounds): void {
    updateDocument((current) => {
      const currentPresentation = current.presentations.nodes.find(
        ({ elementId: candidate }) => candidate === elementId,
      );
      if (!currentPresentation) {
        return current;
      }
      const nodes = current.presentations.nodes.map((presentation) =>
        presentation.id === currentPresentation.id
          ? { ...presentation, bounds }
          : presentation,
      );
      const elementsById = new Map(
        current.elements.map((element) => [element.id, element]),
      );
      const partitions = nodes.flatMap((presentation) =>
        elementsById.get(presentation.elementId)?.kind === 'activity-partition'
          ? [presentation]
          : [],
      );
      const ownerByElementId = new Map<string, typeof partitions[number]>();
      for (const presentation of nodes) {
        const candidateElement = elementsById.get(presentation.elementId);
        if (!candidateElement || !('partitionId' in candidateElement)) {
          continue;
        }
        const center = {
          x: presentation.bounds.x + presentation.bounds.width / 2,
          y: presentation.bounds.y + presentation.bounds.height / 2,
        };
        const owner = partitions.find((partition) => {
          const partitionBounds = partition.bounds;
          return (
            center.x >= partitionBounds.x &&
            center.x <= partitionBounds.x + partitionBounds.width &&
            center.y >= partitionBounds.y &&
            center.y <= partitionBounds.y + partitionBounds.height
          );
        });
        if (owner) {
          ownerByElementId.set(candidateElement.id, owner);
        }
      }
      return {
        ...current,
        elements: current.elements.map((element) =>
          'partitionId' in element
            ? {
                ...element,
                partitionId: ownerByElementId.get(element.id)?.elementId,
              }
            : element,
        ),
        presentations: {
          ...current.presentations,
          nodes: nodes.map((presentation) => {
            const candidateElement = elementsById.get(presentation.elementId);
            return candidateElement && 'partitionId' in candidateElement
              ? {
                  ...presentation,
                  parentPresentationId: ownerByElementId.get(
                    presentation.elementId,
                  )?.id,
                }
              : presentation;
          }),
        },
      };
    }, `resize:${elementId}`);
  }

  function addPartition(side: ActivityPartitionSide): void {
    const selectedPartitionId =
      selection?.kind === 'element' &&
      document.elements.find(({ id }) => id === selection.id)?.kind ===
        'activity-partition'
        ? selection.id
        : undefined;
    let addedElementId: string | undefined;
    updateDocument((current) => {
      const result = addAdjacentActivityPartition(
        current,
        selectedPartitionId,
        side,
      );
      addedElementId = result?.elementId;
      return result?.document ?? current;
    });
    if (addedElementId) {
      setSelection({ kind: 'element', id: addedElementId });
      setTool({ kind: 'select' });
    }
  }

  function connectionNode(elementId: string): void {
    if (tool.kind !== 'connect') {
      return;
    }
    if (!connectionSourceId) {
      setConnectionSourceId(elementId);
      setSelection({ kind: 'element', id: elementId });
      return;
    }
    const relationship = createDiagramRelationship(
      tool.relationshipKind,
      connectionSourceId,
      elementId,
    );
    if ('wholeEnd' in relationship &&
        (relationship.kind === 'aggregation' || relationship.kind === 'composition')) {
      relationship.wholeEnd = 'source';
    }
    if ('order' in relationship) {
      relationship.order =
        Math.max(
          0,
          ...document.relationships.flatMap((candidate) =>
            'order' in candidate ? [candidate.order] : [],
          ),
        ) + 1;
    }
    const sourcePresentation = document.presentations.nodes.find(
      ({ elementId: candidate }) => candidate === connectionSourceId,
    );
    const targetPresentation = document.presentations.nodes.find(
      ({ elementId: candidate }) => candidate === elementId,
    );
    if (!sourcePresentation || !targetPresentation) {
      setConnectionSourceId(undefined);
      return;
    }
    const edge = {
      id: crypto.randomUUID(),
      relationshipId: relationship.id,
      sourcePresentationId: sourcePresentation.id,
      targetPresentationId: targetPresentation.id,
      points: [],
    };
    updateDocument((current) => ({
      ...current,
      relationships: [...current.relationships, relationship],
      presentations: {
        ...current.presentations,
        edges: [...current.presentations.edges, edge],
      },
    }));
    setSelection({ kind: 'relationship', id: relationship.id });
    setConnectionSourceId(undefined);
  }

  function deleteSelection(): void {
    if (!selection) {
      return;
    }
    updateDocument((current) => {
      if (selection.kind === 'relationship') {
        return {
          ...current,
          relationships: current.relationships.filter(({ id }) => id !== selection.id),
          presentations: {
            ...current.presentations,
            edges: current.presentations.edges.filter(
              ({ relationshipId }) => relationshipId !== selection.id,
            ),
          },
        };
      }
      const relationshipIds = new Set(
        current.relationships
          .filter(
            ({ sourceId, targetId }) => sourceId === selection.id || targetId === selection.id,
          )
          .map(({ id }) => id),
      );
      const presentationIds = new Set(
        current.presentations.nodes
          .filter(({ elementId }) => elementId === selection.id)
          .map(({ id }) => id),
      );
      return {
        ...current,
        elements: current.elements.filter(({ id }) => id !== selection.id),
        relationships: current.relationships.filter(({ id }) => !relationshipIds.has(id)),
        presentations: {
          nodes: current.presentations.nodes.filter(({ elementId }) => elementId !== selection.id),
          edges: current.presentations.edges.filter(
            (edge) =>
              !relationshipIds.has(edge.relationshipId) &&
              !presentationIds.has(edge.sourcePresentationId) &&
              !presentationIds.has(edge.targetPresentationId),
          ),
        },
      };
    });
    setSelection(undefined);
  }

  function handleKeyDown(event: React.KeyboardEvent<SVGSVGElement>): void {
    const command = event.ctrlKey || event.metaKey;
    if (event.key === 'Escape') {
      event.preventDefault();
      setTool({ kind: 'select' });
      setConnectionSourceId(undefined);
      return;
    }
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) {
        controller.redo(nodeId);
      } else {
        controller.undo(nodeId);
      }
      return;
    }
    if (command && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      controller.redo(nodeId);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteSelection();
      return;
    }
    if (
      selection?.kind === 'element' &&
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
    ) {
      event.preventDefault();
      const presentation = document.presentations.nodes.find(
        ({ elementId }) => elementId === selection.id,
      );
      if (presentation) {
        const step = event.shiftKey ? document.settings.gridSize : 1;
        moveElement(
          selection.id,
          presentation.bounds.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
          presentation.bounds.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
        );
      }
    }
  }

  function fitView(): void {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const elementsById = new Map(
      document.elements.map((element) => [element.id, element]),
    );
    changeViewport(
      fitDiagramBounds(
        diagramBoundsUnion(
          document.presentations.nodes.map((presentation) => {
            const element = elementsById.get(presentation.elementId);
            return element
              ? getEffectiveDiagramNodePresentation(element, presentation).bounds
              : presentation.bounds;
          }),
        ),
        { width: Math.max(1, rect.width - 280), height: Math.max(1, rect.height - 42) },
      ),
    );
  }

  function selectDiagnostic(targetId: string): void {
    if (document.elements.some(({ id }) => id === targetId)) {
      setSelection({ kind: 'element', id: targetId });
    } else if (document.relationships.some(({ id }) => id === targetId)) {
      setSelection({ kind: 'relationship', id: targetId });
    }
  }

  async function selectImport(): Promise<void> {
    try {
      const result = await runtime.diagram.selectImport();
      if (result.ok) {
        setImportOutcome(result.value);
      } else if (result.error.code !== 'cancelled') {
        runtime.onError?.(result.error.message);
      }
    } catch (error) {
      runtime.onError?.(String(error));
    }
  }

  async function exportDocument(format: 'flyd' | 'drawio'): Promise<void> {
    try {
      const result = await runtime.diagram.exportDocument({ nodeId, format });
      if (!result.ok && result.error.code !== 'cancelled') {
        runtime.onError?.(result.error.message);
      }
    } catch (error) {
      runtime.onError?.(String(error));
    }
  }

  return (
    <main className="diagram-page" ref={rootRef}>
      <DiagramToolbar
        canRedo={controller.canRedo(nodeId)}
        canUndo={controller.canUndo(nodeId)}
        document={document}
        onAddPartition={addPartition}
        onFitView={fitView}
        onImport={() => void selectImport()}
        onExportFlyd={() => void exportDocument('flyd')}
        onExportDrawio={() => void exportDocument('drawio')}
        onRedo={() => controller.redo(nodeId)}
        onToggleGrid={() =>
          updateDocument((current) => ({
            ...current,
            settings: { ...current.settings, showGrid: !current.settings.showGrid },
          }))
        }
        onToggleSnap={() =>
          updateDocument((current) => ({
            ...current,
            settings: { ...current.settings, snapToGrid: !current.settings.snapToGrid },
          }))
        }
        onToolChange={(next) => {
          setTool(next);
          setConnectionSourceId(undefined);
        }}
        onUndo={() => controller.undo(nodeId)}
        onZoomIn={() =>
          changeViewport(
            zoomDiagramAtPoint(viewport, { x: 400, y: 300 }, viewport.zoom * 1.2),
          )
        }
        onZoomOut={() =>
          changeViewport(
            zoomDiagramAtPoint(viewport, { x: 400, y: 300 }, viewport.zoom / 1.2),
          )
        }
        tool={tool}
        translate={translate}
      />
      {connectionSourceId ? (
        <div aria-live="polite" className="diagram-page__connection-status" role="status">
          {translate('diagram.connectionSource')}
        </div>
      ) : null}
      <div className="diagram-page__workspace">
        <DiagramCanvas
          ariaLabel={`${translate('projects.instanceDiagram')}: ${document.diagramType}`}
          connectionSourceId={connectionSourceId}
          document={document}
          minimapLabel={translate('diagram.minimap')}
          onConnectionNode={connectionNode}
          onCreateElement={createElement}
          onKeyDown={handleKeyDown}
          onMoveElement={moveElement}
          onResizeElement={resizeElement}
          onSelectionChange={setSelection}
          onViewportChange={changeViewport}
          selection={selection}
          tool={tool}
          viewport={viewport}
        />
        <DiagramInspector
          diagnostics={diagnostics}
          document={document}
          onAddPartition={addPartition}
          onResizeElement={resizeElement}
          onSelectDiagnostic={selectDiagnostic}
          onUpdateElement={(id, update) =>
            updateDocument((current) => ({
              ...current,
              elements: current.elements.map((element) =>
                element.id === id ? update(element) : element,
              ),
            }))
          }
          onUpdateRelationship={(id, update) =>
            updateDocument((current) => ({
              ...current,
              relationships: current.relationships.map((relationship) =>
                relationship.id === id ? update(relationship) : relationship,
              ),
            }))
          }
          selection={selection}
          translate={translate}
        />
      </div>
      <div aria-live="polite" className="diagram-page__save-status" data-status={snapshot.status}>
        {snapshot.status === 'saving'
          ? translate('diagram.saving')
          : snapshot.status === 'saved'
            ? translate('diagram.saved')
            : snapshot.status === 'conflict'
              ? translate('diagram.conflict')
              : translate('diagram.unsaved')}
        {snapshot.status === 'conflict' ? (
          <span>
            <button onClick={() => void controller.reload(nodeId)} type="button">
              {translate('diagram.reload')}
            </button>
            <button onClick={() => void controller.overwrite(nodeId)} type="button">
              {translate('diagram.overwrite')}
            </button>
          </span>
        ) : null}
      </div>
      {importOutcome ? (
        <DiagramImportDialog
          outcome={importOutcome}
          pending={importPending}
          translate={translate}
          onCancel={() => setImportOutcome(undefined)}
          onCommit={(selection, importIds) => {
            setImportPending(true);
            void runtime.diagram
              .commitImport({
                token: selection.token,
                importIds,
                parentId: node?.parentId ?? null,
              })
              .then((result) => {
                if (!result.ok) {
                  runtime.onError?.(result.error.message);
                  return;
                }
                runtime.diagram.onImported(result.value.nodes);
                setImportOutcome(undefined);
              })
              .catch((error: unknown) => runtime.onError?.(String(error)))
              .finally(() => setImportPending(false));
          }}
        />
      ) : null}
    </main>
  );
}
