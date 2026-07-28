import {
  markdownHeadingSlug,
  mediaAssetUrl,
  parseMarkdown,
  parseInternalLinkDestination,
  splitMarkdownBlocks,
  type BlockNode,
  type Heading,
  type InlineNode,
  type MarkdownBlockSource,
} from '../../shared/markdown';
import { twemojiAssetUrl, twemojiSegments } from '../components/twemoji';
import { colorContrastInk } from '../components/color';
import { markFloatContexts } from './floating-media';

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const ALLOWED_ASSET_SCHEMES = /^(https?|flyoff|flyoff-media)$/i;
const ALLOWED_EXTERNAL_SCHEMES = /^(https?|mailto)$/i;
function appendTwemojiText(parent: Node, value: string): void {
  for (const segment of twemojiSegments(value)) {
    if (!segment.codepoint || !segment.emoji) {
      parent.appendChild(document.createTextNode(segment.text));
      continue;
    }
    const wrapper = document.createElement('span');
    const unicode = document.createElement('span');
    const assetUrl = twemojiAssetUrl(segment.codepoint);
    wrapper.className = 'twemoji';
    wrapper.dataset.twemoji = segment.codepoint;
    wrapper.setAttribute('aria-label', segment.emoji);
    wrapper.setAttribute('role', 'img');
    unicode.className = 'twemoji__unicode';
    unicode.setAttribute('aria-hidden', 'true');
    unicode.textContent = segment.emoji;
    wrapper.appendChild(unicode);
    if (assetUrl) {
      const image = document.createElement('img');
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      image.className = 'twemoji__glyph';
      image.decoding = 'async';
      image.draggable = false;
      image.loading = 'lazy';
      image.src = assetUrl;
      image.addEventListener(
        'error',
        () => {
          wrapper.classList.add('twemoji--fallback');
          image.remove();
        },
        { once: true },
      );
      wrapper.appendChild(image);
    } else {
      wrapper.classList.add('twemoji--fallback');
    }
    parent.appendChild(wrapper);
  }
}

function makeCaptionExpandable(caption: HTMLElement): void {
  caption.classList.add('markdown-caption');
  caption.tabIndex = 0;
  caption.setAttribute('role', 'button');
  caption.setAttribute('aria-expanded', 'false');
  const toggle = (): void => {
    const expanded = caption.dataset.expanded === 'true';
    if (expanded) {
      delete caption.dataset.expanded;
    } else {
      caption.dataset.expanded = 'true';
    }
    caption.setAttribute('aria-expanded', String(!expanded));
  };
  caption.addEventListener('click', toggle);
  caption.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    toggle();
  });
}

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

function appendDirectiveImage(
  directive: Extract<InlineNode, { type: 'inline-image' }>['directive'],
  parent: Node,
  projectId?: string,
): void {
  const wrapper = document.createElement('span');
  wrapper.className = 'markdown-image markdown-image--inline';
  wrapper.dataset.imageAssetId = directive.assetId;
  wrapper.dataset.imageInstanceId = directive.instanceId;
  wrapper.style.setProperty('--image-width', `${directive.width}px`);
  wrapper.style.setProperty('--image-height', `${directive.height}px`);
  wrapper.style.setProperty('--image-margin', `${directive.margin}px`);
  wrapper.style.setProperty(
    '--image-ratio',
    String(directive.width / directive.height),
  );
  wrapper.style.width = `min(${directive.width}px, 100%)`;

  const image = document.createElement('img');
  image.alt = directive.alt;
  image.className = 'markdown-image__content';
  image.decoding = 'async';
  image.draggable = false;
  image.loading = 'lazy';
  image.src = mediaAssetUrl(directive.assetId, projectId);
  image.addEventListener(
    'error',
    () => wrapper.classList.add('markdown-image--missing'),
    { once: true },
  );
  wrapper.appendChild(image);

  if (directive.caption) {
    const caption = document.createElement('span');
    appendTwemojiText(caption, directive.caption);
    makeCaptionExpandable(caption);
    wrapper.appendChild(caption);
  }
  parent.appendChild(wrapper);
}

