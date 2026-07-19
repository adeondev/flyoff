import { describe, expect, it } from 'vitest';

import type {
  MarkdownDocument,
  ProjectTreeNode,
} from '../../src/shared/contracts';
import { ProjectOperationError } from '../../src/main/projects/errors';
import { ProjectReferenceIndex } from '../../src/main/projects/project-reference-index';
import type { ProjectRepository } from '../../src/main/projects/project-repository';

const nodes: readonly ProjectTreeNode[] = [
  {
    kind: 'page',
    name: 'Source',
    nodeId: 'source',
    pageType: 'markdown',
    parentId: 'folder',
  },
  {
    kind: 'page',
    name: 'Target',
    nodeId: 'target',
    pageType: 'markdown',
    parentId: null,
  },
  {
    kind: 'page',
    name: 'Common',
    nodeId: 'common-a',
    pageType: 'markdown',
    parentId: null,
  },
  {
    kind: 'page',
    name: 'Common',
    nodeId: 'common-b',
    pageType: 'markdown',
    parentId: 'folder',
  },
];

const paths = new Map([
  ['source', 'Folder/Source.md'],
  ['target', 'Target.md'],
  ['common-a', 'Common.md'],
  ['common-b', 'Folder/Common.md'],
]);

function repository(): ProjectRepository {
  return {
    listIndexedNodes: () => nodes,
    projectRelativePath: (nodeId: string) => paths.get(nodeId)!,
  } as unknown as ProjectRepository;
}

function document(
  nodeId: string,
  content: string,
  revision = `${nodeId}-revision`,
): MarkdownDocument {
  return { content, nodeId, readOnly: false, revision };
}

function indexWith(
  documents: ReadonlyMap<string, MarkdownDocument>,
  lockedNodeIds: ReadonlySet<string> = new Set(),
): ProjectReferenceIndex {
  return new ProjectReferenceIndex({
    readMarkdown: async (nodeId) => {
      if (lockedNodeIds.has(nodeId)) {
        throw new ProjectOperationError(
          'password-required',
          'The note is locked.',
        );
      }
      return documents.get(nodeId)!;
    },
    repository: repository(),
  });
}

