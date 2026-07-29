import type { WebContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TwineGenerationService } from '../../src/main/twine';
import type { TwineGenerationEvent } from '../../src/shared/contracts';

const genaiMocks = vi.hoisted(() => ({
  generateContentStream: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContentStream: genaiMocks.generateContentStream,
    };
  },
}));

function stream(...chunks: unknown[]) {
  return (async function* () {
    for (const chunk of chunks) {
      yield chunk;
    }
  })();
}

describe('Twine document function loop', () => {
  beforeEach(() => vi.clearAllMocks());

  it('waits for the validated renderer result and resumes the model', async () => {
    genaiMocks.generateContentStream
      .mockResolvedValueOnce(
        stream({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      id: 'call-1',
                      name: 'read_diagram',
                      args: { nodeId: 'diagram-1' },
                    },
                  },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        stream({
          candidates: [
            {
              content: {
                parts: [{ text: 'Diagrama analisado.' }],
              },
            },
          ],
        }),
      );
    const events: TwineGenerationEvent[] = [];
    const webContents = {
      isDestroyed: () => false,
      send: (_channel: string, event: TwineGenerationEvent) =>
        events.push(event),
    } as unknown as WebContents;
    const service = new TwineGenerationService();

    service.start(
      {
        approvalMode: 'request',
        documentAgent: {
          enabled: true,
          scope: 'current',
          currentTarget: {
            nodeId: 'diagram-1',
            pageType: 'diagram',
          },
        },
        messages: [{ role: 'user', text: 'Analise o diagrama' }],
        modelId: 'google/gemma-4-31B-it',
        requestId: 'request-1',
        researchEnabled: false,
        thinkingLevel: 'low',
      },
      'api-key',
      webContents,
      'twine-events',
    );

    await vi.waitFor(() =>
      expect(events).toContainEqual({
        requestId: 'request-1',
        type: 'document-tool-call',
        call: {
          id: 'call-1',
          name: 'read_diagram',
          args: { nodeId: 'diagram-1' },
        },
      }),
    );
    expect(
      service.submitDocumentToolResult({
        requestId: 'request-1',
        callId: 'call-1',
        result: { ok: true, text: '{"diagramType":"class"}' },
      }),
    ).toBe(true);

    await vi.waitFor(() =>
      expect(events.at(-1)).toMatchObject({ type: 'done' }),
    );
    expect(genaiMocks.generateContentStream).toHaveBeenCalledTimes(2);
    expect(
      genaiMocks.generateContentStream.mock.calls[1]?.[0].contents.at(-1),
    ).toEqual({
      role: 'user',
      parts: [
        {
          functionResponse: {
            id: 'call-1',
            name: 'read_diagram',
            response: { output: '{"diagramType":"class"}' },
          },
        },
      ],
    });
    expect(events).toContainEqual({
      requestId: 'request-1',
      text: 'Diagrama analisado.',
      type: 'text-delta',
    });
  });

  it('routes note tool calls through the same bounded loop', async () => {
    genaiMocks.generateContentStream
      .mockResolvedValueOnce(
        stream({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      id: 'note-call-1',
                      name: 'read_note',
                      args: { nodeId: 'note-1' },
                    },
                  },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        stream({
          candidates: [
            {
              content: {
                parts: [{ text: 'Nota atualizada.' }],
              },
            },
          ],
        }),
      );
    const events: TwineGenerationEvent[] = [];
    const webContents = {
      isDestroyed: () => false,
      send: (_channel: string, event: TwineGenerationEvent) =>
        events.push(event),
    } as unknown as WebContents;
    const service = new TwineGenerationService();

    service.start(
      {
        approvalMode: 'full',
        documentAgent: {
          enabled: true,
          scope: 'current',
          currentTarget: {
            nodeId: 'note-1',
            pageType: 'markdown',
          },
        },
        messages: [{ role: 'user', text: 'Atualize a nota' }],
        modelId: 'google/gemma-4-31B-it',
        requestId: 'request-note',
        researchEnabled: false,
        thinkingLevel: 'low',
      },
      'api-key',
      webContents,
      'twine-events',
    );

    await vi.waitFor(() =>
      expect(events).toContainEqual({
        requestId: 'request-note',
        type: 'document-tool-call',
        call: {
          id: 'note-call-1',
          name: 'read_note',
          args: { nodeId: 'note-1' },
        },
      }),
    );
    expect(
      service.submitDocumentToolResult({
        requestId: 'request-note',
        callId: 'note-call-1',
        result: {
          ok: true,
          text: JSON.stringify({
            revision: 'a'.repeat(64),
            content: '# Nota',
          }),
        },
      }),
    ).toBe(true);

    await vi.waitFor(() =>
      expect(events.at(-1)).toMatchObject({ type: 'done' }),
    );
    expect(events).toContainEqual({
      requestId: 'request-note',
      text: 'Nota atualizada.',
      type: 'text-delta',
    });
  });
});
