import { describe, expect, it } from 'vitest';

import {
  applyDiagramAgentOperations,
  createDiagramDocument,
  isDiagramAgentToolCall,
  type DiagramAgentOperation,
  type DiagramType,
} from '../../src/shared/diagram';

function ids() {
  let value = 0;
  return () =>
    `00000000-0000-4000-8000-${String(++value).padStart(12, '0')}`;
}

function apply(
  diagramType: DiagramType,
  operations: readonly DiagramAgentOperation[],
) {
  return applyDiagramAgentOperations(
    createDiagramDocument(
      diagramType,
      () => '10000000-0000-4000-8000-000000000000',
    ),
    operations,
    { createId: ids() },
  );
}

describe('diagram agent operations', () => {
  it('creates complete class UML with stable member ids and composition', () => {
    const result = apply('class', [
      {
        type: 'add-element',
        ref: 'customer',
        kind: 'class',
        changes: {
          name: 'Customer',
          bounds: { x: 32, y: 48, width: 260, height: 180 },
          color: '#8f4fc4',
          attributes: [
            {
              name: 'name',
              type: 'string',
              visibility: 'private',
              isStatic: false,
              isReadOnly: false,
              taggedValues: [],
            },
          ],
          operations: [
            {
              name: 'rename',
              returnType: 'void',
              visibility: 'public',
              isAbstract: false,
              isStatic: false,
              parameters: [
                {
                  name: 'name',
                  type: 'string',
                  direction: 'in',
                },
              ],
              taggedValues: [],
            },
          ],
        },
      },
      {
        type: 'add-element',
        ref: 'address',
        kind: 'class',
        changes: { name: 'Address' },
      },
      {
        type: 'add-relationship',
        ref: 'owns',
        kind: 'composition',
        sourceRef: 'customer',
        targetRef: 'address',
        changes: {
          name: 'addresses',
          targetMultiplicity: '0..*',
          wholeEnd: 'source',
        },
      },
    ]);

    const customer = result.document.elements.find(
      ({ name }) => name === 'Customer',
    );
    expect(customer).toMatchObject({ kind: 'class' });
    if (customer?.kind !== 'class') {
      throw new Error('Expected class');
    }
    expect(customer.attributes[0]?.id).toMatch(
      /^00000000-0000-4000-8000-/,
    );
    expect(customer.operations[0]?.parameters[0]?.id).toMatch(
      /^00000000-0000-4000-8000-/,
    );
    expect(result.document.relationships[0]).toMatchObject({
      kind: 'composition',
      wholeEnd: 'source',
      targetMultiplicity: '0..*',
    });
    expect(result.document.presentations.nodes[0]).toMatchObject({
      appearance: { color: '#8f4fc4' },
      bounds: { x: 32, y: 48, width: 260, height: 180 },
    });
  });

  it.each([
    {
      type: 'use-case' as const,
      operations: [
        {
          type: 'add-element' as const,
          ref: 'actor',
          kind: 'actor' as const,
          changes: { name: 'User' },
        },
        {
          type: 'add-element' as const,
          ref: 'login',
          kind: 'use-case' as const,
          changes: { name: 'Log in' },
        },
        {
          type: 'add-element' as const,
          ref: 'auth',
          kind: 'use-case' as const,
          changes: { name: 'Authenticate' },
        },
        {
          type: 'add-relationship' as const,
          ref: 'include',
          kind: 'include' as const,
          sourceRef: 'login',
          targetRef: 'auth',
        },
      ],
      relationship: 'include',
    },
    {
      type: 'sequence' as const,
      operations: [
        {
          type: 'add-element' as const,
          ref: 'client',
          kind: 'lifeline' as const,
          changes: { name: 'Client' },
        },
        {
          type: 'add-element' as const,
          ref: 'api',
          kind: 'lifeline' as const,
          changes: { name: 'API' },
        },
        {
          type: 'add-relationship' as const,
          ref: 'request',
          kind: 'message-synchronous' as const,
          sourceRef: 'client',
          targetRef: 'api',
          changes: { name: 'request()', order: 1 },
        },
      ],
      relationship: 'message-synchronous',
    },
    {
      type: 'activity' as const,
      operations: [
        {
          type: 'add-element' as const,
          ref: 'lane',
          kind: 'activity-partition' as const,
          changes: {
            name: 'Service',
            bounds: { x: 0, y: 0, width: 300, height: 600 },
          },
        },
        {
          type: 'add-element' as const,
          ref: 'action',
          kind: 'action' as const,
          changes: { name: 'Process', partitionId: 'lane' },
        },
        {
          type: 'add-element' as const,
          ref: 'final',
          kind: 'flow-final' as const,
          changes: { partitionId: 'lane' },
        },
        {
          type: 'add-relationship' as const,
          ref: 'flow',
          kind: 'control-flow' as const,
          sourceRef: 'action',
          targetRef: 'final',
          changes: { guard: 'success' },
        },
      ],
      relationship: 'control-flow',
    },
  ])('supports $type agent plans', ({ type, operations, relationship }) => {
    const result = apply(type, operations);

    expect(result.document.relationships[0]?.kind).toBe(relationship);
    expect(result.summary.addedElements).toBeGreaterThan(1);
    expect(result.summary.addedRelationships).toBe(1);
  });

  it('rejects incompatible elements and marks removals as destructive', () => {
    expect(() =>
      apply('activity', [
        {
          type: 'add-element',
          ref: 'wrong',
          kind: 'class',
        },
      ]),
    ).toThrow(/not valid/);

    const base = apply('use-case', [
      { type: 'add-element', ref: 'actor', kind: 'actor' },
    ]);
    const elementId = base.document.elements[0]!.id;
    const removed = applyDiagramAgentOperations(
      base.document,
      [{ type: 'remove-element', elementRef: elementId }],
      { createId: ids() },
    );
    expect(removed.summary.destructive).toBe(true);
    expect(removed.document.elements).toHaveLength(0);
  });

  it('validates discriminated tool calls and rejects arbitrary patches', () => {
    expect(
      isDiagramAgentToolCall({
        id: 'call-1',
        name: 'propose_diagram_changes',
        args: {
          nodeId: 'node-1',
          summary: 'Rename',
          operations: [
            {
              type: 'update-element',
              elementRef: 'element-1',
              changes: { name: 'Renamed' },
            },
          ],
        },
      }),
    ).toBe(true);
    expect(
      isDiagramAgentToolCall({
        id: 'call-1',
        name: 'propose_diagram_changes',
        args: {
          nodeId: 'node-1',
          summary: 'Unsafe',
          operations: [
            {
              type: 'update-element',
              elementRef: 'element-1',
              changes: { css: 'url(file:///secret)' },
            },
          ],
        },
      }),
    ).toBe(false);
  });
});
