// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MarkdownDocumentController } from '../../src/renderer/projects/markdown-document-controller';
import { useProjectPageProperties } from '../../src/renderer/projects/use-project-page-properties';
import type { SourceEditTransaction } from '../../src/renderer/projects/markdown-history';
import type { Translate } from '../../src/renderer/pages/page-types';
import type {
  FlyoffApi,
  MarkdownDocument,
  ProjectPageProperties,
  ProjectTreeNode,
} from '../../src/shared/contracts';

const nodeId = 'c8382c79-173b-4fe4-a043-9c6de90024ea';
const revision = '1'.repeat(64);
const nextRevision = '2'.repeat(64);
const node: ProjectTreeNode = {
  nodeId,
  parentId: null,
  kind: 'page',
  name: 'Private',
  pageType: 'markdown',
};
const document: MarkdownDocument = {
  nodeId,
  content: 'one',
  readOnly: false,
  revision,
};
const properties: ProjectPageProperties = {
  nodeId,
  pageType: 'markdown',
  contentSizeBytes: 3,
  diskSizeBytes: 512,
  createdAt: null,
  modifiedAt: '2026-07-16T00:00:00.000Z',
  revision,
  readOnly: false,
  passwordProtected: true,
  locked: false,
};
const translate: Translate = (key) => key;

function edit(before: string, after: string): SourceEditTransaction {
  return {
    before: {
      content: before,
      selection: { start: before.length, end: before.length, direction: 'none' },
    },
    after: {
      content: after,
      selection: { start: after.length, end: after.length, direction: 'none' },
    },
    inputType: 'insertText',
    timestamp: 0,
  };
}

