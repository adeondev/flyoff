import type {
  DiagramDiagnostic,
  DiagramBounds,
  DiagramDocument,
  DiagramElement,
  DiagramRelationship,
  UmlAttribute,
  UmlOperation,
} from '../../../shared/diagram';
import type { Translate } from '../../pages/page-types';
import type { DiagramSelection } from './DiagramCanvas';
import {
  getDiagramMinimumSize,
  getEffectiveDiagramNodePresentation,
  setDiagramNodeSize,
  type ActivityPartitionSide,
} from './diagram-geometry';

interface DiagramInspectorProps {
  diagnostics: readonly DiagramDiagnostic[];
  document: DiagramDocument;
  selection?: DiagramSelection;
  translate: Translate;
  onSelectDiagnostic: (targetId: string) => void;
  onAddPartition: (side: ActivityPartitionSide) => void;
  onResizeElement: (id: string, bounds: DiagramBounds) => void;
  onUpdateElement: (
    id: string,
    update: (element: DiagramElement) => DiagramElement,
  ) => void;
  onUpdateRelationship: (
    id: string,
    update: (relationship: DiagramRelationship) => DiagramRelationship,
  ) => void;
}

function GeometryFields({
  document,
  element,
  onResizeElement,
  translate,
}: {
  document: DiagramDocument;
  element: DiagramElement;
  onResizeElement: DiagramInspectorProps['onResizeElement'];
  translate: Translate;
}) {
  const presentation = document.presentations.nodes.find(
    ({ elementId }) => elementId === element.id,
  );
  if (!presentation) {
    return null;
  }
  const bounds = getEffectiveDiagramNodePresentation(
    element,
    presentation,
  ).bounds;
  const minimum = getDiagramMinimumSize(element);
  return (
    <fieldset className="diagram-inspector__dimensions">
      <legend>{translate('diagram.dimensions')}</legend>
      <label>
        <span>{translate('diagram.width')}</span>
        <input
          min={minimum.width}
          onChange={(event) => {
            const value = event.currentTarget.valueAsNumber;
            if (Number.isFinite(value)) {
              onResizeElement(
                element.id,
                setDiagramNodeSize(element, bounds, 'width', value),
              );
            }
          }}
          step="1"
          type="number"
          value={Math.round(bounds.width)}
        />
      </label>
      <label>
        <span>{translate('diagram.height')}</span>
        <input
          min={minimum.height}
          onChange={(event) => {
            const value = event.currentTarget.valueAsNumber;
            if (Number.isFinite(value)) {
              onResizeElement(
                element.id,
                setDiagramNodeSize(element, bounds, 'height', value),
              );
            }
          }}
          step="1"
          type="number"
          value={Math.round(bounds.height)}
        />
      </label>
    </fieldset>
  );
}

const diagnosticKeys: Partial<
  Record<string, Parameters<Translate>[0]>
> = {
  'element.incompatible': 'diagram.diagnosticElementIncompatible',
  'activation.lifeline-missing': 'diagram.diagnosticActivationLifelineMissing',
  'activity.partition-missing': 'diagram.diagnosticPartitionMissing',
  'relationship.endpoint-missing': 'diagram.diagnosticRelationshipEndpointMissing',
  'relationship.incompatible': 'diagram.diagnosticRelationshipIncompatible',
  'use-case.endpoint-invalid': 'diagram.diagnosticUseCaseEndpointInvalid',
  'sequence.endpoint-invalid': 'diagram.diagnosticSequenceEndpointInvalid',
  'sequence.self-message-invalid': 'diagram.diagnosticSelfMessageInvalid',
  'activity.object-flow-invalid': 'diagram.diagnosticObjectFlowInvalid',
  'class.whole-end-missing': 'diagram.diagnosticWholeEndMissing',
  'presentation.element-missing': 'diagram.diagnosticPresentationElementMissing',
  'presentation.parent-missing': 'diagram.diagnosticPresentationParentMissing',
  'presentation.relationship-missing': 'diagram.diagnosticPresentationRelationshipMissing',
  'presentation.endpoint-missing': 'diagram.diagnosticPresentationEndpointMissing',
  'sequence.order-duplicate': 'diagram.diagnosticSequenceOrderDuplicate',
};

const severityKeys: Record<
  DiagramDiagnostic['severity'],
  Parameters<Translate>[0]
> = {
  error: 'diagram.severityError',
  warning: 'diagram.severityWarning',
  info: 'diagram.severityInfo',
};

