import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type CSSProperties,
} from 'react';

import ellipsisIcon from '../../../../public/images/icons/actions/ellipsis.svg';
import splitRightIcon from '../../../../public/images/icons/actions/split-right.svg';
import splitDownIcon from '../../../../public/images/icons/actions/split-down.svg';
import closePaneIcon from '../../../../public/images/icons/actions/close-pane.svg';
import {
  WORKSPACE_MAX_PANES,
  getTabTargetKey,
  isHomeTarget,
  type PageSessionState,
  type TabDescriptor,
  type TabTarget,
  type WorkspaceLayoutSnapshot,
  type WorkspaceSplitDirection,
} from '../../../shared/contracts';
import type {
  PageRenderer,
  TabPresentation,
  Translate,
} from '../../pages/page-types';
import { MaskedIcon } from '../MaskedIcon';
import { ContextMenu, DropdownMenu, type MenuItem } from '../menu';
import { getTooltipTargetProps } from '../tooltip';
import { PageHost } from './PageHost';
import { collectPanes, findPane } from './pane-state';
import { TabBar, type TabBarHandle } from './TabBar';
import {
  collapsedWorkspaceRatios,
  flattenWorkspaceLayout,
  minimumWorkspaceSize,
  resolveWorkspaceLength,
  workspaceBoxStyle,
  WORKSPACE_MIN_PANE_SIZE,
  WORKSPACE_SPLIT_DIVIDER_SIZE,
  type WorkspaceDividerLayout,
  type WorkspacePaneLayout,
} from './workspace-layout';
import {
  consumeWorkspaceDrag,
  consumeWorkspacePointerDrag,
  hasWorkspaceDrag,
  installWorkspaceDragLifecycle,
  readWorkspaceDrag,
  subscribeWorkspaceDragReset,
  subscribeWorkspacePointerDrag,
  type WorkspaceDragPayload,
} from './workspace-drag';
import { animateWorkspaceTabToSplit } from './workspace-drag-motion';
import {
  PANE_EXIT_DURATION_MS,
  waitForWorkspaceMotion,
  workspaceMotionReduced,
} from './workspace-pane-motion';

type PaneDropEdge = 'center' | 'left' | 'right' | 'top' | 'bottom';
type PaneEntryPlacement =
  | 'row-start'
  | 'row-end'
  | 'column-start'
  | 'column-end';
const PANE_DROP_EDGE_RATIO = 0.25;
const PANE_TAB_BAR_HEIGHT = 48;
const PANE_ENTRY_DURATION_MS = 120;
const PANE_MOTION_RELEASE_MS = 320;
// A transition only starts on the frame after its geometry lands, so both the
// close and the entry clean-up wait a couple of frames past their duration
// rather than cutting the last few percent of the travel.
const PANE_MOTION_TAIL_MS = 32;
export { WORKSPACE_MIN_PANE_SIZE };

export function canSplitWorkspacePane(
  size: Pick<DOMRect, 'height' | 'width'>,
  direction: WorkspaceSplitDirection,
): boolean {
  return (
    (direction === 'row' ? size.width : size.height) >=
    WORKSPACE_MIN_PANE_SIZE * 2 + WORKSPACE_SPLIT_DIVIDER_SIZE
  );
}

interface PaneDropIntent {
  duplicate: boolean;
  edge: PaneDropEdge;
}

interface HostDropIntent extends PaneDropIntent {
  count: number;
  height: number;
  left: number;
  paneId: string;
  top: number;
  width: number;
}

interface HostDropOverlay {
  exiting: boolean;
  intent: HostDropIntent;
}

interface ResolvedHostDrop {
  intent: HostDropIntent;
  target: HTMLElement;
}

/**
 * Every pane and divider renders as an absolutely positioned sibling of the
 * host rather than nested inside `.workspace-split` elements. Splitting or
 * closing a pane then only changes geometry, so React keeps each pane — and
 * the editor inside it — mounted instead of tearing it down and rebuilding it.
 */
interface WorkspaceMotionState {
  durationMs: number;
  kind: 'entry' | 'exit';
  paneIds: readonly string[];
  ratios?: ReadonlyMap<string, number>;
}

interface WorkspacePaneHostProps {
  activePaneId: string;
  canCloseSoleTab?: boolean;
  closeLabel: string;
  emptyState?: (paneId: string) => ReactNode;
  getPresentation: (tab: TabDescriptor) => TabPresentation;
  navigationLabel: string;
  onClosePane: (paneId: string) => void;
  onCloseAllTabs?: () => void;
  onCloseTab: (paneId: string, tabId: string) => void;
  onMoveTab: (paneId: string, tabId: string, toIndex: number) => void;
  onMoveTabBetweenPanes: (
    fromPaneId: string,
    toPaneId: string,
    tabId: string,
  ) => void;
  onOpenTarget: (paneId: string, target: TabTarget) => void;
  onOpenTargets: (paneId: string, targets: readonly TabTarget[]) => void;
  onNewTab?: (paneId: string) => void;
  onPageStateChange: (
    paneId: string,
    tabId: string,
    state: PageSessionState,
  ) => void;
  onResizeSplit: (splitId: string, ratio: number) => void;
  onScrollChange: (
    paneId: string,
    tabId: string,
    scrollTop: number,
    settled?: boolean,
  ) => void;
  onSelectPane: (paneId: string) => void;
  onSelectTab: (paneId: string, tabId: string) => void;
  onSplitPane: (
    paneId: string,
    direction: WorkspaceSplitDirection,
  ) => void;
  onSplitPaneWithTab: (
    fromPaneId: string,
    targetPaneId: string,
    tabId: string,
    direction: WorkspaceSplitDirection,
    before: boolean,
  ) => void;
  onSplitPaneWithTarget: (
    targetPaneId: string,
    target: TabTarget,
    direction: WorkspaceSplitDirection,
    before: boolean,
  ) => void;
  onSplitPaneWithTargets: (
    targetPaneId: string,
    targets: readonly TabTarget[],
    direction: WorkspaceSplitDirection,
    before: boolean,
  ) => void;
  renderPage: PageRenderer;
  root: WorkspaceLayoutSnapshot;
  translate: Translate;
}

