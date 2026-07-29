import {
  parseImageDirective,
  parseImageDirectiveAt,
  parseMediaDirective,
  type ImageDirective,
} from "../../shared/markdown";
import type {
  SourceDocumentModel,
  SourceTextChange,
} from "./source-document-model";
import type { SourceViewportRange } from "./source-viewport";

export interface VirtualSourceLayoutConfig {
  characterWidth: number;
  contentWidth: number;
  lineHeight: number;
  tabSize: number;
  wrap: boolean;
}

interface LayoutChunk {
  heights: number[];
  media: number[];
  mediaHeights: number[];
  mediaWidths: number[];
  mediaCount: number;
  totalHeight: number;
  wrapCount: number;
}

interface ChunkBoundary {
  chunkIndex: number;
  localIndex: number;
}

const LAYOUT_CHUNK_LINES = 256;
const MEDIA_NONE = 0;
const MEDIA_FLOW = 1;
const MEDIA_WRAP_LEFT = 2;
const MEDIA_WRAP_RIGHT = 3;

interface EstimatedMedia {
  height: number;
  kind: number;
  width: number;
}

interface EstimatedLine {
  height: number;
  media: EstimatedMedia;
}

interface SourceWrap {
  align: "left" | "right";
  height: number;
  lineIndex: number;
  width: number;
}

interface PlacedWrap extends SourceWrap {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

interface FlowAdjustment {
  before: number;
  height: number;
}

export interface VirtualSourceFloatIntrusion {
  align: "left" | "right";
  height: number;
  top: number;
  width: number;
}

export interface VirtualSourceWrapPlacement {
  align: "left" | "right";
  inset: number;
  top: number;
}

function sameConfig(
  left: VirtualSourceLayoutConfig,
  right: VirtualSourceLayoutConfig,
): boolean {
  return (
    Math.abs(left.characterWidth - right.characterWidth) < 0.05 &&
    Math.abs(left.contentWidth - right.contentWidth) < 0.5 &&
    Math.abs(left.lineHeight - right.lineHeight) < 0.05 &&
    left.tabSize === right.tabSize &&
    left.wrap === right.wrap
  );
}

function displayedImageSize(
  directive: Pick<ImageDirective, "height" | "margin" | "mode" | "width">,
  contentWidth: number,
): { height: number; width: number } {
  const horizontalMargin = directive.mode === "block" ? 0 : directive.margin;
  const width = Math.min(
    directive.width,
    Math.max(1, contentWidth - horizontalMargin),
  );
  return {
    height:
      (width * directive.height) / Math.max(1, directive.width) +
      directive.margin * 2,
    width: width + horizontalMargin,
  };
}

function legacyImageMedia(
  source: string,
  contentWidth: number,
): EstimatedMedia | undefined {
  const media = parseMediaDirective(source);
  if (!media || !media.path.match(/\.(?:avif|gif|jpe?g|png|webp)$/iu)) {
    return undefined;
  }
  const wrap = media.placement.startsWith("wrap");
  const margin = wrap ? 12 : 0;
  const width = Math.min(
    Math.max(96, Math.round((media.span / 12) * 720)),
    Math.max(1, contentWidth - margin),
  );
  return {
    height: width / Math.max(0.05, media.ratio) + 24,
    kind: wrap
      ? media.placement === "wrap-right"
        ? MEDIA_WRAP_RIGHT
        : MEDIA_WRAP_LEFT
      : MEDIA_FLOW,
    width: width + margin,
  };
}

function imageMedia(source: string, contentWidth: number): EstimatedMedia {
  if (!source.includes("::")) {
    return { height: 0, kind: MEDIA_NONE, width: 0 };
  }
  const imageMarker = source.indexOf("::image[");
  const mediaMarker = source.indexOf("::media[");
  if (imageMarker === -1 && mediaMarker === -1) {
    return { height: 0, kind: MEDIA_NONE, width: 0 };
  }
  if (imageMarker === 0) {
    const full = parseImageDirective(source);
    if (full) {
      const size = displayedImageSize(full, contentWidth);
      return {
        ...size,
        kind:
          full.mode === "wrap"
            ? full.align === "right"
              ? MEDIA_WRAP_RIGHT
              : MEDIA_WRAP_LEFT
            : MEDIA_FLOW,
      };
    }
  }
  if (mediaMarker === 0) {
    const legacy = legacyImageMedia(source, contentWidth);
    if (legacy) {
      return legacy;
    }
  }
  let maximum: EstimatedMedia = {
    height: 0,
    kind: MEDIA_NONE,
    width: 0,
  };
  let offset = imageMarker;
  while (offset !== -1) {
    const parsed = parseImageDirectiveAt(source, offset);
    if (parsed?.directive.mode === "inline") {
      const size = displayedImageSize(parsed.directive, contentWidth);
      if (size.height > maximum.height) {
        maximum = { ...size, kind: MEDIA_FLOW };
      }
      offset = source.indexOf("::image[", parsed.end);
    } else {
      offset = source.indexOf("::image[", offset + 2);
    }
  }
  return maximum;
}

function visualColumns(source: string, tabSize: number): number {
  if (!source.includes("\t")) {
    return source.length;
  }
  let columns = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\t") {
      columns += tabSize - (columns % tabSize);
    } else {
      columns += 1;
    }
  }
  return columns;
}