function diagnosticMessage(
  item: DiagramDiagnostic,
  translate: Translate,
): string {
  const key = diagnosticKeys[item.code];
  return key ? translate(key) : item.message;
}

function parseList(value: string): readonly string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseTaggedValues(value: string) {
  return value.split('\n').flatMap((line) => {
    const separator = line.indexOf('=');
    return separator > 0
      ? [
          {
            key: line.slice(0, separator).trim(),
            value: line.slice(separator + 1).trim(),
          },
        ]
      : [];
  });
}

function CommonElementFields({
  element,
  onChange,
  translate,
}: {
  element: DiagramElement;
  onChange: (element: DiagramElement) => void;
  translate: Translate;
}) {
  return (
    <>
      <label>
        <span>{translate('diagram.name')}</span>
        <input
          onChange={(event) => onChange({ ...element, name: event.target.value })}
          value={element.name}
        />
      </label>
      <label>
        <span>{translate('diagram.documentation')}</span>
        <textarea
          onChange={(event) =>
            onChange({ ...element, documentation: event.target.value || undefined })
          }
          rows={3}
          value={element.documentation ?? ''}
        />
      </label>
      <label>
        <span>{translate('diagram.stereotypes')}</span>
        <input
          onChange={(event) =>
            onChange({ ...element, stereotypes: parseList(event.target.value) })
          }
          value={element.stereotypes.join(', ')}
        />
      </label>
      <label>
        <span>{translate('diagram.taggedValues')}</span>
        <textarea
          onChange={(event) =>
            onChange({
              ...element,
              taggedValues: parseTaggedValues(event.target.value),
            })
          }
          rows={2}
          value={element.taggedValues.map(({ key, value }) => `${key}=${value}`).join('\n')}
        />
      </label>
    </>
  );
}