function renderInline(
  nodes: readonly InlineNode[],
  parent: Node,
  projectId?: string,
): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        appendTwemojiText(parent, node.value);
        break;
      case 'break':
        parent.appendChild(document.createElement('br'));
        break;
      case 'inlineCode': {
        const element = document.createElement('code');
        appendTwemojiText(element, node.value);
        parent.appendChild(element);
        break;
      }
      case 'strong':
      case 'emphasis':
      case 'delete': {
        const tag =
          node.type === 'strong'
            ? 'strong'
            : node.type === 'emphasis'
              ? 'em'
              : node.type === 'delete'
                ? 'del'
                : 'mark';
        const element = document.createElement(tag);
        renderInline(node.children, element, projectId);
        parent.appendChild(element);
        break;
      }
      case 'highlight': {
        const element = document.createElement('mark');
        if (node.color) {
          element.style.backgroundColor = node.color;
          element.style.color = colorContrastInk(node.color);
          element.dataset.customColor = '';
        }
        renderInline(node.children, element, projectId);
        parent.appendChild(element);
        break;
      }
      case 'color': {
        const element = document.createElement('span');
        element.style.color = node.color;
        renderInline(node.children, element, projectId);
        parent.appendChild(element);
        break;
      }
      case 'link': {
        const element = document.createElement('a');
        if (node.color) {
          element.style.color = node.color;
          element.dataset.customColor = '';
        }
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
        renderInline(node.children, element, projectId);
        parent.appendChild(element);
        break;
      }
      case 'inline-image':
        appendDirectiveImage(node.directive, parent, projectId);
        break;
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
    } else if (node.type === 'inline-image') {
      value += node.directive.alt;
    } else if ('children' in node) {
      value += inlineText(node.children);
    }
  }
  return value;
}

interface RenderContext {
  headingIds: Map<string, number>;
  headingPath: string[];
  projectId?: string;
}

function applyHeadingMetadata(
  node: Heading,
  element: HTMLElement,
  context: RenderContext,
): void {
  const text = inlineText(node.children).trim();
  context.headingPath.length = node.depth;
  context.headingPath[node.depth - 1] = text;
  const headingPath = context.headingPath.filter(Boolean);
  const slug = markdownHeadingSlug(text) || 'heading';
  const count = context.headingIds.get(slug) ?? 0;
  context.headingIds.set(slug, count + 1);
  element.id = count === 0 ? slug : `${slug}-${count + 1}`;
  element.dataset.markdownHeadingPath = JSON.stringify(headingPath);
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
        applyHeadingMetadata(node, element, context);
        if (node.divided) {
          element.classList.add('markdown-view__heading--divided');
        }
        renderInline(node.children, element, context.projectId);
        parent.appendChild(element);
        break;
      }
      case 'paragraph': {
        const element = document.createElement('p');
        renderInline(node.children, element, context.projectId);
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
        appendTwemojiText(code, node.value);
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
            renderInline(firstChild.children, listItem, context.projectId);
          } else {
            renderBlocks(item.children, listItem, context);
          }

          element.appendChild(listItem);
        }

        parent.appendChild(element);
        break;
      }
      case 'media': {
        const { directive } = node;
        const figure = document.createElement('figure');
        figure.className = `markdown-media markdown-media--${directive.placement}`;
        figure.style.setProperty('--media-span', String(directive.span));
        figure.style.setProperty('--media-offset', String(directive.offset));
        figure.style.setProperty('--media-ratio', String(directive.ratio));
        figure.dataset.mediaNodeId = directive.id;
        figure.dataset.mediaFit = directive.fit;
        const url = mediaAssetUrl(directive.id, context.projectId);
        const extension = directive.path.split('.').pop()?.toLowerCase() ?? '';
        const element = /^(mp4|m4v|webm|ogv)$/.test(extension)
          ? document.createElement('video')
          : /^(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/.test(extension)
            ? document.createElement('audio')
            : document.createElement('img');
        element.className = 'markdown-media__content';
        if (element instanceof HTMLImageElement) {
          element.alt = directive.description;
          element.decoding = 'async';
          element.loading = 'lazy';
        } else {
          element.controls = true;
          element.preload = 'metadata';
          element.setAttribute('aria-label', directive.description);
        }
        if (url) {
          element.src = url;
        }
        element.addEventListener(
          'error',
          () => figure.classList.add('markdown-media--missing'),
          { once: true },
        );
        figure.appendChild(element);
        if (directive.caption && directive.description) {
          const caption = document.createElement('figcaption');
          appendTwemojiText(caption, directive.description);
          makeCaptionExpandable(caption);
          figure.appendChild(caption);
        }
        parent.appendChild(figure);
        break;
      }
      case 'image-block': {
        const { directive } = node;
        const figure = document.createElement('figure');
        figure.className = `markdown-image markdown-image--${directive.mode} markdown-image--${directive.align}`;
        figure.dataset.imageAssetId = directive.assetId;
        figure.dataset.imageInstanceId = directive.instanceId;
        figure.style.setProperty('--image-width', `${directive.width}px`);
        figure.style.setProperty('--image-height', `${directive.height}px`);
        figure.style.setProperty('--image-margin', `${directive.margin}px`);
        figure.style.setProperty(
          '--image-ratio',
          String(directive.width / directive.height),
        );

        const image = document.createElement('img');
        image.alt = directive.alt;
        image.className = 'markdown-image__content';
        image.decoding = 'async';
        image.draggable = false;
        image.loading = 'lazy';
        image.src = mediaAssetUrl(directive.assetId, context.projectId);
        image.addEventListener(
          'error',
          () => figure.classList.add('markdown-image--missing'),
          { once: true },
        );
        figure.appendChild(image);

        if (directive.caption) {
          const caption = document.createElement('figcaption');
          appendTwemojiText(caption, directive.caption);
          makeCaptionExpandable(caption);
          figure.appendChild(caption);
        }
        parent.appendChild(figure);
        break;
      }
      case 'table': {
        const wrapper = document.createElement('div');
        const table = document.createElement('table');
        const head = document.createElement('thead');
        const headRow = document.createElement('tr');
        wrapper.className = 'markdown-view__table-scroll';
        node.header.forEach((cell, index) => {
          const element = document.createElement('th');
          const alignment = node.alignments[index];
          if (alignment) {
            element.style.textAlign = alignment;
          }
          renderInline(cell, element, context.projectId);
          headRow.appendChild(element);
        });
        head.appendChild(headRow);
        table.appendChild(head);
        if (node.rows.length > 0) {
          const body = document.createElement('tbody');
          for (const row of node.rows) {
            const bodyRow = document.createElement('tr');
            row.forEach((cell, index) => {
              const element = document.createElement('td');
              const alignment = node.alignments[index];
              if (alignment) {
                element.style.textAlign = alignment;
              }
              renderInline(cell, element, context.projectId);
              bodyRow.appendChild(element);
            });
            body.appendChild(bodyRow);
          }
          table.appendChild(body);
        }
        wrapper.appendChild(table);
        parent.appendChild(wrapper);
        break;
      }
    }
  }
}

