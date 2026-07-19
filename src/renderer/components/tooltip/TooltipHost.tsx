import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import {
  calculateTooltipPosition,
  type TooltipPlacement,
} from './tooltip-position';

const HOVER_DELAY_MS = 800;
const POINTER_TRANSFER_DELAY_MS = 120;
const DEFAULT_PLACEMENT: TooltipPlacement = 'top';
const TARGET_SELECTOR = '[data-flyoff-tooltip]';
const SUPPRESS_EVENT = 'flyoff-tooltip-suppress';

export interface TooltipTargetProps {
  'data-flyoff-tooltip'?: string;
  'data-flyoff-tooltip-placement'?: TooltipPlacement;
}

interface VisibleTooltip {
  anchor: HTMLElement;
  content: string;
  placement: TooltipPlacement;
}

interface TooltipDescription {
  anchor: HTMLElement;
}

interface SuppressedTooltip {
  target: HTMLElement;
  untilInactive: boolean;
}

function parsePlacement(value: string | undefined): TooltipPlacement {
  return value === 'bottom' || value === 'left' || value === 'right'
    ? value
    : DEFAULT_PLACEMENT;
}

function tooltipTarget(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element
    ? target.closest<HTMLElement>(TARGET_SELECTOR)
    : null;
}

function containsTarget(
  container: HTMLElement,
  target: EventTarget | null,
): boolean {
  return target instanceof Node && container.contains(target);
}

export function getTooltipTargetProps(
  content: string | undefined,
  placement: TooltipPlacement = DEFAULT_PLACEMENT,
): TooltipTargetProps {
  if (!content) {
    return {};
  }

  return {
    'data-flyoff-tooltip': content,
    'data-flyoff-tooltip-placement': placement,
  };
}

export function suppressFlyoffTooltip(target: HTMLElement): void {
  document.dispatchEvent(
    new CustomEvent<HTMLElement>(SUPPRESS_EVENT, { detail: target }),
  );
}

