interface FloatContextOptions {
  clearSelector: string;
  contextClassName: string;
  floatingSelector: string;
  ignoredClearSelector: string;
  previousSiblingIgnoredClearSelector: string;
}

const markedContexts = new WeakMap<HTMLElement, ReadonlySet<Element>>();

function containsOrMatches(element: Element, selector: string): boolean {
  return element.matches(selector) || element.querySelector(selector) !== null;
}

export function markFloatContexts(
  root: HTMLElement,
  options: FloatContextOptions,
): void {
  const next = new Set<Element>();

  for (const floating of root.querySelectorAll(options.floatingSelector)) {
    let start: Element | null = floating;
    while (start?.parentElement !== root) {
      start = start?.parentElement ?? null;
    }
    if (!start) {
      continue;
    }

    let current: Element | null = start;
    while (current) {
      const previousIgnoresClear =
        current.previousElementSibling !== null &&
        containsOrMatches(
          current.previousElementSibling,
          options.previousSiblingIgnoredClearSelector,
        );
      if (
        current !== start &&
        current.matches(options.clearSelector) &&
        !previousIgnoresClear &&
        !containsOrMatches(current, options.ignoredClearSelector)
      ) {
        break;
      }
      next.add(current);
      current = current.nextElementSibling;
    }
  }

  const previous = markedContexts.get(root);
  if (previous) {
    for (const element of previous) {
      if (!next.has(element)) {
        element.classList.remove(options.contextClassName);
      }
    }
  }
  for (const element of next) {
    if (!previous?.has(element)) {
      element.classList.add(options.contextClassName);
    }
  }
  markedContexts.set(root, next);
}
