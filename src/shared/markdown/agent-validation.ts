import {
  NOTE_AGENT_MAX_FRAGMENT_LENGTH,
  NOTE_AGENT_MAX_OPERATIONS,
  NOTE_AGENT_TOOL_NAMES,
  type NoteAgentOperation,
  type NoteAgentToolCall,
} from './agent-types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isBoundedString(
  value: unknown,
  maximumLength: number,
  allowEmpty = false,
): value is string {
  return (
    typeof value === 'string' &&
    (allowEmpty || value.length > 0) &&
    value.length <= maximumLength
  );
}

function isOccurrence(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= 10_000
  );
}

function hasValidSelection(
  value: Record<string, unknown>,
): boolean {
  return (
    (value.all === undefined || typeof value.all === 'boolean') &&
    (value.occurrence === undefined || isOccurrence(value.occurrence)) &&
    !(value.all === true && value.occurrence !== undefined)
  );
}

export function isNoteAgentOperation(
  value: unknown,
): value is NoteAgentOperation {
  if (!isRecord(value)) {
    return false;
  }
  switch (value.type) {
    case 'insert': {
      const positional =
        value.position === 'start' || value.position === 'end';
      return (
        hasOnlyKeys(value, [
          'anchor',
          'occurrence',
          'position',
          'text',
          'type',
        ]) &&
        (positional ||
          value.position === 'before' ||
          value.position === 'after') &&
        isBoundedString(
          value.text,
          NOTE_AGENT_MAX_FRAGMENT_LENGTH,
          true,
        ) &&
        (positional
          ? value.anchor === undefined && value.occurrence === undefined
          : isBoundedString(
              value.anchor,
              NOTE_AGENT_MAX_FRAGMENT_LENGTH,
            ) &&
            (value.occurrence === undefined ||
              isOccurrence(value.occurrence)))
      );
    }
    case 'replace':
      return (
        hasOnlyKeys(value, [
          'all',
          'newText',
          'occurrence',
          'oldText',
          'type',
        ]) &&
        isBoundedString(value.oldText, NOTE_AGENT_MAX_FRAGMENT_LENGTH) &&
        isBoundedString(
          value.newText,
          NOTE_AGENT_MAX_FRAGMENT_LENGTH,
          true,
        ) &&
        hasValidSelection(value)
      );
    case 'delete':
      return (
        hasOnlyKeys(value, ['all', 'occurrence', 'text', 'type']) &&
        isBoundedString(value.text, NOTE_AGENT_MAX_FRAGMENT_LENGTH) &&
        hasValidSelection(value)
      );
    case 'replace-document':
      return (
        hasOnlyKeys(value, ['content', 'type']) &&
        isBoundedString(
          value.content,
          NOTE_AGENT_MAX_FRAGMENT_LENGTH,
          true,
        )
      );
    default:
      return false;
  }
}

function isOperations(value: unknown): value is readonly NoteAgentOperation[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= NOTE_AGENT_MAX_OPERATIONS &&
    value.every(isNoteAgentOperation)
  );
}

export function isNoteAgentToolCall(
  value: unknown,
): value is NoteAgentToolCall {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['args', 'id', 'name']) ||
    !isBoundedString(value.id, 128) ||
    !NOTE_AGENT_TOOL_NAMES.includes(
      value.name as (typeof NOTE_AGENT_TOOL_NAMES)[number],
    ) ||
    !isRecord(value.args)
  ) {
    return false;
  }
  switch (value.name) {
    case 'list_project_notes':
      return (
        hasOnlyKeys(value.args, ['scope']) &&
        (value.args.scope === 'current' || value.args.scope === 'project')
      );
    case 'read_note':
      return (
        hasOnlyKeys(value.args, ['nodeId']) &&
        isBoundedString(value.args.nodeId, 128)
      );
    case 'propose_note_changes':
      return (
        hasOnlyKeys(value.args, [
          'expectedRevision',
          'nodeId',
          'operations',
          'summary',
        ]) &&
        isBoundedString(value.args.expectedRevision, 128) &&
        isBoundedString(value.args.nodeId, 128) &&
        isOperations(value.args.operations) &&
        isBoundedString(value.args.summary, 4_000)
      );
    default:
      return false;
  }
}
