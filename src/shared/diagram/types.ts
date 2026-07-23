export const DIAGRAM_FORMAT = 'flyoff-diagram' as const;
export const DIAGRAM_FORMAT_VERSION = 2 as const;
export const DIAGRAM_MIME_TYPE = 'application/vnd.flyoff.diagram' as const;
export const DIAGRAM_FILE_EXTENSION = '.flyd' as const;

export type DiagramType = 'class' | 'use-case' | 'sequence' | 'activity';

export type UmlVisibility = 'public' | 'private' | 'protected' | 'package';
export type UmlParameterDirection = 'in' | 'out' | 'inout' | 'return';

export interface DiagramSourceRef {
  system: 'flyd' | 'spinel' | 'astah-bridge' | 'xmi' | 'drawio';
  externalId: string;
  externalDiagramId?: string;
}

export interface UmlTaggedValue {
  key: string;
  value: string;
}

export interface UmlParameter {
  id: string;
  name: string;
  type: string;
  direction: UmlParameterDirection;
  multiplicity?: string;
  defaultValue?: string;
}

export interface UmlAttribute {
  id: string;
  name: string;
  type: string;
  visibility: UmlVisibility;
  isStatic: boolean;
  isReadOnly: boolean;
  multiplicity?: string;
  defaultValue?: string;
  documentation?: string;
  taggedValues: readonly UmlTaggedValue[];
}

export interface UmlOperation {
  id: string;
  name: string;
  returnType: string;
  visibility: UmlVisibility;
  isAbstract: boolean;
  isStatic: boolean;
  parameters: readonly UmlParameter[];
  documentation?: string;
  taggedValues: readonly UmlTaggedValue[];
}

interface DiagramElementBase {
  id: string;
  name: string;
  documentation?: string;
  stereotypes: readonly string[];
  taggedValues: readonly UmlTaggedValue[];
  sourceRef?: DiagramSourceRef;
}

export interface PackageElement extends DiagramElementBase {
  kind: 'package';
}

export interface ClassElement extends DiagramElementBase {
  kind: 'class';
  isAbstract: boolean;
  attributes: readonly UmlAttribute[];
  operations: readonly UmlOperation[];
}

export interface InterfaceElement extends DiagramElementBase {
  kind: 'interface';
  attributes: readonly UmlAttribute[];
  operations: readonly UmlOperation[];
}

export interface EnumerationElement extends DiagramElementBase {
  kind: 'enumeration';
  literals: readonly string[];
}

export interface ActorElement extends DiagramElementBase {
  kind: 'actor';
}

export interface UseCaseElement extends DiagramElementBase {
  kind: 'use-case';
}

export interface SystemBoundaryElement extends DiagramElementBase {
  kind: 'system-boundary';
}

export interface LifelineElement extends DiagramElementBase {
  kind: 'lifeline';
  classifierRef?: string;
}

export interface ActivationElement extends DiagramElementBase {
  kind: 'activation';
  lifelineId: string;
}

export interface ActivityPartitionElement extends DiagramElementBase {
  kind: 'activity-partition';
  orientation: 'vertical' | 'horizontal';
}

export interface ActionElement extends DiagramElementBase {
  kind: 'action';
  partitionId?: string;
}

export interface ObjectNodeElement extends DiagramElementBase {
  kind: 'object-node';
  objectType?: string;
  partitionId?: string;
}

export interface InitialNodeElement extends DiagramElementBase {
  kind: 'initial-node';
  partitionId?: string;
}

export interface ActivityFinalElement extends DiagramElementBase {
  kind: 'activity-final';
  partitionId?: string;
}

export interface FlowFinalElement extends DiagramElementBase {
  kind: 'flow-final';
  partitionId?: string;
}

export interface DecisionElement extends DiagramElementBase {
  kind: 'decision';
  partitionId?: string;
}

export interface MergeElement extends DiagramElementBase {
  kind: 'merge';
  partitionId?: string;
}