interface RenderedMarkdownBlock {
  element: ChildNode;
  node: BlockNode;
  source: string;
}

interface MarkdownRenderState {
  blocks: readonly RenderedMarkdownBlock[];
  projectId?: string;
  source: string;
}

const renderStates = new WeakMap<HTMLElement, MarkdownRenderState>();

const FLOATING_MEDIA_SELECTOR =
  '.markdown-image--wrap, .markdown-media--wrap-left, .markdown-media--wrap-right';

function markMediaBlocks(nodes: readonly ChildNode[]): void {
  for (const node of nodes) {
    if (node instanceof Element && node.querySelector('img, video, audio')) {
      node.classList.add('markdown-block--media');
    }
  }
}

function markFloatingMedia(container: HTMLElement): void {
  markFloatContexts(container, {
    clearSelector: ':is(h1, h2, h3, h4, h5, h6)',
    contextClassName: 'markdown-block--float-context',
    floatingSelector: FLOATING_MEDIA_SELECTOR,
    ignoredClearSelector: '.markdown-image--inline',
    previousSiblingIgnoredClearSelector: '.markdown-image--wrap',
  });
}

function collectHeadings(node: BlockNode, headings: Heading[]): void {
  if (node.type === 'heading') {
    headings.push(node);
    return;
  }
  if (node.type === 'blockquote') {
    for (const child of node.children) {
      collectHeadings(child, headings);
    }
    return;
  }
  if (node.type === 'list') {
    for (const item of node.children) {
      for (const child of item.children) {
        collectHeadings(child, headings);
      }
    }
  }
}

function syncHeadingMetadata(
  node: BlockNode,
  element: ChildNode,
  context: RenderContext,
): void {
  if (!(element instanceof Element)) {
    return;
  }
  const headings: Heading[] = [];
  collectHeadings(node, headings);
  if (headings.length === 0) {
    return;
  }
  const elements = [
    ...(element.matches(':is(h1, h2, h3, h4, h5, h6)')
      ? [element as HTMLElement]
      : []),
    ...element.querySelectorAll<HTMLElement>(
      ':is(h1, h2, h3, h4, h5, h6)',
    ),
  ];
  headings.forEach((heading, index) => {
    const headingElement = elements[index];
    if (headingElement) {
      applyHeadingMetadata(heading, headingElement, context);
    }
  });
}