describe('project reference index', () => {
  it('resolves relative, rooted and unique short links with headings', async () => {
    const index = indexWith(
      new Map([
        [
          'source',
          document(
            'source',
            '[relative](../Target.md#Parent#Child)\n[[Target#Parent#Child]]',
          ),
        ],
        [
          'target',
          document('target', '# Parent\n\n## Child\n\ncontent'),
        ],
        ['common-a', document('common-a', '')],
        ['common-b', document('common-b', '')],
      ]),
    );

    await expect(
      index.resolve({
        headingPath: ['Parent', 'Child'],
        path: '../Target.md',
        sourceNodeId: 'source',
        syntax: 'markdown',
      }),
    ).resolves.toMatchObject({
      status: 'resolved',
      target: {
        heading: { line: 3, path: ['Parent', 'Child'] },
        nodeId: 'target',
        path: 'Target',
      },
    });
    await expect(
      index.resolve({
        headingPath: [],
        path: '/Target.md',
        sourceNodeId: 'source',
        syntax: 'markdown',
      }),
    ).resolves.toMatchObject({
      status: 'resolved',
      target: { nodeId: 'target' },
    });
    await expect(
      index.resolve({
        headingPath: [],
        path: 'Target',
        sourceNodeId: 'source',
        syntax: 'wikilink',
      }),
    ).resolves.toMatchObject({
      status: 'resolved',
      target: { nodeId: 'target' },
    });
  });

  it('does not guess ambiguous, missing-heading or escaping targets', async () => {
    const index = indexWith(
      new Map([
        ['source', document('source', '')],
        ['target', document('target', '# Existing')],
        ['common-a', document('common-a', '')],
        ['common-b', document('common-b', '')],
      ]),
    );

    await expect(
      index.resolve({
        headingPath: [],
        path: 'Common',
        sourceNodeId: 'source',
        syntax: 'wikilink',
      }),
    ).resolves.toMatchObject({
      candidates: [
        { nodeId: 'common-a' },
        { nodeId: 'common-b' },
      ],
      status: 'ambiguous',
    });
    await expect(
      index.resolve({
        headingPath: ['Missing'],
        path: '../Target.md',
        sourceNodeId: 'source',
        syntax: 'markdown',
      }),
    ).resolves.toEqual({ status: 'missing' });
    await expect(
      index.resolve({
        headingPath: [],
        path: '../../Outside.md',
        sourceNodeId: 'source',
        syntax: 'markdown',
      }),
    ).resolves.toEqual({ status: 'missing' });
  });

  it('lists only resolved backlinks with exact source positions', async () => {
    const source =
      '[one](../Target.md)\n[[Target]]\n[[Common]]\nTarget as plain text';
    const index = indexWith(
      new Map([
        ['source', document('source', source)],
        ['target', document('target', '# Target')],
        ['common-a', document('common-a', '')],
        ['common-b', document('common-b', '')],
      ]),
    );
    const outcome = await index.backlinks('target');

    expect(outcome.skippedLockedNodeIds).toEqual([]);
    expect(outcome.references).toHaveLength(2);
    expect(outcome.references.map(({ line }) => line)).toEqual([1, 2]);
    for (const reference of outcome.references) {
      expect(reference.sourceNodeId).toBe('source');
      expect(source.slice(reference.start, reference.end)).toMatch(
        /Target/,
      );
    }
  });

  it('keeps protected content isolated per renderer index', async () => {
    const documents = new Map([
      ['source', document('source', '[target](../Target.md)')],
      ['target', document('target', 'secret')],
      ['common-a', document('common-a', '')],
      ['common-b', document('common-b', '')],
    ]);
    const locked = indexWith(documents, new Set(['target']));

    await expect(locked.backlinks('source')).resolves.toMatchObject({
      skippedLockedNodeIds: ['target'],
    });
    expect(locked.document('target')).toBeUndefined();
  });

  it('builds an aggregated graph without exposing locked notes', async () => {
    const index = indexWith(
      new Map([
        [
          'source',
          document(
            'source',
            '[[Target]]\n[again](../Target.md)\n[[Common]]',
          ),
        ],
        ['target', document('target', '[[Source]]')],
        ['common-a', document('common-a', '')],
        ['common-b', document('common-b', '')],
      ]),
      new Set(['common-b']),
    );

    await expect(index.graph()).resolves.toEqual({
      edges: [
        {
          sourceNodeId: 'source',
          targetNodeId: 'target',
          weight: 3,
        },
      ],
      nodes: [
        {
          connectionCount: 0,
          name: 'Common',
          nodeId: 'common-a',
          path: 'Common',
        },
        {
          connectionCount: 3,
          name: 'Source',
          nodeId: 'source',
          path: 'Folder/Source',
        },
        {
          connectionCount: 3,
          name: 'Target',
          nodeId: 'target',
          path: 'Target',
        },
      ],
    });
  });

  it('searches metadata, tags, lines, sections and frontmatter properties', async () => {
    const index = indexWith(
      new Map([
        [
          'source',
          document(
            'source',
            [
              '---',
              'status: done',
              'owners:',
              '  - Gabriel',
              '---',
              '# Parent',
              'alpha beta #work',
              '## Child',
              'gamma',
              '```',
              '#ignored',
              '```',
            ].join('\n'),
          ),
        ],
        ['target', document('target', 'unrelated')],
        ['common-a', document('common-a', '')],
        ['common-b', document('common-b', '')],
      ]),
    );

    await expect(
      index.search({
        query:
          'path:Folder file:Source tag:work line:(alpha beta) section:(alpha gamma) [status:done] [owners]:Gabriel',
      }),
    ).resolves.toEqual({
      nodeIds: ['source'],
      previews: [
        {
          excerpt: 'alpha beta #work',
          line: 7,
          nodeId: 'source',
        },
      ],
      skippedLockedNodeIds: [],
    });
    await expect(index.search({ query: 'tag:ignored' })).resolves.toMatchObject({
      nodeIds: [],
    });
  });

  it('does not search locked content but still matches its visible path', async () => {
    const documents = new Map([
      ['source', document('source', 'visible')],
      ['target', document('target', 'secret')],
      ['common-a', document('common-a', '')],
      ['common-b', document('common-b', '')],
    ]);
    const index = indexWith(documents, new Set(['target']));

    await expect(index.search({ query: 'secret' })).resolves.toEqual({
      nodeIds: [],
      previews: [],
      skippedLockedNodeIds: ['target'],
    });
    await expect(index.search({ query: 'path:Target' })).resolves.toEqual({
      nodeIds: ['target'],
      previews: [],
      skippedLockedNodeIds: [],
    });
  });
});
