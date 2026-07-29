import {
  NOTE_AGENT_MAX_FRAGMENT_LENGTH,
  type NoteAgentApplyResult,
  type NoteAgentOperation,
  type NoteAgentOperationSummary,
} from './agent-types';

const NOTE_AGENT_MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

function occurrenceIndex(
  content: string,
  search: string,
  occurrence = 1,
): number {
  let index = -1;
  let offset = 0;
  for (let current = 0; current < occurrence; current += 1) {
    index = content.indexOf(search, offset);
    if (index < 0) {
      throw new TypeError(
        `The expected note text was not found (occurrence ${occurrence}).`,
      );
    }
    offset = index + search.length;
  }
  return index;
}

function replaceAllExact(
  content: string,
  search: string,
  replacement: string,
): { content: string; count: number } {
  const count = content.split(search).length - 1;
  if (count === 0) {
    throw new TypeError('The expected note text was not found.');
  }
  return {
    content: content.split(search).join(replacement),
    count,
  };
}

function applyOperation(
  content: string,
  operation: NoteAgentOperation,
): {
  content: string;
  deletedCharacters: number;
  insertedCharacters: number;
} {
  switch (operation.type) {
    case 'insert': {
      if (operation.position === 'start') {
        return {
          content: operation.text + content,
          deletedCharacters: 0,
          insertedCharacters: operation.text.length,
        };
      }
      if (operation.position === 'end') {
        return {
          content: content + operation.text,
          deletedCharacters: 0,
          insertedCharacters: operation.text.length,
        };
      }
      const anchor = operation.anchor!;
      const index = occurrenceIndex(
        content,
        anchor,
        operation.occurrence,
      );
      const insertion =
        operation.position === 'before' ? index : index + anchor.length;
      return {
        content:
          content.slice(0, insertion) +
          operation.text +
          content.slice(insertion),
        deletedCharacters: 0,
        insertedCharacters: operation.text.length,
      };
    }
    case 'replace': {
      if (operation.all) {
        const replaced = replaceAllExact(
          content,
          operation.oldText,
          operation.newText,
        );
        return {
          content: replaced.content,
          deletedCharacters: operation.oldText.length * replaced.count,
          insertedCharacters: operation.newText.length * replaced.count,
        };
      }
      const index = occurrenceIndex(
        content,
        operation.oldText,
        operation.occurrence,
      );
      return {
        content:
          content.slice(0, index) +
          operation.newText +
          content.slice(index + operation.oldText.length),
        deletedCharacters: operation.oldText.length,
        insertedCharacters: operation.newText.length,
      };
    }
    case 'delete': {
      if (operation.all) {
        const deleted = replaceAllExact(content, operation.text, '');
        return {
          content: deleted.content,
          deletedCharacters: operation.text.length * deleted.count,
          insertedCharacters: 0,
        };
      }
      const index = occurrenceIndex(
        content,
        operation.text,
        operation.occurrence,
      );
      return {
        content:
          content.slice(0, index) +
          content.slice(index + operation.text.length),
        deletedCharacters: operation.text.length,
        insertedCharacters: 0,
      };
    }
    case 'replace-document':
      return {
        content: operation.content,
        deletedCharacters: content.length,
        insertedCharacters: operation.content.length,
      };
  }
}

function validateContentSize(content: string): void {
  if (
    content.length > NOTE_AGENT_MAX_DOCUMENT_BYTES ||
    new TextEncoder().encode(content).byteLength >
      NOTE_AGENT_MAX_DOCUMENT_BYTES
  ) {
    throw new RangeError('The generated note exceeds the supported size.');
  }
}

export function applyNoteAgentOperations(
  source: string,
  operations: readonly NoteAgentOperation[],
): NoteAgentApplyResult {
  if (operations.length === 0) {
    throw new TypeError('At least one note operation is required.');
  }
  let content = source;
  let deletedCharacters = 0;
  let insertedCharacters = 0;
  const snapshots: string[] = [];
  for (const operation of operations) {
    if (
      operation.type === 'replace-document' &&
      operation.content.length > NOTE_AGENT_MAX_FRAGMENT_LENGTH
    ) {
      throw new RangeError('The replacement note is too large.');
    }
    const result = applyOperation(content, operation);
    content = result.content;
    deletedCharacters += result.deletedCharacters;
    insertedCharacters += result.insertedCharacters;
    validateContentSize(content);
    snapshots.push(content);
  }
  const summary: NoteAgentOperationSummary = {
    deletedCharacters,
    destructive: operations.some(
      ({ type }) => type === 'delete' || type === 'replace-document',
    ),
    insertedCharacters,
    operationCount: operations.length,
  };
  return { content, snapshots, summary };
}
