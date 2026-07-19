import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type WheelEvent,
} from 'react';

import plusIcon from '../../../../public/images/icons/actions/plus.svg';
import {
  getTabTargetKey,
  isHomeTarget,
  type TabDescriptor,
} from '../../../shared/contracts';
import type { TabPresentation } from '../../pages/page-types';
import { MaskedIcon } from '../MaskedIcon';
import { getTooltipTargetProps } from '../tooltip';
import {
  beginWorkspaceTabPointerDrag,
  setWorkspaceDragActive,
  writeWorkspaceTabDrag,
} from './workspace-drag';
import { animateTabExit } from './tab-motion';

interface TabBarProps {
  paneId?: string;
  canCloseSoleTab?: boolean;
  activeTabId: string | null;
  tabs: readonly TabDescriptor[];
  closeLabel: string;
  getPresentation: (tab: TabDescriptor) => TabPresentation;
  navigationLabel: string;
  newTabLabel?: string;
  onClose: (tabId: string) => void;
  onMove: (tabId: string, toIndex: number) => void;
  onNewTab?: () => void;
  onSelect: (tabId: string) => void;
  onContextMenu?: (
    tabId: string,
    position: { x: number; y: number },
  ) => void;
}

interface DropTarget {
  tabId: string;
  edge: 'before' | 'after';
}

const TAB_MOTION_DURATION_MS = 120;

export interface TabBarHandle {
  animateTabEntry: (tabId: string) => void;
  animateTabExit: (tabId: string) => Promise<void>;
}

function focusTab(
  refs: Map<string, HTMLButtonElement>,
  tabs: readonly TabDescriptor[],
  currentIndex: number,
  offset: number,
): string | undefined {
  if (tabs.length === 0) {
    return undefined;
  }

  const index = (currentIndex + offset + tabs.length) % tabs.length;
  const tabId = tabs[index]?.tabId;

  if (tabId) {
    refs.get(tabId)?.focus();
  }

  return tabId;
}

export function tabReorderShift(
  index: number,
  draggedIndex: number,
  insertionIndex: number | undefined,
  draggedWidth: number,
): number {
  if (insertionIndex === undefined || draggedIndex < 0) {
    return 0;
  }
  if (
    insertionIndex < draggedIndex &&
    index >= insertionIndex &&
    index < draggedIndex
  ) {
    return draggedWidth;
  }
  if (
    insertionIndex > draggedIndex &&
    index > draggedIndex &&
    index <= insertionIndex
  ) {
    return -draggedWidth;
  }
  return 0;
}

