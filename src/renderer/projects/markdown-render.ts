import {
  markdownHeadingSlug,
  parseMarkdown,
  parseInternalLinkDestination,
  type BlockNode,
  type InlineNode,
} from '../../shared/markdown';

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const ALLOWED_ASSET_SCHEMES = /^(https?|flyoff)$/i;
const ALLOWED_EXTERNAL_SCHEMES = /^(https?|mailto)$/i;

function safeAssetUrl(url: string): string | null {
  const trimmed = url.trim();
  const scheme = SCHEME.exec(trimmed);

  if (!scheme) {
    return trimmed;
  }

  return ALLOWED_ASSET_SCHEMES.test(scheme[1]!) ? trimmed : null;
}

export function safeExternalUrl(url: string): string | null {
  const trimmed = url.trim();
  const scheme = SCHEME.exec(trimmed);

  if (!scheme || !ALLOWED_EXTERNAL_SCHEMES.test(scheme[1]!)) {
    return null;
  }

  try {
    new URL(trimmed);
    return trimmed;
  } catch {
    return null;
  }
}

function renderInline(nodes: readonly InlineNode[], parent: Node): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        parent.appendChild(document.createTextNode(node.value));
        break;
      case 'break':
        parent.appendChild(document.createElement('br'));
        break;
      case 'inlineCode': {
        const element = document.createElement('code');
        element.textContent = node.value;
        parent.appendChild(element);
        break;
      }
      case 'strong':
      case 'emphasis':
      case 'delete':
      case 'highlight': {
        const tag =
          node.type === 'strong'
            ? 'strong'
            : node.type === 'emphasis'
              ? 'em'
              : node.type === 'delete'
                ? 'del'
                : 'mark';
        const element = document.createElement(tag);
        renderInline(node.children, element);
        parent.appendChild(element);
        break;
      }
      case 'color': {
        const element = document.createElement('span');
        element.style.color = node.color;
        renderInline(node.children, element);
        parent.appendChild(element);
        break;
      }
      case 'link': {
        const element = document.createElement('a');
        const url = safeExternalUrl(node.url);
        if (url) {
          element.dataset.markdownExternalUrl = url;
          element.setAttribute('role', 'link');
          element.tabIndex = 0;
        } else {
          const syntax = node.syntax ?? 'markdown';
          const internal = parseInternalLinkDestination(node.url, syntax);
          if (internal) {
            element.dataset.markdownInternalPath = internal.path;
            element.dataset.markdownInternalHeadings = JSON.stringify(
              internal.headingPath,
            );
            element.dataset.markdownInternalSyntax = syntax;
            element.setAttribute('role', 'link');
            element.tabIndex = 0;
          } else {
            element.setAttribute('aria-disabled', 'true');
          }
        }
        if (node.title) {
          element.dataset.flyoffTooltip = node.title;
        }
        renderInline(node.children, element);
        parent.appendChild(element);
        break;
      }
      case 'image': {
        const element = document.createElement('img');
        const url = safeAssetUrl(node.url);
        if (url) {
          element.src = url;
        }
        element.alt = node.alt;
        if (node.title) {
          element.dataset.flyoffTooltip = node.title;
        }
        parent.appendChild(element);
        break;
      }
    }
  }
}

function inlineText(nodes: readonly InlineNode[]): string {
  let value = '';
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'inlineCode') {
      value += node.value;
    } else if (node.type === 'break') {
      value += ' ';
    } else if (node.type === 'image') {
      value += node.alt;
    } else if ('children' in node) {
      value += inlineText(node.children);
    }
  }
  return value;
}

interface RenderContext {
  headingIds: Map<string, number>;
  headingPath: string[];
}

function renderBlocks(
  nodes: readonly BlockNode[],
  parent: Node,
  context: RenderContext,
): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'heading': {
        const element = document.createElement(`h${node.depth}`);
        const text = inlineText(node.children).trim();
        context.headingPath.length = node.depth;
        context.headingPath[node.depth - 1] = text;
        const headingPath = context.headingPath.filter(Boolean);
        const slug = markdownHeadingSlug(text) || 'heading';
        const count = context.headingIds.get(slug) ?? 0;
        context.headingIds.set(slug, count + 1);
        element.id = count === 0 ? slug : `${slug}-${count + 1}`;
        element.dataset.markdownHeadingPath = JSON.stringify(headingPath);
        if (node.divided) {
          element.classList.add('markdown-view__heading--divided');
        }
        renderInline(node.children, element);
        parent.appendChild(element);
        break;
      }
      case 'paragraph': {
        const element = document.createElement('p');
        renderInline(node.children, element);
        parent.appendChild(element);
        break;
      }
      case 'blockquote': {
        const element = document.createElement('blockquote');
        renderBlocks(node.children, element, context);
        parent.appendChild(element);
        break;
      }
      case 'thematicBreak':
        parent.appendChild(document.createElement('hr'));
        break;
      case 'code': {
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        if (node.lang) {
          code.dataset.lang = node.lang;
        }
        code.textContent = node.value;
        pre.appendChild(code);
        parent.appendChild(pre);
        break;
      }
      case 'list': {
        const element = document.createElement(node.ordered ? 'ol' : 'ul');
        if (node.ordered && node.start !== null && node.start !== 1) {
          element.setAttribute('start', String(node.start));
        }

        for (const item of node.children) {
          const listItem = document.createElement('li');

          if (item.checked !== null) {
            listItem.classList.add('markdown-view__task');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'flyoff-checkbox';
            checkbox.checked = item.checked;
            checkbox.disabled = true;
            listItem.appendChild(checkbox);
          }

          const [firstChild] = item.children;
          if (
            item.children.length === 1 &&
            firstChild &&
            firstChild.type === 'paragraph'
          ) {
            renderInline(firstChild.children, listItem);
          } else {
            renderBlocks(item.children, listItem, context);
          }

          element.appendChild(listItem);
        }

        parent.appendChild(element);
        break;
      }
    }
  }
}

export function renderMarkdownInto(
  container: HTMLElement,
  source: string,
): void {
  container.replaceChildren();
  renderBlocks(parseMarkdown(source).children, container, {
    headingIds: new Map(),
    headingPath: [],
  });
}
