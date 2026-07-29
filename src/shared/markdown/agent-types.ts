export const NOTE_AGENT_MAX_OPERATIONS = 24;
export const NOTE_AGENT_MAX_FRAGMENT_LENGTH = 200_000;
export const NOTE_AGENT_MAX_TOOL_RESULT_BYTES = 512 * 1024;

export interface NoteAgentInsertOperation {
  anchor?: string;
  occurrence?: number;
  position: 'start' | 'end' | 'before' | 'after';
  text: string;
  type: 'insert';
}

export interface NoteAgentReplaceOperation {
  all?: boolean;
  newText: string;
  occurrence?: number;
  oldText: string;
  type: 'replace';
}

export interface NoteAgentDeleteOperation {
  all?: boolean;
  occurrence?: number;
  text: string;
  type: 'delete';
}

export interface NoteAgentReplaceDocumentOperation {
  content: string;
  type: 'replace-document';
}

export type NoteAgentOperation =
  | NoteAgentInsertOperation
  | NoteAgentReplaceOperation
  | NoteAgentDeleteOperation
  | NoteAgentReplaceDocumentOperation;

export interface NoteAgentChangeRequest {
  expectedRevision: string;
  nodeId: string;
  operations: readonly NoteAgentOperation[];
  summary: string;
}

export interface NoteAgentOperationSummary {
  deletedCharacters: number;
  destructive: boolean;
  insertedCharacters: number;
  operationCount: number;
}

export interface NoteAgentApplyResult {
  content: string;
  snapshots: readonly string[];
  summary: NoteAgentOperationSummary;
}

export interface NoteAgentProposal {
  description: string;
  id: string;
  kind: 'note';
  nodeId: string;
  operationSummary: NoteAgentOperationSummary;
  title: string;
}

export const NOTE_AGENT_TOOL_NAMES = [
  'list_project_notes',
  'read_note',
  'propose_note_changes',
] as const;

export type NoteAgentToolName =
  (typeof NOTE_AGENT_TOOL_NAMES)[number];

export type NoteAgentToolCall =
  | {
      args: { scope: 'current' | 'project' };
      id: string;
      name: 'list_project_notes';
    }
  | {
      args: { nodeId: string };
      id: string;
      name: 'read_note';
    }
  | {
      args: NoteAgentChangeRequest;
      id: string;
      name: 'propose_note_changes';
    };