export const TabBar = forwardRef<TabBarHandle, TabBarProps>(function TabBar({
  paneId = 'primary',
  activeTabId,
  canCloseSoleTab = false,
  tabs,
  closeLabel,
  getPresentation,
  navigationLabel,
  newTabLabel,
  onClose,
  onMove,
  onNewTab,
  onSelect,
  onContextMenu,
}: TabBarProps, ref) {
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const wrapperRefs = useRef(new Map<string, HTMLDivElement>());
  const tabListRef = useRef<HTMLDivElement>(null);
  const pendingFocusTabId = useRef<string | undefined>(undefined);
  const draggedTabId = useRef<string | undefined>(undefined);
  const dropTargetRef = useRef<DropTarget | undefined>(undefined);
  const [dropTarget, setDropTarget] = useState<DropTarget>();
  const [draggingTabId, setDraggingTabId] = useState<string>();
  const [draggedTabWidth, setDraggedTabWidth] = useState(0);

  useImperativeHandle(
    ref,
    () => ({
      animateTabEntry: (tabId) => {
        const element = wrapperRefs.current.get(tabId);
        if (!element || element.classList.contains('page-tab--entering')) {
          return;
        }
        element.classList.add('page-tab--entering');
        const finish = (event?: AnimationEvent): void => {
          if (event && event.target !== element) {
            return;
          }
          window.clearTimeout(timeout);
          element.removeEventListener('animationend', finish);
          element.classList.remove('page-tab--entering');
        };
        const timeout = window.setTimeout(finish, TAB_MOTION_DURATION_MS + 80);
        element.addEventListener('animationend', finish);
      },
      animateTabExit: (tabId) =>
        animateTabExit(wrapperRefs.current.get(tabId) ?? null),
    }),
    [],
  );

  useEffect(() => {
    const tabId = pendingFocusTabId.current;

    if (tabId) {
      tabRefs.current.get(tabId)?.focus();
      pendingFocusTabId.current = undefined;
    }
  }, [tabs]);

  useEffect(() => {
    const activeTab = activeTabId
      ? tabRefs.current.get(activeTabId)
      : undefined;

    if (typeof activeTab?.scrollIntoView === 'function') {
      activeTab.scrollIntoView({
        behavior: 'instant',
        block: 'nearest',
        inline: 'nearest',
      });
    }
  }, [activeTabId]);

  function closeAndFocusNeighbor(tab: TabDescriptor, index: number): void {
    const neighbor = tabs[index + 1] ?? tabs[index - 1];
    pendingFocusTabId.current = neighbor?.tabId ?? 'page:home';
    onClose(tab.tabId);
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    tab: TabDescriptor,
    index: number,
  ): void {
    let nextTabId: string | undefined;

    if (event.key === 'ArrowLeft') {
      nextTabId = focusTab(tabRefs.current, tabs, index, -1);
    } else if (event.key === 'ArrowRight') {
      nextTabId = focusTab(tabRefs.current, tabs, index, 1);
    } else if (event.key === 'Home') {
      nextTabId = focusTab(tabRefs.current, tabs, 0, 0);
    } else if (event.key === 'End') {
      nextTabId = focusTab(tabRefs.current, tabs, tabs.length - 1, 0);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(tab.tabId);
      return;
    } else if (
      event.key === 'Delete' &&
      !(tabs.length === 1 && isHomeTarget(tab.target))
    ) {
      event.preventDefault();
      closeAndFocusNeighbor(tab, index);
      return;
    } else {
      return;
    }

    event.preventDefault();
    if (nextTabId) {
      onSelect(nextTabId);
    }
  }

  function resolveDropTarget(
    clientX: number,
    draggedId: string,
  ): DropTarget | undefined {
    const tabList = tabListRef.current;
    if (!tabList) {
      return undefined;
    }
    const listBounds = tabList.getBoundingClientRect();
    const localX = clientX - listBounds.left + tabList.scrollLeft;
    const candidates = tabs.filter(({ tabId }) => tabId !== draggedId);
    const candidate = candidates.find((tab) => {
      const element = wrapperRefs.current.get(tab.tabId);
      return element
        ? localX < element.offsetLeft + element.offsetWidth / 2
        : false;
    });
    const lastCandidate = candidates.at(-1);

    return candidate
      ? { tabId: candidate.tabId, edge: 'before' }
      : lastCandidate
        ? { tabId: lastCandidate.tabId, edge: 'after' }
        : undefined;
  }

  function handleTabListDragOver(event: DragEvent<HTMLDivElement>): void {
    const draggedId = draggedTabId.current;

    if (!draggedId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const target = resolveDropTarget(event.clientX, draggedId);

    if (
      dropTargetRef.current?.tabId === target?.tabId &&
      dropTargetRef.current?.edge === target?.edge
    ) {
      return;
    }

    dropTargetRef.current = target;
    setDropTarget(target);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    const draggedId = draggedTabId.current;
    if (!draggedId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const target = draggedId
      ? resolveDropTarget(event.clientX, draggedId)
      : undefined;

    if (!draggedId || !target) {
      clearDragState();
      return;
    }

    const fromIndex = tabs.findIndex(({ tabId }) => tabId === draggedId);
    const targetIndex = tabs.findIndex(
      ({ tabId }) => tabId === target.tabId,
    );

    if (fromIndex < 0 || targetIndex < 0) {
      clearDragState();
      return;
    }

    let insertionIndex =
      targetIndex + (target.edge === 'after' ? 1 : 0);

    if (fromIndex < insertionIndex) {
      insertionIndex -= 1;
    }

    onMove(draggedId, insertionIndex);
    clearDragState();
  }

  function clearDragState(): void {
    setWorkspaceDragActive(false);
    draggedTabId.current = undefined;
    dropTargetRef.current = undefined;
    setDropTarget(undefined);
    setDraggingTabId(undefined);
    setDraggedTabWidth(0);
  }

  function insertionIndexFor(
    draggedId: string,
    target: DropTarget | undefined,
  ): number | undefined {
    if (!target) {
      return undefined;
    }
    const fromIndex = tabs.findIndex(({ tabId }) => tabId === draggedId);
    const targetIndex = tabs.findIndex(
      ({ tabId }) => tabId === target.tabId,
    );
    if (fromIndex < 0 || targetIndex < 0) {
      return undefined;
    }
    let insertionIndex =
      targetIndex + (target.edge === 'after' ? 1 : 0);
    if (fromIndex < insertionIndex) {
      insertionIndex -= 1;
    }
    return insertionIndex;
  }

  function handleTabListWheel(event: WheelEvent<HTMLDivElement>): void {
    if (
      event.ctrlKey ||
      event.currentTarget.scrollWidth <= event.currentTarget.clientWidth ||
      Math.abs(event.deltaX) >= Math.abs(event.deltaY)
    ) {
      return;
    }

    event.preventDefault();
    event.currentTarget.scrollLeft += event.deltaY;
  }

  const draggedIndex = draggingTabId
    ? tabs.findIndex(({ tabId }) => tabId === draggingTabId)
    : -1;
  const insertionIndex = draggingTabId
    ? insertionIndexFor(draggingTabId, dropTarget)
    : undefined;

  return (
    <div className="pages-bar">
      <div
        aria-label={navigationLabel}
        className={`pages-bar__tabs${draggingTabId ? ' pages-bar__tabs--dragging' : ''}`}
        onDragLeave={(event) => {
          if (
            !(event.relatedTarget instanceof Node) ||
            !event.currentTarget.contains(event.relatedTarget)
          ) {
            dropTargetRef.current = undefined;
            setDropTarget(undefined);
          }
        }}
        onDragOver={handleTabListDragOver}
        onDrop={handleDrop}
        onWheel={handleTabListWheel}
        ref={tabListRef}
        role="tablist"
        style={
          {
            '--page-tab-motion-duration': `${TAB_MOTION_DURATION_MS}ms`,
          } as CSSProperties
        }
      >
        {tabs.map((tab, index) => {
          const presentation = getPresentation(tab);
          const label = presentation.title;
          const active = tab.tabId === activeTabId;
          const closable = !(
            tabs.length === 1 &&
            !canCloseSoleTab &&
            (isHomeTarget(tab.target) ||
              (tab.target.type === 'internal' &&
                tab.target.pageId === 'new-tab'))
          );
          const dragShift = tabReorderShift(
            index,
            draggedIndex,
            insertionIndex,
            draggedTabWidth,
          );
          const draggingClass =
            draggingTabId === tab.tabId
              ? ` page-tab--dragging${dropTarget ? ' page-tab--drag-source' : ''}`
              : dragShift === 0
                ? ''
                : ' page-tab--drag-shift';
          return (
            <div
              className={`page-tab${active ? ' page-tab--active' : ''}${draggingClass}`}
              draggable
              key={tab.tabId}
              onDragEnd={clearDragState}
              onPointerDown={(event) => {
                if (
                  event.button !== 0 ||
                  (event.target instanceof Element &&
                    event.target.closest('.page-tab__close'))
                ) {
                  return;
                }
                beginWorkspaceTabPointerDrag(
                  paneId,
                  tab.tabId,
                  getTabTargetKey(tab.target),
                  event.pointerId,
                  event.clientX,
                  event.clientY,
                );
              }}
              onContextMenu={(event) => {
                if (!onContextMenu) {
                  return;
                }
                event.preventDefault();
                onSelect(tab.tabId);
                onContextMenu(tab.tabId, {
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
              onDragStart={(event) => {
                draggedTabId.current = tab.tabId;
                setDraggingTabId(tab.tabId);
                const bounds = event.currentTarget.getBoundingClientRect();
                const styles = getComputedStyle(event.currentTarget);
                setDraggedTabWidth(
                  bounds.width +
                    Number.parseFloat(styles.marginLeft || '0') +
                    Number.parseFloat(styles.marginRight || '0'),
                );
                setWorkspaceDragActive(true);
                event.dataTransfer.effectAllowed = 'move';
                const dragImage = event.currentTarget.cloneNode(
                  true,
                ) as HTMLElement;
                dragImage.className = 'workspace-drag-image';
                dragImage.setAttribute('aria-hidden', 'true');
                dragImage.querySelectorAll<HTMLElement>('[id], button').forEach(
                  (element) => {
                    element.removeAttribute('id');
                    element.setAttribute('tabindex', '-1');
                  },
                );
                document.body.append(dragImage);
                event.dataTransfer.setDragImage(dragImage, 22, 20);
                window.requestAnimationFrame(() => dragImage.remove());
                writeWorkspaceTabDrag(
                  event.dataTransfer,
                  paneId,
                  tab.tabId,
                  getTabTargetKey(tab.target),
                );
              }}
              style={
                dragShift === 0
                  ? undefined
                  : ({
                      '--page-tab-drag-shift': `${dragShift}px`,
                    } as CSSProperties)
              }
              ref={(element) => {
                if (element) {
                  wrapperRefs.current.set(tab.tabId, element);
                } else {
                  wrapperRefs.current.delete(tab.tabId);
                }
              }}
              role="presentation"
            >
              <div className="page-tab__content">
                <button
                  aria-controls={`page-panel-${paneId}-${tab.tabId}`}
                  aria-selected={active}
                  className="page-tab__trigger"
                  id={`page-tab-${paneId}-${tab.tabId}`}
                  onClick={() => onSelect(tab.tabId)}
                  onKeyDown={(event) => handleKeyDown(event, tab, index)}
                  ref={(element) => {
                    if (element) {
                      tabRefs.current.set(tab.tabId, element);
                    } else {
                      tabRefs.current.delete(tab.tabId);
                    }
                  }}
                  role="tab"
                  tabIndex={active ? 0 : -1}
                  type="button"
                >
                  <MaskedIcon
                    className="page-tab__icon"
                    icon={presentation.icon}
                  />
                  <span className="page-tab__label">{label}</span>
                </button>
                <button
                  aria-hidden={!closable}
                  aria-label={`${closeLabel}: ${label}`}
                  className={`page-tab__close${closable ? '' : ' page-tab__close--hidden'}`}
                  disabled={!closable}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeAndFocusNeighbor(tab, index);
                  }}
                  tabIndex={closable ? 0 : -1}
                  type="button"
                >
                  <svg aria-hidden="true" viewBox="0 0 16 16">
                    <path d="M4 4l8 8m0-8-8 8" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
        {newTabLabel && onNewTab ? (
          <button
            aria-label={newTabLabel}
            className="pages-bar__new-tab"
            onClick={onNewTab}
            type="button"
            {...getTooltipTargetProps(newTabLabel, 'bottom')}
          >
            <MaskedIcon icon={plusIcon} />
          </button>
        ) : null}
      </div>
    </div>
  );
});
