import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
  type UIEvent,
} from 'react';
import { createPortal } from 'react-dom';

import type { EmojiSkinTone } from '../../shared/contracts';
import {
  twemojiAssetUrl,
  twemojiSegments,
} from '../components/twemoji';
import type { Translate } from '../pages/page-types';
import catalogData from './emoji-catalog.generated.json';

interface EmojiPickerProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onPick: (emoji: string) => void;
  onSkinToneChange: (tone: EmojiSkinTone) => void;
  open: boolean;
  recent: readonly string[];
  skinTone: EmojiSkinTone;
  translate: Translate;
}

interface EmojiCatalogEntry {
  codepoint?: string;
  group: number;
  hexcode: string;
  label: {
    en: string;
    pt: string;
  };
  order: number;
  search: string;
  skinCodepoints?: readonly (string | undefined)[];
  skins?: readonly string[];
  unicode: string;
}

interface EmojiGroup {
  key: string;
  message: string;
  order: number;
}

interface EmojiCatalog {
  entries: readonly EmojiCatalogEntry[];
  groups: {
    en: readonly EmojiGroup[];
    pt: readonly EmojiGroup[];
  };
  version: number;
}

interface PickerEmoji {
  codepoint?: string;
  emoji: EmojiCatalogEntry;
  unicode?: string;
}

interface GridViewport {
  height: number;
  scrollTop: number;
  width: number;
}

const SEARCH_RESULT_LIMIT = 120;
const SKIN_TONES: readonly EmojiSkinTone[] = [0, 1, 2, 3, 4, 5];
const TONE_SAMPLES = [
  '\u{1F44B}',
  '\u{1F44B}\u{1F3FB}',
  '\u{1F44B}\u{1F3FC}',
  '\u{1F44B}\u{1F3FD}',
  '\u{1F44B}\u{1F3FE}',
  '\u{1F44B}\u{1F3FF}',
];
const GRID_CELL_MIN_WIDTH = 34;
const GRID_COLUMN_GAP = 4;
const GRID_ROW_HEIGHT = 38;
const GRID_OVERSCAN_ROWS = 2;
const DEFAULT_GRID_WIDTH = 340;
const DEFAULT_GRID_HEIGHT = 240;
const catalog = catalogData as EmojiCatalog;
const entriesByUnicode = new Map<string, EmojiCatalogEntry>();

for (const entry of catalog.entries) {
  entriesByUnicode.set(entry.unicode, entry);
  for (const skin of entry.skins ?? []) {
    entriesByUnicode.set(skin, entry);
  }
}

function normalized(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .trim();
}

function displayedEmoji(
  emoji: EmojiCatalogEntry,
  tone: EmojiSkinTone,
): { codepoint?: string; unicode: string } {
  return tone > 0 && emoji.skins?.[tone - 1]
    ? {
        codepoint: emoji.skinCodepoints?.[tone - 1],
        unicode: emoji.skins[tone - 1]!,
      }
    : { codepoint: emoji.codepoint, unicode: emoji.unicode };
}

function glyph(
  emoji: string,
  knownCodepoint?: string,
  loadAsset = true,
): React.ReactNode {
  const segment = knownCodepoint
    ? { codepoint: knownCodepoint, emoji }
    : twemojiSegments(emoji).find(({ codepoint }) => codepoint);
  const assetUrl = segment?.codepoint
    ? twemojiAssetUrl(segment.codepoint)
    : null;
  if (!assetUrl || !loadAsset) {
    return emoji;
  }
  return (
    <>
      <span aria-hidden="true" className="emoji-picker__native">
        {emoji}
      </span>
      <img
        alt=""
        aria-hidden="true"
        className="emoji-picker__asset"
        decoding="async"
        draggable={false}
        loading="lazy"
        onError={(event) => {
          const native = event.currentTarget.previousElementSibling;
          if (native instanceof HTMLElement) {
            native.style.visibility = 'visible';
          }
          event.currentTarget.remove();
        }}
        src={assetUrl}
      />
    </>
  );
}

function locale(): 'en' | 'pt' {
  return document.documentElement.lang.toLocaleLowerCase().startsWith('pt')
    ? 'pt'
    : 'en';
}