export interface WorkspacePaneHostHandle {
  animateAllTabsAndPanesExit: () => Promise<void>;
  animatePaneExit: (paneId: string, durationMs?: number) => Promise<void>;
  animateTabAndPaneExit: (paneId: string, tabId: string) => Promise<void>;
  animateTabExit: (paneId: string, tabId: string) => Promise<void>;
}

interface PaneLeafProps extends WorkspacePaneHostProps {
  entryPlacement?: PaneEntryPlacement;
  exiting: boolean;
  layout: WorkspacePaneLayout;
  paneCount: number;
  tabBars: Map<string, TabBarHandle>;
}

function containsPane(
  node: WorkspaceLayoutSnapshot,
  paneId: string,
): boolean {
  if (node.kind === 'pane') {
    return node.paneId === paneId;
  }
  return containsPane(node.first, paneId) || containsPane(node.second, paneId);
}

export function findNewWorkspaceTabIds(
  previousTabIds: ReadonlySet<string>,
  root: WorkspaceLayoutSnapshot,
): readonly string[] {
  return collectPanes(root).flatMap(({ tabs }) =>
    tabs.flatMap(({ tabId }) =>
      previousTabIds.has(tabId) ? [] : [tabId],
    ),
  );
}

function findPaneEntryPlacement(
  node: WorkspaceLayoutSnapshot,
  paneId: string,
): PaneEntryPlacement | undefined {
  if (node.kind === 'pane') {
    return undefined;
  }
  const inFirst = containsPane(node.first, paneId);
  const branch = inFirst ? node.first : node.second;
  return (
    findPaneEntryPlacement(branch, paneId) ??
    (`${node.direction}-${inFirst ? 'start' : 'end'}` as PaneEntryPlacement)
  );
}

export function resolvePaneDropEdge(
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  clientX: number,
  clientY: number,
  allowSplit: boolean,
  dragged?: WorkspaceDragPayload,
  targetPaneId?: string,
): PaneDropEdge | undefined {
  if (!allowSplit) {
    return 'center';
  }
  const x = clientX - bounds.left;
  const y = clientY - bounds.top;
  if (dragged?.kind === 'tab' && y <= PANE_TAB_BAR_HEIGHT) {
    return dragged.paneId === targetPaneId ? undefined : 'center';
  }
  const horizontalEdge = bounds.width * PANE_DROP_EDGE_RATIO;
  const contentHeight = Math.max(0, bounds.height - PANE_TAB_BAR_HEIGHT);
  const verticalEdge = contentHeight * PANE_DROP_EDGE_RATIO;
  if (x < horizontalEdge) return 'left';
  if (x > bounds.width - horizontalEdge) return 'right';
  if (y < PANE_TAB_BAR_HEIGHT + verticalEdge) return 'top';
  if (y > bounds.height - verticalEdge) return 'bottom';
  return 'center';
}

function targetKeyForWorkspaceDrag(
  root: WorkspaceLayoutSnapshot,
  dragged: WorkspaceDragPayload,
): string | undefined {
  if (dragged.kind === 'project-node') {
    return dragged.targets.length === 1
      ? getTabTargetKey(dragged.targets[0]!)
      : undefined;
  }
  if (dragged.targetKey) {
    return dragged.targetKey;
  }
  const target = findPane(root, dragged.paneId)?.tabs.find(
    ({ tabId }) => tabId === dragged.tabId,
  )?.target;
  return target ? getTabTargetKey(target) : undefined;
}

function resolveWorkspaceHostDrop(
  root: WorkspaceLayoutSnapshot,
  paneCount: number,
  host: HTMLElement,
  clientX: number,
  clientY: number,
  dragged: WorkspaceDragPayload,
  fallbackTarget?: EventTarget | null,
): ResolvedHostDrop | undefined {
  const pointedElement =
    clientX !== 0 || clientY !== 0
      ? document.elementFromPoint(clientX, clientY)
      : null;
  const eventTarget = pointedElement ?? fallbackTarget;
  const target =
    eventTarget instanceof Element
      ? eventTarget.closest<HTMLElement>('.workspace-pane')
      : null;
  if (!target || !host.contains(target)) {
    return undefined;
  }
  const paneId = target.dataset.paneId;
  const pane = paneId ? findPane(root, paneId) : undefined;
  if (!pane || !paneId) {
    return undefined;
  }
  const paneBounds = target.getBoundingClientRect();
  let edge = resolvePaneDropEdge(
    paneBounds,
    clientX,
    clientY,
    paneCount < WORKSPACE_MAX_PANES &&
      (canSplitWorkspacePane(paneBounds, 'row') ||
        canSplitWorkspacePane(paneBounds, 'column')),
    dragged,
    paneId,
  );
  if (!edge) {
    return undefined;
  }
  if (
    ((edge === 'left' || edge === 'right') &&
      !canSplitWorkspacePane(paneBounds, 'row')) ||
    ((edge === 'top' || edge === 'bottom') &&
      !canSplitWorkspacePane(paneBounds, 'column'))
  ) {
    edge = 'center';
  }
  const targetKey = targetKeyForWorkspaceDrag(root, dragged);
  const hostBounds = host.getBoundingClientRect();
  return {
    intent: {
      count: dragged.kind === 'project-node' ? dragged.targets.length : 1,
      duplicate:
        edge === 'center' &&
        Boolean(
          targetKey &&
            pane.tabs.some(
              ({ target: current }) =>
                getTabTargetKey(current) === targetKey,
            ),
        ),
      edge,
      height: paneBounds.height,
      left: paneBounds.left - hostBounds.left,
      paneId,
      top: paneBounds.top - hostBounds.top,
      width: paneBounds.width,
    },
    target,
  };
}

