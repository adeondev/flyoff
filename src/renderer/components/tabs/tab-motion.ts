const TAB_EXIT_DURATION_MS = 120;

const pendingTabExits = new WeakMap<HTMLElement, Promise<void>>();

function reducedMotion(): boolean {
  const preference = document.documentElement.dataset.motion;
  if (preference === 'reduced') {
    return true;
  }
  if (preference === 'full') {
    return false;
  }
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function animateTabExit(element: HTMLElement | null): Promise<void> {
  if (!element || reducedMotion()) {
    return Promise.resolve();
  }
  if (typeof element.animate !== 'function') {
    return Promise.resolve();
  }

  const existing = pendingTabExits.get(element);
  if (existing) {
    return existing;
  }

  const bounds = element.getBoundingClientRect();
  const width = bounds.width || element.offsetWidth;
  const styles = getComputedStyle(element);
  element.classList.add('page-tab--closing');
  element.setAttribute('aria-busy', 'true');
  element.setAttribute('inert', '');

  const animation = element.animate(
    [
      {
        '--page-tab-reveal': '1',
        flexBasis: `${width}px`,
        marginLeft: styles.marginLeft,
        maxWidth: `${width}px`,
        minWidth: `${width}px`,
        transform: 'translateX(0)',
        width: `${width}px`,
      },
      {
        '--page-tab-reveal': '0',
        flexBasis: '0px',
        marginLeft: '0px',
        maxWidth: '0px',
        minWidth: '0px',
        transform: 'translateX(-18px)',
        width: '0px',
      },
    ],
    {
      duration: TAB_EXIT_DURATION_MS,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'forwards',
    },
  );

  const pending = new Promise<void>((resolve) => {
    let settled = false;
    const timeout = window.setTimeout(
      () => finish(),
      TAB_EXIT_DURATION_MS + 80,
    );
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeout);
      pendingTabExits.delete(element);
      resolve();
    };

    animation.addEventListener('finish', finish, { once: true });
    animation.addEventListener('cancel', finish, { once: true });
  });

  pendingTabExits.set(element, pending);
  return pending;
}
