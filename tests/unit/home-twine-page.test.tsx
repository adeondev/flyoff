// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GlobalSidebar } from '../../src/renderer/components/Sidebar';
import { createDescriptor } from '../../src/renderer/components/tabs/tab-state';
import { HomePage } from '../../src/renderer/pages/HomePage';
import { TwinePage } from '../../src/renderer/pages/TwinePage';
import { INTERNAL_PAGE_IDS } from '../../src/shared/contracts';
import { enUS, type TranslationKey } from '../../src/shared/i18n';

function translate(key: TranslationKey): string {
  const [section, entry] = key.split('.') as [keyof typeof enUS, string];
  return (enUS[section] as unknown as Record<string, string>)[entry] ?? key;
}

function pageProps(
  pageId:
    | typeof INTERNAL_PAGE_IDS.home
    | typeof INTERNAL_PAGE_IDS.twine,
) {
  return {
    active: true,
    descriptor: createDescriptor({ type: 'internal' as const, pageId }),
    onScrollChange: vi.fn(),
    onStateChange: vi.fn(),
    title: translate(
      pageId === INTERNAL_PAGE_IDS.home ? 'pages.home' : 'pages.twine',
    ),
    translate,
  };
}

afterEach(cleanup);

describe('Twine entry points', () => {
  it('shows a Beta action on Home and invokes its callback', () => {
    const onOpenTwine = vi.fn();

    render(
      <HomePage
        {...pageProps(INTERNAL_PAGE_IDS.home)}
        onOpenTwine={onOpenTwine}
      />,
    );

    const twine = screen.getByRole('button', { name: 'Twine, Beta' });
    fireEvent.click(twine);

    expect(onOpenTwine).toHaveBeenCalledOnce();
    expect(twine.querySelector('img')).toBeTruthy();
  });

  it('opens Twine from the sidebar and marks it as current', () => {
    const onOpenPage = vi.fn();

    render(
      <GlobalSidebar
        activePageId={INTERNAL_PAGE_IDS.twine}
        onOpenPage={onOpenPage}
        translate={translate}
      />,
    );

    const twine = screen.getByRole('button', { name: 'Twine' });
    expect(twine.getAttribute('aria-current')).toBe('page');

    fireEvent.click(twine);
    expect(onOpenPage).toHaveBeenCalledWith(INTERNAL_PAGE_IDS.twine);
  });

  it('renders the Twine chat empty state', () => {
    render(<TwinePage {...pageProps(INTERNAL_PAGE_IDS.twine)} />);

    expect(screen.getByText('Twine')).toBeTruthy();
    expect(screen.queryByText('What will we do today?')).toBeNull();
    expect(screen.queryByText('Beta')).toBeNull();
    expect(
      screen.getByRole('button', {
        name: 'Select model: Gemma 4 26B A4B IT',
      }),
    ).toBeTruthy();
  });
});
