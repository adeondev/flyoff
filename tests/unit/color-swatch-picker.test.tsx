// @vitest-environment jsdom

import { useState } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ColorSwatchPicker } from '../../src/renderer/components/color';
import * as pixelSampler from '../../src/renderer/components/color/pixel-sampler';

type HitTestable = { elementFromPoint?: (x: number, y: number) => Element | null };

afterEach(() => {
  cleanup();
  delete (window as { EyeDropper?: unknown }).EyeDropper;
  delete (document as HitTestable).elementFromPoint;
  delete document.documentElement.dataset.colorPicking;
  delete (window as { flyoff?: unknown }).flyoff;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

/** The eyedropper captures the window first, so the loupe mounts a tick later. */
async function openLoupe(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Capturar cor' }));
  await screen.findByRole('button', { name: 'Esc para cancelar' });
  await waitFor(() =>
    expect(document.documentElement.dataset.colorPicking).toBe('true'),
  );
}

/** Stands in for the window capture, which jsdom cannot produce. */
function stubSampler(hex: string) {
  return vi.spyOn(pixelSampler, 'captureWindowPixels').mockResolvedValue({
    scale: 1,
    source: document.createElement('canvas'),
    at: () => hex,
  });
}

function stubEyeDropper(sRGBHex: string): void {
  (window as { EyeDropper?: unknown }).EyeDropper = class {
    open(): Promise<{ sRGBHex: string }> {
      return Promise.resolve({ sRGBHex });
    }
  };
}

function ControlledPicker({
  allowAlpha = false,
  onChange = () => undefined,
  recent,
  snapTo,
}: {
  allowAlpha?: boolean;
  onChange?: (color: string) => void;
  recent?: readonly string[];
  snapTo?: readonly string[];
}) {
  const [value, setValue] = useState<string | null>('#3B82F6');
  return (
    <ColorSwatchPicker
      allowAlpha={allowAlpha}
      customLabel="Cor personalizada"
      label="Presets"
      labels={{
        alpha: 'Opacidade',
        eyedropper: 'Capturar cor',
        format: 'Formato',
        hue: 'Matiz',
        loupeCancel: 'Esc para cancelar',
        loupeHint: 'Clique para confirmar',
        loupeLocked: 'Cor da nota',
        loupeScreen: 'Tela inteira',
        recent: 'Cores recentes',
      }}
      onChange={(color) => {
        setValue(color);
        onChange(color);
      }}
      optionLabel={(preset) => preset}
      presets={['#3B82F6', '#8F4FC4']}
      recent={recent}
      snapTo={snapTo}
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

  it('switches the numeric fields between RGB and HSL', () => {
    const onChange = vi.fn();
    render(<ControlledPicker onChange={onChange} />);

    const format = screen.getByRole('button', { name: 'Formato: RGB' });
    fireEvent.click(format);

    expect(screen.queryByLabelText('Cor personalizada: R')).toBeNull();
    expect(
      (screen.getByLabelText('Cor personalizada: H') as HTMLInputElement)
        .value,
    ).toBe('217');

    fireEvent.change(screen.getByLabelText('Cor personalizada: L'), {
      target: { value: '20' },
    });
    expect(onChange).toHaveBeenLastCalledWith('#042862');
  });

  it('only offers opacity when alpha is allowed and emits eight digits', () => {
    const onChange = vi.fn();
    const { unmount } = render(<ControlledPicker onChange={onChange} />);
    expect(screen.queryByLabelText('Cor personalizada: Opacidade')).toBeNull();
    unmount();

    render(<ControlledPicker allowAlpha onChange={onChange} />);
    const alpha = screen.getByLabelText('Cor personalizada: Opacidade');
    fireEvent.change(alpha, { target: { value: '50' } });
    fireEvent.pointerUp(alpha, { target: { value: '50' } });

    expect(onChange).toHaveBeenLastCalledWith('#3B82F680');
  });

  it('locks a screen sample onto the colour already used in the note', async () => {
    const onChange = vi.fn();
    // What the screen really holds over green text on a light page.
    stubEyeDropper('#42EA6B');
    render(<ControlledPicker onChange={onChange} snapTo={['#2DE85B']} />);

    await openLoupe();
    fireEvent.click(screen.getByRole('button', { name: 'Tela inteira' }));

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith('#2DE85B'),
    );
  });

  it('keeps the raw sample when no authored colour is near it', async () => {
    const onChange = vi.fn();
    stubEyeDropper('#FF0000');
    render(<ControlledPicker onChange={onChange} snapTo={['#2DE85B']} />);

    await openLoupe();
    fireEvent.click(screen.getByRole('button', { name: 'Tela inteira' }));

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith('#FF0000'),
    );
  });

  it('locks onto the colour under the loupe and confirms on click', async () => {
    const onChange = vi.fn();
    render(<ControlledPicker onChange={onChange} />);
    const target = document.createElement('span');
    target.style.color = '#2DE85B';
    document.body.append(target);
    (document as HitTestable).elementFromPoint = () => target;

    await openLoupe();
    fireEvent.pointerMove(window, { clientX: 40, clientY: 40 });

    // The loupe reports the authored value, not an approximation of it.
    expect(screen.getByText('#2DE85B')).toBeTruthy();
    expect(screen.getByText('Cor da nota')).toBeTruthy();
    expect(document.documentElement.dataset.colorPicking).toBe('true');

    fireEvent.click(window, { clientX: 40, clientY: 40 });

    expect(onChange).toHaveBeenLastCalledWith('#2DE85B');
    expect(document.documentElement.dataset.colorPicking).toBeUndefined();
  });

  it('accepts a pixel colour nothing in the DOM declares', async () => {
    const onChange = vi.fn();
    render(<ControlledPicker onChange={onChange} />);
    // An emoji or image: the DOM knows no colour for this point.
    const art = document.createElement('img');
    document.body.append(art);
    (document as HitTestable).elementFromPoint = () => art;
    stubSampler('#C71585');

    await openLoupe();
    fireEvent.pointerMove(window, { clientX: 40, clientY: 40 });

    expect(screen.getByText('#C71585')).toBeTruthy();
    expect(screen.queryByText('Cor da nota')).toBeNull();

    fireEvent.click(window, { clientX: 40, clientY: 40 });
    expect(onChange).toHaveBeenLastCalledWith('#C71585');
  });

  it('hands back the written colour when a pixel came from it', async () => {
    const onChange = vi.fn();
    render(<ControlledPicker onChange={onChange} />);
    const painted = document.createElement('span');
    painted.style.color = '#2DE85B';
    document.body.append(painted);
    (document as HitTestable).elementFromPoint = () => painted;
    // Anti-aliased edge of that same green text.
    stubSampler('#42EA6B');

    await openLoupe();
    fireEvent.pointerMove(window, { clientX: 40, clientY: 40 });

    expect(screen.getByText('#2DE85B')).toBeTruthy();
    expect(screen.getByText('Cor da nota')).toBeTruthy();
  });

  it('locks across the whole run, gaps between glyphs included', async () => {
    const onChange = vi.fn();
    render(<ControlledPicker onChange={onChange} />);
    const painted = document.createElement('span');
    painted.style.color = '#2DE85B';
    document.body.append(painted);
    (document as HitTestable).elementFromPoint = () => painted;
    // The page showing through between two letters: still that run's colour.
    stubSampler('#FFFFFF');

    await openLoupe();
    fireEvent.pointerMove(window, { clientX: 40, clientY: 40 });

    expect(screen.getByText('#2DE85B')).toBeTruthy();
    expect(screen.getByText('Cor da nota')).toBeTruthy();
  });

  it('takes the pixel from an emoji sitting inside a coloured run', async () => {
    const onChange = vi.fn();
    render(<ControlledPicker onChange={onChange} />);
    const painted = document.createElement('span');
    painted.style.color = '#2DE85B';
    // Twemoji renders as an image; its pixels are not the run's colour.
    const glyph = document.createElement('img');
    painted.append(glyph);
    document.body.append(painted);
    (document as HitTestable).elementFromPoint = () => glyph;
    stubSampler('#F5A623');

    await openLoupe();
    fireEvent.pointerMove(window, { clientX: 40, clientY: 40 });

    expect(screen.getByText('#F5A623')).toBeTruthy();
    expect(screen.queryByText('Cor da nota')).toBeNull();
  });

  it('re-takes the still after the page scrolls under the loupe', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    (document as HitTestable).elementFromPoint = () => target;
    const capture = stubSampler('#111111');

    render(<ControlledPicker />);
    await openLoupe();
    expect(capture).toHaveBeenCalledTimes(1);

    fireEvent.pointerMove(window, { clientX: 40, clientY: 40 });
    expect(screen.getByText('#111111')).toBeTruthy();

    // Scrolled: the still now describes content that has moved away.
    capture.mockResolvedValue({
      scale: 1,
      source: document.createElement('canvas'),
      at: () => '#999999',
    });
    fireEvent.scroll(window);

    await waitFor(() => expect(capture).toHaveBeenCalledTimes(2));
    fireEvent.pointerMove(window, { clientX: 40, clientY: 40 });
    await waitFor(() => expect(screen.getByText('#999999')).toBeTruthy());
  });

  it('leaves the colour untouched when picking is cancelled', async () => {
    const onChange = vi.fn();
    render(<ControlledPicker onChange={onChange} />);

    await openLoupe();
    expect(document.documentElement.dataset.colorPicking).toBe('true');
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onChange).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.colorPicking).toBeUndefined();
  });

  it('offers the screen sampler only where the platform has one', async () => {
    render(<ControlledPicker />);
    await openLoupe();
    expect(screen.queryByRole('button', { name: 'Tela inteira' })).toBeNull();
    cleanup();

    stubEyeDropper('#FF0000');
    render(<ControlledPicker />);
    await openLoupe();
    expect(screen.getByRole('button', { name: 'Tela inteira' })).toBeTruthy();
  });

  it('offers recent colours as a separate group', () => {
    const onChange = vi.fn();
    render(<ControlledPicker onChange={onChange} recent={['#2DE85B']} />);

    const group = screen.getByRole('group', { name: 'Cores recentes' });
    fireEvent.click(within(group).getByRole('button', { name: '#2DE85B' }));
    expect(onChange).toHaveBeenLastCalledWith('#2DE85B');
  });
});
