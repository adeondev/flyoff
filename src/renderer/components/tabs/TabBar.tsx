import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react';

import {
  isHomeTarget,
  type TabDescriptor,
} from '../../../shared/contracts';
import type { TabPresentation } from '../../pages/page-types';
import { MaskedIcon } from '../MaskedIcon';

interface TabBarProps {
  activeTabId: string | null;
  tabs: readonly TabDescriptor[];
  closeLabel: string;
  getPresentation: (tab: TabDescriptor) => TabPresentation;
  navigationLabel: string;
  onClose: (tabId: string) => void;
  onMove: (tabId: string, toIndex: number) => void;
  onSelect: (tabId: string) => void;
}

interface DropTarget {
  tabId: string;
  edge: 'before' | 'after';
}

interface TabVisualBounds {
  height: number;
  left: number;
  top: number;
  width: number;
}

interface ClosingTabVisual {
  active: boolean;
  bounds: TabVisualBounds;
  presentation: TabPresentation;
  tab: TabDescriptor;
}

const TAB_CLOSE_DURATION = 140;

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function removedTabVisuals(
  currentTabs: readonly TabDescriptor[],
  previousTabs: readonly TabDescriptor[],
  previousActiveTabId: string | null,
  previousBounds: ReadonlyMap<string, TabVisualBounds>,
  previousPresentations: ReadonlyMap<string, TabPresentation>,
): ClosingTabVisual[] {
  const currentContext = currentTabs[0]?.target.type === 'internal'
    ? 'home'
    : currentTabs[0]
      ? 'project'
      : undefined;
  const previousContext = previousTabs[0]?.target.type === 'internal'
    ? 'home'
    : previousTabs[0]
      ? 'project'
      : undefined;
  if (
    currentContext &&
    previousContext &&
    currentContext !== previousContext
  ) {
    return [];
  }

  const currentIds = new Set(currentTabs.map(({ tabId }) => tabId));

  return previousTabs.flatMap((tab) => {
    const bounds = previousBounds.get(tab.tabId);
    const presentation = previousPresentations.get(tab.tabId);

    return currentIds.has(tab.tabId) || !bounds || !presentation
      ? []
      : [
          {
            active: tab.tabId === previousActiveTabId,
            bounds,
            presentation,
            tab,
          },
        ];
  });
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

export function TabBar({
  activeTabId,
  tabs,
  closeLabel,
  getPresentation,
  navigationLabel,
  onClose,
  onMove,
  onSelect,
}: TabBarProps) {
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const wrapperRefs = useRef(new Map<string, HTMLDivElement>());
  const tabListRef = useRef<HTMLDivElement>(null);
  const pendingFocusTabId = useRef<string | undefined>(undefined);
  const draggedTabId = useRef<string | undefined>(undefined);
  const dropTargetRef = useRef<DropTarget | undefined>(undefined);
  const previousTabsRef = useRef(tabs);
  const previousActiveTabIdRef = useRef(activeTabId);
  const previousBoundsRef = useRef(new Map<string, TabVisualBounds>());
  const previousPresentationsRef = useRef(
    new Map<string, TabPresentation>(),
  );
  const closingTimersRef = useRef(new Map<string, number>());
  const [dropTarget, setDropTarget] = useState<DropTarget>();
  const [draggingTabId, setDraggingTabId] = useState<string>();
  const [closingTabs, setClosingTabs] = useState<ClosingTabVisual[]>([]);

  function finishClosingTab(tabId: string): void {
    const timer = closingTimersRef.current.get(tabId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      closingTimersRef.current.delete(tabId);
    }
    setClosingTabs((current) =>
      current.filter(({ tab }) => tab.tabId !== tabId),
    );
  }

  useEffect(
    () => () => {
      for (const timer of closingTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      closingTimersRef.current.clear();
    },
    [],
  );

  useLayoutEffect(() => {
    const tabList = tabListRef.current;
    if (!tabList) {
      return;
    }

    const removed = removedTabVisuals(
      tabs,
      previousTabsRef.current,
      previousActiveTabIdRef.current,
      previousBoundsRef.current,
      previousPresentationsRef.current,
    );
    const reducedMotion = prefersReducedMotion();
    const tabListBounds = tabList.getBoundingClientRect();
    const nextBounds = new Map<string, TabVisualBounds>();

    for (const tab of tabs) {
      const element = wrapperRefs.current.get(tab.tabId);
      if (!element) {
        continue;
      }

      const bounds = element.getBoundingClientRect();
      const relativeBounds = {
        height: bounds.height,
        left: bounds.left - tabListBounds.left + tabList.scrollLeft,
        top: bounds.top - tabListBounds.top + tabList.scrollTop,
        width: bounds.width,
      };
      nextBounds.set(tab.tabId, relativeBounds);

      const previous = previousBoundsRef.current.get(tab.tabId);
      const deltaX = previous ? previous.left - relativeBounds.left : 0;
      if (
        removed.length > 0 &&
        !reducedMotion &&
        Math.abs(deltaX) >= 0.5 &&
        typeof element.animate === 'function'
      ) {
        element.animate(
          [
            { transform: `translateX(${deltaX}px)` },
            { transform: 'translateX(0)' },
          ],
          {
            duration: TAB_CLOSE_DURATION,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          },
        );
      }
    }

    if (removed.length > 0 && !reducedMotion) {
      setClosingTabs((current) => {
        const next = [...current];
        for (const visual of removed) {
          if (!next.some(({ tab }) => tab.tabId === visual.tab.tabId)) {
            next.push(visual);
          }
        }
        return next;
      });

      for (const { tab } of removed) {
        if (!closingTimersRef.current.has(tab.tabId)) {
          closingTimersRef.current.set(
            tab.tabId,
            window.setTimeout(
              () => {
                closingTimersRef.current.delete(tab.tabId);
                setClosingTabs((current) =>
                  current.filter(
                    ({ tab: currentTab }) => currentTab.tabId !== tab.tabId,
                  ),
                );
              },
              TAB_CLOSE_DURATION + 30,
            ),
          );
        }
      }
    }

    previousTabsRef.current = tabs;
    previousActiveTabIdRef.current = activeTabId;
    previousBoundsRef.current = nextBounds;
    previousPresentationsRef.current = new Map(
      tabs.map((tab) => [tab.tabId, getPresentation(tab)]),
    );
  }, [activeTabId, getPresentation, tabs]);

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
    const candidates = tabs.filter(({ tabId }) => tabId !== draggedId);
    const candidate = candidates.find((tab) => {
      const element = wrapperRefs.current.get(tab.tabId);
      const bounds = element?.getBoundingClientRect();
      return bounds ? clientX < bounds.left + bounds.width / 2 : false;
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
    event.preventDefault();
    event.stopPropagation();
    const transferredId = event.dataTransfer.getData('text/plain');
    const draggedId =
      draggedTabId.current ??
      (tabs.some(({ tabId }) => tabId === transferredId)
        ? transferredId
        : undefined);
    const target = draggedId
      ? resolveDropTarget(event.clientX, draggedId)
      : undefined;

    if (!draggedId || !target) {
      draggedTabId.current = undefined;
      dropTargetRef.current = undefined;
      setDropTarget(undefined);
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
    draggedTabId.current = undefined;
    dropTargetRef.current = undefined;
    setDropTarget(undefined);
    setDraggingTabId(undefined);
  }

  function clearDragState(): void {
    draggedTabId.current = undefined;
    dropTargetRef.current = undefined;
    setDropTarget(undefined);
    setDraggingTabId(undefined);
  }

  return (
    <div className="pages-bar">
      <div
        aria-label={navigationLabel}
        className={`pages-bar__tabs${draggingTabId ? ' pages-bar__tabs--dragging' : ''}`}
        onDragLeave={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }

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
        ref={tabListRef}
        role="tablist"
      >
        {tabs.map((tab, index) => {
          const presentation = getPresentation(tab);
          const label = presentation.title;
          const active = tab.tabId === activeTabId;
          const closable = !(
            tabs.length === 1 &&
            isHomeTarget(tab.target)
          );
          const dropClass =
            dropTarget?.tabId === tab.tabId
              ? ` page-tab--drop-${dropTarget.edge}`
              : '';
          const draggingClass =
            draggingTabId === tab.tabId ? ' page-tab--dragging' : '';
          return (
            <div
              className={`page-tab${active ? ' page-tab--active' : ''}${dropClass}${draggingClass}`}
              draggable
              key={tab.tabId}
              onDragEnd={clearDragState}
              onDragStart={(event) => {
                draggedTabId.current = tab.tabId;
                setDraggingTabId(tab.tabId);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', tab.tabId);
              }}
              ref={(element) => {
                if (element) {
                  wrapperRefs.current.set(tab.tabId, element);
                } else {
                  wrapperRefs.current.delete(tab.tabId);
                }
              }}
              role="presentation"
            >
              <button
                aria-controls={`page-panel-${tab.tabId}`}
                aria-selected={active}
                className="page-tab__trigger"
                id={`page-tab-${tab.tabId}`}
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
          );
        })}
        {closingTabs.map(
          ({ active, bounds, presentation, tab }) => (
            <div
              aria-hidden="true"
              className={`page-tab page-tab--closing${active ? ' page-tab--active' : ''}`}
              key={`closing:${tab.tabId}`}
              onAnimationEnd={(event) => {
                if (event.currentTarget === event.target) {
                  finishClosingTab(tab.tabId);
                }
              }}
              style={{
                height: bounds.height,
                left: bounds.left,
                maxWidth: bounds.width,
                minWidth: bounds.width,
                top: bounds.top,
                width: bounds.width,
              }}
            >
              <span className="page-tab__trigger">
                <MaskedIcon
                  className="page-tab__icon"
                  icon={presentation.icon}
                />
                <span className="page-tab__label">{presentation.title}</span>
              </span>
              <span className="page-tab__close">
                <svg aria-hidden="true" viewBox="0 0 16 16">
                  <path d="M4 4l8 8m0-8-8 8" />
                </svg>
              </span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
