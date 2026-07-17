import {
  useEffect,
  useId,
  useMemo,
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';

import folderIcon from '../../../public/images/icons/instances/folder.svg';
import { MaskedIcon } from '../components/MaskedIcon';
import type { Translate } from '../pages/page-types';
import { listProjectPageTypeDefinitions } from './project-page-type-registry';

export interface AddInstanceChoice {
  kind: 'folder' | 'page';
  pageType?: string;
}

export type AddInstancePopoverCloseReason =
  | 'outside-pointer'
  | 'escape'
  | 'selection';

export interface AddInstancePopoverProps {
  parentId: string | null;
  position: { x: number; y: number };
  restoreFocus?: HTMLElement | null;
  translate: Translate;
  onClose: (reason: AddInstancePopoverCloseReason) => void;
  onSelect: (choice: AddInstanceChoice) => void;
}

interface InstanceOption extends AddInstanceChoice {
  id: string;
  label: string;
  description: string;
  disabled: boolean;
  icon: string;
}

const PAGE_TYPE_ORDER = ['markdown', 'checklist', 'kanban', 'gallery'];

function positionStyle(position: { x: number; y: number }): CSSProperties {
  const width = 352;
  const height = 408;
  const gap = 8;
  return {
    left: Math.max(gap, Math.min(position.x, window.innerWidth - width - gap)),
    top: Math.max(gap, Math.min(position.y, window.innerHeight - height - gap)),
  };
}

export function AddInstancePopover({
  onClose,
  onSelect,
  parentId,
  position,
  restoreFocus,
  translate,
}: AddInstancePopoverProps) {
  const titleId = `add-instance-title-${useId()}`;
  const optionsId = `add-instance-options-${useId()}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState('markdown');
  const options = useMemo<readonly InstanceOption[]>(() => {
    const pages = [...listProjectPageTypeDefinitions()]
      .sort(
        (left, right) => {
          const leftIndex = PAGE_TYPE_ORDER.indexOf(left.pageType);
          const rightIndex = PAGE_TYPE_ORDER.indexOf(right.pageType);
          return (
            (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) -
              (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex) ||
            left.pageType.localeCompare(right.pageType)
          );
        },
      )
      .map((definition) => ({
        id: definition.pageType,
        kind: 'page' as const,
        pageType: definition.pageType,
        label:
          definition.title ??
          (definition.titleKey ? translate(definition.titleKey) : definition.pageType),
        description:
          definition.description ??
          (definition.descriptionKey
            ? translate(definition.descriptionKey)
            : definition.pageType),
        disabled: definition.availability !== 'available',
        icon: definition.icon,
      }));
    return [
      ...pages,
      {
        id: 'folder',
        kind: 'folder' as const,
        label: translate('projects.instanceFolder'),
        description: translate('projects.instanceFolderDescription'),
        disabled: false,
        icon: folderIcon,
      },
    ];
  }, [translate]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = normalizedQuery
    ? options.filter(({ description, label }) =>
        `${label} ${description}`.toLocaleLowerCase().includes(normalizedQuery),
      )
    : options;
  const effectiveActiveId = filtered.some(({ id }) => id === activeId)
    ? activeId
    : filtered.find(({ disabled }) => !disabled)?.id ?? '';

  const close = useCallback(
    (reason: AddInstancePopoverCloseReason): void => {
      if (
        reason !== 'escape' &&
        document.activeElement instanceof HTMLElement &&
        document.activeElement
          .closest('.add-instance-popover')
          ?.getAttribute('aria-labelledby') === titleId
      ) {
        document.activeElement.blur();
      }

      onClose(reason);
      if (reason !== 'escape') {
        return;
      }

      requestAnimationFrame(() => {
        if (restoreFocus?.isConnected) {
          restoreFocus.focus({ preventScroll: true });
        }
      });
    },
    [onClose, restoreFocus, titleId],
  );

  const select = useCallback((choice: AddInstanceChoice): void => {
    close('selection');
    onSelect(choice);
  }, [close, onSelect]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        close('outside-pointer');
      }
    };
    const handleEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      close('escape');
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [close]);

  function moveActive(offset: number): void {
    const enabled = filtered.filter(({ disabled }) => !disabled);
    if (enabled.length === 0) {
      return;
    }
    const current = enabled.findIndex(({ id }) => id === effectiveActiveId);
    const index = (Math.max(0, current) + offset + enabled.length) % enabled.length;
    const next = enabled[index];
    if (next) {
      setActiveId(next.id);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter') {
      const option = filtered.find(
        ({ disabled, id }) => !disabled && id === effectiveActiveId,
      );
      if (option) {
        event.preventDefault();
        select({ kind: option.kind, pageType: option.pageType });
      }
    }
  }

  return createPortal(
    <div
      aria-labelledby={titleId}
      className="add-instance-popover"
      data-parent-id={parentId ?? 'root'}
      onKeyDown={handleKeyDown}
      ref={rootRef}
      role="dialog"
      style={positionStyle(position)}
    >
      <div className="add-instance-popover__header">
        <strong id={titleId}>{translate('projects.addInstance')}</strong>
        <input
          aria-activedescendant={
            effectiveActiveId
              ? `${optionsId}-${effectiveActiveId}`
              : undefined
          }
          aria-controls={optionsId}
          aria-label={translate('projects.searchInstances')}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          placeholder={translate('projects.searchInstances')}
          type="search"
          value={query}
        />
      </div>
      <div
        className="add-instance-popover__options"
        id={optionsId}
        role="listbox"
      >
        {filtered.length === 0 ? (
          <p className="add-instance-popover__empty" role="status">
            {translate('projects.noInstances')}
          </p>
        ) : (
          filtered.map((option) => (
            <button
              aria-disabled={option.disabled}
              aria-selected={option.id === effectiveActiveId}
              className="add-instance-popover__option"
              data-instance-type={option.id}
              disabled={option.disabled}
              key={option.id}
              id={`${optionsId}-${option.id}`}
              onClick={() =>
                select({ kind: option.kind, pageType: option.pageType })
              }
              onMouseEnter={() => {
                if (!option.disabled) {
                  setActiveId(option.id);
                }
              }}
              role="option"
              tabIndex={-1}
              type="button"
            >
              <MaskedIcon
                className="add-instance-popover__icon"
                icon={option.icon}
              />
              <span className="add-instance-popover__copy">
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </button>
          ))
        )}
      </div>
    </div>,
    document.body,
  );
}
