import { isNoteAgentToolCall } from '../../shared/markdown';
import type {
  TwineDocumentAgent,
  TwineDocumentTarget,
} from './twine-agent-types';
import type { TwineDiagramAgent } from './twine-diagram-agent';
import type { TwineNoteAgent } from './twine-note-agent';

export interface CreateTwineDocumentAgentOptions {
  currentTarget?: TwineDocumentTarget;
  diagram: TwineDiagramAgent;
  note: TwineNoteAgent;
}

export function createTwineDocumentAgent({
  currentTarget,
  diagram,
  note,
}: CreateTwineDocumentAgentOptions): TwineDocumentAgent {
  return {
    available: diagram.available || note.available,
    currentTarget,
    execute: (call, options) =>
      isNoteAgentToolCall(call)
        ? note.execute(call, options)
        : diagram.execute(call, options),
  };
}
