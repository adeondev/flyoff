import { writeFile } from 'node:fs/promises';

import { clipboard, dialog } from 'electron';

import type {
  TwineContentActionResult,
  TwineCopyContentRequest,
  TwineExportMarkdownRequest,
} from '../../shared/contracts';

function exportFileName(value: string): string {
  const printable = Array.from(value, (character) =>
    character.charCodeAt(0) < 32 ? ' ' : character,
  ).join('');
  const sanitized = printable
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  const base = sanitized || 'Twine response';
  return base.toLowerCase().endsWith('.md') ? base : `${base}.md`;
}

export class TwineContentService {
  copy(request: TwineCopyContentRequest): TwineContentActionResult {
    try {
      clipboard.writeText(request.content);
      return { status: 'success' };
    } catch {
      return { error: 'clipboard-unavailable', status: 'error' };
    }
  }

  async exportMarkdown(
    request: TwineExportMarkdownRequest,
  ): Promise<TwineContentActionResult> {
    try {
      const selection = await dialog.showSaveDialog({
        defaultPath: exportFileName(request.suggestedName),
        filters: [{ extensions: ['md'], name: 'Markdown' }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (selection.canceled || !selection.filePath) {
        return { status: 'canceled' };
      }
      await writeFile(selection.filePath, request.content, 'utf8');
      return { status: 'success' };
    } catch {
      return { error: 'write-failed', status: 'error' };
    }
  }
}