function performWorkspaceDrop(
  props: WorkspacePaneHostProps,
  dragged: WorkspaceDragPayload,
  paneId: string,
  edge: PaneDropEdge,
  target: HTMLElement,
): void {
  if (edge === 'center') {
    if (dragged.kind === 'tab') {
      props.onMoveTabBetweenPanes(dragged.paneId, paneId, dragged.tabId);
    } else {
      props.onOpenTargets(paneId, dragged.targets);
    }
    return;
  }

  const direction =
    edge === 'left' || edge === 'right' ? 'row' : 'column';
  const before = edge === 'left' || edge === 'top';
  if (dragged.kind === 'tab') {
    const source = document
      .getElementById(`page-tab-${dragged.paneId}-${dragged.tabId}`)
      ?.closest<HTMLElement>('.page-tab');
    animateWorkspaceTabToSplit(source ?? null, target, edge);
    props.onSplitPaneWithTab(
      dragged.paneId,
      paneId,
      dragged.tabId,
      direction,
      before,
    );
    return;
  }
  props.onSplitPaneWithTargets(
    paneId,
    dragged.targets,
    direction,
    before,
  );
}

function PaneLeaf(props: PaneLeafProps) {
  const { layout } = props;
  const node = layout.node;
  const [tabMenu, setTabMenu] = useState<{
    tabId: string;
    x: number;
    y: number;
  }>();
  const paneRef = useRef<HTMLElement>(null);
  const [paneSize, setPaneSize] = useState({ height: 0, width: 0 });
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) {
      return;
    }
    const update = (): void => {
      const bounds = pane.getBoundingClientRect();
      setPaneSize((current) =>
        current.height === bounds.height && current.width === bounds.width
          ? current
          : { height: bounds.height, width: bounds.width },
      );
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);
  const belowPaneLimit = props.paneCount < WORKSPACE_MAX_PANES;
  const canSplitRight =
    belowPaneLimit &&
    (paneSize.width === 0 ||
      canSplitWorkspacePane(paneSize, 'row'));
  const canSplitBelow =
    belowPaneLimit &&
    (paneSize.height === 0 ||
      canSplitWorkspacePane(paneSize, 'column'));
  const items: readonly MenuItem[] = [
    {
      kind: 'action',
      id: 'split-right',
      label: props.translate('pages.splitRight'),
      icon: splitRightIcon,
      disabled: !canSplitRight,
    },
    {
      kind: 'action',
      id: 'split-below',
      label: props.translate('pages.splitBelow'),
      icon: splitDownIcon,
      disabled: !canSplitBelow,
    },
    { kind: 'separator', id: 'pane-separator' },
    {
      kind: 'action',
      id: 'close-pane',
      label: props.translate('pages.closePane'),
      icon: closePaneIcon,
      disabled: props.paneCount <= 1,
    },
    ...(props.onCloseAllTabs
      ? [
          { kind: 'separator', id: 'close-all-separator' } as const,
          {
            kind: 'action',
            id: 'close-all-tabs',
            label: props.translate('pages.closeAllTabs'),
            icon: closePaneIcon,
          } as const,
        ]
      : []),
  ];

  return (
    <section
      className={`workspace-pane${
        props.activePaneId === node.paneId ? ' workspace-pane--active' : ''
      }`}
      data-pane-entry={props.entryPlacement}
      data-pane-exiting={props.exiting || undefined}
      data-pane-id={node.paneId}
      data-top={layout.top || undefined}
      data-top-left={(layout.top && layout.left) || undefined}
      data-top-right={(layout.top && layout.right) || undefined}
      onClick={(event) => {
        if (
          event.target instanceof Node &&
          event.currentTarget.contains(event.target)
        ) {
          props.onSelectPane(node.paneId);
        }
      }}
      onDragOver={(event) => {
        if (!hasWorkspaceDrag(event.dataTransfer)) {
          return;
        }
        event.preventDefault();
        const dragged = readWorkspaceDrag(event.dataTransfer);
        event.dataTransfer.dropEffect =
          dragged?.kind === 'project-node' ? 'copy' : 'move';
      }}
      ref={paneRef}
      style={workspaceBoxStyle(layout.box)}
    >
      <div className="workspace-pane__bar">
        <TabBar
          activeTabId={node.activeTabId}
          canCloseSoleTab={
            props.canCloseSoleTab === true || props.paneCount > 1
          }
          closeLabel={props.closeLabel}
          getPresentation={props.getPresentation}
          navigationLabel={props.navigationLabel}
          newTabLabel={
            props.onNewTab ? props.translate('pages.newTab') : undefined
          }
          onClose={(tabId) => props.onCloseTab(node.paneId, tabId)}
          onMove={(tabId, toIndex) =>
            props.onMoveTab(node.paneId, tabId, toIndex)
          }
          onNewTab={
            props.onNewTab
              ? () => props.onNewTab?.(node.paneId)
              : undefined
          }
          onContextMenu={(tabId, position) =>
            setTabMenu({ tabId, ...position })
          }
          onSelect={(tabId) => props.onSelectTab(node.paneId, tabId)}
          paneId={node.paneId}
          ref={(handle) => {
            if (handle) {
              props.tabBars.set(node.paneId, handle);
            } else {
              props.tabBars.delete(node.paneId);
            }
          }}
          tabs={node.tabs}
        />
        <div className="workspace-pane__actions">
          <DropdownMenu
            items={items}
            onAction={(id) => {
              if (id === 'split-right') {
                props.onSplitPane(node.paneId, 'row');
              } else if (id === 'split-below') {
                props.onSplitPane(node.paneId, 'column');
              } else if (id === 'close-pane') {
                props.onClosePane(node.paneId);
              } else if (id === 'close-all-tabs') {
                props.onCloseAllTabs?.();
              }
            }}
            trigger={(triggerProps) => (
              <button
                {...triggerProps}
                aria-label={props.translate('pages.paneMenu')}
                className="workspace-pane__action"
                type="button"
                {...getTooltipTargetProps(
                  props.translate('pages.paneMenu'),
                  'bottom',
                )}
              >
                <MaskedIcon icon={ellipsisIcon} />
              </button>
            )}
          />
        </div>
      </div>
      <PageHost
        activePane={props.activePaneId === node.paneId}
        activeTabId={node.activeTabId}
        emptyState={props.emptyState?.(node.paneId)}
        getPresentation={props.getPresentation}
        onPageStateChange={(tabId, state) =>
          props.onPageStateChange(node.paneId, tabId, state)
        }
        onScrollChange={(tabId, scrollTop, settled) =>
          props.onScrollChange(node.paneId, tabId, scrollTop, settled)
        }
        paneId={node.paneId}
        renderPage={props.renderPage}
        tabs={node.tabs}
        translate={props.translate}
      />
      {tabMenu ? (
        <ContextMenu
          ariaLabel={props.translate('pages.tabMenu')}
          items={[
            {
              kind: 'action',
              id: 'split-right',
              label: props.translate('pages.splitRight'),
              icon: splitRightIcon,
              disabled: !canSplitRight,
            },
            {
              kind: 'action',
              id: 'split-below',
              label: props.translate('pages.splitBelow'),
              icon: splitDownIcon,
              disabled: !canSplitBelow,
            },
            { kind: 'separator', id: 'tab-separator' },
            {
              kind: 'action',
              id: 'close-tab',
              label: props.closeLabel,
              icon: closePaneIcon,
              disabled:
                props.canCloseSoleTab !== true &&
                node.tabs.length === 1 &&
                props.paneCount <= 1 &&
                (isHomeTarget(node.tabs[0]!.target) ||
                  (node.tabs[0]?.target.type === 'internal' &&
                    node.tabs[0].target.pageId === 'new-tab')),
            },
            ...(props.onCloseAllTabs
              ? [
                  {
                    kind: 'action',
                    id: 'close-all-tabs',
                    label: props.translate('pages.closeAllTabs'),
                    icon: closePaneIcon,
                  } as const,
                ]
              : []),
          ]}
          onAction={(id) => {
            if (id === 'split-right') {
              props.onSplitPane(node.paneId, 'row');
            } else if (id === 'split-below') {
              props.onSplitPane(node.paneId, 'column');
            } else if (id === 'close-tab') {
              props.onCloseTab(node.paneId, tabMenu.tabId);
            } else if (id === 'close-all-tabs') {
              props.onCloseAllTabs?.();
            }
            setTabMenu(undefined);
          }}
          onClose={() => setTabMenu(undefined)}
          x={tabMenu.x}
          y={tabMenu.y}
        />
      ) : null}
    </section>
  );
}

