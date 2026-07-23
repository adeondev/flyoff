// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dialog } from '../../src/renderer/components/dialog/Dialog';

afterEach(cleanup);

describe('Dialog', () => {
  it('closes the topmost dialog on Escape when focus is outside its portal', () => {
    const onCancel = vi.fn();
    render(
      <>
        <button type="button">Outside</button>
        <Dialog
          closeLabel="Close"
          onCancel={onCancel}
          title="References"
        >
          <button type="button">Result</button>
        </Dialog>
      </>,
    );

    const outside = screen.getByRole('button', { name: 'Outside' });
    outside.focus();
    fireEvent.keyDown(outside, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledWith('escape');
  });
});
