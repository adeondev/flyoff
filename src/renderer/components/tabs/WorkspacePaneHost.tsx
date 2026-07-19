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
  animateWorkspacePaneExit,
  waitForWorkspaceMotion,
} from './workspace-pane-motion';

type PaneDropEdge = 'center' | 'left' | 'right' | 'top' | 'bottom';
type PaneEntryPlacement =
  | 'row-start'
  | 'row-end'
  | 'column-start'
  | 'column-end';
const PANE_DROP_EDGE_RATIO = 0.25;
const PANE_TAB_BAR_HEIGHT = 48;

interface PaneDropIntent {
  duplicate: boolean;
  edge: PaneDropEdge;
}

interface HostDropIntent extends PaneDropIntent {
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
  onNewTab: (paneId: string) => void;
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

interface PaneTreeProps extends WorkspacePaneHostProps {
  left: boolean;
  paneCount: number;
  paneEntry?: {
    paneId: string;
    placement: PaneEntryPlacement;
    splitId: string;
  };
  right: boolean;
  tabBars: Map<string, TabBarHandle>;
  top: boolean;
  node: WorkspaceLayoutSnapshot;
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
): Pick<
  NonNullable<PaneTreeProps['paneEntry']>,
  'placement' | 'splitId'
> | undefined {
  if (node.kind === 'pane') {
    return undefined;
  }
  const inFirst = containsPane(node.first, paneId);
  const branch = inFirst ? node.first : node.second;
  return (
    findPaneEntryPlacement(branch, paneId) ??
    {
      placement: `${node.direction}-${inFirst ? 'start' : 'end'}`,
      splitId: node.splitId,
    }
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
    return getTabTargetKey(dragged.target);
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
  const edge = resolvePaneDropEdge(
    paneBounds,
    clientX,
    clientY,
    paneCount < WORKSPACE_MAX_PANES,
    dragged,
    paneId,
  );
  if (!edge) {
    return undefined;
  }
  const targetKey = targetKeyForWorkspaceDrag(root, dragged);
  const hostBounds = host.getBoundingClientRect();
  return {
    intent: {
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
      props.onOpenTarget(paneId, dragged.target);
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
  props.onSplitPaneWithTarget(paneId, dragged.target, direction, before);
}

function PaneLeaf(props: PaneTreeProps & {
  node: Extract<WorkspaceLayoutSnapshot, { kind: 'pane' }>;
}) {
  const { node } = props;
  const [tabMenu, setTabMenu] = useState<{
    tabId: string;
    x: number;
    y: number;
  }>();
  const canSplit = props.paneCount < WORKSPACE_MAX_PANES;
  const items: readonly MenuItem[] = [
    {
      kind: 'action',
      id: 'split-right',
      label: props.translate('pages.splitRight'),
      icon: splitRightIcon,
      disabled: !canSplit,
    },
    {
      kind: 'action',
      id: 'split-below',
      label: props.translate('pages.splitBelow'),
      icon: splitDownIcon,
      disabled: !canSplit,
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
      data-pane-id={node.paneId}
      data-pane-entry={
        props.paneEntry?.paneId === node.paneId
          ? props.paneEntry.placement
          : undefined
      }
      data-top={props.top || undefined}
      data-top-left={(props.top && props.left) || undefined}
      data-top-right={(props.top && props.right) || undefined}
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
          newTabLabel={props.translate('pages.newTab')}
          onClose={(tabId) => props.onCloseTab(node.paneId, tabId)}
          onMove={(tabId, toIndex) =>
            props.onMoveTab(node.paneId, tabId, toIndex)
          }
          onNewTab={() => props.onNewTab(node.paneId)}
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
        onScrollChange={(tabId, scrollTop) =>
          props.onScrollChange(node.paneId, tabId, scrollTop)
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
              disabled: !canSplit,
            },
            {
              kind: 'action',
              id: 'split-below',
              label: props.translate('pages.splitBelow'),
              icon: splitDownIcon,
              disabled: !canSplit,
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

function SplitDivider(
  props: PaneTreeProps & {
    node: Extract<WorkspaceLayoutSnapshot, { kind: 'split' }>;
  },
) {
  const { node } = props;
  const vertical = node.direction === 'row';

  function updateFromPointer(event: PointerEvent<HTMLDivElement>): void {
    const parent = event.currentTarget.parentElement;
    if (!parent) {
      return;
    }
    const bounds = parent.getBoundingClientRect();
    const ratio = vertical
      ? (event.clientX - bounds.left) / Math.max(1, bounds.width)
      : (event.clientY - bounds.top) / Math.max(1, bounds.height);
    props.onResizeSplit(node.splitId, ratio);
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
    props.onResizeSplit(node.splitId, node.ratio + direction * 0.02);
  }

  return (
    <div
      aria-label={props.translate('pages.resizePane')}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-valuemax={90}
      aria-valuemin={10}
      aria-valuenow={Math.round(node.ratio * 100)}
      className="workspace-split__divider"
      onDoubleClick={() => props.onResizeSplit(node.splitId, 0.5)}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        updateFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          updateFromPointer(event);
        }
      }}
      role="separator"
      tabIndex={0}
    />
  );
}

function PaneTree(props: PaneTreeProps): ReactNode {
  if (props.node.kind === 'pane') {
    return <PaneLeaf {...props} node={props.node} />;
  }

  const firstTop = props.top;
  const secondTop = props.top && props.node.direction === 'row';
  const firstLeft = props.left;
  const secondLeft = props.node.direction === 'row' ? false : props.left;
  const firstRight = props.node.direction === 'row' ? false : props.right;
  const secondRight = props.right;
  return (
    <div
      className={`workspace-split workspace-split--${props.node.direction}`}
      data-split-entry={
        props.paneEntry?.splitId === props.node.splitId
          ? props.paneEntry.placement
          : undefined
      }
      style={{
        '--workspace-split-ratio': `${props.node.ratio * 100}%`,
      } as CSSProperties}
    >
      <PaneTree
        {...props}
        left={firstLeft}
        node={props.node.first}
        right={firstRight}
        top={firstTop}
      />
      <SplitDivider {...props} node={props.node} />
      <PaneTree
        {...props}
        left={secondLeft}
        node={props.node.second}
        right={secondRight}
        top={secondTop}
      />
    </div>
  );
}

export const WorkspacePaneHost = forwardRef<
  WorkspacePaneHostHandle,
  WorkspacePaneHostProps
>(function WorkspacePaneHost(props, ref) {
  const [dropOverlay, setDropOverlay] = useState<HostDropOverlay>();
  const [paneEntry, setPaneEntry] = useState<PaneTreeProps['paneEntry']>();
  const dropIntentRef = useRef<HostDropIntent | undefined>(undefined);
  const dropExitTimerRef = useRef<number | undefined>(undefined);
  const dragLeaveFrameRef = useRef<number | undefined>(undefined);
  const hostRef = useRef<HTMLDivElement>(null);
  const [tabBars] = useState(() => new Map<string, TabBarHandle>());
  const panes = collectPanes(props.root);
  const paneCount = panes.length;
  const paneIdsKey = panes.map(({ paneId }) => paneId).join('\u0000');
  const previousPaneIdsRef = useRef(
    new Set(panes.map(({ paneId }) => paneId)),
  );
  const previousTabIdsRef = useRef(
    new Set(panes.flatMap(({ tabs }) => tabs.map(({ tabId }) => tabId))),
  );
  const paneEntryTimerRef = useRef<number | undefined>(undefined);

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
          Promise.all(
            currentPanes
              .filter(({ paneId }) => paneId !== props.activePaneId)
              .map((pane) => {
                const element = [...(hostRef.current?.querySelectorAll<HTMLElement>(
                  '.workspace-pane[data-pane-id]',
                ) ?? [])].find(
                  (candidate) => candidate.dataset.paneId === pane.paneId,
                );
                return animateWorkspacePaneExit(element ?? null, 80);
              }),
          ),
        );
        await Promise.all([...tabExits, paneExit]);
      },
      animatePaneExit: (paneId, durationMs) => {
        const pane = [...(hostRef.current?.querySelectorAll<HTMLElement>(
          '.workspace-pane[data-pane-id]',
        ) ?? [])].find((candidate) => candidate.dataset.paneId === paneId);
        return animateWorkspacePaneExit(pane ?? null, durationMs);
      },
      animateTabAndPaneExit: async (paneId, tabId) => {
        const pane = [...(hostRef.current?.querySelectorAll<HTMLElement>(
          '.workspace-pane[data-pane-id]',
        ) ?? [])].find((candidate) => candidate.dataset.paneId === paneId);
        const tabExit =
          tabBars.get(paneId)?.animateTabExit(tabId) ?? Promise.resolve();
        await waitForWorkspaceMotion(45);
        const paneExit = animateWorkspacePaneExit(pane ?? null, 80);
        await Promise.all([tabExit, paneExit]);
      },
      animateTabExit: (paneId, tabId) =>
        tabBars.get(paneId)?.animateTabExit(tabId) ??
        Promise.resolve(),
    }),
    [props.activePaneId, props.root, tabBars],
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
      if (dragLeaveFrameRef.current !== undefined) {
        window.cancelAnimationFrame(dragLeaveFrameRef.current);
      }
      if (paneEntryTimerRef.current !== undefined) {
        window.clearTimeout(paneEntryTimerRef.current);
      }
    };
  }, [cancelDropExit, clearHostDropIntent]);

  useLayoutEffect(() => {
    if (paneEntryTimerRef.current !== undefined) {
      window.clearTimeout(paneEntryTimerRef.current);
      paneEntryTimerRef.current = undefined;
    }
    const currentPanes = collectPanes(props.root);
    const currentPaneIds = new Set(
      currentPanes.map(({ paneId }) => paneId),
    );
    const enteringPane = currentPanes.find(
      ({ paneId }) => !previousPaneIdsRef.current.has(paneId),
    );
    previousPaneIdsRef.current = currentPaneIds;
    const entry = enteringPane
      ? findPaneEntryPlacement(props.root, enteringPane.paneId)
      : undefined;
    if (!enteringPane || !entry) {
      setPaneEntry(undefined);
      return;
    }
    setPaneEntry({ paneId: enteringPane.paneId, ...entry });
    paneEntryTimerRef.current = window.setTimeout(() => {
      paneEntryTimerRef.current = undefined;
      setPaneEntry(undefined);
    }, 140);
  }, [paneIdsKey, props.root]);

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

  return (
    <div
      className="workspace-pane-host"
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
    >
      <PaneTree
        {...props}
        node={props.root}
        left
        paneCount={paneCount}
        paneEntry={paneEntry}
        right
        tabBars={tabBars}
        top
      />
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
              <span>{props.translate('pages.openInPane')}</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
});