function SplitDivider(props: {
  layout: WorkspaceDividerLayout;
  onLiveResize: (splitId: string, ratio: number) => void;
  onReleaseResize: (splitId: string) => void;
  onResizeSplit: (splitId: string, ratio: number) => void;
  translate: Translate;
}) {
  const { layout } = props;
  const node = layout.node;
  const vertical = node.direction === 'row';

  function regionSize(host: HTMLElement): number {
    const bounds = host.getBoundingClientRect();
    return Math.max(
      1,
      resolveWorkspaceLength(
        vertical ? layout.region.width : layout.region.height,
        vertical ? bounds.width : bounds.height,
      ),
    );
  }

  function clampRatio(available: number, ratio: number): number {
    const firstMinimum = minimumWorkspaceSize(node.first, node.direction);
    const secondMinimum = minimumWorkspaceSize(node.second, node.direction);
    if (
      available <
      firstMinimum + WORKSPACE_SPLIT_DIVIDER_SIZE + secondMinimum
    ) {
      return node.ratio;
    }
    return Math.min(
      (available - WORKSPACE_SPLIT_DIVIDER_SIZE - secondMinimum) / available,
      Math.max(firstMinimum / available, ratio),
    );
  }

  function ratioFromPointer(
    event: PointerEvent<HTMLDivElement>,
  ): number | undefined {
    const host = event.currentTarget.parentElement;
    if (!host) {
      return undefined;
    }
    const bounds = host.getBoundingClientRect();
    const available = regionSize(host);
    const start = resolveWorkspaceLength(
      vertical ? layout.region.left : layout.region.top,
      vertical ? bounds.width : bounds.height,
    );
    const pointer = vertical
      ? event.clientX - bounds.left
      : event.clientY - bounds.top;
    return clampRatio(available, (pointer - start) / available);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const direction = vertical
      ? event.key === 'ArrowLeft'
        ? -1
        : event.key === 'ArrowRight'
          ? 1
          : 0
      : event.key === 'ArrowUp'
        ? -1
        : event.key === 'ArrowDown'
          ? 1
          : 0;
    if (direction === 0) {
      return;
    }
    event.preventDefault();
    const host = event.currentTarget.parentElement;
    if (host) {
      props.onResizeSplit(
        node.splitId,
        clampRatio(regionSize(host), node.ratio + direction * 0.02),
      );
    }
  }

  return (
    <div
      aria-label={props.translate('pages.resizePane')}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-valuemax={90}
      aria-valuemin={10}
      aria-valuenow={Math.round(node.ratio * 100)}
      className="workspace-split__divider"
      data-direction={node.direction}
      data-split-id={node.splitId}
      onDoubleClick={(event) => {
        const host = event.currentTarget.parentElement;
        if (host) {
          props.onResizeSplit(
            node.splitId,
            clampRatio(regionSize(host), 0.5),
          );
        }
      }}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={() => {
        props.onReleaseResize(node.splitId);
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        const ratio = ratioFromPointer(event);
        if (ratio !== undefined) {
          props.onLiveResize(node.splitId, ratio);
        }
      }}
      // Live, but not through React. A drag samples once per frame, and routing
      // each sample through the workspace reducer re-rendered the application
      // root — title bar, sidebar, every pane's tabs, every editor still
      // mounted behind a hidden tab — to move two boxes. The geometry is
      // written straight to the elements here and committed once on release.
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          const ratio = ratioFromPointer(event);
          if (ratio !== undefined) {
            props.onLiveResize(node.splitId, ratio);
          }
        }
      }}
      onPointerUp={(event) => {
        const ratio = ratioFromPointer(event);
        if (ratio !== undefined) {
          props.onLiveResize(node.splitId, ratio);
        }
        props.onReleaseResize(node.splitId);
      }}
      role="separator"
      style={workspaceBoxStyle(layout.box)}
      tabIndex={0}
    />
  );
}