function installApi(api: Partial<FlyoffApi>): void {
  Object.defineProperty(window, 'flyoff', {
    configurable: true,
    value: api,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('project page properties runtime', () => {
  it('freezes edits until a protected page is flushed, locked and wiped', async () => {
    let finishSave:
      | ((result: { ok: true; value: MarkdownDocument }) => void)
      | undefined;
    const save = vi.fn(
      () =>
        new Promise<{ ok: true; value: MarkdownDocument }>((resolve) => {
          finishSave = resolve;
        }),
    );
    const lockProjectPage = vi.fn(async () => ({
      ok: true as const,
      value: null,
    }));
    installApi({ lockProjectPage });
    const controller = new MarkdownDocumentController({
      reload: vi.fn(),
      save,
    });
    controller.open(document);
    controller.commitEditorTransaction(nodeId, edit('one', 'two'));
    const { result } = renderHook(() =>
      useProjectPageProperties({
        controller,
        nodes: new Map([[nodeId, node]]),
        translate,
      }),
    );
    act(() => result.current.acceptProperties(properties));

    let close: Promise<unknown> | undefined;
    act(() => {
      close = result.current.closeProtectedPage(nodeId);
    });
    expect(controller.isMutationLocked(nodeId)).toBe(true);
    controller.update(nodeId, 'three');
    expect(controller.getSnapshot(nodeId)?.content).toBe('two');
    expect(lockProjectPage).not.toHaveBeenCalled();

    await act(async () => {
      finishSave?.({
        ok: true,
        value: { ...document, content: 'two', revision: nextRevision },
      });
      await close;
    });

    expect(lockProjectPage).toHaveBeenCalledWith({ nodeId });
    expect(controller.getSnapshot(nodeId)).toBeUndefined();
    expect(controller.isMutationLocked(nodeId)).toBe(false);
  });

  it('wipes buffers and history for notes removed with their branch', () => {
    installApi({});
    const controller = new MarkdownDocumentController({
      reload: vi.fn(),
      save: vi.fn(),
    });
    controller.open(document);
    controller.commitEditorTransaction(nodeId, edit('one', 'secret'));
    const { result } = renderHook(() =>
      useProjectPageProperties({
        controller,
        nodes: new Map([[nodeId, node]]),
        translate,
      }),
    );

    act(() => result.current.discardRemoved([nodeId]));
    expect(controller.getSnapshot(nodeId)).toBeUndefined();
    controller.open({ ...document, content: 'disk' });
    expect(controller.canUndo(nodeId)).toBe(false);
    expect(controller.canRedo(nodeId)).toBe(false);
  });

  it('preserves a dirty buffer while immediately enforcing external read-only', () => {
    installApi({});
    const controller = new MarkdownDocumentController({
      reload: vi.fn(),
      save: vi.fn(),
    });
    controller.open(document);
    controller.update(nodeId, 'local draft');
    const { result } = renderHook(() =>
      useProjectPageProperties({
        controller,
        nodes: new Map([[nodeId, node]]),
        translate,
      }),
    );

    act(() =>
      result.current.acceptProperties({
        ...properties,
        passwordProtected: false,
        readOnly: true,
      }),
    );
    expect(controller.getSnapshot(nodeId)).toMatchObject({
      content: 'local draft',
      dirty: true,
      readOnly: true,
      revision,
    });
    controller.update(nodeId, 'blocked');
    expect(controller.getSnapshot(nodeId)?.content).toBe('local draft');
  });

  it('disables external read-only without saving first and keeps the draft saveable', async () => {
    const externalReadOnly = {
      ...properties,
      passwordProtected: false,
      readOnly: true,
    };
    const save = vi.fn(async (request) => ({
      ok: true as const,
      value: {
        ...document,
        content: request.content,
        revision: nextRevision,
      },
    }));
    const setProjectPageReadOnly = vi.fn(async () => ({
      ok: true as const,
      value: { ...externalReadOnly, readOnly: false },
    }));
    installApi({
      getProjectPageProperties: vi.fn(async () => ({
        ok: true as const,
        value: externalReadOnly,
      })),
      setProjectPageReadOnly,
    });
    const controller = new MarkdownDocumentController({
      reload: vi.fn(),
      save,
    });
    controller.open(document);
    controller.update(nodeId, 'local draft');
    const { result } = renderHook(() =>
      useProjectPageProperties({
        controller,
        nodes: new Map([[nodeId, node]]),
        translate,
      }),
    );

    await act(async () => {
      result.current.open(node);
      await Promise.resolve();
    });
    expect(controller.getSnapshot(nodeId)).toMatchObject({
      content: 'local draft',
      dirty: true,
      readOnly: true,
    });

    await act(async () => {
      await result.current.setReadOnly(false, revision);
    });
    expect(setProjectPageReadOnly).toHaveBeenCalledWith({
      nodeId,
      expectedRevision: revision,
      readOnly: false,
    });
    expect(save).not.toHaveBeenCalled();
    expect(controller.getSnapshot(nodeId)).toMatchObject({
      content: 'local draft',
      dirty: true,
      readOnly: false,
    });

    expect(await controller.save(nodeId)).toBe(true);
    expect(save).toHaveBeenCalledWith({
      nodeId,
      content: 'local draft',
      expectedRevision: revision,
    });
  });

  it('locks and clears an unknown protected page without a live buffer cache', async () => {
    const save = vi.fn(async (request) => ({
      ok: true as const,
      value: {
        ...document,
        content: request.content,
        revision: nextRevision,
      },
    }));
    const lockProjectPage = vi.fn(async () => ({
      ok: true as const,
      value: null,
    }));
    installApi({ lockProjectPage });
    const controller = new MarkdownDocumentController({
      reload: vi.fn(),
      save,
    });
    controller.open(document);
    controller.commitEditorTransaction(nodeId, edit('one', 'secret'));
    expect(await controller.save(nodeId)).toBe(true);
    expect(controller.discardClean(nodeId)).toBe(true);
    const { result } = renderHook(() =>
      useProjectPageProperties({
        controller,
        nodes: new Map([[nodeId, node]]),
        translate,
      }),
    );

    await act(async () => {
      await result.current.closeProtectedPage(nodeId);
    });

    expect(lockProjectPage).toHaveBeenCalledWith({ nodeId });
    controller.open({ ...document, content: 'secret', revision: nextRevision });
    expect(controller.canUndo(nodeId)).toBe(false);
    expect(controller.canRedo(nodeId)).toBe(false);
  });
});