export function EmojiPicker({
  anchorRef,
  onClose,
  onPick,
  onSkinToneChange,
  open,
  recent,
  skinTone,
  translate,
}: EmojiPickerProps) {
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<number, HTMLButtonElement>());
  const pendingScrollFrame = useRef<number | null>(null);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const [viewport, setViewport] = useState<GridViewport>({
    height: DEFAULT_GRID_HEIGHT,
    scrollTop: 0,
    width: DEFAULT_GRID_WIDTH,
  });
  const pickerLocale = useMemo(() => locale(), []);
  const groups = catalog.groups[pickerLocale];
  const normalizedQuery = normalized(query);
  const deferredQuery = useDeferredValue(normalizedQuery);
  const visible = useMemo<readonly PickerEmoji[]>(() => {
    if (deferredQuery) {
      return catalog.entries
        .filter(({ search }) => search.includes(deferredQuery))
        .slice(0, SEARCH_RESULT_LIMIT)
        .map((emoji) => ({ emoji }));
    }
    if (group === -1) {
      return recent.flatMap((unicode) => {
        const matching = entriesByUnicode.get(unicode);
        if (!matching) {
          return [];
        }
        const skinIndex = matching.skins?.indexOf(unicode) ?? -1;
        return [{
          codepoint:
            skinIndex >= 0
              ? matching.skinCodepoints?.[skinIndex]
              : matching.codepoint,
          emoji: matching,
          unicode,
        }];
      });
    }
    return catalog.entries
      .filter((entry) => entry.group === group)
      .map((emoji) => ({ emoji }));
  }, [deferredQuery, group, recent]);
  const columns = Math.max(
    1,
    Math.floor(
      (viewport.width + GRID_COLUMN_GAP) /
        (GRID_CELL_MIN_WIDTH + GRID_COLUMN_GAP),
    ),
  );
  const cellWidth =
    (viewport.width - GRID_COLUMN_GAP * (columns - 1)) / columns;
  const rowCount = Math.ceil(visible.length / columns);
  const startRow = Math.max(
    0,
    Math.floor(viewport.scrollTop / GRID_ROW_HEIGHT) - GRID_OVERSCAN_ROWS,
  );
  const endRow = Math.min(
    rowCount,
    Math.ceil(
      (viewport.scrollTop + viewport.height) / GRID_ROW_HEIGHT,
    ) + GRID_OVERSCAN_ROWS,
  );
  const startIndex = startRow * columns;
  const endIndex = Math.min(visible.length, endRow * columns);
  const mounted = visible.slice(startIndex, endIndex);
  const firstVisibleRow = Math.floor(viewport.scrollTop / GRID_ROW_HEIGHT);
  const lastVisibleRow = Math.ceil(
    (viewport.scrollTop + viewport.height) / GRID_ROW_HEIGHT,
  );
  const currentActiveIndex =
    visible.length > 0 ? Math.min(activeIndex, visible.length - 1) : 0;

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const positionPicker = (): void => {
      const anchor = anchorRef.current;
      const picker = pickerRef.current;
      if (!anchor || !picker) {
        return;
      }
      const anchorBounds = anchor.getBoundingClientRect();
      const pickerBounds = picker.getBoundingClientRect();
      const gap = 6;
      setPosition({
        left: Math.max(
          8,
          Math.min(
            window.innerWidth - pickerBounds.width - 8,
            anchorBounds.right - pickerBounds.width,
          ),
        ),
        top: Math.max(8, anchorBounds.top - pickerBounds.height - gap),
      });
    };
    positionPicker();
    window.addEventListener('resize', positionPicker);
    window.addEventListener('scroll', positionPicker, true);
    return () => {
      window.removeEventListener('resize', positionPicker);
      window.removeEventListener('scroll', positionPicker, true);
    };
  }, [anchorRef, open]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const grid = gridRef.current;
    if (!grid) {
      return;
    }
    const measure = (): void => {
      const bounds = grid.getBoundingClientRect();
      setViewport((current) => {
        const width = bounds.width > 0 ? bounds.width : current.width;
        const height = bounds.height > 0 ? bounds.height : current.height;
        return current.width === width && current.height === height
          ? current
          : { ...current, height, width };
      });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    window.requestAnimationFrame(() => searchRef.current?.focus());
    const closeOutside = (event: PointerEvent): void => {
      const target = event.target;
      if (
        target instanceof Node &&
        !pickerRef.current?.contains(target) &&
        !anchorRef.current?.contains(target)
      ) {
        onClose();
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('pointerdown', closeOutside, true);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [anchorRef, onClose, open]);

  useEffect(
    () => () => {
      if (pendingScrollFrame.current !== null) {
        window.cancelAnimationFrame(pendingScrollFrame.current);
      }
    },
    [],
  );

  function scrollIndexIntoView(index: number): void {
    const grid = gridRef.current;
    if (!grid) {
      return;
    }
    const row = Math.floor(index / columns);
    const top = row * GRID_ROW_HEIGHT;
    const bottom = top + GRID_CELL_MIN_WIDTH;
    if (top < grid.scrollTop) {
      grid.scrollTop = top;
    } else if (bottom > grid.scrollTop + grid.clientHeight) {
      grid.scrollTop = bottom - grid.clientHeight;
    }
  }

  function moveActive(index: number): void {
    if (visible.length === 0) {
      return;
    }
    const next = Math.min(Math.max(0, index), visible.length - 1);
    setActiveIndex(next);
    scrollIndexIntoView(next);
    window.requestAnimationFrame(() => itemRefs.current.get(next)?.focus());
  }

  function resetGrid(): void {
    const grid = gridRef.current;
    if (grid) {
      grid.scrollTop = 0;
    }
    setViewport((current) =>
      current.scrollTop === 0 ? current : { ...current, scrollTop: 0 },
    );
    setActiveIndex(0);
  }

  function handleGridScroll(event: UIEvent<HTMLDivElement>): void {
    const scrollTop = event.currentTarget.scrollTop;
    if (pendingScrollFrame.current !== null) {
      return;
    }
    pendingScrollFrame.current = window.requestAnimationFrame(() => {
      pendingScrollFrame.current = null;
      setViewport((current) =>
        current.scrollTop === scrollTop
          ? current
          : { ...current, scrollTop },
      );
    });
  }

  function handleGridKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveActive(currentActiveIndex + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveActive(currentActiveIndex - 1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(currentActiveIndex + columns);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(currentActiveIndex - columns);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveActive(visible.length - 1);
    }
  }

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      aria-label={translate('toolbar.emojiPicker')}
      className="emoji-picker"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
      ref={pickerRef}
      role="dialog"
      style={
        {
          '--emoji-picker-left': `${position.left}px`,
          '--emoji-picker-top': `${position.top}px`,
        } as CSSProperties
      }
    >
      <input
        aria-label={translate('toolbar.emojiSearch')}
        className="emoji-picker__search"
        onChange={(event) => {
          setQuery(event.target.value);
          resetGrid();
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && visible.length > 0) {
            event.preventDefault();
            moveActive(0);
          }
        }}
        placeholder={translate('toolbar.emojiSearch')}
        ref={searchRef}
        spellCheck={false}
        type="search"
        value={query}
      />
      <div
        aria-label={translate('toolbar.emojiSkinTone')}
        className="emoji-picker__tones"
        role="group"
      >
        {SKIN_TONES.map((tone) => (
          <button
            aria-pressed={skinTone === tone}
            key={tone}
            onClick={() => onSkinToneChange(tone)}
            type="button"
          >
            {glyph(TONE_SAMPLES[tone]!)}
          </button>
        ))}
      </div>
      {!normalizedQuery ? (
        <div className="emoji-picker__categories" role="tablist">
          {recent.length > 0 ? (
            <button
              aria-selected={group === -1}
              onClick={() => {
                setGroup(-1);
                resetGrid();
              }}
              role="tab"
              type="button"
            >
              {translate('toolbar.emojiRecent')}
            </button>
          ) : null}
          {groups.map((category) => (
            <button
              aria-selected={group === category.order}
              key={category.key}
              onClick={() => {
                setGroup(category.order);
                resetGrid();
              }}
              role="tab"
              type="button"
            >
              {category.message}
            </button>
          ))}
        </div>
      ) : null}
      <div
        aria-colcount={columns}
        aria-rowcount={rowCount}
        className="emoji-picker__grid"
        onKeyDown={handleGridKeyDown}
        onScroll={handleGridScroll}
        ref={gridRef}
        role="grid"
      >
        <div
          className="emoji-picker__grid-content"
          role="presentation"
          style={{ height: rowCount * GRID_ROW_HEIGHT }}
        >
          {mounted.map((entry, mountedIndex) => {
            const index = startIndex + mountedIndex;
            const displayed = entry.unicode
              ? { codepoint: entry.codepoint, unicode: entry.unicode }
              : displayedEmoji(entry.emoji, skinTone);
            const row = Math.floor(index / columns);
            const column = index % columns;
            return (
              <button
                aria-colindex={column + 1}
                aria-label={entry.emoji.label[pickerLocale]}
                aria-rowindex={row + 1}
                className="emoji-picker__emoji"
                key={`${entry.emoji.hexcode}:${displayed.unicode}`}
                onClick={() => onPick(displayed.unicode)}
                onFocus={() => setActiveIndex(index)}
                ref={(element) => {
                  if (element) {
                    itemRefs.current.set(index, element);
                  } else {
                    itemRefs.current.delete(index);
                  }
                }}
                role="gridcell"
                style={{
                  left: column * (cellWidth + GRID_COLUMN_GAP),
                  top: row * GRID_ROW_HEIGHT,
                  width: cellWidth,
                }}
                tabIndex={currentActiveIndex === index ? 0 : -1}
                type="button"
              >
                {glyph(
                  displayed.unicode,
                  displayed.codepoint,
                  row >= firstVisibleRow && row <= lastVisibleRow,
                )}
              </button>
            );
          })}
        </div>
        {visible.length === 0 ? (
          <p className="emoji-picker__empty">
            {translate('toolbar.emojiNoResults')}
          </p>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
