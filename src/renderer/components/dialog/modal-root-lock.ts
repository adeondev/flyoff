interface RootLockState {
  count: number;
  root?: HTMLElement;
  previousAriaHidden: string | null;
  previousInert: boolean;
}

const state: RootLockState = {
  count: 0,
  previousAriaHidden: null,
  previousInert: false,
};

export function acquireModalRootLock(): () => boolean {
  const root = document.getElementById('root');

  if (state.count === 0) {
    state.root = root ?? undefined;
    state.previousAriaHidden = root?.getAttribute('aria-hidden') ?? null;
    state.previousInert = root?.inert ?? false;
  }

  state.count += 1;
  if (root) {
    root.inert = true;
    root.setAttribute('aria-hidden', 'true');
  }

  let released = false;
  return () => {
    if (released) {
      return state.count === 0;
    }
    released = true;
    state.count = Math.max(0, state.count - 1);

    if (state.count > 0) {
      return false;
    }

    const lockedRoot = state.root;
    if (lockedRoot) {
      lockedRoot.inert = state.previousInert;
      if (state.previousAriaHidden === null) {
        lockedRoot.removeAttribute('aria-hidden');
      } else {
        lockedRoot.setAttribute('aria-hidden', state.previousAriaHidden);
      }
    }
    state.root = undefined;
    return true;
  };
}

function canRestoreFocus(element: HTMLElement): boolean {
  return (
    element.isConnected &&
    !element.closest('[inert]') &&
    !element.matches(':disabled')
  );
}

export function restoreModalFocus(
  previousFocus: Element | null,
  closingDialog?: HTMLElement | null,
): void {
  if (previousFocus instanceof HTMLElement && canRestoreFocus(previousFocus)) {
    previousFocus.focus();
    return;
  }

  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="dialog"] [data-dialog-initial-focus], [role="dialog"] button:not([disabled]), [role="dialog"] input:not([disabled])',
    ),
  ).reverse();
  candidates.find(
    (candidate) =>
      !closingDialog?.contains(candidate) && canRestoreFocus(candidate),
  )?.focus();
}
