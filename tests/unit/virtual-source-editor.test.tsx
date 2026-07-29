// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VirtualSourceEditor } from "../../src/renderer/projects/VirtualSourceEditor";
import {
  parseImageDirective,
  serializeImageDirective,
} from "../../src/shared/markdown";
import type {
  RichSourceEditorProps,
  SourceInlineColorRequest,
} from "../../src/renderer/projects/RichSourceEditor";
import { IMAGE_INSTANCE_TRANSFER } from "../../src/renderer/projects/media-transfer";
import {
  virtualSourceChange,
  virtualSourceOffsetFromPoint,
} from "../../src/renderer/projects/virtual-source-engine";
import {
  focusSource,
  readSelection,
  readSource,
  readSourceDocumentModel,
  writeSelection,
  type SourceSelection,
} from "../../src/renderer/projects/source-caret";
import type { SourceEditTransaction } from "../../src/renderer/projects/markdown-history";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.platform;
  Reflect.deleteProperty(document, "caretPositionFromPoint");
  Reflect.deleteProperty(document, "caretRangeFromPoint");
});

function largeSource(lines = 20_000): string {
  return Array.from(
    { length: lines },
    (_, index) => `line ${index} **markdown**`,
  ).join("\n");
}

interface RenderEditorOptions {
  active?: boolean;
  checkCodeBlocks?: boolean;
  inlineColorLabel?: string;
  onColorRequest?: (request: SourceInlineColorRequest) => void;
  onContextMenuRequest?: RichSourceEditorProps["onContextMenuRequest"];
  onImageOperation?: RichSourceEditorProps["onImageOperation"];
  onScroll?: RichSourceEditorProps["onScroll"];
  onSelectionChange?: (selection: SourceSelection) => void;
  onTransaction?: (transaction: SourceEditTransaction) => void;
  projectId?: string;
  readOnly?: boolean;
  selection?: SourceSelection;
  spellCheck?: boolean;
  spellcheckScope?: string;
  wrap?: boolean;
}

function renderEditor(value: string, options: RenderEditorOptions = {}) {
  const editorRef = createRef<HTMLDivElement>();
  const onSelectionChange = vi.fn<(selection: SourceSelection) => void>(
    options.onSelectionChange,
  );
  const onTransaction = vi.fn<(transaction: SourceEditTransaction) => void>(
    options.onTransaction,
  );
  const onColorRequest = vi.fn<(request: SourceInlineColorRequest) => void>(
    options.onColorRequest,
  );
  const onContextMenuRequest = vi.fn<
    NonNullable<RichSourceEditorProps["onContextMenuRequest"]>
  >(options.onContextMenuRequest);
  const onImageOperation = vi.fn<
    NonNullable<RichSourceEditorProps["onImageOperation"]>
  >(options.onImageOperation);
  const onScroll = vi.fn<NonNullable<RichSourceEditorProps["onScroll"]>>(
    options.onScroll,
  );
  const onRedo = vi.fn();
  const onUndo = vi.fn();
  let currentOptions = options;
  const content = () => (
    <div
      className="markdown-editor"
      data-wrap={String(currentOptions.wrap ?? true)}
    >
      <VirtualSourceEditor
        active={currentOptions.active}
        ariaLabel="Editor"
        checkCodeBlocks={currentOptions.checkCodeBlocks}
        editorRef={editorRef}
        inlineColorLabel={currentOptions.inlineColorLabel}
        nodeId="note"
        onColorRequest={onColorRequest}
        onContextMenuRequest={onContextMenuRequest}
        onImageOperation={onImageOperation}
        onRedo={onRedo}
        onScroll={onScroll}
        onSelectionChange={onSelectionChange}
        onTransaction={onTransaction}
        onUndo={onUndo}
        projectId={currentOptions.projectId}
        readOnly={currentOptions.readOnly}
        selection={
          currentOptions.selection ?? { direction: "none", end: 0, start: 0 }
        }
        spellcheckScope={currentOptions.spellcheckScope}
        translate={(key) => key}
        value={value}
        spellCheck={currentOptions.spellCheck}
      />
    </div>
  );
  const view = render(content());
  return {
    editorRef,
    onColorRequest,
    onContextMenuRequest,
    onImageOperation,
    onRedo,
    onScroll,
    onSelectionChange,
    onTransaction,
    onUndo,
    rerender: (next: Partial<RenderEditorOptions>) => {
      currentOptions = { ...currentOptions, ...next };
      view.rerender(content());
    },
    view,
  };
}

async function waitForProxyEvents(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  });
}

