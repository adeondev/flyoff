import { describe, expect, it } from 'vitest';

import {
  collectPanes,
  splitPaneWithTab,
  type PaneWorkspaceState,
} from '../../src/renderer/components/tabs/pane-state';
import {
  INTERNAL_PAGE_IDS,
  type TabDescriptor,
} from '../../src/shared/contracts';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

function descriptor(
  tabId: string,
  target: TabDescriptor['target'],
): TabDescriptor {
  return {
    tabId,
    target,
    scrollTop: 0,
    pageState: { version: 1, data: null },
  };
}

describe('pane layout identifiers', () => {
  it('does not reuse a pane id already present in a restored layout', () => {
    const overview = descriptor('project-overview', {
      type: 'project-overview',
      projectId: PROJECT_ID,
    });
    const restoredNewTab = descriptor('restored-new-tab', {
      type: 'internal',
      pageId: INTERNAL_PAGE_IDS.newTab,
      instanceKey: 'restored',
    });
    const restored: PaneWorkspaceState = {
      activePaneId: 'project-pane-1',
      root: {
        kind: 'split',
        splitId: 'restored-split',
        direction: 'row',
        ratio: 0.5,
        first: {
          kind: 'pane',
          paneId: 'project-pane-1',
          tabs: [overview],
          activeTabId: overview.tabId,
        },
        second: {
          kind: 'pane',
          paneId: 'pane-1',
          tabs: [restoredNewTab],
          activeTabId: restoredNewTab.tabId,
        },
      },
    };

    const split = splitPaneWithTab(
      restored,
      'project-pane-1',
      'project-pane-1',
      overview.tabId,
      'row',
      false,
    );
    const paneIds = collectPanes(split.root).map(({ paneId }) => paneId);

    expect(paneIds).toHaveLength(3);
    expect(new Set(paneIds).size).toBe(paneIds.length);
  });
});