function AttributesEditor({
  attributes,
  onChange,
  translate,
}: {
  attributes: readonly UmlAttribute[];
  onChange: (attributes: readonly UmlAttribute[]) => void;
  translate: Translate;
}) {
  return (
    <fieldset className="diagram-inspector__collection">
      <legend>{translate('diagram.attributes')}</legend>
      {attributes.map((attribute, index) => (
        <div className="diagram-inspector__member" key={attribute.id}>
          <select
            aria-label={translate('diagram.visibility')}
            onChange={(event) => {
              const next = [...attributes];
              next[index] = { ...attribute, visibility: event.target.value as UmlAttribute['visibility'] };
              onChange(next);
            }}
            value={attribute.visibility}
          >
            <option value="public">public</option>
            <option value="private">private</option>
            <option value="protected">protected</option>
            <option value="package">package</option>
          </select>
          <input
            aria-label={translate('diagram.name')}
            onChange={(event) => {
              const next = [...attributes];
              next[index] = { ...attribute, name: event.target.value };
              onChange(next);
            }}
            value={attribute.name}
          />
          <input
            aria-label={translate('projects.propertiesType')}
            onChange={(event) => {
              const next = [...attributes];
              next[index] = { ...attribute, type: event.target.value };
              onChange(next);
            }}
            value={attribute.type}
          />
          <input
            aria-label={translate('diagram.targetMultiplicity')}
            onChange={(event) => {
              const next = [...attributes];
              next[index] = { ...attribute, multiplicity: event.target.value || undefined };
              onChange(next);
            }}
            value={attribute.multiplicity ?? ''}
          />
          <input
            aria-label={translate('diagram.defaultValue')}
            onChange={(event) => {
              const next = [...attributes];
              next[index] = {
                ...attribute,
                defaultValue: event.target.value || undefined,
              };
              onChange(next);
            }}
            value={attribute.defaultValue ?? ''}
          />
          <label className="diagram-inspector__check">
            <input
              checked={attribute.isStatic}
              onChange={(event) => {
                const next = [...attributes];
                next[index] = { ...attribute, isStatic: event.target.checked };
                onChange(next);
              }}
              type="checkbox"
            />
            {translate('diagram.staticMember')}
          </label>
          <label className="diagram-inspector__check">
            <input
              checked={attribute.isReadOnly}
              onChange={(event) => {
                const next = [...attributes];
                next[index] = { ...attribute, isReadOnly: event.target.checked };
                onChange(next);
              }}
              type="checkbox"
            />
            {translate('diagram.readOnly')}
          </label>
          <button
            aria-label={translate('projects.delete')}
            onClick={() => onChange(attributes.filter(({ id }) => id !== attribute.id))}
            type="button"
          >
            {translate('projects.delete')}
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          onChange([
            ...attributes,
            {
              id: crypto.randomUUID(),
              name: 'attribute',
              type: 'string',
              visibility: 'private',
              isStatic: false,
              isReadOnly: false,
              taggedValues: [],
            },
          ])
        }
        type="button"
      >
        {translate('projects.add')}
      </button>
    </fieldset>
  );
}

function OperationsEditor({
  operations,
  onChange,
  translate,
}: {
  operations: readonly UmlOperation[];
  onChange: (operations: readonly UmlOperation[]) => void;
  translate: Translate;
}) {
  return (
    <fieldset className="diagram-inspector__collection">
      <legend>{translate('diagram.operations')}</legend>
      {operations.map((operation, index) => (
        <div className="diagram-inspector__member" key={operation.id}>
          <select
            aria-label={translate('diagram.visibility')}
            onChange={(event) => {
              const next = [...operations];
              next[index] = {
                ...operation,
                visibility: event.target.value as UmlOperation['visibility'],
              };
              onChange(next);
            }}
            value={operation.visibility}
          >
            <option value="public">public</option>
            <option value="private">private</option>
            <option value="protected">protected</option>
            <option value="package">package</option>
          </select>
          <input
            aria-label={translate('diagram.name')}
            onChange={(event) => {
              const next = [...operations];
              next[index] = { ...operation, name: event.target.value };
              onChange(next);
            }}
            value={operation.name}
          />
          <input
            aria-label={translate('diagram.returnType')}
            onChange={(event) => {
              const next = [...operations];
              next[index] = { ...operation, returnType: event.target.value };
              onChange(next);
            }}
            value={operation.returnType}
          />
          <label className="diagram-inspector__check">
            <input
              checked={operation.isAbstract}
              onChange={(event) => {
                const next = [...operations];
                next[index] = { ...operation, isAbstract: event.target.checked };
                onChange(next);
              }}
              type="checkbox"
            />
            {translate('diagram.abstract')}
          </label>
          <label className="diagram-inspector__check">
            <input
              checked={operation.isStatic}
              onChange={(event) => {
                const next = [...operations];
                next[index] = { ...operation, isStatic: event.target.checked };
                onChange(next);
              }}
              type="checkbox"
            />
            {translate('diagram.staticMember')}
          </label>
          {operation.parameters.map((parameter, parameterIndex) => (
            <div className="diagram-inspector__parameter" key={parameter.id}>
              <input
                aria-label={translate('diagram.parameter')}
                onChange={(event) => {
                  const parameters = [...operation.parameters];
                  parameters[parameterIndex] = { ...parameter, name: event.target.value };
                  const next = [...operations];
                  next[index] = { ...operation, parameters };
                  onChange(next);
                }}
                value={parameter.name}
              />
              <input
                aria-label={translate('projects.propertiesType')}
                onChange={(event) => {
                  const parameters = [...operation.parameters];
                  parameters[parameterIndex] = { ...parameter, type: event.target.value };
                  const next = [...operations];
                  next[index] = { ...operation, parameters };
                  onChange(next);
                }}
                value={parameter.type}
              />
              <select
                aria-label={translate('diagram.direction')}
                onChange={(event) => {
                  const parameters = [...operation.parameters];
                  parameters[parameterIndex] = {
                    ...parameter,
                    direction: event.target.value as typeof parameter.direction,
                  };
                  const next = [...operations];
                  next[index] = { ...operation, parameters };
                  onChange(next);
                }}
                value={parameter.direction}
              >
                <option value="in">in</option>
                <option value="out">out</option>
                <option value="inout">inout</option>
                <option value="return">return</option>
              </select>
              <input
                aria-label={translate('diagram.targetMultiplicity')}
                onChange={(event) => {
                  const parameters = [...operation.parameters];
                  parameters[parameterIndex] = {
                    ...parameter,
                    multiplicity: event.target.value || undefined,
                  };
                  const next = [...operations];
                  next[index] = { ...operation, parameters };
                  onChange(next);
                }}
                value={parameter.multiplicity ?? ''}
              />
              <button
                aria-label={translate('projects.delete')}
                onClick={() => {
                  const next = [...operations];
                  next[index] = {
                    ...operation,
                    parameters: operation.parameters.filter(({ id }) => id !== parameter.id),
                  };
                  onChange(next);
                }}
                type="button"
              >
                {translate('projects.delete')}
              </button>
            </div>
          ))}
          <button
            onClick={() => {
              const next = [...operations];
              next[index] = {
                ...operation,
                parameters: [
                  ...operation.parameters,
                  {
                    id: crypto.randomUUID(),
                    name: 'parameter',
                    type: 'string',
                    direction: 'in',
                  },
                ],
              };
              onChange(next);
            }}
            type="button"
          >
            {translate('diagram.addParameter')}
          </button>
          <button
            onClick={() => onChange(operations.filter(({ id }) => id !== operation.id))}
            type="button"
          >
            {translate('projects.delete')}
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          onChange([
            ...operations,
            {
              id: crypto.randomUUID(),
              name: 'operation',
              returnType: 'void',
              visibility: 'public',
              isAbstract: false,
              isStatic: false,
              parameters: [],
              taggedValues: [],
            },
          ])
        }
        type="button"
      >
        {translate('projects.add')}
      </button>
    </fieldset>
  );
}

export function DiagramInspector({
  diagnostics,
  document,
  onAddPartition,
  onResizeElement,
  onSelectDiagnostic,
  onUpdateElement,
  onUpdateRelationship,
  selection,
  translate,
}: DiagramInspectorProps) {
  const element =
    selection?.kind === 'element'
      ? document.elements.find(({ id }) => id === selection.id)
      : undefined;
  const relationship =
    selection?.kind === 'relationship'
      ? document.relationships.find(({ id }) => id === selection.id)
      : undefined;
  return (
    <aside aria-label={translate('diagram.inspector')} className="diagram-inspector">
      <h2>{translate('diagram.inspector')}</h2>
      <div className="diagram-inspector__fields">
        {element ? (
          <>
            <CommonElementFields
              element={element}
              onChange={(next) => onUpdateElement(element.id, () => next)}
              translate={translate}
            />
            <GeometryFields
              document={document}
              element={element}
              onResizeElement={onResizeElement}
              translate={translate}
            />
            {element.kind === 'class' ? (
              <label className="diagram-inspector__check">
                <input
                  checked={element.isAbstract}
                  onChange={(event) =>
                    onUpdateElement(element.id, (current) =>
                      current.kind === 'class'
                        ? { ...current, isAbstract: event.target.checked }
                        : current,
                    )
                  }
                  type="checkbox"
                />
                {translate('diagram.abstract')}
              </label>
            ) : null}
            {element.kind === 'class' || element.kind === 'interface' ? (
              <>
                <AttributesEditor
                  attributes={element.attributes}
                  onChange={(attributes) =>
                    onUpdateElement(element.id, (current) =>
                      current.kind === 'class' || current.kind === 'interface'
                        ? { ...current, attributes }
                        : current,
                    )
                  }
                  translate={translate}
                />
                <OperationsEditor
                  onChange={(operations) =>
                    onUpdateElement(element.id, (current) =>
                      current.kind === 'class' || current.kind === 'interface'
                        ? { ...current, operations }
                        : current,
                    )
                  }
                  operations={element.operations}
                  translate={translate}
                />
              </>
            ) : null}
            {element.kind === 'enumeration' ? (
              <label>
                <span>{translate('diagram.literals')}</span>
                <textarea
                  onChange={(event) =>
                    onUpdateElement(element.id, (current) =>
                      current.kind === 'enumeration'
                        ? { ...current, literals: event.target.value.split('\n') }
                        : current,
                    )
                  }
                  value={element.literals.join('\n')}
                />
              </label>
            ) : null}
            {element.kind === 'object-node' ? (
              <label>
                <span>{translate('diagram.objectType')}</span>
                <input
                  onChange={(event) =>
                    onUpdateElement(element.id, (current) =>
                      current.kind === 'object-node'
                        ? { ...current, objectType: event.target.value || undefined }
                        : current,
                    )
                  }
                  value={element.objectType ?? ''}
                />
              </label>
            ) : null}
            {element.kind === 'activity-partition' ? (
              <>
                <label>
                  <span>{translate('diagram.orientation')}</span>
                  <select
                    onChange={(event) =>
                      onUpdateElement(element.id, (current) =>
                        current.kind === 'activity-partition'
                          ? { ...current, orientation: event.target.value as 'vertical' | 'horizontal' }
                          : current,
                      )
                    }
                    value={element.orientation}
                  >
                    <option value="vertical">{translate('diagram.vertical')}</option>
                    <option value="horizontal">{translate('diagram.horizontal')}</option>
                  </select>
                </label>
                <div className="diagram-inspector__partition-actions">
                  <button onClick={() => onAddPartition('left')} type="button">
                    {translate('diagram.addPartitionLeft')}
                  </button>
                  <button onClick={() => onAddPartition('right')} type="button">
                    {translate('diagram.addPartitionRight')}
                  </button>
                </div>
              </>
            ) : null}
          </>
        ) : relationship ? (
          <>
            <label>
              <span>{translate('diagram.relationLabel')}</span>
              <input
                onChange={(event) =>
                  onUpdateRelationship(relationship.id, (current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                value={relationship.name}
              />
            </label>
            <label>
              <span>{translate('diagram.documentation')}</span>
              <textarea
                onChange={(event) =>
                  onUpdateRelationship(relationship.id, (current) => ({
                    ...current,
                    documentation: event.target.value || undefined,
                  }))
                }
                rows={3}
                value={relationship.documentation ?? ''}
              />
            </label>
            <label>
              <span>{translate('diagram.stereotypes')}</span>
              <input
                onChange={(event) =>
                  onUpdateRelationship(relationship.id, (current) => ({
                    ...current,
                    stereotypes: parseList(event.target.value),
                  }))
                }
                value={relationship.stereotypes.join(', ')}
              />
            </label>
            <label>
              <span>{translate('diagram.taggedValues')}</span>
              <textarea
                onChange={(event) =>
                  onUpdateRelationship(relationship.id, (current) => ({
                    ...current,
                    taggedValues: parseTaggedValues(event.target.value),
                  }))
                }
                rows={2}
                value={relationship.taggedValues
                  .map(({ key, value }) => `${key}=${value}`)
                  .join('\n')}
              />
            </label>
            {'guard' in relationship ? (
              <label>
                <span>{translate('diagram.guard')}</span>
                <input
                  onChange={(event) =>
                    onUpdateRelationship(relationship.id, (current) =>
                      'guard' in current
                        ? { ...current, guard: event.target.value || undefined }
                        : current,
                    )
                  }
                  value={relationship.guard ?? ''}
                />
              </label>
            ) : null}
            {'sourceMultiplicity' in relationship ? (
              <>
                <label>
                  <span>{translate('diagram.sourceMultiplicity')}</span>
                  <input
                    onChange={(event) =>
                      onUpdateRelationship(relationship.id, (current) =>
                        'sourceMultiplicity' in current
                          ? { ...current, sourceMultiplicity: event.target.value || undefined }
                          : current,
                      )
                    }
                    value={relationship.sourceMultiplicity ?? ''}
                  />
                </label>
                <label>
                  <span>{translate('diagram.targetMultiplicity')}</span>
                  <input
                    onChange={(event) =>
                      onUpdateRelationship(relationship.id, (current) =>
                        'targetMultiplicity' in current
                          ? { ...current, targetMultiplicity: event.target.value || undefined }
                          : current,
                      )
                    }
                    value={relationship.targetMultiplicity ?? ''}
                  />
                </label>
              </>
            ) : null}
            {'wholeEnd' in relationship &&
            (relationship.kind === 'aggregation' ||
              relationship.kind === 'composition') ? (
              <label>
                <span>{translate('diagram.wholeEnd')}</span>
                <select
                  onChange={(event) =>
                    onUpdateRelationship(relationship.id, (current) =>
                      'wholeEnd' in current
                        ? {
                            ...current,
                            wholeEnd: event.target.value as 'source' | 'target',
                          }
                        : current,
                    )
                  }
                  value={relationship.wholeEnd ?? 'source'}
                >
                  <option value="source">{translate('diagram.source')}</option>
                  <option value="target">{translate('diagram.target')}</option>
                </select>
              </label>
            ) : null}
          </>
        ) : (
          <p>{translate('diagram.noSelection')}</p>
        )}
      </div>
      <section aria-live="polite" className="diagram-diagnostics">
        <h3>{translate('diagram.diagnostics')}</h3>
        {diagnostics.length === 0 ? (
          <p>{translate('diagram.noDiagnostics')}</p>
        ) : (
          <ul>
            {diagnostics.map((item, index) => (
              <li data-severity={item.severity} key={`${item.code}:${item.targetId ?? index}`}>
                <strong>{translate(severityKeys[item.severity])}: </strong>
                {item.targetId ? (
                  <button onClick={() => onSelectDiagnostic(item.targetId!)} type="button">
                    {diagnosticMessage(item, translate)}
                  </button>
                ) : (
                  diagnosticMessage(item, translate)
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
