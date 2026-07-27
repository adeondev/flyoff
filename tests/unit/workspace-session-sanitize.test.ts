import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_SESSION_VERSION,
  type TabDescriptor,
  type WorkspaceSessionSnapshot,
} from '../../src/shared/contracts';
import { createDescriptor } from '../../src/renderer/components/tabs/tab-state';
import { sanitizeRestoredWorkspace } from '../../src/renderer/components/tabs/workspace-session-sanitize';

const projectId = '123e4567-e89b-42d3-a456-426614174000';
const validId = '223e4567-e89b-42d3-a456-426614174001';
const missingId = '323e4567-e89b-42d3-a456-426614174002';

function content(nodeId: string): TabDescriptor {
  return createDescriptor({
    type: 'project-content',
    projectId,
    nodeId,
    pageType: 'markdown',
  });
}

function snapshot(tabs: readonly TabDescriptor[]): WorkspaceSessionSnapshot {
  const home = createDescriptor({ type: 'internal', pageId: 'home' });
  return {
    version: WORKSPACE_SESSION_VERSION,
    home: {
      activePaneId: 'home-pane-1',
      root: {
        kind: 'pane',
        paneId: 'home-pane-1',
        tabs: [home],
        activeTabId: home.tabId,
      },
    },
    project: {
      projectId,
      activePaneId: 'project-pane-1',
      root: {
        kind: 'pane',
        paneId: 'project-pane-1',
        tabs,
        activeTabId: tabs[0]?.tabId ?? null,
      },
    },
  };
}

describe('restored workspace sanitization', () => {
  it('drops missing content and activates its nearest surviving neighbor', () => {
    const missing = content(missingId);
    const valid = content(validId);
    const result = sanitizeRestoredWorkspace(
      snapshot([missing, valid]),
      new Map([[validId, 'markdown']]),
    );
    expect(result.project?.root).toMatchObject({
      kind: 'pane',
      tabs: [valid],
      activeTabId: valid.tabId,
    });
  });

  it('replaces an entirely invalid project workspace with its overview', () => {
    const result = sanitizeRestoredWorkspace(
      snapshot([content(missingId)]),
      new Map(),
    );
    expect(result.project?.root).toMatchObject({
      kind: 'pane',
      tabs: [{ target: { type: 'project-overview', projectId } }],
    });
  });

  it('rejects a valid id restored with an incompatible page type', () => {
    const result = sanitizeRestoredWorkspace(
      snapshot([content(validId)]),
      new Map([[validId, 'diagram']]),
    );
    expect(result.project?.root).toMatchObject({
      tabs: [{ target: { type: 'project-overview' } }],
    });
  });
});