function estimateLineHeight(
  model: SourceDocumentModel,
  index: number,
  config: VirtualSourceLayoutConfig,
): EstimatedLine {
  const line = model.lines[index];
  if (!line) {
    return {
      height: config.lineHeight,
      media: { height: 0, kind: MEDIA_NONE, width: 0 },
    };
  }
  const media = line.code
    ? { height: 0, kind: MEDIA_NONE, width: 0 }
    : imageMedia(line.source, config.contentWidth);
  const wrappedHeight = config.wrap
    ? Math.max(
        1,
        Math.ceil(
          visualColumns(line.source, config.tabSize) /
            Math.max(
              1,
              Math.floor(config.contentWidth / config.characterWidth),
            ),
        ),
      ) * config.lineHeight
    : config.lineHeight;
  return {
    height:
      media.kind === MEDIA_WRAP_LEFT || media.kind === MEDIA_WRAP_RIGHT
        ? config.lineHeight
        : Math.max(config.lineHeight, wrappedHeight, media.height),
    media,
  };
}

function createChunk(
  heights: number[],
  media: number[],
  mediaHeights: number[],
  mediaWidths: number[],
): LayoutChunk {
  let totalHeight = 0;
  let mediaCount = 0;
  let wrapCount = 0;
  for (let index = 0; index < heights.length; index += 1) {
    totalHeight += heights[index]!;
    mediaCount += Number(media[index] !== MEDIA_NONE);
    wrapCount += Number((media[index] ?? MEDIA_NONE) >= MEDIA_WRAP_LEFT);
  }
  return {
    heights,
    media,
    mediaCount,
    mediaHeights,
    mediaWidths,
    totalHeight,
    wrapCount,
  };
}

function chunkValues(
  heights: readonly number[],
  media: readonly number[],
  mediaHeights: readonly number[],
  mediaWidths: readonly number[],
): LayoutChunk[] {
  const chunks: LayoutChunk[] = [];
  for (let start = 0; start < heights.length; start += LAYOUT_CHUNK_LINES) {
    const end = Math.min(heights.length, start + LAYOUT_CHUNK_LINES);
    chunks.push(
      createChunk(
        heights.slice(start, end),
        media.slice(start, end),
        mediaHeights.slice(start, end),
        mediaWidths.slice(start, end),
      ),
    );
  }
  return chunks;
}