function renderContext(projectId?: string): RenderContext {
  return {
    headingIds: new Map(),
    headingPath: [],
    projectId,
  };
}

function rebuildMarkdown(
  container: HTMLElement,
  source: string,
  projectId?: string,
): void {
  const nodes = parseMarkdown(source).children;
  const fragment = document.createDocumentFragment();
  const context = renderContext(projectId);
  const blocks: RenderedMarkdownBlock[] = [];

  for (const node of nodes) {
    renderBlocks([node], fragment, context);
    const element = fragment.lastChild!;
    blocks.push({
      element,
      node,
      source: source.slice(node.position.start, node.position.end),
    });
  }

  markMediaBlocks([...fragment.childNodes]);
  container.replaceChildren(fragment);
  renderStates.set(container, { blocks, projectId, source });
  markFloatingMedia(container);
}

function hasExpectedChildren(
  container: HTMLElement,
  blocks: readonly RenderedMarkdownBlock[],
): boolean {
  if (container.childNodes.length !== blocks.length) {
    return false;
  }
  return blocks.every(
    ({ element }, index) => container.childNodes[index] === element,
  );
}

function parseChangedBlock(segment: MarkdownBlockSource): BlockNode | null {
  const children = parseMarkdown(segment.source).children;
  if (children.length !== 1) {
    return null;
  }
  const node = children[0]!;
  node.position = { end: segment.end, start: segment.start };
  return node;
}

export function renderMarkdownInto(
  container: HTMLElement,
  source: string,
  options: { projectId?: string } = {},
): void {
  const state = renderStates.get(container);
  if (
    !state ||
    state.projectId !== options.projectId ||
    !hasExpectedChildren(container, state.blocks)
  ) {
    rebuildMarkdown(container, source, options.projectId);
    return;
  }

  if (state.source === source) {
    return;
  }

  const segments = splitMarkdownBlocks(source);
  let prefix = 0;
  while (
    prefix < state.blocks.length &&
    prefix < segments.length &&
    state.blocks[prefix]?.source === segments[prefix]?.source
  ) {
    prefix += 1;
  }

  if (state.blocks.length === segments.length && prefix === segments.length) {
    renderStates.set(container, { ...state, source });
    return;
  }

  let suffix = 0;
  while (
    suffix < state.blocks.length - prefix &&
    suffix < segments.length - prefix &&
    state.blocks[state.blocks.length - suffix - 1]?.source ===
      segments[segments.length - suffix - 1]?.source
  ) {
    suffix += 1;
  }

  const oldEnd = state.blocks.length - suffix;
  const newEnd = segments.length - suffix;
  const next: Array<RenderedMarkdownBlock | undefined> = new Array(
    segments.length,
  );

  for (let index = 0; index < prefix; index += 1) {
    next[index] = state.blocks[index]!;
  }
  for (let index = 0; index < suffix; index += 1) {
    next[segments.length - index - 1] =
      state.blocks[state.blocks.length - index - 1]!;
  }
  for (let index = prefix; index < newEnd; index += 1) {
    const segment = segments[index]!;
    const node = parseChangedBlock(segment);
    if (!node) {
      rebuildMarkdown(container, source, options.projectId);
      return;
    }
    next[index] = {
      element: document.createTextNode(''),
      node,
      source: segment.source,
    };
  }

  const context = renderContext(options.projectId);
  for (let index = 0; index < next.length; index += 1) {
    const block = next[index]!;
    if (index >= prefix && index < newEnd) {
      const fragment = document.createDocumentFragment();
      renderBlocks([block.node], fragment, context);
      block.element = fragment.firstChild!;
      markMediaBlocks([block.element]);
    } else {
      syncHeadingMetadata(block.node, block.element, context);
    }
  }

  const anchor = container.childNodes[oldEnd] ?? null;

  for (let index = oldEnd - 1; index >= prefix; index -= 1) {
    container.childNodes[index]?.remove();
  }

  const fragment = document.createDocumentFragment();
  for (let index = prefix; index < newEnd; index += 1) {
    fragment.appendChild(next[index]!.element);
  }
  container.insertBefore(fragment, anchor);

  renderStates.set(container, {
    blocks: next as RenderedMarkdownBlock[],
    projectId: options.projectId,
    source,
  });
  markFloatingMedia(container);
}
