import {
  useEffect,
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
  const pendingFocusTabId = useRef<string | undefined>(undefined);
  const draggedTabId = useRef<string | undefined>(undefined);
  const dropTargetRef = useRef<DropTarget | undefined>(undefined);
  const [dropTarget, setDropTarget] = useState<DropTarget>();
  const [draggingTabId, setDraggingTabId] = useState<string>();

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
      </div>
    </div>
  );
}
