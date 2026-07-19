const BLOCK_ELEMENTS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DIV',
  'DL',
  'DT',
  'DD',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'TBODY',
  'TD',
  'TFOOT',
  'TH',
  'THEAD',
  'TR',
  'UL',
]);

const IGNORED_ELEMENTS = new Set(['NOSCRIPT', 'SCRIPT', 'STYLE', 'TEMPLATE']);
const LOGICAL_LINE_ENDINGS = /\r\n?|[\u0085\u2028\u2029]/gu;

export interface SourceTransfer {
  getData(format: string): string;
}

export function normalizeSourceText(value: string): string {
  return value.replace(LOGICAL_LINE_ENDINGS, '\n');
}

function isPlaceholderBlock(node: Node): boolean {
  return (
    node.nodeType === Node.ELEMENT_NODE &&
    BLOCK_ELEMENTS.has((node as Element).tagName) &&
    node.childNodes.length === 1 &&
    node.firstChild?.nodeType === Node.ELEMENT_NODE &&
    (node.firstChild as Element).tagName === 'BR'
  );
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return serializeChildren(node as ParentNode);
  }

  const element = node as Element;
  if (IGNORED_ELEMENTS.has(element.tagName)) {
    return '';
  }
  if (element.tagName === 'BR') {
    return '\n';
  }
  return serializeChildren(element);
}

function serializeChildren(parent: ParentNode): string {
  const segments: string[] = [];
  let inline = '';
  let hasInline = false;

  const flushInline = (): void => {
    if (hasInline) {
      segments.push(inline);
      inline = '';
      hasInline = false;
    }
  };

  for (const child of parent.childNodes) {
    const block =
      child.nodeType === Node.ELEMENT_NODE &&
      BLOCK_ELEMENTS.has((child as Element).tagName);
    if (block) {
      flushInline();
      segments.push(isPlaceholderBlock(child) ? '' : serializeNode(child));
    } else {
      hasInline = true;
      inline += serializeNode(child);
    }
  }

  flushInline();
  return segments.join('\n');
}

function htmlSourceText(html: string, ownerDocument: Document): string {
  if (!html) {
    return '';
  }

  const inert = ownerDocument.implementation.createHTMLDocument('');
  inert.body.innerHTML = html;
  return normalizeSourceText(serializeChildren(inert.body)).replace(
    /^\n+|\n+$/gu,
    '',
  );
}

function compactText(value: string): string {
  return value.replace(/\s+/gu, '');
}

export function sourceTextFromTransfer(
  transfer: SourceTransfer,
  ownerDocument: Document,
): string {
  const plain = normalizeSourceText(transfer.getData('text/plain'));
  const html = htmlSourceText(transfer.getData('text/html'), ownerDocument);

  if (!plain) {
    return html;
  }
  if (
    !plain.includes('\n') &&
    html.includes('\n') &&
    compactText(plain) === compactText(html)
  ) {
    return html;
  }
  return plain;
}