export const WorkspacePaneHost = forwardRef<
  WorkspacePaneHostHandle,
  WorkspacePaneHostProps
>(function WorkspacePaneHost(props, ref) {
  const [dropOverlay, setDropOverlay] = useState<HostDropOverlay>();
  const [paneEntry, setPaneEntry] = useState<{
    paneId: string;
    placement: PaneEntryPlacement;
  }>();
  const [motion, setMotion] = useState<WorkspaceMotionState>();
  const dropIntentRef = useRef<HostDropIntent | undefined>(undefined);
  const dropExitTimerRef = useRef<number | undefined>(undefined);
  const dragLeaveFrameRef = useRef<number | undefined>(undefined);
  const hostRef = useRef<HTMLDivElement>(null);
  const [tabBars] = useState(() => new Map<string, TabBarHandle>());
  const panes = collectPanes(props.root);
  const paneCount = panes.length;
  const paneIds = panes.map(({ paneId }) => paneId);
  const paneIdsKey = paneIds.join('\u0000');
  const [settledPaneIds, setSettledPaneIds] = useState<ReadonlySet<string>>(
    () => new Set(paneIds),
  );
  // Derived while rendering, not in an effect: a pane written to the DOM at
  // its settled size and only collapsed afterwards animates backwards the
  // moment anything forces a layout in between.
  const enteringPaneId = paneIds.find(
    (paneId) => !settledPaneIds.has(paneId),
  );
  const activeMotion =
    motion?.kind === 'exit' &&
    !paneIds.some((paneId) => motion.paneIds.includes(paneId))
      ? undefined
      : motion;
  const previousTabIdsRef = useRef(
    new Set(panes.flatMap(({ tabs }) => tabs.map(({ tabId }) => tabId))),
  );
  const paneEntryTimerRef = useRef<number | undefined>(undefined);
  const motionFrameRef = useRef<number | undefined>(undefined);
  const motionTimerRef = useRef<number | undefined>(undefined);
  /**
   * Ratios a divider is being dragged to, held outside React for the length of
   * the gesture.
   *
   * A pointer drag samples once per animation frame, and every sample used to
   * dispatch into the workspace reducer. That reducer lives in the application
   * root, which memoises nothing, so moving a divider reconciled the whole
   * application — title bar, menus, sidebar, both panes' tab bars, and every
   * editor still mounted behind a hidden tab — sixty times a second, to change
   * the geometry of two absolutely positioned boxes. The sidebar's own resizer
   * never did this: `usePanelResize` writes a CSS variable during the drag and
   * commits to state on release, and this is the same bargain for panes.
   */
  const dragRatiosRef = useRef(new Map<string, number>());

  const clearMotionTimers = useCallback((includePaneEntry = false): void => {
    if (motionFrameRef.current !== undefined) {
      window.cancelAnimationFrame(motionFrameRef.current);
      motionFrameRef.current = undefined;
    }
    if (motionTimerRef.current !== undefined) {
      window.clearTimeout(motionTimerRef.current);
      motionTimerRef.current = undefined;
    }
    if (includePaneEntry && paneEntryTimerRef.current !== undefined) {
      window.clearTimeout(paneEntryTimerRef.current);
      paneEntryTimerRef.current = undefined;
    }
  }, []);

  /**
   * Push the dragged geometry onto the boxes the drag actually moves.
   *
   * `flattenWorkspaceLayout` already takes an override map — it is how a
   * closing pane is animated to zero — so the same projection that renders the
   * tree produces the dragged one, and there is no second geometry model to
   * keep in step. Only panes and dividers are touched; nothing inside them is
   * read or written, so this does not force a layout of its own.
   */
  const writeDragGeometry = useCallback((): void => {
    const host = hostRef.current;
    if (!host || dragRatiosRef.current.size === 0) {
      return;
    }
    for (const entry of flattenWorkspaceLayout(
      props.root,
      dragRatiosRef.current,
    )) {
      const id =
        entry.kind === 'pane' ? entry.node.paneId : entry.node.splitId;
      const selector =
        entry.kind === 'pane'
          ? `.workspace-pane[data-pane-id="${CSS.escape(id)}"]`
          : `.workspace-split__divider[data-split-id="${CSS.escape(id)}"]`;
      const element = host.querySelector<HTMLElement>(selector);
      if (!element) {
        continue;
      }
      const box = workspaceBoxStyle(entry.box);
      element.style.top = box.top;
      element.style.left = box.left;
      element.style.width = box.width;
      element.style.height = box.height;
      if (entry.kind === 'divider') {
        element.setAttribute(
          'aria-valuenow',
          String(
            Math.round(
              (dragRatiosRef.current.get(entry.node.splitId) ??
                entry.node.ratio) * 100,
            ),
          ),
        );
      }
    }
  }, [props.root]);

  const handleLiveResize = useCallback(
    (splitId: string, ratio: number): void => {
      dragRatiosRef.current.set(splitId, ratio);
      writeDragGeometry();
    },
    [writeDragGeometry],
  );

  const handleReleaseResize = useCallback(
    (splitId: string): void => {
      const ratio = dragRatiosRef.current.get(splitId);
      dragRatiosRef.current.delete(splitId);
      if (ratio !== undefined) {
        props.onResizeSplit(splitId, ratio);
      }
    },
    [props],
  );

  // A render triggered by anything else mid-drag — a save settling, a tab
  // title arriving — would otherwise paint the boxes at the ratio the reducer
  // still holds, and the divider would jump back to where the drag started.
  useLayoutEffect(() => {
    writeDragGeometry();
  });

  const beginPaneExit = useCallback(
    (
      paneIds: readonly string[],
      durationMs: number,
    ): Promise<void> => {
      if (paneIds.length === 0 || workspaceMotionReduced()) {
        return Promise.resolve();
      }
      const ratios = collapsedWorkspaceRatios(props.root, new Set(paneIds));
      if (ratios.size === 0) {
        return Promise.resolve();
      }
      clearMotionTimers();
      // Arm the transitions a frame before anything moves. Panes whose box
      // changes in the very commit that enables the transition are only
      // sometimes picked up by the style engine, and the ones that miss out
      // snap to their new size.
      setMotion({ durationMs, kind: 'exit', paneIds });
      return new Promise((resolve) => {
        motionFrameRef.current = window.requestAnimationFrame(() => {
          motionFrameRef.current = undefined;
          setMotion((current) =>
            current?.kind === 'exit' ? { ...current, ratios } : current,
          );
          // Release the collapsed geometry even if the close never lands, so a
          // rejected close cannot leave the workspace stuck mid-animation.
          motionTimerRef.current = window.setTimeout(() => {
            motionTimerRef.current = undefined;
            setMotion((current) =>
              current?.kind === 'exit' ? undefined : current,
            );
          }, durationMs + PANE_MOTION_RELEASE_MS);
          window.setTimeout(resolve, durationMs + PANE_MOTION_TAIL_MS);
        });
      });
    },
    [clearMotionTimers, props.root],
  );

  useImperativeHandle(
    ref,
    () => ({
      animateAllTabsAndPanesExit: async () => {
        const currentPanes = collectPanes(props.root);
        const tabExits = currentPanes.flatMap((pane) =>
          pane.tabs.map(
            (tab) =>
              tabBars.get(pane.paneId)?.animateTabExit(tab.tabId) ??
              Promise.resolve(),
          ),
        );
        const paneExit = waitForWorkspaceMotion(45).then(() =>
          beginPaneExit(
            currentPanes
              .filter(({ paneId }) => paneId !== props.activePaneId)
              .map(({ paneId }) => paneId),
            80,
          ),
        );
        await Promise.all([...tabExits, paneExit]);
      },
      animatePaneExit: (paneId, durationMs = PANE_EXIT_DURATION_MS) =>
        beginPaneExit([paneId], durationMs),
      animateTabAndPaneExit: async (paneId, tabId) => {
        await Promise.all([
          tabBars.get(paneId)?.animateTabExit(tabId) ?? Promise.resolve(),
          beginPaneExit([paneId], 80),
        ]);
      },
      animateTabExit: (paneId, tabId) =>
        tabBars.get(paneId)?.animateTabExit(tabId) ??
        Promise.resolve(),
    }),
    [beginPaneExit, props.activePaneId, props.root, tabBars],
  );

  const cancelDropExit = useCallback((): void => {
    if (dropExitTimerRef.current !== undefined) {
      window.clearTimeout(dropExitTimerRef.current);
      dropExitTimerRef.current = undefined;
    }
  }, []);

  const showHostDropIntent = useCallback((intent: HostDropIntent): void => {
    cancelDropExit();
    dropIntentRef.current = intent;
    setDropOverlay({ exiting: false, intent });
  }, [cancelDropExit]);

  const clearHostDropIntent = useCallback((): void => {
    const intent = dropIntentRef.current;
    dropIntentRef.current = undefined;
    if (!intent) {
      return;
    }
    cancelDropExit();
    setDropOverlay({ exiting: true, intent });
    dropExitTimerRef.current = window.setTimeout(() => {
      dropExitTimerRef.current = undefined;
      setDropOverlay(undefined);
    }, 90);
  }, [cancelDropExit]);

  function cancelDragLeaveFrame(): void {
    if (dragLeaveFrameRef.current !== undefined) {
      window.cancelAnimationFrame(dragLeaveFrameRef.current);
      dragLeaveFrameRef.current = undefined;
    }
  }

  useEffect(() => {
    const removeLifecycle = installWorkspaceDragLifecycle();
    const unsubscribe = subscribeWorkspaceDragReset(() => {
      if (dragLeaveFrameRef.current !== undefined) {
        window.cancelAnimationFrame(dragLeaveFrameRef.current);
        dragLeaveFrameRef.current = undefined;
      }
      clearHostDropIntent();
    });
    return () => {
      unsubscribe();
      removeLifecycle();
      cancelDropExit();
      clearMotionTimers(true);
      if (dragLeaveFrameRef.current !== undefined) {
        window.cancelAnimationFrame(dragLeaveFrameRef.current);
      }
    };
  }, [cancelDropExit, clearHostDropIntent, clearMotionTimers]);

  useLayoutEffect(() => {
    if (!enteringPaneId) {
      return;
    }
    const settled = new Set(
      collectPanes(props.root).map(({ paneId }) => paneId),
    );
    const placement = findPaneEntryPlacement(props.root, enteringPaneId);
    if (!placement || workspaceMotionReduced()) {
      // Still before paint, so the collapsed frame is never shown.
      queueMicrotask(() => setSettledPaneIds(settled));
      return;
    }
    clearMotionTimers(true);
    // The entering pane paints collapsed against the split edge, then the
    // transitions are armed, and only on the frame after that does the layout
    // settle — which is what turns the geometry change into a transition
    // rather than a jump.
    motionFrameRef.current = window.requestAnimationFrame(() => {
      setPaneEntry({ paneId: enteringPaneId, placement });
      setMotion({
        durationMs: PANE_ENTRY_DURATION_MS,
        kind: 'entry',
        paneIds: [enteringPaneId],
      });
      motionFrameRef.current = window.requestAnimationFrame(() => {
        motionFrameRef.current = undefined;
        setSettledPaneIds(settled);
        motionTimerRef.current = window.setTimeout(() => {
          motionTimerRef.current = undefined;
          setMotion((current) =>
            current?.kind === 'entry' ? undefined : current,
          );
          setPaneEntry(undefined);
        }, PANE_ENTRY_DURATION_MS + PANE_MOTION_TAIL_MS);
      });
    });
  }, [clearMotionTimers, enteringPaneId, paneIdsKey, props.root]);

  useLayoutEffect(() => {
    const currentPanes = collectPanes(props.root);
    const enteringTabIds = new Set(
      findNewWorkspaceTabIds(previousTabIdsRef.current, props.root),
    );
    const currentTabIds = new Set(
      currentPanes.flatMap(({ tabs }) => tabs.map(({ tabId }) => tabId)),
    );
    for (const pane of currentPanes) {
      for (const tab of pane.tabs) {
        if (enteringTabIds.has(tab.tabId)) {
          tabBars.get(pane.paneId)?.animateTabEntry(tab.tabId);
        }
      }
    }
    previousTabIdsRef.current = currentTabIds;
  }, [props.root, tabBars]);

  useEffect(
    () =>
      subscribeWorkspacePointerDrag(
        ({ clientX, clientY, payload }) => {
          const host = hostRef.current;
          if (!host) {
            return;
          }
          const resolved = resolveWorkspaceHostDrop(
            props.root,
            paneCount,
            host,
            clientX,
            clientY,
            payload,
          );
          if (!resolved) {
            clearHostDropIntent();
            return;
          }
          const current = dropIntentRef.current;
          const next = resolved.intent;
          if (
            current?.paneId === next.paneId &&
            current.edge === next.edge &&
            current.duplicate === next.duplicate &&
            current.left === next.left &&
            current.top === next.top &&
            current.width === next.width &&
            current.height === next.height
          ) {
            return;
          }
          showHostDropIntent(next);
        },
        ({ clientX, clientY, payload }) => {
          const host = hostRef.current;
          const resolved = host
            ? resolveWorkspaceHostDrop(
                props.root,
                paneCount,
                host,
                clientX,
                clientY,
                payload,
              )
            : undefined;
          const dragged = consumeWorkspacePointerDrag(payload);
          clearHostDropIntent();
          if (resolved && dragged) {
            performWorkspaceDrop(
              props,
              dragged,
              resolved.intent.paneId,
              resolved.intent.edge,
              resolved.target,
            );
          }
        },
      ),
    [
      clearHostDropIntent,
      paneCount,
      props,
      showHostDropIntent,
    ],
  );

  function updateHostDropIntent(event: DragEvent<HTMLDivElement>): void {
    if (!hasWorkspaceDrag(event.dataTransfer)) {
      clearHostDropIntent();
      return;
    }
    const dragged = readWorkspaceDrag(event.dataTransfer);
    if (!dragged) {
      clearHostDropIntent();
      return;
    }
    const resolved = resolveWorkspaceHostDrop(
      props.root,
      paneCount,
      event.currentTarget,
      event.clientX,
      event.clientY,
      dragged,
      event.target,
    );
    if (!resolved) {
      clearHostDropIntent();
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect =
      dragged?.kind === 'project-node' ? 'copy' : 'move';
    const next = resolved.intent;
    const current = dropIntentRef.current;
    if (
      current?.paneId === next.paneId &&
      current.count === next.count &&
      current.edge === next.edge &&
      current.duplicate === next.duplicate &&
      current.left === next.left &&
      current.top === next.top &&
      current.width === next.width &&
      current.height === next.height
    ) {
      return;
    }
    showHostDropIntent(next);
  }

  function handleHostDrop(event: DragEvent<HTMLDivElement>): void {
    if (!hasWorkspaceDrag(event.dataTransfer)) {
      return;
    }
    const preview = readWorkspaceDrag(event.dataTransfer);
    if (!preview) {
      return;
    }
    const resolved = resolveWorkspaceHostDrop(
      props.root,
      paneCount,
      event.currentTarget,
      event.clientX,
      event.clientY,
      preview,
      event.target,
    );
    if (!resolved) {
      return;
    }
    const dragged = consumeWorkspaceDrag(event.dataTransfer);
    if (!dragged) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    cancelDragLeaveFrame();
    clearHostDropIntent();
    performWorkspaceDrop(
      props,
      dragged,
      resolved.intent.paneId,
      resolved.intent.edge,
      resolved.target,
    );
  }

  const entries = flattenWorkspaceLayout(
    props.root,
    enteringPaneId
      ? collapsedWorkspaceRatios(props.root, new Set([enteringPaneId]))
      : activeMotion?.ratios,
  );

  return (
    <div
      className="workspace-pane-host"
      data-workspace-motion={activeMotion?.kind}
      onDragCapture={(event) => {
        cancelDragLeaveFrame();
        updateHostDropIntent(event);
      }}
      onDragLeaveCapture={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        ) {
          return;
        }
        const host = event.currentTarget;
        const { clientX, clientY } = event;
        cancelDragLeaveFrame();
        dragLeaveFrameRef.current = window.requestAnimationFrame(() => {
          dragLeaveFrameRef.current = undefined;
          if (clientX === 0 && clientY === 0) {
            return;
          }
          const hovered = document.elementFromPoint(clientX, clientY);
          if (!hovered || !host.contains(hovered)) {
            clearHostDropIntent();
          }
        });
      }}
      onDragOverCapture={(event) => {
        cancelDragLeaveFrame();
        updateHostDropIntent(event);
      }}
      onDropCapture={handleHostDrop}
      ref={hostRef}
      style={
        activeMotion
          ? ({
              '--workspace-pane-motion-duration': `${activeMotion.durationMs}ms`,
            } as CSSProperties)
          : undefined
      }
    >
      {entries.map((entry) =>
        entry.kind === 'pane' ? (
          <PaneLeaf
            {...props}
            entryPlacement={
              paneEntry?.paneId === entry.node.paneId
                ? paneEntry.placement
                : undefined
            }
            exiting={
              activeMotion?.kind === 'exit' &&
              activeMotion.ratios !== undefined &&
              activeMotion.paneIds.includes(entry.node.paneId)
            }
            key={entry.node.paneId}
            layout={entry}
            paneCount={paneCount}
            tabBars={tabBars}
          />
        ) : (
          <SplitDivider
            key={entry.node.splitId}
            layout={entry}
            onLiveResize={handleLiveResize}
            onReleaseResize={handleReleaseResize}
            onResizeSplit={props.onResizeSplit}
            translate={props.translate}
          />
        ),
      )}
      {dropOverlay ? (
        <div
          aria-hidden="true"
          className={`workspace-pane-host__drop-target${
            dropOverlay.exiting
              ? ' workspace-pane-host__drop-target--exiting'
              : ''
          }`}
          data-duplicate={
            dropOverlay.intent.duplicate || undefined
          }
          data-drop-edge={dropOverlay.intent.edge}
          style={{
            height: dropOverlay.intent.height,
            left: dropOverlay.intent.left,
            top: dropOverlay.intent.top,
            width: dropOverlay.intent.width,
          }}
        >
          <div
            className={`workspace-pane__drop-preview workspace-pane__drop-preview--${dropOverlay.intent.edge}`}
          >
            {dropOverlay.intent.edge === 'center' ? (
              <span>
                {dropOverlay.intent.count > 1
                  ? `${dropOverlay.intent.count} · `
                  : ''}
                {props.translate('pages.openInPane')}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
});
