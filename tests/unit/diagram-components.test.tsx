// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiagramCanvas } from '../../src/renderer/projects/diagram/DiagramCanvas';
import { DiagramImportDialog } from '../../src/renderer/projects/diagram/DiagramImportDialog';
import { DiagramInspector } from '../../src/renderer/projects/diagram/DiagramInspector';
import { DiagramToolbar } from '../../src/renderer/projects/diagram/DiagramToolbar';
import { DiagramTypeDialog } from '../../src/renderer/projects/diagram/DiagramTypeDialog';
import {
  addAdjacentActivityPartition,
  resizeDiagramNodeBounds,
} from '../../src/renderer/projects/diagram/diagram-geometry';
import {
  createDiagramDocument,
  createDiagramElement,
  createDiagramRelationship,
  type DiagramDocument,
} from '../../src/shared/diagram';
import type { Translate } from '../../src/renderer/pages/page-types';

const translate: Translate = (key) => key;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function populated(type: DiagramDocument['diagramType']): DiagramDocument {
  const document = createDiagramDocument(type);
  const kinds = {
    class: ['class'],
    'use-case': ['actor', 'use-case'],
    sequence: ['actor', 'lifeline'],
    activity: ['activity-partition', 'action'],
  } as const;
  const created = kinds[type].map((kind, index) =>
    createDiagramElement(kind, { x: 40 + index * 220, y: 60 }),
  );
  return {
    ...document,
    elements: created.map(({ element }) => element),
    presentations: {
      nodes: created.map(({ presentation }) => presentation),
      edges: [],
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  Object.defineProperties(SVGElement.prototype, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('diagram components', () => {
  it.each([
    ['class', 'diagram.elementClass', 'diagram.relationComposition'],
    ['use-case', 'diagram.elementUseCase', 'diagram.relationInclude'],
    ['sequence', 'diagram.elementLifeline', 'diagram.relationMessageSynchronous'],
    ['activity', 'diagram.elementPartition', 'diagram.relationObjectFlow'],
  ] as const)('shows tools specific to the %s diagram', (type, elementLabel, relationLabel) => {
    const onToolChange = vi.fn();
    const { unmount } = render(
      <DiagramToolbar
        canRedo={false}
        canUndo={false}
        document={createDiagramDocument(type)}
        onAddPartition={vi.fn()}
        onExportDrawio={vi.fn()}
        onExportFlyd={vi.fn()}
        onFitView={vi.fn()}
        onImport={vi.fn()}
        onRedo={vi.fn()}
        onToggleGrid={vi.fn()}
        onToggleSnap={vi.fn()}
        onToolChange={onToolChange}
        onUndo={vi.fn()}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        tool={{ kind: 'select' }}
        translate={translate}
      />,
    );

    expect(screen.getByRole('button', { name: elementLabel })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'diagram.connect' }));
    expect(screen.getByRole('menuitemcheckbox', { name: relationLabel })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: relationLabel }));
    expect(onToolChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'connect' }),
    );
    const toolbar = screen.getByRole('toolbar', { name: 'diagram.toolbarLabel' });
    for (const button of within(toolbar).getAllByRole('button')) {
      expect(button.hasAttribute('title')).toBe(false);
      expect(button.getAttribute('aria-label')).toBeTruthy();
    }
    unmount();
  });

  it('keeps view and file actions in accessible menus', () => {
    const onExportDrawio = vi.fn();
    const onExportFlyd = vi.fn();
    const onImport = vi.fn();
    const onToggleGrid = vi.fn();
    const onToggleSnap = vi.fn();
    render(
      <DiagramToolbar
        canRedo={false}
        canUndo={false}
        document={createDiagramDocument('class')}
        onAddPartition={vi.fn()}
        onExportDrawio={onExportDrawio}
        onExportFlyd={onExportFlyd}
        onFitView={vi.fn()}
        onImport={onImport}
        onRedo={vi.fn()}
        onToggleGrid={onToggleGrid}
        onToggleSnap={onToggleSnap}
        onToolChange={vi.fn()}
        onUndo={vi.fn()}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        tool={{ kind: 'select' }}
        translate={translate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'diagram.viewOptions' }));
    const grid = screen.getByRole('menuitemcheckbox', { name: 'diagram.toggleGrid' });
    expect(grid.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(grid);
    expect(onToggleGrid).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'diagram.fileActions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'diagram.importDiagram' }));
    expect(onImport).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'diagram.fileActions' }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'diagram.exportDiagram (.flyd)' }),
    );
    expect(onExportFlyd).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'diagram.fileActions' }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'diagram.exportDiagram (.drawio)' }),
    );
    expect(onExportDrawio).toHaveBeenCalledOnce();
  });

  it('adds later activity partitions beside the current lane', () => {
    const onAddPartition = vi.fn();
    render(
      <DiagramToolbar
        canRedo={false}
        canUndo={false}
        document={populated('activity')}
        onAddPartition={onAddPartition}
        onExportDrawio={vi.fn()}
        onExportFlyd={vi.fn()}
        onFitView={vi.fn()}
        onImport={vi.fn()}
        onRedo={vi.fn()}
        onToggleGrid={vi.fn()}
        onToggleSnap={vi.fn()}
        onToolChange={vi.fn()}
        onUndo={vi.fn()}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        tool={{ kind: 'select' }}
        translate={translate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'diagram.elementPartition' }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'diagram.addPartitionLeft' }),
    );
    expect(onAddPartition).toHaveBeenCalledWith('left');
    fireEvent.click(screen.getByRole('button', { name: 'diagram.elementPartition' }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'diagram.addPartitionRight' }),
    );
    expect(onAddPartition).toHaveBeenCalledWith('right');
  });

  it('inserts a lane without overlapping its neighbor and moves owned elements', () => {
    const document = populated('activity');
    const partition = document.elements.find(
      ({ kind }) => kind === 'activity-partition',
    )!;
    const action = document.elements.find(({ kind }) => kind === 'action')!;
    const owned = {
      ...action,
      partitionId: partition.id,
    };
    const withOwner = {
      ...document,
      elements: document.elements.map((element) =>
        element.id === action.id ? owned : element,
      ),
    };
    const originalPartition = document.presentations.nodes.find(
      ({ elementId }) => elementId === partition.id,
    )!;
    const originalAction = document.presentations.nodes.find(
      ({ elementId }) => elementId === action.id,
    )!;
    const result = addAdjacentActivityPartition(
      withOwner,
      partition.id,
      'left',
    )!;
    const inserted = result.document.presentations.nodes.find(
      ({ elementId }) => elementId === result.elementId,
    )!;
    const shiftedPartition = result.document.presentations.nodes.find(
      ({ elementId }) => elementId === partition.id,
    )!;
    const shiftedAction = result.document.presentations.nodes.find(
      ({ elementId }) => elementId === action.id,
    )!;

    expect(inserted.bounds).toEqual(originalPartition.bounds);
    expect(shiftedPartition.bounds.x).toBe(
      originalPartition.bounds.x + originalPartition.bounds.width,
    );
    expect(shiftedAction.bounds.x).toBe(
      originalAction.bounds.x + originalPartition.bounds.width,
    );
  });

  it('resizes with snap and preserves UML proportions where required', () => {
    const partition = createDiagramElement('activity-partition');
    const resizedPartition = resizeDiagramNodeBounds(
      partition.element,
      partition.presentation.bounds,
      'se',
      { x: 37, y: 59 },
      16,
    );
    expect(resizedPartition.width).toBe(304);
    expect(resizedPartition.height).toBe(496);

    const finalNode = createDiagramElement('activity-final');
    const resizedFinal = resizeDiagramNodeBounds(
      finalNode.element,
      finalNode.presentation.bounds,
      'se',
      { x: 20, y: 5 },
    );
    expect(resizedFinal.width).toBe(56);
    expect(resizedFinal.height).toBe(56);
  });

  it('selects, moves and supplies both endpoints in connection mode', () => {
    const document = populated('use-case');
    const actorId = document.elements[0]!.id;
    const useCaseId = document.elements[1]!.id;
    const onConnectionNode = vi.fn();
    const onMoveElement = vi.fn();
    const onSelectionChange = vi.fn();
    const { container, rerender } = render(
      <DiagramCanvas
        ariaLabel="Diagram"
        document={document}
        minimapLabel="Minimap"
        onConnectionNode={onConnectionNode}
        onCreateElement={vi.fn()}
        onKeyDown={vi.fn()}
        onMoveElement={onMoveElement}
        onResizeElement={vi.fn()}
        onSelectionChange={onSelectionChange}
        onViewportChange={vi.fn()}
        tool={{ kind: 'select' }}
        viewport={{ x: 0, y: 0, zoom: 1 }}
      />,
    );
    const actor = container.querySelector(`[data-element-id="${actorId}"]`)!;
    fireEvent.pointerDown(actor, { button: 0, clientX: 50, clientY: 70, pointerId: 1 });
    expect(onSelectionChange).toHaveBeenCalledWith({ kind: 'element', id: actorId });

    const canvas = screen.getByRole('application', { name: 'Diagram' });
    fireEvent.pointerMove(canvas, { clientX: 82, clientY: 102, pointerId: 1 });
    expect(onMoveElement).toHaveBeenCalledWith(actorId, 80, 96);

    rerender(
      <DiagramCanvas
        ariaLabel="Diagram"
        connectionSourceId={actorId}
        document={document}
        minimapLabel="Minimap"
        onConnectionNode={onConnectionNode}
        onCreateElement={vi.fn()}
        onKeyDown={vi.fn()}
        onMoveElement={onMoveElement}
        onResizeElement={vi.fn()}
        onSelectionChange={onSelectionChange}
        onViewportChange={vi.fn()}
        tool={{ kind: 'connect', relationshipKind: 'association' }}
        viewport={{ x: 0, y: 0, zoom: 1 }}
      />,
    );
    fireEvent.pointerDown(
      container.querySelector(`[data-element-id="${actorId}"]`)!,
      { button: 0, pointerId: 2 },
    );
    fireEvent.pointerDown(
      container.querySelector(`[data-element-id="${useCaseId}"]`)!,
      { button: 0, pointerId: 3 },
    );
    expect(onConnectionNode.mock.calls.map(([id]) => id)).toEqual([actorId, useCaseId]);
    expect(screen.getByRole('img', { name: 'Minimap' })).toBeTruthy();
  });

  it('uses resize handles and generous relationship hit targets', () => {
    const document = populated('use-case');
    const source = document.elements[0]!;
    const target = document.elements[1]!;
    const relationship = createDiagramRelationship(
      'association',
      source.id,
      target.id,
    );
    const onResizeElement = vi.fn();
    const { container } = render(
      <DiagramCanvas
        ariaLabel="Diagram"
        document={{ ...document, relationships: [relationship] }}
        minimapLabel="Minimap"
        onConnectionNode={vi.fn()}
        onCreateElement={vi.fn()}
        onKeyDown={vi.fn()}
        onMoveElement={vi.fn()}
        onResizeElement={onResizeElement}
        onSelectionChange={vi.fn()}
        onViewportChange={vi.fn()}
        selection={{ kind: 'element', id: source.id }}
        tool={{ kind: 'select' }}
        viewport={{ x: 0, y: 0, zoom: 1 }}
      />,
    );

    const handle = container.querySelector<SVGRectElement>(
      '[data-resize-handle="se"]',
    )!;
    fireEvent.pointerDown(handle, {
      button: 0,
      clientX: 136,
      clientY: 188,
      pointerId: 7,
    });
    fireEvent.pointerMove(screen.getByRole('application', { name: 'Diagram' }), {
      clientX: 168,
      clientY: 220,
      pointerId: 7,
    });
    expect(onResizeElement).toHaveBeenCalledWith(source.id, expect.any(Object));
    expect(container.querySelector('.diagram-edge__hit-area')).toBeTruthy();
    expect(container.querySelector('.diagram-node__hit-area')).toBeTruthy();
  });

  it('expands classifier compartments to contain attributes and operations', () => {
    const document = createDiagramDocument('class');
    const created = createDiagramElement('class', { x: 40, y: 60 });
    if (created.element.kind !== 'class') {
      throw new Error('Expected a class element');
    }
    const classElement = {
      ...created.element,
      attributes: Array.from({ length: 5 }, (_, index) => ({
        id: `attribute-${index}`,
        name: 'attribute',
        type: 'string',
        visibility: 'private' as const,
        isStatic: false,
        isReadOnly: false,
        taggedValues: [],
      })),
      operations: [
        {
          id: 'operation-1',
          name: 'operation',
          returnType: 'void',
          visibility: 'public' as const,
          isAbstract: false,
          isStatic: false,
          parameters: [],
          taggedValues: [],
        },
      ],
    };
    const { container } = render(
      <DiagramCanvas
        ariaLabel="Diagram"
        document={{
          ...document,
          elements: [classElement],
          presentations: { nodes: [created.presentation], edges: [] },
        }}
        minimapLabel="Minimap"
        onConnectionNode={vi.fn()}
        onCreateElement={vi.fn()}
        onKeyDown={vi.fn()}
        onMoveElement={vi.fn()}
        onResizeElement={vi.fn()}
        onSelectionChange={vi.fn()}
        onViewportChange={vi.fn()}
        tool={{ kind: 'select' }}
        viewport={{ x: 0, y: 0, zoom: 1 }}
      />,
    );

    const classNode = container.querySelector('[data-element-id]')!;
    const shapeHeight = Number(
      classNode.querySelector('.diagram-node__shape')!.getAttribute('height'),
    );
    const operationY = Number(
      within(classNode as HTMLElement)
        .getByText('+ operation(): void')
        .getAttribute('y'),
    );
    expect(shapeHeight).toBeGreaterThan(created.presentation.bounds.height);
    expect(operationY).toBeLessThan(shapeHeight);
  });

  it('edits classifier properties and exposes diagnostics without color-only meaning', () => {
    const document = populated('class');
    const element = document.elements[0]!;
    const onResizeElement = vi.fn();
    const onUpdateElement = vi.fn();
    render(
      <DiagramInspector
        diagnostics={[
          {
            code: 'element.incompatible',
            severity: 'warning',
            message: 'Semantic warning',
            targetId: element.id,
          },
        ]}
        document={document}
        onAddPartition={vi.fn()}
        onResizeElement={onResizeElement}
        onSelectDiagnostic={vi.fn()}
        onUpdateElement={onUpdateElement}
        onUpdateRelationship={vi.fn()}
        selection={{ kind: 'element', id: element.id }}
        translate={translate}
      />,
    );

    fireEvent.change(screen.getByLabelText('diagram.name'), {
      target: { value: 'Customer' },
    });
    expect(onUpdateElement).toHaveBeenCalledWith(element.id, expect.any(Function));
    fireEvent.change(screen.getByLabelText('diagram.width'), {
      target: { value: '320' },
    });
    expect(onResizeElement).toHaveBeenCalledWith(
      element.id,
      expect.objectContaining({ width: 320 }),
    );
    expect(
      screen
        .getByText('diagram.diagnosticElementIncompatible')
        .closest('li')?.dataset.severity,
    ).toBe('warning');
    expect(screen.getByText('diagram.severityWarning:')).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'diagram.inspector' })).toBeTruthy();
  });

  it('supports keyboard cancellation and all diagram choices', () => {
    const onCancel = vi.fn();
    const onSelect = vi.fn();
    render(
      <DiagramTypeDialog onCancel={onCancel} onSelect={onSelect} translate={translate} />,
    );
    expect(screen.getAllByRole('button')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: /diagram.typeSequence/ }));
    expect(onSelect).toHaveBeenCalledWith('sequence');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('explains Astah proprietary files without offering a direct parser', () => {
    render(
      <DiagramImportDialog
        onCancel={vi.fn()}
        onCommit={vi.fn()}
        outcome={{
          status: 'astah-bridge-required',
          fileName: 'model.asta',
          acceptedBridgeExtension: '.spinel-import.json',
          alternatives: ['.xmi', '.xml'],
        }}
        pending={false}
        translate={translate}
      />,
    );
    expect(screen.getByText('diagram.astahBridgeExplanation')).toBeTruthy();
    expect(screen.getByText('.spinel-import.json')).toBeTruthy();
  });

  it('removes diagram transitions for reduced motion', () => {
    const css = readFileSync(
      path.join(process.cwd(), 'src/renderer/projects/diagram/diagram.css'),
      'utf8',
    );
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('transition-duration: 0ms !important');
    expect(css).toContain('flex-wrap: wrap');
    expect(css).not.toContain('overflow-x: auto');
  });
});
