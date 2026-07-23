import { renderMarkdownInto } from '../projects/markdown-render';

export function twinePlainTextFromMarkdown(source: string): string {
  const container = document.createElement('div');
  renderMarkdownInto(container, source);
  return (container.textContent ?? '').trim();
}