function estimatedChunks(
  model: SourceDocumentModel,
  config: VirtualSourceLayoutConfig,
  start = 0,
  end = model.lines.length,
): LayoutChunk[] {
  const chunks: LayoutChunk[] = [];
  for (let chunkStart = start; chunkStart < end;) {
    const chunkEnd = Math.min(end, chunkStart + LAYOUT_CHUNK_LINES);
    const heights = new Array<number>(chunkEnd - chunkStart);
    const media = new Array<number>(chunkEnd - chunkStart);
    const mediaHeights = new Array<number>(chunkEnd - chunkStart);
    const mediaWidths = new Array<number>(chunkEnd - chunkStart);
    for (let index = chunkStart; index < chunkEnd; index += 1) {
      const estimate = estimateLineHeight(model, index, config);
      heights[index - chunkStart] = estimate.height;
      media[index - chunkStart] = estimate.media.kind;
      mediaHeights[index - chunkStart] = estimate.media.height;
      mediaWidths[index - chunkStart] = estimate.media.width;
    }
    chunks.push(createChunk(heights, media, mediaHeights, mediaWidths));
    chunkStart = chunkEnd;
  }
  return chunks;
}

function wrapsAt(
  wraps: readonly PlacedWrap[],
  y: number,
): readonly PlacedWrap[] {
  return wraps.filter((wrap) => wrap.top <= y && wrap.bottom > y);
}

function wrapInsets(
  wraps: readonly PlacedWrap[],
  y: number,
  contentWidth: number,
): { left: number; right: number } {
  let left = 0;
  let right = 0;
  for (const wrap of wrapsAt(wraps, y)) {
    if (wrap.align === "left") {
      left = Math.max(left, wrap.right);
    } else {
      right = Math.max(right, contentWidth - wrap.left);
    }
  }
  return { left, right };
}

function placeWrap(
  source: SourceWrap,
  preferredTop: number,
  previousTop: number,
  active: readonly PlacedWrap[],
  contentWidth: number,
): PlacedWrap {
  let top = Math.max(preferredTop, previousTop);
  const width = Math.min(source.width, contentWidth);
  for (;;) {
    const occupying = active.filter(
      (wrap) => wrap.bottom > top && wrap.top < top + source.height,
    );
    let leftInset = 0;
    let rightInset = 0;
    for (const wrap of occupying) {
      if (wrap.align === "left") {
        leftInset = Math.max(leftInset, wrap.right);
      } else {
        rightInset = Math.max(rightInset, contentWidth - wrap.left);
      }
    }
    const left =
      source.align === "left" ? leftInset : contentWidth - rightInset - width;
    const fits =
      source.align === "left"
        ? left + width <= contentWidth - rightInset + 0.01
        : left >= leftInset - 0.01;
    if (fits) {
      return {
        ...source,
        bottom: top + source.height,
        left,
        right: left + width,
        top,
        width,
      };
    }
    const nextTop = Math.min(
      ...occupying.map((wrap) => wrap.bottom).filter((bottom) => bottom > top),
    );
    if (!Number.isFinite(nextTop)) {
      return {
        ...source,
        bottom: top + source.height,
        left: source.align === "left" ? 0 : contentWidth - width,
        right: source.align === "left" ? width : contentWidth,
        top,
        width,
      };
    }
    top = nextTop;
  }
}