export function TooltipHost() {
  const tooltipId = `flyoff-tooltip-${useId()}`;
  const tooltipRef = useRef<HTMLDivElement>(null);
  const openTimerRef = useRef<number | undefined>(undefined);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const pointerTargetRef = useRef<HTMLElement | null>(null);
  const focusTargetRef = useRef<HTMLElement | null>(null);
  const visibleTargetRef = useRef<HTMLElement | null>(null);
  const suppressedTargetRef = useRef<SuppressedTooltip | null>(null);
  const tooltipHoveredRef = useRef(false);
  const descriptionRef = useRef<TooltipDescription | null>(null);
  const [tooltip, setTooltip] = useState<VisibleTooltip>();

  const clearOpenTimer = useCallback((): void => {
    window.clearTimeout(openTimerRef.current);
    openTimerRef.current = undefined;
  }, []);

  const clearCloseTimer = useCallback((): void => {
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = undefined;
  }, []);

  const restoreDescription = useCallback((): void => {
    const description = descriptionRef.current;
    if (!description) {
      return;
    }

    const remainingIds =
      description.anchor
        .getAttribute('aria-describedby')
        ?.split(/\s+/)
        .filter((id) => id && id !== tooltipId) ?? [];
    if (remainingIds.length === 0) {
      description.anchor.removeAttribute('aria-describedby');
    } else {
      description.anchor.setAttribute('aria-describedby', remainingIds.join(' '));
    }
    descriptionRef.current = null;
  }, [tooltipId]);

  const describe = useCallback(
    (anchor: HTMLElement): void => {
      if (descriptionRef.current?.anchor === anchor) {
        return;
      }

      restoreDescription();
      const ids = anchor.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean) ?? [];
      if (!ids.includes(tooltipId)) {
        anchor.setAttribute(
          'aria-describedby',
          [...ids, tooltipId].join(' '),
        );
      }
      descriptionRef.current = { anchor };
    },
    [restoreDescription, tooltipId],
  );

  const hide = useCallback((
    suppress?: HTMLElement | null,
    untilInactive = true,
  ): void => {
    clearOpenTimer();
    clearCloseTimer();
    if (suppress) {
      suppressedTargetRef.current = { target: suppress, untilInactive };
    }
    visibleTargetRef.current = null;
    tooltipHoveredRef.current = false;
    restoreDescription();
    setTooltip(undefined);
  }, [clearCloseTimer, clearOpenTimer, restoreDescription]);

  const targetIsActive = useCallback((anchor: HTMLElement): boolean => (
    pointerTargetRef.current === anchor || focusTargetRef.current === anchor
  ), []);

  const show = useCallback(
    (anchor: HTMLElement, delay: number): void => {
      const content = anchor.dataset.flyoffTooltip?.trim();
      const suppression = suppressedTargetRef.current;
      if (!content || (suppression?.target === anchor && suppression.untilInactive)) {
        return;
      }
      if (suppression?.target === anchor) {
        suppressedTargetRef.current = null;
      }

      clearOpenTimer();
      clearCloseTimer();

      if (visibleTargetRef.current === anchor) {
        return;
      }

      const reveal = (): void => {
        openTimerRef.current = undefined;
        if (!targetIsActive(anchor) || !anchor.isConnected) {
          return;
        }
        describe(anchor);
        visibleTargetRef.current = anchor;
        setTooltip({
          anchor,
          content,
          placement: parsePlacement(anchor.dataset.flyoffTooltipPlacement),
        });
      };

      if (
        delay === 0 ||
        (visibleTargetRef.current && visibleTargetRef.current !== anchor)
      ) {
        reveal();
      } else {
        openTimerRef.current = window.setTimeout(reveal, delay);
      }
    },
    [clearCloseTimer, clearOpenTimer, describe, targetIsActive],
  );

  const scheduleHide = useCallback((): void => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = undefined;
      const anchor = visibleTargetRef.current;
      if (
        tooltipHoveredRef.current ||
        (anchor && targetIsActive(anchor))
      ) {
        return;
      }
      hide();
    }, POINTER_TRANSFER_DELAY_MS);
  }, [clearCloseTimer, hide, targetIsActive]);

  const releaseSuppression = useCallback((): void => {
    const suppressed = suppressedTargetRef.current;
    if (
      suppressed &&
      pointerTargetRef.current !== suppressed.target &&
      focusTargetRef.current !== suppressed.target
    ) {
      suppressedTargetRef.current = null;
    }
  }, []);

  const updatePosition = useCallback((): void => {
    const element = tooltipRef.current;
    if (!element || !tooltip?.anchor.isConnected) {
      return;
    }

    const position = calculateTooltipPosition(
      tooltip.anchor.getBoundingClientRect(),
      element.getBoundingClientRect(),
      { height: window.innerHeight, width: window.innerWidth },
      tooltip.placement,
    );
    element.style.left = `${position.left}px`;
    element.style.top = `${position.top}px`;
    element.style.visibility = 'visible';
    element.dataset.placement = position.placement;
  }, [tooltip]);

  useLayoutEffect(updatePosition, [updatePosition]);

  useEffect(() => {
    if (!tooltip) {
      return;
    }

    const observeAnchor = (): void => {
      if (!tooltip.anchor.isConnected) {
        hide();
        return;
      }

      const content = tooltip.anchor.dataset.flyoffTooltip?.trim();
      if (!content) {
        hide();
        return;
      }

      setTooltip((current) =>
        current?.anchor === tooltip.anchor
          ? current.content === content &&
            current.placement ===
              parsePlacement(tooltip.anchor.dataset.flyoffTooltipPlacement)
            ? current
            : {
                anchor: tooltip.anchor,
                content,
                placement: parsePlacement(
                  tooltip.anchor.dataset.flyoffTooltipPlacement,
                ),
              }
          : current,
      );
    };
    const resizeObserver =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(updatePosition)
        : undefined;
    resizeObserver?.observe(tooltip.anchor);
    if (tooltipRef.current && resizeObserver) {
      resizeObserver.observe(tooltipRef.current);
    }
    const anchorObserver =
      typeof MutationObserver === 'function'
        ? new MutationObserver(observeAnchor)
        : undefined;
    anchorObserver?.observe(tooltip.anchor, {
      attributeFilter: [
        'data-flyoff-tooltip',
        'data-flyoff-tooltip-placement',
      ],
      attributes: true,
    });
    const connectionObserver =
      typeof MutationObserver === 'function'
        ? new MutationObserver(observeAnchor)
        : undefined;
    connectionObserver?.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    return () => {
      resizeObserver?.disconnect();
      anchorObserver?.disconnect();
      connectionObserver?.disconnect();
    };
  }, [hide, tooltip, updatePosition]);

  useEffect(() => {
    const handlePointerOver = (event: PointerEvent): void => {
      const anchor = tooltipTarget(event.target);
      if (anchor && !containsTarget(anchor, event.relatedTarget)) {
        pointerTargetRef.current = anchor;
        if (suppressedTargetRef.current?.target !== anchor) {
          suppressedTargetRef.current = null;
        }
        show(anchor, HOVER_DELAY_MS);
      }
    };
    const handlePointerOut = (event: PointerEvent): void => {
      const anchor = tooltipTarget(event.target);
      if (anchor && !containsTarget(anchor, event.relatedTarget)) {
        if (pointerTargetRef.current === anchor) {
          pointerTargetRef.current = null;
        }
        clearOpenTimer();
        releaseSuppression();
        scheduleHide();
      }
    };
    const handleFocusIn = (event: FocusEvent): void => {
      const anchor = tooltipTarget(event.target);
      if (anchor) {
        focusTargetRef.current = anchor;
        if (suppressedTargetRef.current?.target !== anchor) {
          suppressedTargetRef.current = null;
        }
        show(anchor, 0);
      }
    };
    const handleFocusOut = (event: FocusEvent): void => {
      const anchor = tooltipTarget(event.target);
      if (anchor && !containsTarget(anchor, event.relatedTarget)) {
        if (focusTargetRef.current === anchor) {
          focusTargetRef.current = null;
        }
        releaseSuppression();
        scheduleHide();
      }
    };
    const handlePointerDown = (event: PointerEvent): void => {
      const anchor = tooltipTarget(event.target);
      const suppress = anchor ?? visibleTargetRef.current;
      hide(suppress);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        event.key === 'Escape' &&
        (visibleTargetRef.current || openTimerRef.current !== undefined)
      ) {
        event.preventDefault();
        hide(
          visibleTargetRef.current ??
            focusTargetRef.current ??
            pointerTargetRef.current,
          false,
        );
      }
    };
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        hide();
      }
    };
    const handleSuppress = (event: Event): void => {
      const target = (event as CustomEvent<HTMLElement>).detail;
      hide(target);
    };
    const closeTooltip = (): void => hide();

    document.addEventListener('pointerover', handlePointerOver);
    document.addEventListener('pointerout', handlePointerOut);
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('dragstart', closeTooltip, true);
    document.addEventListener('scroll', closeTooltip, true);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener(SUPPRESS_EVENT, handleSuppress);
    window.addEventListener('blur', closeTooltip);
    window.addEventListener('resize', closeTooltip);
    return () => {
      clearOpenTimer();
      clearCloseTimer();
      restoreDescription();
      document.removeEventListener('pointerover', handlePointerOver);
      document.removeEventListener('pointerout', handlePointerOut);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('dragstart', closeTooltip, true);
      document.removeEventListener('scroll', closeTooltip, true);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener(SUPPRESS_EVENT, handleSuppress);
      window.removeEventListener('blur', closeTooltip);
      window.removeEventListener('resize', closeTooltip);
    };
  }, [
    clearCloseTimer,
    clearOpenTimer,
    hide,
    releaseSuppression,
    restoreDescription,
    scheduleHide,
    show,
  ]);

  return tooltip
    ? createPortal(
        <div
          className="flyoff-tooltip"
          data-placement={tooltip.placement}
          id={tooltipId}
          onPointerEnter={() => {
            tooltipHoveredRef.current = true;
            clearCloseTimer();
          }}
          onPointerLeave={() => {
            tooltipHoveredRef.current = false;
            scheduleHide();
          }}
          ref={tooltipRef}
          role="tooltip"
          style={{ visibility: 'hidden' }}
        >
          {tooltip.content}
        </div>,
        document.body,
      )
    : null;
}
