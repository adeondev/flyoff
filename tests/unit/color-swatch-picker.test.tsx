// @vitest-environment jsdom

import { useState } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ColorSwatchPicker } from '../../src/renderer/components/color';

afterEach(cleanup);

function ControlledPicker({
  onChange = () => undefined,
}: {
  onChange?: (color: string) => void;
}) {
  const [value, setValue] = useState<string | null>('#3B82F6');
  return (
    <ColorSwatchPicker
      customLabel="Cor personalizada"
      label="Presets"
      onChange={(color) => {
        setValue(color);
        onChange(color);
      }}
      optionLabel={(preset) => preset}
      presets={['#3B82F6', '#8F4FC4']}
      value={value}
    />
  );
}

describe('ColorSwatchPicker', () => {
  it('keeps RGB and hexadecimal fields synchronized', () => {
    const onChange = vi.fn();
    render(<ControlledPicker onChange={onChange} />);

    expect(
      (screen.getByLabelText('Cor personalizada: R') as HTMLInputElement)
        .value,
    ).toBe('59');
    expect(
      (
        screen.getByLabelText(
          'Cor personalizada: hexadecimal',
        ) as HTMLInputElement
      ).value,
    ).toBe('#3B82F6');

    fireEvent.change(screen.getByLabelText('Cor personalizada: R'), {
      target: { value: '255' },
    });
    expect(onChange).toHaveBeenLastCalledWith('#FF82F6');

    const hex = screen.getByLabelText('Cor personalizada: hexadecimal');
    fireEvent.change(hex, { target: { value: '#00ff00' } });
    fireEvent.blur(hex);
    expect(onChange).toHaveBeenLastCalledWith('#00FF00');
    expect(
      (screen.getByLabelText('Cor personalizada: G') as HTMLInputElement)
        .value,
    ).toBe('255');
  });

  it('moves preset focus with arrow keys and commits on click', () => {
    const onChange = vi.fn();
    render(<ControlledPicker onChange={onChange} />);
    const blue = screen.getByRole('radio', { name: '#3B82F6' });
    const purple = screen.getByRole('radio', { name: '#8F4FC4' });

    blue.focus();
    fireEvent.keyDown(blue, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(purple);
    fireEvent.click(purple);
    expect(onChange).toHaveBeenLastCalledWith('#8F4FC4');
  });
});