function occupiedTextHeight(
  source: string,
  top: number,
  wraps: readonly PlacedWrap[],
  config: VirtualSourceLayoutConfig,
): number {
  if (!config.wrap) {
    return config.lineHeight;
  }
  let remaining = Math.max(1, visualColumns(source, config.tabSize));
  let rows = 0;
  while (remaining > 0) {
    const y = top + rows * config.lineHeight;
    const occupying = wrapsAt(wraps, y);
    const nextEvent = Math.min(
      ...wraps
        .flatMap((wrap) => [
          wrap.top > y ? wrap.top : Number.POSITIVE_INFINITY,
          wrap.bottom > y ? wrap.bottom : Number.POSITIVE_INFINITY,
        ])
        .filter(Number.isFinite),
    );
    const insets = wrapInsets(occupying, y, config.contentWidth);
    const capacity = Math.max(
      1,
      Math.floor(
        (config.contentWidth - insets.left - insets.right) /
          config.characterWidth,
      ),
    );
    const requiredRows = Math.ceil(remaining / capacity);
    const stableRows = Number.isFinite(nextEvent)
      ? Math.max(1, Math.ceil((nextEvent - y) / config.lineHeight))
      : requiredRows;
    const consumedRows = Math.min(requiredRows, stableRows);
    remaining -= consumedRows * capacity;
    rows += consumedRows;
  }
  return Math.max(config.lineHeight, rows * config.lineHeight);
}

export class VirtualSourceLayout {
  private baseTotalHeightValue = 0;
  private chunkStarts: number[] = [];
  private chunks: LayoutChunk[] = [];
  private config: VirtualSourceLayoutConfig;
  private flowAdjustmentLines: number[] = [];
  private flowAdjustmentPrefixes: number[] = [];
  private flowAdjustments = new Map<number, FlowAdjustment>();
  private floatIntrusions = new Map<
    number,
    readonly VirtualSourceFloatIntrusion[]
  >();
  private heightTree: number[] = [];
  private lineCountValue = 0;
  private mediaCountValue = 0;
  private model: SourceDocumentModel;
  private sourceWraps: SourceWrap[] = [];
  private totalHeightValue = 0;
  private wrapPlacements = new Map<number, VirtualSourceWrapPlacement>();
  private wrapVisualHeights = new Map<number, number>();

  constructor(model: SourceDocumentModel, config: VirtualSourceLayoutConfig) {
    this.config = config;
    this.model = model;
    this.chunks = estimatedChunks(model, config);
    this.rebuildIndex();
  }

  get hasMedia(): boolean {
    return this.mediaCountValue > 0;
  }

  get lineCount(): number {
    return this.lineCountValue;
  }

  get totalHeight(): number {
    return this.totalHeightValue;
  }

  heightAt(index: number): number {
    if (this.lineCountValue === 0) {
      return this.config.lineHeight;
    }
    const boundary = this.locateBoundary(
      Math.min(Math.max(0, index), this.lineCountValue - 1),
    );
    const base =
      this.chunks[boundary.chunkIndex]?.heights[boundary.localIndex] ??
      this.config.lineHeight;
    return base + (this.flowAdjustments.get(index)?.height ?? 0);
  }

  visualHeightAt(index: number): number {
    return Math.max(
      this.heightAt(index),
      this.wrapVisualHeights.get(index) ?? 0,
    );
  }

  floatIntrusionsAt(index: number): readonly VirtualSourceFloatIntrusion[] {
    return this.floatIntrusions.get(index) ?? [];
  }

  wrapPlacementAt(index: number): VirtualSourceWrapPlacement | undefined {
    return this.wrapPlacements.get(index);
  }

  canMeasureLine(index: number): boolean {
    return (
      this.mediaKindAt(index) < MEDIA_WRAP_LEFT &&
      !this.floatIntrusions.has(index)
    );
  }

  lineAtOffset(offset: number): number {
    if (this.lineCountValue === 0) {
      return 0;
    }
    if (this.sourceWraps.length === 0) {
      return this.baseLineAtOffset(offset);
    }
    const target = Math.min(
      Math.max(0, offset),
      Math.max(0, this.totalHeightValue - 0.001),
    );
    let low = 0;
    let high = this.lineCountValue;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (this.flowBoundaryTop(middle) <= target) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return Math.min(this.lineCountValue - 1, low);
  }

  lineTop(index: number): number {
    const target = Math.min(Math.max(0, index), this.lineCountValue);
    if (this.sourceWraps.length === 0) {
      return this.baseLineTop(target);
    }
    if (target === this.lineCountValue) {
      return this.totalHeightValue;
    }
    return (
      this.flowBoundaryTop(target) +
      (this.flowAdjustments.get(target)?.before ?? 0)
    );
  }

