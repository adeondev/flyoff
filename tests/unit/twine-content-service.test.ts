import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TwineContentService } from '../../src/main/twine/twine-content-service';

const mocks = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
  writeFile: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock('electron', () => ({
  clipboard: { writeText: mocks.writeText },
  dialog: { showSaveDialog: mocks.showSaveDialog },
}));

vi.mock('node:fs/promises', () => ({
  writeFile: mocks.writeFile,
}));

describe('TwineContentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('copies content and reports clipboard failures', () => {
    const service = new TwineContentService();

    expect(service.copy({ content: '**Answer**', format: 'markdown' })).toEqual({
      status: 'success',
    });
    expect(mocks.writeText).toHaveBeenCalledWith('**Answer**');

    mocks.writeText.mockImplementationOnce(() => {
      throw new Error('clipboard unavailable');
    });
    expect(service.copy({ content: 'Answer', format: 'text' })).toEqual({
      error: 'clipboard-unavailable',
      status: 'error',
    });
  });

  it('exports Markdown with a sanitized cross-platform file name', async () => {
    mocks.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: 'D:\\Exports\\Twine.md',
    });
    mocks.writeFile.mockResolvedValue(undefined);
    const service = new TwineContentService();

    await expect(
      service.exportMarkdown({
        content: '# Answer',
        suggestedName: 'Answer: one?',
      }),
    ).resolves.toEqual({ status: 'success' });
    expect(mocks.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'Answer one.md' }),
    );
    expect(mocks.writeFile).toHaveBeenCalledWith(
      'D:\\Exports\\Twine.md',
      '# Answer',
      'utf8',
    );
  });

  it('keeps cancellation silent and reports write errors', async () => {
    const service = new TwineContentService();
    mocks.showSaveDialog.mockResolvedValueOnce({ canceled: true });
    await expect(
      service.exportMarkdown({ content: 'Answer', suggestedName: 'Answer' }),
    ).resolves.toEqual({ status: 'canceled' });
    expect(mocks.writeFile).not.toHaveBeenCalled();

    mocks.showSaveDialog.mockRejectedValueOnce(new Error('dialog failed'));
    await expect(
      service.exportMarkdown({ content: 'Answer', suggestedName: 'Answer' }),
    ).resolves.toEqual({ error: 'write-failed', status: 'error' });
  });
});
