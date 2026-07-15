import {
  parseMarkdown,
  type BlockNode,
  type InlineNode,
} from '../../shared/markdown';

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const ALLOWED_SCHEMES = /^(https?|mailto|flyoff)$/i;

function safeUrl(url: string): string | null {
  const trimmed = url.trim();
  const scheme = SCHEME.exec(trimmed);

  if (!scheme) {
    return trimmed;
  }

  return ALLOWED_SCHEMES.test(scheme[1]!) ? trimmed : null;
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
        const url = safeUrl(node.url);
        if (url) {
          element.href = url;
          element.target = '_blank';
          element.rel = 'noopener noreferrer';
        }
        if (node.title) {
          element.title = node.title;
        }
        renderInline(node.children, element);
        parent.appendChild(element);
        break;
      }
      case 'image': {
        const element = document.createElement('img');
        const url = safeUrl(node.url);
        if (url) {
          element.src = url;
        }
        element.alt = node.alt;
        if (node.title) {
          element.title = node.title;
        }
        parent.appendChild(element);
        break;
      }
    }
  }
}

function renderBlocks(nodes: readonly BlockNode[], parent: Node): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'heading': {
        const element = document.createElement(`h${node.depth}`);
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
        renderBlocks(node.children, element);
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
            renderBlocks(item.children, listItem);
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
  renderBlocks(parseMarkdown(source).children, container);
}