  reconfigure(
    model: SourceDocumentModel,
    config: VirtualSourceLayoutConfig,
  ): boolean {
    if (sameConfig(this.config, config)) {
      return false;
    }
    this.config = config;
    this.model = model;
    this.chunks = estimatedChunks(model, config);
    this.rebuildIndex();
    return true;
  }

  setMeasuredHeight(index: number, height: number): boolean {
    return this.setMeasuredHeights([{ height, index }]);
  }

  setMeasuredHeights(
    measurements: readonly { height: number; index: number }[],
  ): boolean {
    let changed = false;
    for (const { height, index } of measurements) {
      changed = this.setBaseMeasuredHeight(index, height) || changed;
    }
    if (changed) {
      this.rebuildWrapLayout();
    }
    return changed;
  }

  private setBaseMeasuredHeight(index: number, height: number): boolean {
    if (
      index < 0 ||
      index >= this.lineCountValue ||
      !Number.isFinite(height) ||
      height <= 0 ||
      !this.canMeasureLine(index)
    ) {
      return false;
    }
    const boundary = this.locateBoundary(index);
    const chunk = this.chunks[boundary.chunkIndex]!;
    const next = Math.max(this.config.lineHeight, height);
    const previous = chunk.heights[boundary.localIndex]!;
    if (
      (chunk.media[boundary.localIndex] === MEDIA_FLOW && next < previous) ||
      Math.abs(previous - next) < 0.5
    ) {
      return false;
    }
    const delta = next - previous;
    chunk.heights[boundary.localIndex] = next;
    chunk.totalHeight += delta;
    this.baseTotalHeightValue += delta;
    this.addChunkHeight(boundary.chunkIndex, delta);
    return true;
  }

  updateModel(
    previous: SourceDocumentModel,
    next: SourceDocumentModel,
    change?: SourceTextChange,
  ): void {
    if (!change) {
      this.model = next;
      this.chunks = estimatedChunks(next, this.config);
      this.rebuildIndex();
      return;
    }
    const start = Math.max(0, next.change.startLine);
    const nextEnd = Math.min(next.lines.length, next.change.endLine);
    const previousEnd = Math.min(
      previous.lines.length,
      Math.max(start, nextEnd + previous.lines.length - next.lines.length),
    );
    const startBoundary = this.locateBoundary(start);
    const endBoundary = this.locateBoundary(previousEnd);
    const replaceStart = startBoundary.chunkIndex;
    const replaceEnd =
      endBoundary.localIndex === 0
        ? endBoundary.chunkIndex
        : endBoundary.chunkIndex + 1;
    const prefixChunk = this.chunks[startBoundary.chunkIndex];
    const suffixChunk = this.chunks[endBoundary.chunkIndex];
    const heights =
      prefixChunk?.heights.slice(0, startBoundary.localIndex) ?? [];
    const media = prefixChunk?.media.slice(0, startBoundary.localIndex) ?? [];
    const mediaHeights =
      prefixChunk?.mediaHeights.slice(0, startBoundary.localIndex) ?? [];
    const mediaWidths =
      prefixChunk?.mediaWidths.slice(0, startBoundary.localIndex) ?? [];

    for (let index = start; index < nextEnd; index += 1) {
      const estimate = estimateLineHeight(next, index, this.config);
      heights.push(estimate.height);
      media.push(estimate.media.kind);
      mediaHeights.push(estimate.media.height);
      mediaWidths.push(estimate.media.width);
    }
    if (endBoundary.localIndex > 0 && suffixChunk) {
      heights.push(...suffixChunk.heights.slice(endBoundary.localIndex));
      media.push(...suffixChunk.media.slice(endBoundary.localIndex));
      mediaHeights.push(
        ...suffixChunk.mediaHeights.slice(endBoundary.localIndex),
      );
      mediaWidths.push(
        ...suffixChunk.mediaWidths.slice(endBoundary.localIndex),
      );
    }

    this.chunks.splice(
      replaceStart,
      Math.max(0, replaceEnd - replaceStart),
      ...chunkValues(heights, media, mediaHeights, mediaWidths),
    );
    this.normalizeAround(replaceStart);
    this.model = next;
    this.rebuildIndex();
    if (this.lineCountValue !== next.lines.length) {
      this.chunks = estimatedChunks(next, this.config);
      this.rebuildIndex();
    }
  }

