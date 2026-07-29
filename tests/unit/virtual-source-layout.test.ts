import { describe, expect, it } from "vitest";

import {
  createSourceDocumentModel,
  updateSourceDocumentModel,
} from "../../src/renderer/projects/source-document-model";
import {
  VirtualSourceLayout,
  type VirtualSourceLayoutConfig,
} from "../../src/renderer/projects/virtual-source-layout";

const config: VirtualSourceLayoutConfig = {
  characterWidth: 10,
  contentWidth: 400,
  lineHeight: 20,
  tabSize: 2,
  wrap: true,
};

const image =
  '::image[Lua]{v=2 instance=223e4567-e89b-42d3-a456-426614174001 asset=123e4567-e89b-42d3-a456-426614174000 path="Media/Lua.png" mode=wrap align=right width=320 height=180 min=96 max=1200 margin=12 ratioLock=true positionLock=false caption=""}';

function wrappedImage(
  align: "left" | "right",
  width: number,
  height: number,
  margin: number,
): string {
  return image
    .replace("align=right", `align=${align}`)
    .replace("width=320", `width=${width}`)
    .replace("height=180", `height=${height}`)
    .replace("margin=12", `margin=${margin}`);
}

describe("virtual source layout", () => {
  it("separates a wrapped image visual height from document flow", () => {
    const model = createSourceDocumentModel(
      `short\n${"x".repeat(81)}\n${image}\nafter`,
    );
    const layout = new VirtualSourceLayout(model, config);

    expect(layout.heightAt(0)).toBe(20);
    expect(layout.heightAt(1)).toBe(60);
    expect(layout.heightAt(2)).toBe(20);
    expect(layout.visualHeightAt(2)).toBe(204);
    expect(layout.lineTop(3)).toBe(100);
    expect(layout.floatIntrusionsAt(3)).toEqual([
      { align: "right", height: 184, top: 0, width: 332 },
    ]);
    expect(layout.totalHeight).toBe(284);
    expect(layout.lineAtOffset(99)).toBe(2);
    expect(layout.lineAtOffset(100)).toBe(3);
    expect(layout.lineAtOffset(283)).toBe(3);
    expect(layout.hasMedia).toBe(true);

    expect(layout.setMeasuredHeight(2, 20)).toBe(false);
    expect(layout.visualHeightAt(2)).toBe(204);
    expect(layout.setMeasuredHeight(1, 42)).toBe(true);
    expect(layout.lineTop(2)).toBe(62);
    expect(layout.lineTop(3)).toBe(82);
    expect(layout.totalHeight).toBe(266);
  });

  it("lets the first heading wrap and clears subsequent headings below floats", () => {
    const layout = new VirtualSourceLayout(
      createSourceDocumentModel(`${image}\n# direct\n# clear`),
      config,
    );

    expect(layout.lineTop(1)).toBe(20);
    expect(layout.heightAt(1)).toBe(40);
    expect(layout.floatIntrusionsAt(1)).toHaveLength(1);
    expect(layout.lineTop(2)).toBe(204);
    expect(layout.floatIntrusionsAt(2)).toEqual([]);
    expect(layout.totalHeight).toBe(224);
  });

  it("tracks simultaneous left and right float occupancy per covered line", () => {
    const left = wrappedImage("left", 140, 100, 10);
    const right = wrappedImage("right", 140, 100, 10);
    const layout = new VirtualSourceLayout(
      createSourceDocumentModel(`${left}\n${right}\n${"x".repeat(25)}\nafter`),
      config,
    );

    expect(layout.lineTop(0)).toBe(0);
    expect(layout.lineTop(1)).toBe(20);
    expect(layout.lineTop(2)).toBe(40);
    expect(layout.heightAt(2)).toBe(60);
    expect(layout.floatIntrusionsAt(2)).toEqual([
      { align: "left", height: 80, top: 0, width: 150 },
      { align: "right", height: 100, top: 0, width: 150 },
    ]);
    expect(layout.lineTop(3)).toBe(100);
    expect(layout.totalHeight).toBe(140);
  });

  it("defers same-side floats and exposes their future intrusion", () => {
    const first = wrappedImage("left", 240, 100, 10);
    const second = wrappedImage("left", 240, 100, 10);
    const layout = new VirtualSourceLayout(
      createSourceDocumentModel(`${first}\n${second}\nafter`),
      config,
    );

    expect(layout.visualHeightAt(0)).toBe(120);
    expect(layout.visualHeightAt(1)).toBe(220);
    expect(layout.floatIntrusionsAt(2)).toEqual([
      { align: "left", height: 80, top: 0, width: 250 },
      { align: "left", height: 200, top: 80, width: 250 },
    ]);
    expect(layout.totalHeight).toBe(240);
  });

  it("places a third float beside a delayed opposite float without CSS collision inference", () => {
    const first = wrappedImage("left", 240, 100, 10);
    const delayed = wrappedImage("right", 240, 100, 10);
    const third = wrappedImage("left", 130, 100, 10);
    const layout = new VirtualSourceLayout(
      createSourceDocumentModel(`${first}\n${delayed}\n${third}\nafter`),
      config,
    );

    expect(layout.wrapPlacementAt(0)).toEqual({
      align: "left",
      inset: 0,
      top: 0,
    });
    expect(layout.wrapPlacementAt(1)).toEqual({
      align: "right",
      inset: 0,
      top: 100,
    });
    expect(layout.wrapPlacementAt(2)).toEqual({
      align: "left",
      inset: 0,
      top: 80,
    });
    expect(layout.visualHeightAt(1)).toBe(220);
    expect(layout.visualHeightAt(2)).toBe(200);
    expect(layout.floatIntrusionsAt(3)).toEqual([
      { align: "left", height: 60, top: 0, width: 250 },
      { align: "right", height: 180, top: 60, width: 250 },
      { align: "left", height: 180, top: 60, width: 140 },
    ]);
    expect(layout.totalHeight).toBe(240);
  });

  it("extends the scroll range through a wrapped image at EOF", () => {
    const layout = new VirtualSourceLayout(
      createSourceDocumentModel(image),
      config,
    );

    expect(layout.heightAt(0)).toBe(20);
    expect(layout.visualHeightAt(0)).toBe(204);
    expect(layout.lineTop(1)).toBe(204);
    expect(layout.totalHeight).toBe(204);
    expect(layout.lineAtOffset(203)).toBe(0);
  });

  it("inserts a line locally and preserves measured heights in stable chunks", () => {
    const source = Array.from(
      { length: 20_000 },
      (_, index) => `line ${index}`,
    ).join("\n");
    const previous = createSourceDocumentModel(source);
    const layout = new VirtualSourceLayout(previous, {
      ...config,
      wrap: false,
    });
    expect(layout.setMeasuredHeight(10_000, 77)).toBe(true);

    const from = previous.lineStarts[10]! + 4;
    const change = { from, insert: "\n", to: from };
    const nextSource =
      source.slice(0, from) + change.insert + source.slice(from);
    const next = updateSourceDocumentModel(previous, nextSource, change);
    layout.updateModel(previous, next, change);

    expect(layout.lineCount).toBe(20_001);
    expect(layout.heightAt(10_001)).toBe(77);
    expect(layout.lineAtOffset(layout.lineTop(10_001))).toBe(10_001);
    expect(layout.totalHeight).toBe(20_000 * 20 + 20 + 57);
  });

  it("keeps Fenwick offset lookup exact with measured no-media lines", () => {
    const model = createSourceDocumentModel(
      Array.from({ length: 2_000 }, (_, index) => `line ${index}`).join("\n"),
    );
    const layout = new VirtualSourceLayout(model, {
      ...config,
      wrap: false,
    });
    expect(
      layout.setMeasuredHeights([
        { height: 41, index: 0 },
        { height: 77, index: 255 },
        { height: 38, index: 256 },
        { height: 64, index: 1_024 },
        { height: 99, index: 1_999 },
      ]),
    ).toBe(true);

    for (let index = 0; index < layout.lineCount; index += 17) {
      const top = layout.lineTop(index);
      expect(layout.lineAtOffset(top)).toBe(index);
      expect(layout.lineAtOffset(top + layout.heightAt(index) - 0.001)).toBe(
        index,
      );
    }
    expect(layout.lineAtOffset(layout.totalHeight)).toBe(1_999);
  });

  it("removes a line across a chunk boundary while retaining the stable suffix", () => {
    const source = Array.from(
      { length: 600 },
      (_, index) => `line ${index}`,
    ).join("\n");
    const previous = createSourceDocumentModel(source);
    const layout = new VirtualSourceLayout(previous, {
      ...config,
      wrap: false,
    });
    expect(layout.setMeasuredHeight(500, 64)).toBe(true);

    const from = previous.lineStarts[255]! + previous.lines[255]!.source.length;
    const change = { from, insert: "", to: from + 1 };
    const nextSource = source.slice(0, from) + source.slice(from + 1);
    const next = updateSourceDocumentModel(previous, nextSource, change);
    layout.updateModel(previous, next, change);

    expect(layout.lineCount).toBe(599);
    expect(layout.heightAt(499)).toBe(64);
    expect(layout.lineTop(599)).toBe(layout.totalHeight);
  });
});
