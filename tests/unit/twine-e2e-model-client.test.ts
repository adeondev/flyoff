import { describe, expect, it } from 'vitest';

import {
  createTwineE2eModelClientFactory,
  type TwineGenerateContentParams,
} from '../../src/main/twine';
import type { TwineGenerationRequest } from '../../src/shared/contracts';

function request(
  pageType: 'diagram' | 'markdown',
): TwineGenerationRequest {
  return {
    approvalMode: 'full',
    documentAgent: {
      enabled: true,
      scope: 'current',
      currentTarget: {
        nodeId: `${pageType}-1`,
        pageType,
      },
    },
    messages: [{ role: 'user', text: 'Edite o documento' }],
    modelId: 'google/gemma-4-31B-it',
    requestId: `request-${pageType}`,
    researchEnabled: false,
    thinkingLevel: 'low',
  };
}

function params(parts: TwineGenerateContentParams['contents'][number]['parts'] = []):
  TwineGenerateContentParams {
  return {
    config: {
      safetySettings: [],
      systemInstruction: '',
      thinkingConfig: {
        includeThoughts: false,
        thinkingLevel: 'MINIMAL',
      },
      tools: [],
    },
    contents: [{ parts, role: 'user' }],
    model: 'test',
  };
}

async function partsFrom(
  stream: AsyncGenerator<{
    candidates?: Array<{ content?: { parts?: unknown[] } }>;
  }>,
): Promise<unknown[]> {
  const parts: unknown[] = [];
  for await (const item of stream) {
    parts.push(...(item.candidates?.[0]?.content?.parts ?? []));
  }
  return parts;
}

describe('Twine deterministic E2E model client', () => {
  it('rejects unknown scenarios instead of accepting arbitrary scripts', () => {
    expect(() => createTwineE2eModelClientFactory('arbitrary-script')).toThrow(
      'Unknown Twine E2E model scenario',
    );
  });

  it('reads and updates a note using the revision returned by the tool', async () => {
    const factory = createTwineE2eModelClientFactory('document-live-edit');
    expect(factory).toBeDefined();
    const client = await factory!('unused', request('markdown'));

    const first = await partsFrom(
      await client.models.generateContentStream(params()),
    );
    expect(first).toEqual([
      {
        functionCall: {
          id: 'e2e-read-markdown',
          name: 'read_note',
          args: { nodeId: 'markdown-1' },
        },
      },
    ]);

    const revision = 'a'.repeat(64);
    const second = await partsFrom(
      await client.models.generateContentStream(
        params([
          {
            functionResponse: {
              id: 'e2e-read-markdown',
              name: 'read_note',
              response: {
                output: JSON.stringify({
                  content: '# Plano\n\nStatus: rascunho',
                  revision,
                }),
              },
            },
          },
        ]),
      ),
    );
    expect(second).toEqual([
      {
        functionCall: {
          id: 'e2e-update-note',
          name: 'propose_note_changes',
          args: expect.objectContaining({
            expectedRevision: revision,
            nodeId: 'markdown-1',
            operations: [
              expect.objectContaining({ type: 'replace' }),
            ],
          }),
        },
      },
    ]);

    const nextRevision = 'b'.repeat(64);
    const third = await partsFrom(
      await client.models.generateContentStream(
        params([
          {
            functionResponse: {
              id: 'e2e-update-note',
              name: 'propose_note_changes',
              response: {
                output: JSON.stringify({ revision: nextRevision }),
              },
            },
          },
        ]),
      ),
    );
    expect(third).toEqual([
      {
        functionCall: {
          id: 'e2e-extend-note',
          name: 'propose_note_changes',
          args: expect.objectContaining({
            expectedRevision: nextRevision,
            operations: [
              expect.objectContaining({ type: 'insert' }),
            ],
          }),
        },
      },
    ]);
  });

  it('creates valid class elements and a relationship after reading a diagram', async () => {
    const factory = createTwineE2eModelClientFactory('document-live-edit');
    const client = await factory!('unused', request('diagram'));

    await partsFrom(await client.models.generateContentStream(params()));
    const second = await partsFrom(
      await client.models.generateContentStream(
        params([
          {
            functionResponse: {
              id: 'e2e-read-diagram',
              name: 'read_diagram',
              response: { output: '{"document":{"diagramType":"class"}}' },
            },
          },
        ]),
      ),
    );
    expect(second).toEqual([
      {
        functionCall: {
          id: 'e2e-update-diagram',
          name: 'propose_diagram_changes',
          args: expect.objectContaining({
            nodeId: 'diagram-1',
            operations: [
              expect.objectContaining({
                kind: 'class',
                ref: 'customer',
                type: 'add-element',
              }),
            ],
          }),
        },
      },
    ]);
  });
});