  viewportRange(
    scrollTop: number,
    clientHeight: number,
    overscanLines: number,
  ): SourceViewportRange {
    if (this.lineCountValue === 0) {
      return { endLine: 0, startLine: 0 };
    }
    const first = this.lineAtOffset(scrollTop);
    const last = this.lineAtOffset(
      Math.max(scrollTop, scrollTop + clientHeight),
    );
    return {
      endLine: Math.min(this.lineCountValue, last + overscanLines + 1),
      startLine: Math.max(0, first - overscanLines),
    };
  }

  private addChunkHeight(index: number, delta: number): void {
    for (
      let treeIndex = index + 1;
      treeIndex < this.heightTree.length;
      treeIndex += treeIndex & -treeIndex
    ) {
      this.heightTree[treeIndex] = (this.heightTree[treeIndex] ?? 0) + delta;
    }
  }

  private baseHeightAt(index: number): number {
    if (index < 0 || index >= this.lineCountValue) {
      return this.config.lineHeight;
    }
    const boundary = this.locateBoundary(index);
    return (
      this.chunks[boundary.chunkIndex]?.heights[boundary.localIndex] ??
      this.config.lineHeight
    );
  }

  private baseLineAtOffset(offset: number): number {
    const target = Math.min(
      Math.max(0, offset),
      Math.max(0, this.baseTotalHeightValue - 0.001),
    );
    let chunkIndex = 0;
    let chunkTop = 0;
    let bit = 1;
    while (bit * 2 < this.heightTree.length) {
      bit *= 2;
    }
    for (; bit > 0; bit >>= 1) {
      const next = chunkIndex + bit;
      const height = this.heightTree[next];
      if (
        next < this.heightTree.length &&
        height !== undefined &&
        chunkTop + height <= target
      ) {
        chunkIndex = next;
        chunkTop += height;
      }
    }
    const chunk = this.chunks[Math.min(chunkIndex, this.chunks.length - 1)];
    const start =
      this.chunkStarts[Math.min(chunkIndex, this.chunkStarts.length - 1)] ?? 0;
    if (!chunk) {
      return 0;
    }
    let localIndex = 0;
    while (
      localIndex + 1 < chunk.heights.length &&
      chunkTop + chunk.heights[localIndex]! <= target
    ) {
      chunkTop += chunk.heights[localIndex]!;
      localIndex += 1;
    }
    return Math.min(this.lineCountValue - 1, start + localIndex);
  }

  private baseLineTop(index: number): number {
    const target = Math.min(Math.max(0, index), this.lineCountValue);
    if (target === this.lineCountValue) {
      return this.baseTotalHeightValue;
    }
    const boundary = this.locateBoundary(target);
    let top = this.prefixChunkHeight(boundary.chunkIndex);
    const heights = this.chunks[boundary.chunkIndex]?.heights ?? [];
    for (let local = 0; local < boundary.localIndex; local += 1) {
      top += heights[local]!;
    }
    return top;
  }

