import {
  markdownHeadingSlug,
  mediaAssetUrl,
  parseMarkdown,
  parseInternalLinkDestination,
  splitMarkdownBlocks,
  splitMarkdownBlocksCooperatively,
  type BlockNode,
  type Heading,
  type InlineNode,
  type MarkdownBlockSource,
} from '../../shared/markdown';
import {
  twemojiAssetUrl,
  twemojiSegments,
  type TwemojiSegment,
} from '../components/twemoji';
import { colorContrastInk } from '../components/color';

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const ALLOWED_ASSET_SCHEMES = /^(https?|flyoff|flyoff-media)$/i;
const ALLOWED_EXTERNAL_SCHEMES = /^(https?|mailto)$/i;
const ASCII_TEXT = /^\p{ASCII}*$/u;
const COOPERATIVE_MARKDOWN_BLOCK_CHARACTERS = 64_000;
function appendTwemojiSegment(
  parent: Node,
  segment: TwemojiSegment,
): void {
  if (!segment.codepoint || !segment.emoji) {
    parent.appendChild(document.createTextNode(segment.text));
    return;
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

function appendTwemojiText(parent: Node, value: string): void {
  if (ASCII_TEXT.test(value)) {
    if (value) {
      parent.appendChild(document.createTextNode(value));
    }
    return;
  }
  for (const segment of twemojiSegments(value)) {
    appendTwemojiSegment(parent, segment);
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

interface RenderedMarkdownHeading {
  element: HTMLElement;
  node: Heading;
}

interface RenderContext {
  capturedHeadings?: RenderedMarkdownHeading[];
  headingIds: Map<string, number>;
  headingPath: string[];
  projectId?: string;
}

interface HeadingMetadata {
  id: string;
  path: string;
}

function nextHeadingMetadata(
  node: Heading,
  context: RenderContext,
): HeadingMetadata {
  const text = inlineText(node.children).trim();
  context.headingPath.length = node.depth;
  context.headingPath[node.depth - 1] = text;
  const headingPath = context.headingPath.filter(Boolean);
  const slug = markdownHeadingSlug(text) || 'heading';
  const count = context.headingIds.get(slug) ?? 0;
  context.headingIds.set(slug, count + 1);
  return {
    id: count === 0 ? slug : `${slug}-${count + 1}`,
    path: JSON.stringify(headingPath),
  };
}

function applyHeadingMetadata(
  node: Heading,
  element: HTMLElement,
  context: RenderContext,
): void {
  const metadata = nextHeadingMetadata(node, context);
  element.id = metadata.id;
  element.dataset.markdownHeadingPath = metadata.path;
  context.capturedHeadings?.push({ element, node });
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
  headings: readonly RenderedMarkdownHeading[];
  node: BlockNode;
  source: string;
}

interface MarkdownRenderState {
  blocks: readonly RenderedMarkdownBlock[];
  projectId?: string;
  source: string;
}

const renderStates = new WeakMap<HTMLElement, MarkdownRenderState>();

function renderContext(projectId?: string): RenderContext {
  return {
    headingIds: new Map(),
    headingPath: [],
    projectId,
  };
}

function renderMarkdownBlock(
  segment: MarkdownBlockSource,
  context: RenderContext,
): RenderedMarkdownBlock | null {
  const node = parseChangedBlock(segment);
  if (!node) {
    return null;
  }
  const fragment = document.createDocumentFragment();
  const headings: RenderedMarkdownHeading[] = [];
  context.capturedHeadings = headings;
  renderBlocks([node], fragment, context);
  delete context.capturedHeadings;
  const element = fragment.firstChild;
  if (!element) {
    return null;
  }
  return { element, headings, node, source: segment.source };
}

function buildMarkdown(
  source: string,
  projectId?: string,
): {
  blocks: readonly RenderedMarkdownBlock[];
  fragment: DocumentFragment;
} {
  const nodes = parseMarkdown(source).children;
  const fragment = document.createDocumentFragment();
  const context = renderContext(projectId);
  const blocks: RenderedMarkdownBlock[] = [];

  for (const node of nodes) {
    const headings: RenderedMarkdownHeading[] = [];
    context.capturedHeadings = headings;
    renderBlocks([node], fragment, context);
    delete context.capturedHeadings;
    const element = fragment.lastChild!;
    blocks.push({
      element,
      headings,
      node,
      source: source.slice(node.position.start, node.position.end),
    });
  }

  return { blocks, fragment };
}

function publishMarkdown(
  container: HTMLElement,
  source: string,
  projectId: string | undefined,
  build: {
    blocks: readonly RenderedMarkdownBlock[];
    fragment: DocumentFragment;
  },
): void {
  container.replaceChildren(build.fragment);
  renderStates.set(container, {
    blocks: build.blocks,
    projectId,
    source,
  });
}

function rebuildMarkdown(
  container: HTMLElement,
  source: string,
  projectId?: string,
): void {
  const build = buildMarkdown(source, projectId);
  publishMarkdown(container, source, projectId, build);
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

interface MarkdownBlockDiff {
  newEnd: number;
  oldEnd: number;
  prefix: number;
  suffix: number;
}

function markdownBlockDiff(
  blocks: readonly RenderedMarkdownBlock[],
  segments: readonly MarkdownBlockSource[],
): MarkdownBlockDiff {
  let prefix = 0;
  while (
    prefix < blocks.length &&
    prefix < segments.length &&
    blocks[prefix]?.source === segments[prefix]?.source
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < blocks.length - prefix &&
    suffix < segments.length - prefix &&
    blocks[blocks.length - suffix - 1]?.source ===
      segments[segments.length - suffix - 1]?.source
  ) {
    suffix += 1;
  }

  return {
    newEnd: segments.length - suffix,
    oldEnd: blocks.length - suffix,
    prefix,
    suffix,
  };
}

function reuseMarkdownBlocks(
  blocks: readonly RenderedMarkdownBlock[],
  segments: readonly MarkdownBlockSource[],
  diff: MarkdownBlockDiff,
): Array<RenderedMarkdownBlock | undefined> {
  const next: Array<RenderedMarkdownBlock | undefined> = new Array(
    segments.length,
  );
  for (let index = 0; index < diff.prefix; index += 1) {
    next[index] = blocks[index]!;
  }
  for (let index = 0; index < diff.suffix; index += 1) {
    next[segments.length - index - 1] =
      blocks[blocks.length - index - 1]!;
  }
  return next;
}

interface HeadingMetadataUpdate extends HeadingMetadata {
  element: HTMLElement;
}

function headingStructureChanged(
  previous: readonly RenderedMarkdownBlock[],
  next: readonly RenderedMarkdownBlock[],
  diff: MarkdownBlockDiff,
): boolean {
  for (let index = diff.prefix; index < diff.oldEnd; index += 1) {
    if (previous[index]!.headings.length > 0) {
      return true;
    }
  }
  for (let index = diff.prefix; index < diff.newEnd; index += 1) {
    if (next[index]!.headings.length > 0) {
      return true;
    }
  }
  return false;
}

function nextHeadingUpdate(
  heading: RenderedMarkdownHeading,
  context: RenderContext,
): HeadingMetadataUpdate | null {
  const metadata = nextHeadingMetadata(heading.node, context);
  return heading.element.id === metadata.id &&
    heading.element.dataset.markdownHeadingPath === metadata.path
    ? null
    : { ...metadata, element: heading.element };
}

function headingMetadataUpdates(
  blocks: readonly RenderedMarkdownBlock[],
): HeadingMetadataUpdate[] {
  const context = renderContext();
  const updates: HeadingMetadataUpdate[] = [];
  for (const block of blocks) {
    for (const heading of block.headings) {
      const update = nextHeadingUpdate(heading, context);
      if (update) {
        updates.push(update);
      }
    }
  }
  return updates;
}

function applyHeadingMetadataUpdates(
  updates: readonly HeadingMetadataUpdate[],
): void {
  for (const { element, id, path } of updates) {
    element.id = id;
    element.dataset.markdownHeadingPath = path;
  }
}

function publishMarkdownChanges(
  container: HTMLElement,
  source: string,
  projectId: string | undefined,
  blocks: readonly RenderedMarkdownBlock[],
  diff: MarkdownBlockDiff,
  headingUpdates: readonly HeadingMetadataUpdate[],
): void {
  const scrollLeft = container.scrollLeft;
  const scrollTop = container.scrollTop;
  const anchor = container.childNodes[diff.oldEnd] ?? null;
  const fragment = document.createDocumentFragment();
  for (let index = diff.prefix; index < diff.newEnd; index += 1) {
    fragment.appendChild(blocks[index]!.element);
  }

  if (diff.prefix === 0 && diff.suffix === 0) {
    container.replaceChildren(fragment);
  } else {
    for (let index = diff.oldEnd - 1; index >= diff.prefix; index -= 1) {
      container.childNodes[index]?.remove();
    }
    container.insertBefore(fragment, anchor);
  }
  applyHeadingMetadataUpdates(headingUpdates);
  renderStates.set(container, { blocks, projectId, source });
  container.scrollLeft = scrollLeft;
  container.scrollTop = scrollTop;
}

function rendererYield(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

interface CooperativeRenderState {
  cancelled?: () => boolean;
  sliceMs: number;
  sliceStartedAt: number;
}

function cooperativeRenderCheckpoint(
  state: CooperativeRenderState,
): boolean | Promise<boolean> {
  if (state.cancelled?.()) {
    return false;
  }
  if (performance.now() - state.sliceStartedAt < state.sliceMs) {
    return true;
  }
  return rendererYield().then(() => {
    state.sliceStartedAt = performance.now();
    return !state.cancelled?.();
  });
}

async function appendTwemojiTextCooperatively(
  parent: Node,
  value: string,
  state: CooperativeRenderState,
): Promise<boolean> {
  if (ASCII_TEXT.test(value)) {
    if (value) {
      parent.appendChild(document.createTextNode(value));
    }
    const checkpoint = cooperativeRenderCheckpoint(state);
    return checkpoint === true
      ? true
      : checkpoint === false
        ? false
        : checkpoint;
  }
  const segments = twemojiSegments(value);
  const parsed = cooperativeRenderCheckpoint(state);
  if (parsed === false || (parsed !== true && !(await parsed))) {
    return false;
  }
  for (const segment of segments) {
    appendTwemojiSegment(parent, segment);
    const checkpoint = cooperativeRenderCheckpoint(state);
    if (
      checkpoint === false ||
      (checkpoint !== true && !(await checkpoint))
    ) {
      return false;
    }
  }
  return true;
}

async function renderInlineCooperatively(
  nodes: readonly InlineNode[],
  parent: Node,
  projectId: string | undefined,
  state: CooperativeRenderState,
): Promise<boolean> {
  for (const node of nodes) {
    if (node.type === 'text') {
      if (
        !(await appendTwemojiTextCooperatively(
          parent,
          node.value,
          state,
        ))
      ) {
        return false;
      }
    } else if (node.type === 'inlineCode') {
      const element = document.createElement('code');
      if (
        !(await appendTwemojiTextCooperatively(
          element,
          node.value,
          state,
        ))
      ) {
        return false;
      }
      parent.appendChild(element);
    } else if (
      node.type === 'strong' ||
      node.type === 'emphasis' ||
      node.type === 'delete'
    ) {
      const element = document.createElement(
        node.type === 'strong'
          ? 'strong'
          : node.type === 'emphasis'
            ? 'em'
            : 'del',
      );
      if (
        !(await renderInlineCooperatively(
          node.children,
          element,
          projectId,
          state,
        ))
      ) {
        return false;
      }
      parent.appendChild(element);
    } else if (node.type === 'highlight') {
      const element = document.createElement('mark');
      if (node.color) {
        element.style.backgroundColor = node.color;
        element.style.color = colorContrastInk(node.color);
        element.dataset.customColor = '';
      }
      if (
        !(await renderInlineCooperatively(
          node.children,
          element,
          projectId,
          state,
        ))
      ) {
        return false;
      }
      parent.appendChild(element);
    } else if (node.type === 'color') {
      const element = document.createElement('span');
      element.style.color = node.color;
      if (
        !(await renderInlineCooperatively(
          node.children,
          element,
          projectId,
          state,
        ))
      ) {
        return false;
      }
      parent.appendChild(element);
    } else if (node.type === 'link') {
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
      if (
        !(await renderInlineCooperatively(
          node.children,
          element,
          projectId,
          state,
        ))
      ) {
        return false;
      }
      parent.appendChild(element);
    } else {
      renderInline([node], parent, projectId);
    }

    const checkpoint = cooperativeRenderCheckpoint(state);
    if (
      checkpoint === false ||
      (checkpoint !== true && !(await checkpoint))
    ) {
      return false;
    }
  }
  return true;
}

async function renderLargeBlockCooperatively(
  node: BlockNode,
  parent: Node,
  context: RenderContext,
  state: CooperativeRenderState,
): Promise<boolean> {
  if (node.type === 'paragraph') {
    const element = document.createElement('p');
    if (
      !(await renderInlineCooperatively(
        node.children,
        element,
        context.projectId,
        state,
      ))
    ) {
      return false;
    }
    parent.appendChild(element);
    return true;
  }

  if (node.type === 'code') {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    if (node.lang) {
      code.dataset.lang = node.lang;
    }
    if (
      !(await appendTwemojiTextCooperatively(
        code,
        node.value,
        state,
      ))
    ) {
      return false;
    }
    pre.appendChild(code);
    parent.appendChild(pre);
    return true;
  }

  if (node.type === 'list') {
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
      const checkpoint = cooperativeRenderCheckpoint(state);
      if (
        checkpoint === false ||
        (checkpoint !== true && !(await checkpoint))
      ) {
        return false;
      }
    }
    parent.appendChild(element);
    return true;
  }

  if (node.type === 'table') {
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
        const checkpoint = cooperativeRenderCheckpoint(state);
        if (
          checkpoint === false ||
          (checkpoint !== true && !(await checkpoint))
        ) {
          return false;
        }
      }
      table.appendChild(body);
    }
    wrapper.appendChild(table);
    parent.appendChild(wrapper);
    return true;
  }

  renderBlocks([node], parent, context);
  return true;
}

async function renderMarkdownBlockCooperatively(
  segment: MarkdownBlockSource,
  context: RenderContext,
  cancelled: (() => boolean) | undefined,
  sliceMs: number,
): Promise<RenderedMarkdownBlock | null | undefined> {
  const state: CooperativeRenderState = {
    cancelled,
    sliceMs,
    sliceStartedAt: performance.now(),
  };
  const node = parseChangedBlock(segment);
  if (!node) {
    return null;
  }
  const parsed = cooperativeRenderCheckpoint(state);
  if (parsed === false || (parsed !== true && !(await parsed))) {
    return undefined;
  }

  const fragment = document.createDocumentFragment();
  const headings: RenderedMarkdownHeading[] = [];
  context.capturedHeadings = headings;
  const rendered = await renderLargeBlockCooperatively(
    node,
    fragment,
    context,
    state,
  );
  delete context.capturedHeadings;
  if (!rendered) {
    return undefined;
  }
  const element = fragment.firstChild;
  return element
    ? { element, headings, node, source: segment.source }
    : null;
}

async function headingMetadataUpdatesCooperatively(
  blocks: readonly RenderedMarkdownBlock[],
  cancelled: (() => boolean) | undefined,
  sliceMs: number,
): Promise<HeadingMetadataUpdate[] | null> {
  const context = renderContext();
  const updates: HeadingMetadataUpdate[] = [];
  let sliceStartedAt = performance.now();

  for (const block of blocks) {
    for (const heading of block.headings) {
      const update = nextHeadingUpdate(heading, context);
      if (update) {
        updates.push(update);
      }
    }
    if (cancelled?.()) {
      return null;
    }
    if (performance.now() - sliceStartedAt >= sliceMs) {
      await rendererYield();
      if (cancelled?.()) {
        return null;
      }
      sliceStartedAt = performance.now();
    }
  }
  return updates;
}

export async function renderMarkdownIntoCooperatively(
  container: HTMLElement,
  source: string,
  options: {
    cancelled?: () => boolean;
    projectId?: string;
    sliceMs?: number;
  } = {},
): Promise<boolean> {
  const state = renderStates.get(container);
  if (
    state?.source === source &&
    state.projectId === options.projectId &&
    hasExpectedChildren(container, state.blocks)
  ) {
    return true;
  }
  if (options.cancelled?.()) {
    return false;
  }

  const sliceMs = Math.max(2, options.sliceMs ?? 8);
  const segments = await splitMarkdownBlocksCooperatively(source, {
    cancelled: options.cancelled,
    sliceMs,
    yieldControl: rendererYield,
  });
  if (!segments) {
    return false;
  }

  const reusableState =
    state &&
    state.projectId === options.projectId &&
    hasExpectedChildren(container, state.blocks)
      ? state
      : undefined;
  if (reusableState) {
    const diff = markdownBlockDiff(reusableState.blocks, segments);
    if (
      reusableState.blocks.length === segments.length &&
      diff.prefix === segments.length
    ) {
      renderStates.set(container, { ...reusableState, source });
      return true;
    }

    const pending = reuseMarkdownBlocks(
      reusableState.blocks,
      segments,
      diff,
    );
    const context = renderContext(options.projectId);
    let sliceStartedAt = performance.now();
    for (let index = diff.prefix; index < diff.newEnd; index += 1) {
      if (options.cancelled?.()) {
        return false;
      }
      const segment = segments[index]!;
      const block =
        segment.source.length >= COOPERATIVE_MARKDOWN_BLOCK_CHARACTERS
          ? await renderMarkdownBlockCooperatively(
              segment,
              context,
              options.cancelled,
              sliceMs,
            )
          : renderMarkdownBlock(segment, context);
      if (block === undefined) {
        return false;
      }
      if (!block) {
        break;
      }
      pending[index] = block;
      if (performance.now() - sliceStartedAt >= sliceMs) {
        await rendererYield();
        if (options.cancelled?.()) {
          return false;
        }
        sliceStartedAt = performance.now();
      }
    }

    if (pending.some((block) => block === undefined)) {
      const build = buildMarkdown(source, options.projectId);
      if (options.cancelled?.()) {
        return false;
      }
      publishMarkdown(container, source, options.projectId, build);
      return true;
    }

    const blocks = pending as RenderedMarkdownBlock[];
    const headingUpdates = headingStructureChanged(
      reusableState.blocks,
      blocks,
      diff,
    )
      ? await headingMetadataUpdatesCooperatively(
          blocks,
          options.cancelled,
          sliceMs,
        )
      : [];
    if (!headingUpdates || options.cancelled?.()) {
      return false;
    }
    if (
      renderStates.get(container) !== reusableState ||
      !hasExpectedChildren(container, reusableState.blocks)
    ) {
      return false;
    }
    publishMarkdownChanges(
      container,
      source,
      options.projectId,
      blocks,
      diff,
      headingUpdates,
    );
    return true;
  }

  const context = renderContext(options.projectId);
  const fragment = document.createDocumentFragment();
  const blocks: RenderedMarkdownBlock[] = [];
  let sliceStartedAt = performance.now();

  for (const segment of segments) {
    if (options.cancelled?.()) {
      return false;
    }
    const block =
      segment.source.length >= COOPERATIVE_MARKDOWN_BLOCK_CHARACTERS
        ? await renderMarkdownBlockCooperatively(
            segment,
            context,
            options.cancelled,
            sliceMs,
          )
        : renderMarkdownBlock(segment, context);
    if (block === undefined) {
      return false;
    }
    if (!block) {
      const build = buildMarkdown(source, options.projectId);
      if (options.cancelled?.()) {
        return false;
      }
      publishMarkdown(container, source, options.projectId, build);
      return true;
    }
    fragment.appendChild(block.element);
    blocks.push(block);

    if (performance.now() - sliceStartedAt >= sliceMs) {
      await rendererYield();
      sliceStartedAt = performance.now();
    }
  }

  if (options.cancelled?.()) {
    return false;
  }
  publishMarkdown(container, source, options.projectId, {
    blocks,
    fragment,
  });
  return true;
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
  const diff = markdownBlockDiff(state.blocks, segments);

  if (
    state.blocks.length === segments.length &&
    diff.prefix === segments.length
  ) {
    renderStates.set(container, { ...state, source });
    return;
  }

  const next = reuseMarkdownBlocks(state.blocks, segments, diff);
  const context = renderContext(options.projectId);
  for (let index = diff.prefix; index < diff.newEnd; index += 1) {
    const segment = segments[index]!;
    const block = renderMarkdownBlock(segment, context);
    if (!block) {
      rebuildMarkdown(container, source, options.projectId);
      return;
    }
    next[index] = block;
  }

  const blocks = next as RenderedMarkdownBlock[];
  const headingUpdates = headingStructureChanged(state.blocks, blocks, diff)
    ? headingMetadataUpdates(blocks)
    : [];
  publishMarkdownChanges(
    container,
    source,
    options.projectId,
    blocks,
    diff,
    headingUpdates,
  );
}
