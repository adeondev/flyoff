import { describe, expect, it } from 'vitest';

import {
  applyNoteAgentOperations,
  isNoteAgentToolCall,
} from '../../src/shared/markdown';

describe('note agent operations', () => {
  it('applies exact incremental edits and exposes every valid snapshot', () => {
    const result = applyNoteAgentOperations(
      '# Plano\n\nStatus: antigo\n',
      [
        {
          type: 'replace',
          oldText: 'Status: antigo',
          newText: 'Status: atualizado',
        },
        {
          type: 'insert',
          position: 'after',
          anchor: 'Status: atualizado',
          text: '\n\n- [ ] Validar',
        },
      ],
    );

    expect(result.snapshots).toEqual([
      '# Plano\n\nStatus: atualizado\n',
      '# Plano\n\nStatus: atualizado\n\n- [ ] Validar\n',
    ]);
    expect(result.content).toBe(
      '# Plano\n\nStatus: atualizado\n\n- [ ] Validar\n',
    );
    expect(result.summary).toMatchObject({
      operationCount: 2,
      destructive: false,
    });
  });

  it('rejects stale anchors instead of guessing a position', () => {
    expect(() =>
      applyNoteAgentOperations('Conteúdo atual', [
        {
          type: 'replace',
          oldText: 'Conteúdo antigo',
          newText: 'Novo',
        },
      ]),
    ).toThrow('expected note text was not found');
  });

  it('validates bounded note tool calls and exact operation fields', () => {
    expect(
      isNoteAgentToolCall({
        id: 'call-1',
        name: 'propose_note_changes',
        args: {
          expectedRevision: 'a'.repeat(64),
          nodeId: 'note-1',
          summary: 'Atualizar status',
          operations: [
            {
              type: 'replace',
              oldText: 'antigo',
              newText: 'novo',
            },
          ],
        },
      }),
    ).toBe(true);
    expect(
      isNoteAgentToolCall({
        id: 'call-1',
        name: 'propose_note_changes',
        args: {
          expectedRevision: 'a'.repeat(64),
          nodeId: 'note-1',
          summary: 'Ler arquivo',
          operations: [
            {
              type: 'replace',
              oldText: 'antigo',
              newText: 'novo',
              path: 'C:\\secret.txt',
            },
          ],
        },
      }),
    ).toBe(false);
  });
});