  private flowAdjustmentPrefix(index: number): number {
    let low = 0;
    let high = this.flowAdjustmentLines.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.flowAdjustmentLines[middle]! < index) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low === 0 ? 0 : this.flowAdjustmentPrefixes[low - 1]!;
  }

  private flowBoundaryTop(index: number): number {
    return this.baseLineTop(index) + this.flowAdjustmentPrefix(index);
  }

  private locateBoundary(index: number): ChunkBoundary {
    if (this.chunks.length === 0 || index >= this.lineCountValue) {
      return {
        chunkIndex: this.chunks.length,
        localIndex: 0,
      };
    }
    let low = 0;
    let high = this.chunkStarts.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      if (this.chunkStarts[middle]! <= index) {
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    const chunkIndex = Math.max(0, high);
    return {
      chunkIndex,
      localIndex: index - this.chunkStarts[chunkIndex]!,
    };
  }

  private normalizeAround(index: number): void {
    if (this.chunks.length < 2) {
      return;
    }
    const start = Math.max(0, index - 1);
    const end = Math.min(this.chunks.length, index + 3);
    const heights: number[] = [];
    const media: number[] = [];
    const mediaHeights: number[] = [];
    const mediaWidths: number[] = [];
    for (let chunkIndex = start; chunkIndex < end; chunkIndex += 1) {
      heights.push(...this.chunks[chunkIndex]!.heights);
      media.push(...this.chunks[chunkIndex]!.media);
      mediaHeights.push(...this.chunks[chunkIndex]!.mediaHeights);
      mediaWidths.push(...this.chunks[chunkIndex]!.mediaWidths);
    }
    this.chunks.splice(
      start,
      end - start,
      ...chunkValues(heights, media, mediaHeights, mediaWidths),
    );
  }

  private mediaKindAt(index: number): number {
    if (index < 0 || index >= this.lineCountValue) {
      return MEDIA_NONE;
    }
    const boundary = this.locateBoundary(index);
    return (
      this.chunks[boundary.chunkIndex]?.media[boundary.localIndex] ?? MEDIA_NONE
    );
  }

  private rebuildWrapLayout(): void {
    this.flowAdjustmentLines = [];
    this.flowAdjustmentPrefixes = [];
    this.flowAdjustments.clear();
    this.floatIntrusions.clear();
    this.wrapPlacements.clear();
    this.wrapVisualHeights.clear();
    if (this.sourceWraps.length === 0 || this.lineCountValue === 0) {
      this.totalHeightValue = this.baseTotalHeightValue;
      return;
    }

    const wrapLines = new Set(this.sourceWraps.map((wrap) => wrap.lineIndex));
    const active: PlacedWrap[] = [];
    let accumulatedAdjustment = 0;
    let cursor = this.sourceWraps[0]!.lineIndex;
    let lastPlacedTop = 0;
    let maximumFloatBottom = 0;
    let wrapCursor = 0;

    while (
      cursor < this.lineCountValue &&
      (active.length > 0 || wrapCursor < this.sourceWraps.length)
    ) {
      if (active.length === 0) {
        cursor = Math.max(
          cursor,
          this.sourceWraps[wrapCursor]?.lineIndex ?? this.lineCountValue,
        );
      }
      if (cursor >= this.lineCountValue) {
        break;
      }

      const boundaryTop = this.baseLineTop(cursor) + accumulatedAdjustment;
      for (let index = active.length - 1; index >= 0; index -= 1) {
        if (active[index]!.bottom <= boundaryTop) {
          active.splice(index, 1);
        }
      }
      const line = this.model.lines[cursor];
      const immediateAfterWrap = wrapLines.has(cursor - 1);
      const clearHeading =
        Boolean(line?.heading) &&
        !immediateAfterWrap &&
        this.mediaKindAt(cursor) !== MEDIA_FLOW;
      const clearanceBottom = clearHeading
        ? active.reduce(
            (bottom, wrap) => Math.max(bottom, wrap.bottom),
            boundaryTop,
          )
        : boundaryTop;
      const before = Math.max(0, clearanceBottom - boundaryTop);
      const contentTop = boundaryTop + before;
      for (let index = active.length - 1; index >= 0; index -= 1) {
        if (active[index]!.bottom <= contentTop) {
          active.splice(index, 1);
        }
      }

      const intrusions = active
        .filter((wrap) => wrap.bottom > contentTop)
        .map((wrap) => ({
          align: wrap.align,
          height: wrap.bottom - contentTop,
          top: Math.max(0, wrap.top - contentTop),
          width: wrap.right - wrap.left,
        }));
      if (intrusions.length > 0) {
        this.floatIntrusions.set(cursor, intrusions);
      }

      const mediaKind = this.mediaKindAt(cursor);
      const baseHeight = this.baseHeightAt(cursor);
      const occupiedHeight =
        mediaKind === MEDIA_NONE && line
          ? occupiedTextHeight(line.source, contentTop, active, this.config)
          : baseHeight;
      const height = Math.max(0, occupiedHeight - baseHeight);
      const total = before + height;
      if (total > 0) {
        accumulatedAdjustment += total;
        this.flowAdjustments.set(cursor, { before, height });
        this.flowAdjustmentLines.push(cursor);
        this.flowAdjustmentPrefixes.push(accumulatedAdjustment);
      }

      while (this.sourceWraps[wrapCursor]?.lineIndex === cursor) {
        const sourceWrap = this.sourceWraps[wrapCursor]!;
        const placed = placeWrap(
          sourceWrap,
          contentTop,
          lastPlacedTop,
          active,
          this.config.contentWidth,
        );
        active.push(placed);
        lastPlacedTop = placed.top;
        maximumFloatBottom = Math.max(maximumFloatBottom, placed.bottom);
        this.wrapVisualHeights.set(
          cursor,
          Math.max(
            this.wrapVisualHeights.get(cursor) ?? 0,
            placed.bottom - contentTop,
          ),
        );
        this.wrapPlacements.set(cursor, {
          align: placed.align,
          inset:
            placed.align === "left"
              ? placed.left
              : this.config.contentWidth - placed.right,
          top: placed.top - contentTop,
        });
        wrapCursor += 1;
      }
      cursor += 1;
    }

    this.totalHeightValue = Math.max(
      this.baseTotalHeightValue + accumulatedAdjustment,
      maximumFloatBottom,
    );
  }

  private prefixChunkHeight(count: number): number {
    let total = 0;
    for (
      let index = Math.min(count, this.chunks.length);
      index > 0;
      index -= index & -index
    ) {
      total += this.heightTree[index] ?? 0;
    }
    return total;
  }

  private rebuildIndex(): void {
    this.chunkStarts = new Array<number>(this.chunks.length);
    this.heightTree = new Array<number>(this.chunks.length + 1).fill(0);
    this.lineCountValue = 0;
    this.mediaCountValue = 0;
    this.baseTotalHeightValue = 0;
    this.sourceWraps = [];
    for (let chunkIndex = 0; chunkIndex < this.chunks.length; chunkIndex += 1) {
      const chunk = this.chunks[chunkIndex]!;
      this.chunkStarts[chunkIndex] = this.lineCountValue;
      if (chunk.wrapCount > 0) {
        for (
          let localIndex = 0;
          localIndex < chunk.media.length;
          localIndex += 1
        ) {
          const kind = chunk.media[localIndex] ?? MEDIA_NONE;
          if (kind < MEDIA_WRAP_LEFT) {
            continue;
          }
          this.sourceWraps.push({
            align: kind === MEDIA_WRAP_RIGHT ? "right" : "left",
            height: chunk.mediaHeights[localIndex]!,
            lineIndex: this.lineCountValue + localIndex,
            width: chunk.mediaWidths[localIndex]!,
          });
        }
      }
      this.lineCountValue += chunk.heights.length;
      this.mediaCountValue += chunk.mediaCount;
      this.baseTotalHeightValue += chunk.totalHeight;
      this.addChunkHeight(chunkIndex, chunk.totalHeight);
    }
    this.rebuildWrapLayout();
  }
}