export interface ForkElement extends DiagramElementBase {
  kind: 'fork';
  partitionId?: string;
}

export interface JoinElement extends DiagramElementBase {
  kind: 'join';
  partitionId?: string;
}

export type DiagramElement =
  | PackageElement
  | ClassElement
  | InterfaceElement
  | EnumerationElement
  | ActorElement
  | UseCaseElement
  | SystemBoundaryElement
  | LifelineElement
  | ActivationElement
  | ActivityPartitionElement
  | ActionElement
  | ObjectNodeElement
  | InitialNodeElement
  | ActivityFinalElement
  | FlowFinalElement
  | DecisionElement
  | MergeElement
  | ForkElement
  | JoinElement;

interface DiagramRelationshipBase {
  id: string;
  sourceId: string;
  targetId: string;
  name: string;
  documentation?: string;
  stereotypes: readonly string[];
  taggedValues: readonly UmlTaggedValue[];
  sourceRef?: DiagramSourceRef;
}

export type ClassRelationshipKind =
  | 'association'
  | 'directed-association'
  | 'aggregation'
  | 'composition'
  | 'generalization'
  | 'realization'
  | 'dependency';

export interface ClassRelationship extends DiagramRelationshipBase {
  kind: ClassRelationshipKind;
  sourceMultiplicity?: string;
  targetMultiplicity?: string;
  wholeEnd?: 'source' | 'target';
}

export type UseCaseRelationshipKind =
  | 'association'
  | 'include'
  | 'extend'
  | 'generalization';

export interface UseCaseRelationship extends DiagramRelationshipBase {
  kind: UseCaseRelationshipKind;
}

export type SequenceRelationshipKind =
  | 'message-synchronous'
  | 'message-asynchronous'
  | 'message-return'
  | 'self-message';

export interface SequenceRelationship extends DiagramRelationshipBase {
  kind: SequenceRelationshipKind;
  order: number;
  guard?: string;
}

export type ActivityRelationshipKind = 'control-flow' | 'object-flow';

export interface ActivityRelationship extends DiagramRelationshipBase {
  kind: ActivityRelationshipKind;
  guard?: string;
}

export type DiagramRelationship =
  | ClassRelationship
  | UseCaseRelationship
  | SequenceRelationship
  | ActivityRelationship;

export interface DiagramPoint {
  x: number;
  y: number;
}

export interface DiagramBounds extends DiagramPoint {
  width: number;
  height: number;
}

export type DiagramElementColor = `#${string}`;

export interface DiagramNodeAppearance {
  color: DiagramElementColor;
}

export interface DiagramNodePresentation {
  id: string;
  elementId: string;
  bounds: DiagramBounds;
  zIndex: number;
  parentPresentationId?: string;
  appearance?: DiagramNodeAppearance;
}

export interface DiagramEdgePresentation {
  id: string;
  relationshipId: string;
  sourcePresentationId: string;
  targetPresentationId: string;
  points: readonly DiagramPoint[];
  labelPosition?: DiagramPoint;
}

export interface DiagramPresentations {
  nodes: readonly DiagramNodePresentation[];
  edges: readonly DiagramEdgePresentation[];
}

export interface DiagramSettings {
  showGrid: boolean;
  snapToGrid: boolean;
  gridSize: number;
}

export interface DiagramDocument {
  format: typeof DIAGRAM_FORMAT;
  formatVersion: typeof DIAGRAM_FORMAT_VERSION;
  documentId: string;
  diagramType: DiagramType;
  elements: readonly DiagramElement[];
  relationships: readonly DiagramRelationship[];
  presentations: DiagramPresentations;
  settings: DiagramSettings;
  sourceRef?: DiagramSourceRef;
}

export type DiagramDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface DiagramDiagnostic {
  code: string;
  severity: DiagramDiagnosticSeverity;
  message: string;
  targetId?: string;
}

export interface DiagramViewport {
  x: number;
  y: number;
  zoom: number;
}