describe("virtual source editor", () => {
  it("keeps a 20k-line document in the model while bounding rendered rows", () => {
    const source = largeSource();
    const { editorRef } = renderEditor(source);
    const root = editorRef.current!;

    expect(
      root.querySelectorAll(".virtual-source__rows > .md-line").length,
    ).toBeLessThanOrEqual(150);
    expect(
      root.querySelectorAll(".virtual-source__rows > .md-line").length,
    ).toBeGreaterThan(0);
    expect(readSource(root)).toBe(source);
    expect(
      root.querySelector<HTMLTextAreaElement>(".virtual-source__proxy")?.value,
    ).not.toBe(source);
    const proxy = root.querySelector<HTMLTextAreaElement>(
      ".virtual-source__proxy",
    )!;
    expect(screen.getAllByRole("textbox", { name: "Editor" })).toEqual([proxy]);
    expect(proxy.getAttribute("aria-hidden")).toBeNull();
    expect(proxy.tabIndex).toBe(0);
    act(() => focusSource(root));
    expect(root.ownerDocument.activeElement).toBe(proxy);
  });

  it("falls back to the native emoji when a virtual Twemoji asset fails", () => {
    const { editorRef } = renderEditor("hello 😀");
    const root = editorRef.current!;
    const wrapper = root.querySelector<HTMLElement>(".twemoji")!;
    const image = wrapper.querySelector<HTMLImageElement>(".twemoji__glyph")!;

    fireEvent.error(image);

    expect(wrapper.classList.contains("twemoji--fallback")).toBe(true);
    expect(wrapper.querySelector(".twemoji__glyph")).toBeNull();
  });

  it("exposes model selection through the source caret adapter", async () => {
    const source = largeSource();
    const { editorRef } = renderEditor(source);
    const root = editorRef.current!;
    const target = source.indexOf("line 9000");

    act(() => writeSelection(root, target, target + 9));
    await waitForProxyEvents();

    expect(readSelection(root)).toEqual({
      direction: "forward",
      end: target + 9,
      start: target,
    });
    expect(root.scrollTop).toBeGreaterThan(0);
    expect(
      root.querySelectorAll(".virtual-source__rows > .md-line").length,
    ).toBeLessThanOrEqual(150);
  });

  it("keeps programmatic multi-line selection and synchronizes the proxy first", async () => {
    const source = "x\n01234567890123456789\nlast";
    const { editorRef, onSelectionChange } = renderEditor(source);
    const root = editorRef.current!;
    const proxy = root.querySelector<HTMLTextAreaElement>(
      ".virtual-source__proxy",
    )!;
    const longLineOffset = source.indexOf("0123") + 18;

    act(() => writeSelection(root, longLineOffset));
    await waitForProxyEvents();

    expect(proxy.value).toBe("01234567890123456789");
    expect(proxy.selectionStart).toBe(18);
    expect(proxy.selectionEnd).toBe(18);

    act(() =>
      writeSelection(root, {
        direction: "forward",
        end: source.length,
        start: 0,
      }),
    );
    await waitForProxyEvents();

    expect(readSelection(root)).toEqual({
      direction: "forward",
      end: source.length,
      start: 0,
    });
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("derives an exact localized change without scanning unrelated lines", () => {
    const source = largeSource();
    const after = `X${source}`;
    expect(
      virtualSourceChange(
        source,
        after,
        { direction: "none", end: 0, start: 0 },
        { direction: "none", end: 1, start: 1 },
      ),
    ).toEqual({
      from: 0,
      insert: "X",
      to: 0,
    });

    const boundaryBefore = "first\nsecond\nthird";
    const boundaryAfter = "firstsecond\nthird";
    expect(
      virtualSourceChange(
        boundaryBefore,
        boundaryAfter,
        { direction: "none", end: 6, start: 6 },
        { direction: "none", end: 5, start: 5 },
      ),
    ).toEqual({
      from: 5,
      insert: "",
      to: 6,
    });

    expect(
      virtualSourceChange(
        "\nsecond",
        "x\nsecond",
        { direction: "none", end: 0, start: 0 },
        { direction: "none", end: 1, start: 1 },
      ),
    ).toEqual({
      from: 0,
      insert: "x",
      to: 0,
    });
  });

  it("commits typing with an exact change and navigates across row boundaries", async () => {
    const source = largeSource();
    const { editorRef, onSelectionChange, onTransaction } =
      renderEditor(source);
    const root = editorRef.current!;
    const proxy = root.querySelector<HTMLTextAreaElement>(
      ".virtual-source__proxy",
    )!;
    const lineStart = source.indexOf("line 100 ");

    act(() => writeSelection(root, lineStart));
    await waitForProxyEvents();
    fireEvent.keyDown(proxy, { key: "ArrowLeft" });
    expect(readSelection(root)).toEqual({
      direction: "none",
      end: lineStart - 1,
      start: lineStart - 1,
    });

    act(() => writeSelection(root, lineStart));
    await waitForProxyEvents();
    onSelectionChange.mockClear();
    fireEvent.paste(proxy, {
      clipboardData: {
        getData: (format: string) => (format === "text/plain" ? "X" : ""),
      },
    });
    expect(onSelectionChange).not.toHaveBeenCalled();
    const transaction = onTransaction.mock.calls.at(-1)?.[0];
    expect(transaction?.change).toEqual({
      from: lineStart,
      insert: "X",
      to: lineStart,
    });
    expect(readSource(root).slice(lineStart, lineStart + 2)).toBe("Xl");

    fireEvent.keyDown(proxy, { ctrlKey: true, key: "a" });
    await waitForProxyEvents();
    expect(readSelection(root)).toEqual({
      direction: "forward",
      end: source.length + 1,
      start: 0,
    });
  });

  it("commits native input when the environment omits beforeinput", () => {
    const { editorRef, onTransaction } = renderEditor("abc", {
      selection: { direction: "none", end: 3, start: 3 },
    });
    const root = editorRef.current!;
    const proxy = root.querySelector<HTMLTextAreaElement>(
      ".virtual-source__proxy",
    )!;
    const untypedBeforeInput = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "x",
    });
    fireEvent(proxy, untypedBeforeInput);
    expect(untypedBeforeInput.defaultPrevented).toBe(false);

    fireEvent.input(proxy, {
      data: "x",
      inputType: "insertText",
      target: { value: "abcx" },
    });

    expect(onTransaction.mock.calls.at(-1)?.[0]).toMatchObject({
      after: {
        content: "abcx",
        selection: { direction: "none", end: 4, start: 4 },
      },
      change: { from: 3, insert: "x", to: 3 },
      inputType: "insertText",
    });
    expect(readSource(root)).toBe("abcx");
  });

  it("keeps rapid native beforeinput transactions in order", () => {
    const { editorRef, onTransaction } = renderEditor("abc", {
      selection: { direction: "none", end: 3, start: 3 },
    });
    const root = editorRef.current!;
    const proxy = root.querySelector<HTMLTextAreaElement>(
      ".virtual-source__proxy",
    )!;

    for (const character of " edited") {
      const beforeInput = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        data: character,
        inputType: "insertText",
      });
      fireEvent(proxy, beforeInput);
      expect(beforeInput.defaultPrevented).toBe(true);
    }

    expect(onTransaction).toHaveBeenCalledTimes(7);
    expect(readSource(root)).toBe("abc edited");
    expect(proxy.value).toBe("abc edited");
    expect(proxy.selectionStart).toBe(10);
    expect(proxy.selectionEnd).toBe(10);
  });

  it("copies, cuts and pastes multi-line selections through the proxy", async () => {
    const source = "one\ntwo\nthree";
    const { editorRef, onTransaction } = renderEditor(source);
    const root = editorRef.current!;
    const proxy = root.querySelector<HTMLTextAreaElement>(
      ".virtual-source__proxy",
    )!;
    const setData = vi.fn();

    act(() => writeSelection(root, 1, 8));
    await waitForProxyEvents();
    fireEvent.copy(proxy, { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith("text/plain", "ne\ntwo\n");

    fireEvent.cut(proxy, { clipboardData: { setData } });
    expect(onTransaction.mock.calls.at(-1)?.[0]).toMatchObject({
      after: {
        content: "othree",
        selection: { direction: "none", end: 1, start: 1 },
      },
      change: { from: 1, insert: "", to: 8 },
      inputType: "deleteByCut",
    });

    fireEvent.paste(proxy, {
      clipboardData: {
        getData: (format: string) =>
          format === "text/plain" ? "alpha\r\nbeta" : "",
      },
    });
    expect(onTransaction.mock.calls.at(-1)?.[0]).toMatchObject({
      after: {
        content: "oalpha\nbetathree",
        selection: { direction: "none", end: 11, start: 11 },
      },
      change: { from: 1, insert: "alpha\nbeta", to: 1 },
      inputType: "insertFromPaste",
    });
  });

  it("gives a pasted image instance a fresh identity", () => {
    const image =
      '::image[Lua]{v=2 instance=223e4567-e89b-42d3-a456-426614174001 asset=123e4567-e89b-42d3-a456-426614174000 path="Media/Lua.png" mode=block align=center width=320 height=180 min=96 max=1200 margin=12 ratioLock=true positionLock=false caption=""}';
    const freshInstance = "323e4567-e89b-42d3-a456-426614174002";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(freshInstance);
    const { editorRef, onTransaction } = renderEditor("");
    const proxy = editorRef.current!.querySelector<HTMLTextAreaElement>(
      ".virtual-source__proxy",
    )!;

    fireEvent.paste(proxy, {
      clipboardData: {
        getData: (format: string) =>
          format === IMAGE_INSTANCE_TRANSFER ? image : "",
      },
    });

    const inserted = onTransaction.mock.calls.at(-1)?.[0].after.content ?? "";
    expect(parseImageDirective(inserted)).toEqual({
      ...parseImageDirective(image),
      instanceId: freshInstance,
    });
    expect(inserted).toBe(
      serializeImageDirective(parseImageDirective(inserted)!),
    );
  });

  it("routes undo and redo shortcuts without mutating the virtual model", () => {
    const { editorRef, onRedo, onUndo } = renderEditor("unchanged");
    const proxy = editorRef.current!.querySelector<HTMLTextAreaElement>(
      ".virtual-source__proxy",
    )!;

    fireEvent.keyDown(proxy, { ctrlKey: true, key: "z" });
    fireEvent.keyDown(proxy, {
      ctrlKey: true,
      key: "z",
      shiftKey: true,
    });
    fireEvent.keyDown(proxy, { ctrlKey: true, key: "y" });

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(2);
    expect(readSource(editorRef.current!)).toBe("unchanged");
  });

  it("handles line, page and document edge navigation in model offsets", async () => {
    const source = "abcde\n012345\nuvwxyz\nlastline\nfifth";
    const { editorRef } = renderEditor(source);
    const root = editorRef.current!;
    const proxy = root.querySelector<HTMLTextAreaElement>(
      ".virtual-source__proxy",
    )!;
    Object.defineProperty(root, "clientHeight", {
      configurable: true,
      value: 44,
    });

    act(() => writeSelection(root, 9));
    await waitForProxyEvents();
    fireEvent.keyDown(proxy, { key: "Home" });
    expect(readSelection(root).start).toBe(6);
    fireEvent.keyDown(proxy, { key: "End" });
    expect(readSelection(root).start).toBe(12);

    act(() => writeSelection(root, 9));
    await waitForProxyEvents();
    fireEvent.keyDown(proxy, { key: "PageDown" });
    expect(readSelection(root).start).toBe(23);
    fireEvent.keyDown(proxy, { key: "PageUp" });
    expect(readSelection(root).start).toBe(9);

    fireEvent.keyDown(proxy, { ctrlKey: true, key: "Home" });
    expect(readSelection(root).start).toBe(0);
    fireEvent.keyDown(proxy, { ctrlKey: true, key: "End" });
    expect(readSelection(root).start).toBe(source.length);
  });

  it("preserves the desired column across a shorter line", async () => {
    const source = "abcdefghij\nx\nabcdefghij";
    const { editorRef } = renderEditor(source);
    const root = editorRef.current!;
    const proxy = root.querySelector<HTMLTextAreaElement>(
      ".virtual-source__proxy",
    )!;

    act(() => writeSelection(root, 8));
    await waitForProxyEvents();
    fireEvent.keyDown(proxy, { key: "ArrowDown" });
    expect(readSelection(root).start).toBe(12);
    fireEvent.keyDown(proxy, { key: "ArrowDown" });
    expect(readSelection(root).start).toBe(21);
  });

  it("inserts dropped multi-line text at the native virtual caret", () => {
    const source = "one\ntwo";
    const { editorRef, onTransaction } = renderEditor(source);
    const root = editorRef.current!;
    const line = root.querySelector<HTMLElement>(
      '[data-line="2"] .md-line__content',
    )!;
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    const text = walker.nextNode()!;
    Object.defineProperty(document, "caretPositionFromPoint", {
      configurable: true,
      value: () => ({ offset: 1, offsetNode: text }),
    });

    fireEvent.drop(root, {
      clientX: 120,
      clientY: 30,
      dataTransfer: {
        files: [],
        getData: (format: string) => (format === "text/plain" ? "X\r\nY" : ""),
        types: ["text/plain"],
      },
    });

    expect(onTransaction.mock.calls.at(-1)?.[0]).toMatchObject({
      after: {
        content: "one\ntX\nYwo",
        selection: { direction: "none", end: 8, start: 8 },
      },
      change: { from: 5, insert: "X\nY", to: 5 },
      inputType: "insertFromDrop",
    });
  });

  it("navigates words and document edges with platform modifiers and Shift", async () => {
    const source = "one two\nthree four";
    const { editorRef } = renderEditor(source);
    const root = editorRef.current!;
    const proxy = root.querySelector<HTMLTextAreaElement>(
      ".virtual-source__proxy",
    )!;
    const secondLine = source.indexOf("three");

    document.documentElement.dataset.platform = "win32";
    act(() => writeSelection(root, secondLine));
    await waitForProxyEvents();
    fireEvent.keyDown(proxy, { ctrlKey: true, key: "ArrowLeft" });
    expect(readSelection(root)).toEqual({
      direction: "none",
      end: source.indexOf("two"),
      start: source.indexOf("two"),
    });
    fireEvent.keyDown(proxy, {
      ctrlKey: true,
      key: "ArrowLeft",
      shiftKey: true,
    });
    expect(readSelection(root)).toEqual({
      direction: "backward",
      end: source.indexOf("two"),
      start: 0,
    });

    document.documentElement.dataset.platform = "darwin";
    act(() => writeSelection(root, secondLine));
    await waitForProxyEvents();
    fireEvent.keyDown(proxy, { altKey: true, key: "ArrowRight" });
    expect(readSelection(root)).toEqual({
      direction: "none",
      end: secondLine + "three".length,
      start: secondLine + "three".length,
    });
    fireEvent.keyDown(proxy, {
      key: "ArrowDown",
      metaKey: true,
      shiftKey: true,
    });
    expect(readSelection(root)).toEqual({
      direction: "forward",
      end: source.length,
      start: secondLine + "three".length,
    });
  });

  it("leaves editor commands to the active IME composition", async () => {
    const source = "one two";
    const { editorRef, onTransaction } = renderEditor(source);
    const root = editorRef.current!;
    const proxy = root.querySelector<HTMLTextAreaElement>(
      ".virtual-source__proxy",
    )!;
    act(() => writeSelection(root, 4));
    await waitForProxyEvents();

    fireEvent.compositionStart(proxy);
    fireEvent.keyDown(proxy, {
      ctrlKey: true,
      isComposing: true,
      key: "a",
    });

    expect(readSelection(root)).toEqual({
      direction: "none",
      end: 4,
      start: 4,
    });
    fireEvent.compositionEnd(proxy);
    await waitForProxyEvents();
    expect(onTransaction).not.toHaveBeenCalled();
  });

  it("replaces a multi-line selection with the committed IME text", async () => {
    const source = "one\ntwo\nthree";
    const onTransaction = vi.fn<(transaction: SourceEditTransaction) => void>();
    const { editorRef } = renderEditor(source, {
      onTransaction,
      selection: { direction: "forward", end: 7, start: 1 },
    });
    const root = editorRef.current!;
    const proxy = root.querySelector<HTMLTextAreaElement>(
      ".virtual-source__proxy",
    )!;
    await waitForProxyEvents();

    fireEvent.compositionStart(proxy);
    fireEvent.input(proxy, {
      data: "あ",
      inputType: "insertCompositionText",
      isComposing: true,
      target: { value: "twoあ" },
    });
    proxy.setSelectionRange(4, 4);
    fireEvent.compositionEnd(proxy, { data: "あ" });
    await waitForProxyEvents();

    expect(onTransaction).toHaveBeenCalledTimes(1);
    expect(onTransaction.mock.calls[0]![0].after).toEqual({
      content: "oあ\nthree",
      selection: { direction: "none", end: 2, start: 2 },
    });
    expect(readSource(root)).toBe("oあ\nthree");
  });

  it("discards a pending IME commit when the note becomes read-only", () => {
    vi.useFakeTimers();
    const source = "one two";
    const { editorRef, onTransaction, rerender } = renderEditor(source);
    const root = editorRef.current!;
    const proxy = root.querySelector<HTMLTextAreaElement>(
      ".virtual-source__proxy",
    )!;

    fireEvent.compositionStart(proxy);
    fireEvent.input(proxy, {
      data: "あ",
      inputType: "insertCompositionText",
      isComposing: true,
      target: { value: "oneあ two" },
    });
    fireEvent.compositionEnd(proxy, { data: "あ" });
    rerender({ readOnly: true });
    act(() => vi.runOnlyPendingTimers());

    expect(onTransaction).not.toHaveBeenCalled();
    expect(readSource(root)).toBe(source);
    expect(proxy.value).toBe(source);
  });

  it("shrinks the horizontal extent when an edited line held the maximum", async () => {
    const source = "1234567890\nx";
    const { editorRef } = renderEditor(source, { wrap: false });
    const root = editorRef.current!;
    const proxy = root.querySelector<HTMLTextAreaElement>(
      ".virtual-source__proxy",
    )!;
    const spacer = root.querySelector<HTMLElement>(".virtual-source__spacer")!;
    expect(spacer.style.minWidth).toContain("18ch");

    act(() => writeSelection(root, 0, 10));
    await waitForProxyEvents();
    fireEvent.paste(proxy, {
      clipboardData: {
        getData: (format: string) => (format === "text/plain" ? "z" : ""),
      },
    });

    expect(spacer.style.minWidth).toContain("9ch");
  });

  it("moves the viewport without materializing intervening lines", async () => {
    const source = largeSource();
    const { editorRef } = renderEditor(source);
    const root = editorRef.current!;
    Object.defineProperty(root, "clientHeight", {
      configurable: true,
      value: 660,
    });
    root.scrollTop = 10_000 * 22;

    fireEvent.scroll(root);
    await act(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });

    const rows = Array.from(
      root.querySelectorAll<HTMLElement>(".virtual-source__rows > .md-line"),
    );
    expect(rows.length).toBeLessThanOrEqual(150);
    expect(Number(rows[0]?.dataset.line)).toBeGreaterThan(9_900);
    expect(Number(rows.at(-1)?.dataset.line)).toBeLessThan(10_100);
  });

  it("uses variable line tops for wrapped content, reveal and the input proxy", async () => {
    const source = [
      "x".repeat(220),
      ...Array.from({ length: 2_000 }, (_, index) => `line ${index}`),
    ].join("\n");
    const { editorRef } = renderEditor(source);
    const root = editorRef.current!;
    Object.defineProperty(root, "clientHeight", {
      configurable: true,
      value: 440,
    });
    const target = source.indexOf("line 999");

    act(() => writeSelection(root, target));
    await waitForProxyEvents();

    const row = root.querySelector<HTMLElement>('[data-line="1001"]')!;
    const proxy = root.querySelector<HTMLTextAreaElement>(
      ".virtual-source__proxy",
    )!;
    expect(row).not.toBeNull();
    expect(proxy.style.transform).toBe(row.style.transform);
    expect(Number.parseFloat(row.style.transform.slice(11))).toBeGreaterThan(
      1_000 * 22,
    );
    expect(proxy.wrap).toBe("soft");
    expect(root.scrollTop).toBeGreaterThan(0);
  });

  it("hydrates visible project images and keeps image interaction on the virtual model", async () => {
    const image =
      '::image[Lua]{v=2 instance=223e4567-e89b-42d3-a456-426614174001 asset=123e4567-e89b-42d3-a456-426614174000 path="Media/Lua.png" mode=wrap align=right width=320 height=180 min=96 max=1200 margin=12 ratioLock=true positionLock=false caption=""}';
    const projectId = "323e4567-e89b-42d3-a456-426614174002";
    const { editorRef, onSelectionChange } = renderEditor(`${image}\nafter`, {
      projectId,
      readOnly: true,
    });
    const root = editorRef.current!;
    const host = root.querySelector<HTMLElement>(".md-source-image__host")!;
    const renderedImage = host.querySelector<HTMLImageElement>("img")!;
    const proxy = root.querySelector<HTMLTextAreaElement>(
      ".virtual-source__proxy",
    )!;
    await waitForProxyEvents();

    expect(renderedImage.src).toBe(
      `flyoff-media://asset/${projectId}/123e4567-e89b-42d3-a456-426614174000`,
    );
    const imageRow = root.querySelector<HTMLElement>('[data-line="1"]')!;
    expect(imageRow.style.height).toBe("204px");
    expect(imageRow.dataset.virtualWrapImage).toBe("right");
    expect(imageRow.style.getPropertyValue("--virtual-wrap-top")).toBe("0px");
    const following = root.querySelector<HTMLElement>('[data-line="2"]')!;
    const intrusion = following.querySelector<HTMLElement>(
      ".virtual-source__float-intrusion",
    )!;
    expect(following.style.transform).toBe("translateY(22px)");
    expect(intrusion.dataset.virtualFloatAlign).toBe("right");
    expect(intrusion.hasAttribute("data-md-decoration")).toBe(true);
    expect(intrusion.style.getPropertyValue("--virtual-float-height")).toBe(
      "182px",
    );
    expect(intrusion.style.getPropertyValue("--virtual-float-width")).toBe(
      "332px",
    );
    expect(readSource(root)).toBe(`${image}\nafter`);

    fireEvent.pointerDown(host, { button: 0 });

    expect(root.ownerDocument.activeElement).toBe(proxy);
    expect(readSelection(root)).toEqual({
      direction: "none",
      end: 0,
      start: 0,
    });
    expect(onSelectionChange).toHaveBeenCalledWith({
      direction: "none",
      end: 0,
      start: 0,
    });
  });

  it("renders delayed alternating wraps at layout-owned positions", () => {
    const base =
      '::image[Lua]{v=2 instance=223e4567-e89b-42d3-a456-426614174001 asset=123e4567-e89b-42d3-a456-426614174000 path="Media/Lua.png" mode=wrap align=left width=500 height=100 min=96 max=1200 margin=10 ratioLock=true positionLock=false caption=""}';
    const delayed = base.replace("align=left", "align=right");
    const third = base.replace("width=500", "width=270");
    const source = `${base}\n${delayed}\n${third}\nafter`;
    const { editorRef } = renderEditor(source, { readOnly: true });
    const root = editorRef.current!;
    const firstRow = root.querySelector<HTMLElement>('[data-line="1"]')!;
    const delayedRow = root.querySelector<HTMLElement>('[data-line="2"]')!;
    const thirdRow = root.querySelector<HTMLElement>('[data-line="3"]')!;
    expect(delayedRow.querySelector(".md-source-image--wrap")).not.toBeNull();

    expect(firstRow.dataset.virtualWrapImage).toBe("left");
    expect(firstRow.style.getPropertyValue("--virtual-wrap-top")).toBe("0px");
    expect(delayedRow.dataset.virtualWrapImage).toBe("right");
    expect(delayedRow.style.getPropertyValue("--virtual-wrap-top")).toBe(
      "98px",
    );
    expect(thirdRow.dataset.virtualWrapImage).toBe("left");
    expect(thirdRow.style.getPropertyValue("--virtual-wrap-top")).toBe("76px");
    expect(delayedRow.style.height).toBe("218px");
    expect(thirdRow.style.height).toBe("196px");
    expect(
      root.querySelectorAll('[data-line="4"] .virtual-source__float-intrusion'),
    ).toHaveLength(3);
    const intrusion = root.querySelector<HTMLElement>(
      '[data-line="4"] .virtual-source__float-intrusion',
    )!;
    intrusion.append("ignored decoration");
    Object.defineProperty(document, "caretPositionFromPoint", {
      configurable: true,
      value: () => ({
        offset: 7,
        offsetNode: intrusion.firstChild!,
      }),
    });
    expect(
      virtualSourceOffsetFromPoint(
        root,
        readSourceDocumentModel(root)!,
        100,
        60,
        22,
      ),
    ).toBe(source.lastIndexOf("after"));
  });

  it("ignores decoration text when resolving a caret around a visible image", () => {
    const image =
      '::image[Lua]{v=2 instance=223e4567-e89b-42d3-a456-426614174001 asset=123e4567-e89b-42d3-a456-426614174000 path="Media/Lua.png" mode=inline align=left width=320 height=180 min=96 max=1200 margin=12 ratioLock=true positionLock=false caption=""}';
    const { editorRef } = renderEditor(image);
    const root = editorRef.current!;
    const host = root.querySelector<HTMLElement>(".md-source-image__host")!;
    const syntax = root.querySelector<HTMLElement>(".md-source-image__syntax")!;
    const syntaxText = syntax.firstChild!;
    host.append("decoration text");
    const caretPositionFromPoint = vi.fn();
    Object.defineProperty(root.ownerDocument, "caretPositionFromPoint", {
      configurable: true,
      value: caretPositionFromPoint,
    });
    const model = readSourceDocumentModel(root)!;

    caretPositionFromPoint.mockReturnValue({
      offset: 0,
      offsetNode: syntaxText,
    });
    expect(virtualSourceOffsetFromPoint(root, model, 0, 0, 22)).toBe(0);

    caretPositionFromPoint.mockReturnValue({
      offset: image.length,
      offsetNode: syntaxText,
    });
    expect(virtualSourceOffsetFromPoint(root, model, 0, 0, 22)).toBe(
      image.length,
    );

    Object.defineProperty(root.ownerDocument, "caretPositionFromPoint", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(root.ownerDocument, "caretRangeFromPoint", {
      configurable: true,
      value: () => ({
        startContainer: syntaxText,
        startOffset: image.length,
      }),
    });
    expect(virtualSourceOffsetFromPoint(root, model, 0, 0, 22)).toBe(
      image.length,
    );
  });

  it("keeps inline colour controls interactive on rendered rows", async () => {
    const source = "[John]{color=#3B82F6}";
    const { editorRef, onColorRequest } = renderEditor(source, {
      inlineColorLabel: "Change colour",
    });
    await waitForProxyEvents();
    const trigger = editorRef.current!.querySelector<HTMLButtonElement>(
      ".md-inline-color-trigger",
    )!;

    expect(trigger.getAttribute("aria-label")).toBe("Change colour");
    expect(trigger.ariaDisabled).toBe("false");
    fireEvent.click(trigger);

    expect(onColorRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        color: "#3B82F6",
        kind: "text",
      }),
    );
  });

  it("pauses native spellcheck while its pane is inactive", () => {
    const { editorRef } = renderEditor("mistkae", {
      active: false,
      spellCheck: true,
    });
    const proxy = editorRef.current!.querySelector<HTMLTextAreaElement>(
      ".virtual-source__proxy",
    )!;
    expect(proxy.getAttribute("spellcheck")).toBe("false");
  });

  it("pauses custom spellcheck while inactive and refreshes its dictionary cache", async () => {
    vi.useFakeTimers();
    const checkSpellcheckWords = vi
      .fn()
      .mockImplementation(async ({ words }: { words: readonly string[] }) =>
        words.filter((word) => word === "mistkae"),
      );
    vi.stubGlobal("flyoff", { checkSpellcheckWords });
    const { editorRef, rerender } = renderEditor("mistkae is here", {
      active: false,
      spellCheck: true,
      spellcheckScope: "pt-BR",
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(checkSpellcheckWords).not.toHaveBeenCalled();

    rerender({ active: true });
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(checkSpellcheckWords).toHaveBeenCalledTimes(1);
    expect(
      editorRef.current!.querySelector(".md-spelling-error")?.textContent,
    ).toBe("mistkae");

    act(() =>
      window.dispatchEvent(new Event("flyoff:personal-dictionary-changed")),
    );
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(checkSpellcheckWords).toHaveBeenCalledTimes(2);

    rerender({ active: false });
    act(() =>
      window.dispatchEvent(new Event("flyoff:personal-dictionary-changed")),
    );
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(checkSpellcheckWords).toHaveBeenCalledTimes(2);
  });

  it("derives task and link context by point when virtual rows ignore pointer hits", () => {
    const source = "- [x] done\n[site](https://example.com)";
    const { editorRef, onContextMenuRequest } = renderEditor(source);
    const root = editorRef.current!;
    const taskText = Array.from(
      root.querySelector(".md-tok-task")!.childNodes,
    ).find((node) => node.textContent?.includes("[x]"))!;
    const linkWalker = document.createTreeWalker(
      root.querySelector(".md-source-link")!,
      NodeFilter.SHOW_TEXT,
    );
    let linkText: Node | undefined;
    while (linkWalker.nextNode()) {
      if (linkWalker.currentNode.textContent === "site") {
        linkText = linkWalker.currentNode;
        break;
      }
    }
    let point = { offset: 2, offsetNode: taskText };
    Object.defineProperty(document, "caretPositionFromPoint", {
      configurable: true,
      value: () => point,
    });

    fireEvent.contextMenu(root, { clientX: 100, clientY: 20 });
    expect(onContextMenuRequest.mock.calls.at(-1)?.[0].task).toEqual({
      checked: true,
      markerOffset: 3,
    });

    point = { offset: 2, offsetNode: linkText! };
    fireEvent.contextMenu(root, { clientX: 100, clientY: 40 });
    expect(onContextMenuRequest.mock.calls.at(-1)?.[0].link).toMatchObject({
      syntax: "markdown",
      url: "https://example.com",
    });
  });

  it("coalesces scroll publication while keeping the final settled value", () => {
    const { editorRef, onScroll } = renderEditor(largeSource());
    const root = editorRef.current!;
    let nextFrame = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      nextFrame += 1;
      frames.set(nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (frame: number) => {
      frames.delete(frame);
    });

    for (const scrollTop of [100, 200, 300]) {
      root.scrollTop = scrollTop;
      fireEvent.scroll(root);
    }
    expect(onScroll).not.toHaveBeenCalled();
    act(() => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) {
        callback(performance.now());
      }
    });
    expect(onScroll).toHaveBeenCalledTimes(1);
    expect(onScroll).toHaveBeenLastCalledWith(300, false);

    fireEvent(root, new Event("scrollend", { bubbles: true }));
    expect(onScroll).toHaveBeenLastCalledWith(300, true);
  });

  it("auto-scrolls a pointer selection beyond the visible window", () => {
    const { editorRef } = renderEditor(largeSource());
    const root = editorRef.current!;
    Object.defineProperty(root, "clientHeight", {
      configurable: true,
      value: 100,
    });
    root.getBoundingClientRect = () =>
      ({
        bottom: 100,
        height: 100,
        left: 0,
        right: 600,
        top: 0,
        width: 600,
        x: 0,
        y: 0,
        toJSON: () => undefined,
      }) as DOMRect;
    let nextFrame = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      nextFrame += 1;
      frames.set(nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (frame: number) => {
      frames.delete(frame);
    });

    fireEvent.pointerDown(root, {
      button: 0,
      clientX: 120,
      clientY: 50,
      detail: 1,
      pointerId: 17,
    });
    const before = readSelection(root);
    fireEvent.pointerMove(window, {
      buttons: 1,
      clientX: 120,
      clientY: 150,
      pointerId: 17,
    });
    act(() => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) {
        callback(performance.now());
      }
    });

    expect(root.scrollTop).toBeGreaterThan(0);
    expect(readSelection(root).end).toBeGreaterThan(before.end);
    fireEvent.pointerUp(window, { pointerId: 17 });
  });
});
