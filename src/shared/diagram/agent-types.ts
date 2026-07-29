import type {
  DiagramBounds,
  DiagramDiagnostic,
  DiagramDocument,
  DiagramElement,
  DiagramElementColor,
  DiagramRelationship,
  DiagramSettings,
  DiagramType,
  UmlAttribute,
  UmlOperation,
  UmlParameter,
  UmlTaggedValue,
  UmlVisibility,
} from './types';

export const DIAGRAM_AGENT_MAX_OPERATIONS = 24;
export const DIAGRAM_AGENT_MAX_TOOL_RESULT_BYTES = 512 * 1_024;

export type DiagramAgentContextScope = 'current' | 'project';

export interface DiagramAgentMemberParameter
  extends Omit<UmlParameter, 'id'> {
  id?: string;
}

export interface DiagramAgentAttribute
  extends Omit<UmlAttribute, 'id'> {
  id?: string;
}

export interface DiagramAgentOperationMember
  extends Omit<UmlOperation, 'id' | 'parameters'> {
  id?: string;
  parameters: readonly DiagramAgentMemberParameter[];
}

export interface DiagramAgentElementChanges {
  name?: string;
  documentation?: string | null;
  stereotypes?: readonly string[];
  taggedValues?: readonly UmlTaggedValue[];
  bounds?: DiagramBounds;
  color?: DiagramElementColor | null;
  isAbstract?: boolean;
  attributes?: readonly DiagramAgentAttribute[];
  operations?: readonly DiagramAgentOperationMember[];
  literals?: readonly string[];
  classifierRef?: string | null;
  lifelineId?: string;
  orientation?: 'vertical' | 'horizontal';
  partitionId?: string | null;
  objectType?: string | null;
}

export interface DiagramAgentRelationshipChanges {
  name?: string;
  documentation?: string | null;
  stereotypes?: readonly string[];
  taggedValues?: readonly UmlTaggedValue[];
  sourceRef?: string;
  targetRef?: string;
  sourceMultiplicity?: string | null;
  targetMultiplicity?: string | null;
  wholeEnd?: 'source' | 'target' | null;
  order?: number;
  guard?: string | null;
}

export type DiagramAgentOperation =
  | {
      type: 'add-element';
      ref: string;
      kind: DiagramElement['kind'];
      changes?: DiagramAgentElementChanges;
    }
  | {
      type: 'update-element';
      elementRef: string;
      changes: DiagramAgentElementChanges;
    }
  | {
      type: 'remove-element';
      elementRef: string;
    }
  | {
      type: 'add-relationship';
      ref: string;
      kind: DiagramRelationship['kind'];
      sourceRef: string;
      targetRef: string;
      changes?: DiagramAgentRelationshipChanges;
    }
  | {
      type: 'update-relationship';
      relationshipRef: string;
      changes: DiagramAgentRelationshipChanges;
    }
  | {
      type: 'remove-relationship';
      relationshipRef: string;
    }
  | {
      type: 'update-settings';
      changes: Partial<DiagramSettings>;
    };

export interface DiagramAgentChangeRequest {
  nodeId: string;
  summary: string;
  operations: readonly DiagramAgentOperation[];
}

export interface DiagramAgentCreateRequest {
  name: string;
  diagramType: DiagramType;
  parentId?: string | null;
  summary: string;
  operations: readonly DiagramAgentOperation[];
}

export interface DiagramAgentOperationSummary {
  addedElements: number;
  updatedElements: number;
  removedElements: number;
  addedRelationships: number;
  updatedRelationships: number;
  removedRelationships: number;
  settingsChanged: boolean;
  destructive: boolean;
}

export interface DiagramAgentPlanResult {
  document: DiagramDocument;
  diagnostics: readonly DiagramDiagnostic[];
  summary: DiagramAgentOperationSummary;
}

export interface DiagramAgentProposal {
  id: string;
  kind: 'diagram';
  title: string;
  description: string;
  nodeId?: string;
  diagramType: DiagramType;
  diagnosticsBefore: readonly DiagramDiagnostic[];
  diagnosticsAfter: readonly DiagramDiagnostic[];
  operationSummary: DiagramAgentOperationSummary;
}

export interface DiagramAgentToolContext {
  enabled: true;
  scope: DiagramAgentContextScope;
  currentDiagramNodeId?: string;
}

export const DIAGRAM_AGENT_TOOL_NAMES = [
  'list_project_diagrams',
  'read_diagram',
  'validate_diagram',
  'propose_diagram_changes',
  'propose_new_diagram',
] as const;

export type DiagramAgentToolName =
  (typeof DIAGRAM_AGENT_TOOL_NAMES)[number];

export interface DiagramAgentToolResult {
  ok: boolean;
  text: string;
}

export interface DiagramAgentListArgs {
  scope: DiagramAgentContextScope;
}

export interface DiagramAgentReadArgs {
  nodeId: string;
}

export interface DiagramAgentValidateArgs {
  nodeId: string;
}

export type DiagramAgentToolCall =
  | {
      id: string;
      name: 'list_project_diagrams';
      args: DiagramAgentListArgs;
    }
  | {
      id: string;
      name: 'read_diagram';
      args: DiagramAgentReadArgs;
    }
  | {
      id: string;
      name: 'validate_diagram';
      args: DiagramAgentValidateArgs;
    }
  | {
      id: string;
      name: 'propose_diagram_changes';
      args: DiagramAgentChangeRequest;
    }
  | {
      id: string;
      name: 'propose_new_diagram';
      args: DiagramAgentCreateRequest;
    };

export interface DiagramAgentApplyOptions {
  createId?: () => string;
}

export type DiagramAgentKnownElementFields =
  | keyof DiagramAgentElementChanges
  | keyof Pick<DiagramElement, 'id' | 'kind'>;

export type DiagramAgentKnownRelationshipFields =
  | keyof DiagramAgentRelationshipChanges
  | keyof Pick<DiagramRelationship, 'id' | 'kind'>;

export type DiagramAgentKnownVisibility = UmlVisibility;
