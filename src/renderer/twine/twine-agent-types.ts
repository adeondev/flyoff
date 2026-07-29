import type {
  TwineDocumentToolCall,
  TwineDocumentToolResult,
} from '../../shared/contracts';
import type { DiagramAgentProposal } from '../../shared/diagram';
import type { NoteAgentProposal } from '../../shared/markdown';
import type { TwineApprovalMode } from './twine-state';

export type TwineDocumentProposal =
  | DiagramAgentProposal
  | NoteAgentProposal;

export interface TwineDocumentAgentApprovalRequest {
  proposal: TwineDocumentProposal;
}

export interface TwineDocumentAgentExecutionOptions {
  approvalMode: TwineApprovalMode;
  historyGroup: string;
  requestApproval: (
    request: TwineDocumentAgentApprovalRequest,
  ) => Promise<boolean>;
  scope: 'current' | 'project';
  shouldContinue: () => boolean;
}

export interface TwineDocumentTarget {
  nodeId: string;
  pageType: 'diagram' | 'markdown';
}

export interface TwineDocumentAgent {
  available: boolean;
  currentTarget?: TwineDocumentTarget;
  execute(
    call: TwineDocumentToolCall,
    options: TwineDocumentAgentExecutionOptions,
  ): Promise<TwineDocumentToolResult>;
}
